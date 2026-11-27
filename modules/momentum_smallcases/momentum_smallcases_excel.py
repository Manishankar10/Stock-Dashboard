"""
CAPITAL DESK - MOMENTUM SMALLCASES EXCEL EXPORT ENGINE
Generates professional, presentation-ready Excel workbooks (.xlsx) for:
Ranked Stocks by Momentum Formula covering ALL eligible stocks in universe,
ordered descending by total formula score.
"""

import io
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from modules.momentum_smallcases.momentum_smallcases_store import (
    get_user_strategy,
    get_strategy_index_constituents,
)
from modules.momentum_smallcases.momentum_smallcases_calculator import (
    calculate_stock_momentum_metrics,
    is_in_trading_hours_now,
    parse_date_fast,
    prewarm_stock_prices_cache,
    rank_and_evaluate_universe,
)


def _enrich_ranked_stocks_with_windows(strategy, run, all_stocks, prewarm=True):
    """
    Returns a shallow-copied list of ranked stock dicts with `windows` populated
    (`ret_*_start`/`end`, `vol_*_start`/`end`) for Excel audit columns without
    mutating stored DB snapshots.
    """
    if not all_stocks:
        return []
    exec_date_str = (run or {}).get("executed_date") or (run or {}).get("scheduled_date")
    exec_date = parse_date_fast(exec_date_str)
    if exec_date is None:
        return [dict(s) for s in all_stocks]

    td = (strategy or {}).get("trading_days_per_month", 30)
    in_trading = is_in_trading_hours_now() if (exec_date == date.today()) else False

    missing_syms = [
        str(s.get("symbol") or "").strip().upper()
        for s in all_stocks
        if not s.get("windows") and s.get("symbol")
    ]
    missing_syms = list(dict.fromkeys(missing_syms))
    if not missing_syms:
        return [dict(s) for s in all_stocks]

    if prewarm:
        win_min = (exec_date - timedelta(days=450)).isoformat()
        win_max = exec_date.isoformat()
        prewarm_stock_prices_cache(missing_syms, min_date=win_min, max_date=win_max)

    windows_by_sym = {}

    def _calc(sym):
        try:
            m = calculate_stock_momentum_metrics(
                sym, exec_date, in_trading_hours=in_trading, trading_days_per_month=td, include_windows=True
            )
            if m and m.get("windows"):
                return sym, m["windows"]
        except Exception:
            pass
        return sym, None

    worker_count = min(8, max(1, len(missing_syms)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        for sym, w in executor.map(_calc, missing_syms):
            if w:
                windows_by_sym[sym] = w

    enriched = []
    for s in all_stocks:
        copy_s = dict(s)
        sym = str(copy_s.get("symbol") or "").strip().upper()
        if not copy_s.get("windows") and sym in windows_by_sym:
            copy_s["windows"] = windows_by_sym[sym]
        enriched.append(copy_s)
    return enriched


def _compute_run_all_ranked_stocks(strat, target_run, constituents, username=None):
    """Computes missing all_ranked_stocks for a run using pre-loaded strategy & constituents."""
    exec_date_str = target_run.get("executed_date") or target_run.get("scheduled_date")
    exec_date = parse_date_fast(exec_date_str, fallback=datetime.now().date())

    ranked_displayed, _eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target_run.get("formula_used") or strat.get("formula"),
        no_of_stocks=strat.get("no_of_stocks", 12),
        exit_regime_ranking=strat.get("exit_regime_ranking", 15),
        return_meta=True,
        save_cache=False,
        trading_days_per_month=strat.get("trading_days_per_month", 30)
    )
    all_calculated = meta.get("all_stocks") or ranked_displayed or []

    executed_map = {s["symbol"]: s for s in target_run.get("ranked_stocks", [])}
    for s in all_calculated:
        sym = s["symbol"]
        if sym in executed_map:
            ex = executed_map[sym]
            s["action"] = ex.get("action") or s.get("action") or "—"
            s["quantity"] = ex.get("quantity") or s.get("quantity") or 0
            s["allocated_amount"] = ex.get("allocated_amount") or s.get("allocated_amount") or 0.0
            s["weight_percent"] = ex.get("weight_percent") or s.get("weight_percent") or 0.0
            s["fee"] = ex.get("fee") or s.get("fee") or 0.0
            s["is_held"] = ex.get("is_held", s.get("is_held", False))
        else:
            s.setdefault("action", "—")
            s.setdefault("quantity", 0)
            s.setdefault("allocated_amount", 0.0)
            s.setdefault("weight_percent", 0.0)
            s.setdefault("fee", 0.0)
            s.setdefault("is_held", False)
    return all_calculated


def _persist_backfilled_all_ranked(strategy_id, updated_runs_map, username=None, runs_list=None, runs_externalized=False):
    """Persists newly backfilled all_ranked_stocks into normalized snapshot collection or embedded runs."""
    if not updated_runs_map:
        return
    try:
        from modules.momentum_smallcases.momentum_smallcases_store import (
            RANKED_SNAPSHOTS_COLLECTION,
            _resolve_username,
            _safe_user,
            load_user_momentum_smallcases,
            save_user_momentum_smallcases,
        )
        import db_store
        user = _resolve_username(username)
        safe_u = _safe_user(user)
        if db_store.db is not None and user:
            db = db_store.db
            if runs_externalized and runs_list is not None:
                from pymongo import ReplaceOne
                ops = []
                for idx, stocks in updated_runs_map.items():
                    if 0 <= idx < len(runs_list):
                        rid = runs_list[idx].get("run_id") or f"run_{idx}"
                        doc_id = f"{strategy_id}:{rid}"
                        ops.append(ReplaceOne(
                            {"_id": doc_id},
                            {
                                "_id": doc_id,
                                "username": safe_u,
                                "strategy_id": strategy_id,
                                "run_id": rid,
                                "run_index": idx,
                                "all_ranked_stocks": stocks,
                            },
                            upsert=True,
                        ))
                if ops:
                    db[RANKED_SNAPSHOTS_COLLECTION].bulk_write(ops, ordered=False)
                return

            set_fields = {
                f"data.strategies.$.runs.{idx}.all_ranked_stocks": stocks
                for idx, stocks in updated_runs_map.items()
            }
            res = db["momentum_smallcases"].update_one(
                {"_id": safe_u, "data.strategies.id": strategy_id},
                {"$set": set_fields}
            )
            if res.matched_count > 0:
                return
        data = load_user_momentum_smallcases(user)
        for st in data.get("strategies", []):
            if st.get("id") == strategy_id:
                runs = st.get("runs") or []
                for idx, stocks in updated_runs_map.items():
                    if 0 <= idx < len(runs):
                        runs[idx]["all_ranked_stocks"] = stocks
                save_user_momentum_smallcases(data, user)
                break
    except Exception:
        pass


def get_run_all_ranked_stocks(strategy_id, run_index=None, username=None):
    """
    Retrieves all eligible constituent stocks calculated and ranked by momentum score
    for a strategy run. Checks normalized snapshot collection before recomputing.
    Returns: (strategy, run, all_stocks_list)
    """
    strat = get_user_strategy(strategy_id, username=username, include_all_ranked=False)
    if not strat:
        raise ValueError(f"Strategy '{strategy_id}' not found")

    runs = strat.get("runs", [])
    if not runs:
        raise ValueError(f"Strategy '{strategy_id}' has no execution runs yet.")

    if run_index is None:
        idx = len(runs) - 1
    else:
        try:
            idx = int(run_index)
        except Exception:
            idx = len(runs) - 1

    if idx < 0 or idx >= len(runs):
        idx = max(0, min(len(runs) - 1, idx))

    target_run = runs[idx]
    all_stocks = target_run.get("all_ranked_stocks")
    if all_stocks and len(all_stocks) > 0:
        return strat, target_run, all_stocks

    # Direct single-snapshot lookup in momentum_smallcase_ranked_snapshots
    try:
        from modules.momentum_smallcases.momentum_smallcases_store import RANKED_SNAPSHOTS_COLLECTION
        import db_store
        if db_store.db is not None:
            rid = target_run.get("run_id")
            q = {"_id": f"{strategy_id}:{rid}"} if rid else {"strategy_id": strategy_id, "run_index": idx}
            snap = db_store.db[RANKED_SNAPSHOTS_COLLECTION].find_one(q, {"_id": 0, "all_ranked_stocks": 1})
            if not snap and rid:
                snap = db_store.db[RANKED_SNAPSHOTS_COLLECTION].find_one(
                    {"strategy_id": strategy_id, "run_index": idx},
                    {"_id": 0, "all_ranked_stocks": 1},
                )
            if snap and snap.get("all_ranked_stocks"):
                all_stocks = snap["all_ranked_stocks"]
                target_run["all_ranked_stocks"] = all_stocks
                return strat, target_run, all_stocks
    except Exception:
        pass

    # Legacy embedded check if include_all_ranked=False stripped it on non-externalized doc
    if not strat.get("runs_externalized"):
        full_strat = get_user_strategy(strategy_id, username=username, include_all_ranked=True)
        if full_strat and idx < len(full_strat.get("runs", [])):
            leg = full_strat["runs"][idx].get("all_ranked_stocks")
            if leg:
                target_run["all_ranked_stocks"] = leg
                return full_strat, full_strat["runs"][idx], leg

    constituents = get_strategy_index_constituents(
        strat.get("index_id"),
        strat.get("index_type", "manual"),
        username=username
    )
    if not constituents:
        raise ValueError(f"No constituents found for index '{strat.get('index_name')}'")

    all_calculated = _compute_run_all_ranked_stocks(strat, target_run, constituents, username=username)
    target_run["all_ranked_stocks"] = all_calculated
    _persist_backfilled_all_ranked(
        strategy_id,
        {idx: all_calculated},
        username=username,
        runs_list=runs,
        runs_externalized=bool(strat.get("runs_externalized")),
    )
    return strat, target_run, all_calculated


def format_run_sheet_title(run, run_index=None, used_titles=None):
    """Formats sheet title like '#1 Jan 25' or 'Init Jan 25' conforming to Excel's 31-char limit."""
    exec_date_str = run.get("executed_date") or run.get("scheduled_date") or ""
    dt = parse_date_fast(exec_date_str)
    month_yr = dt.strftime("%b %y") if dt else "Date"

    r_num = run.get("run_number")
    if r_num is None and run_index is not None:
        r_num = run_index

    is_init = (run.get("run_type") == "INIT" or r_num == 0 or r_num is None)
    if is_init:
        base_title = f"#0 {month_yr}" if r_num == 0 else f"Init {month_yr}"
    else:
        base_title = f"#{r_num} {month_yr}"

    base_title = re.sub(r'[\:\\\/\?\*\[\]]', '', base_title).strip()[:28]

    if used_titles is not None:
        title = base_title
        counter = 1
        while title in used_titles:
            title = f"{base_title}_{counter}"[:31]
            counter += 1
        used_titles.add(title)
        return title
    return base_title[:31]


def populate_ranked_stocks_worksheet(ws, strategy, run, all_stocks, sheet_title=None):
    """Populates an openpyxl Worksheet with formatted ranked stocks for a specific run."""
    ws.title = sheet_title or format_run_sheet_title(run)
    ws.views.sheetView[0].showGridLines = True
    ws.sheet_properties.outlinePr.summaryRight = False
    ws.sheet_view.showOutlineSymbols = True

    # Palettes & Styling
    navy_header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    detail_header_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
    meta_bg_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    top_tier_fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")    # soft emerald
    exit_tier_fill = PatternFill(start_color="FEFCE8", end_color="FEFCE8", fill_type="solid")   # soft amber
    alt_row_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    font_title = Font(name="Segoe UI", size=15, bold=True, color="FFFFFF")
    font_meta = Font(name="Segoe UI", size=9.5, color="CBD5E1")
    font_meta_bold = Font(name="Segoe UI", size=9.5, bold=True, color="FFFFFF")
    font_formula = Font(name="Consolas", size=9.5, color="34D399")
    font_col_header = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    font_detail_header = Font(name="Segoe UI", size=9.5, bold=True, color="E2E8F0")
    font_data = Font(name="Segoe UI", size=10, color="0F172A")
    font_detail_data = Font(name="Segoe UI", size=9.5, color="475569")
    font_sym_bold = Font(name="Segoe UI", size=10, bold=True, color="0F172A")
    font_top_tier = Font(name="Segoe UI", size=10, bold=True, color="047857")
    font_exit_tier = Font(name="Segoe UI", size=10, bold=True, color="B45309")
    font_excluded = Font(name="Segoe UI", size=9.5, color="64748B")
    font_action_buy = Font(name="Segoe UI", size=9.5, bold=True, color="047857")
    font_action_hold = Font(name="Segoe UI", size=9.5, bold=True, color="2563EB")
    font_action_exit = Font(name="Segoe UI", size=9.5, bold=True, color="DC2626")

    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0")
    )

    header_border = Border(
        left=Side(style="thin", color="334155"),
        right=Side(style="thin", color="334155"),
        top=Side(style="medium", color="0F172A"),
        bottom=Side(style="medium", color="0F172A")
    )

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")

    strat_name = strategy.get("name", "Momentum Smallcase")
    index_name = strategy.get("index_name") or strategy.get("index_id") or "Universe"
    run_title = run.get("title") or ("Init Run" if run.get("run_type") == "INIT" else "Rebalance")
    exec_date = run.get("executed_date") or run.get("scheduled_date") or ""
    formula_str = run.get("formula_used") or strategy.get("formula") or "Standard Momentum"
    no_of_stocks = strategy.get("no_of_stocks", 12)
    exit_regime = strategy.get("exit_regime_ranking", 15)

    # Column specifications: (title, align, width, is_detail_col)
    columns_spec = [
        ("RANK", align_center, 9, False),
        ("STOCK SYMBOL", align_left, 17, False),
        ("PORTFOLIO TIER", align_center, 16, False),
        ("ACTION", align_center, 12, False),
        ("MOMENTUM SCORE", align_right, 18, False),
        ("CLOSING PRICE (₹)", align_right, 18, False),
        ("1M RETURN", align_right, 15, False),
        ("1M START", align_center, 15, True),
        ("1M END", align_center, 15, True),
        ("2M RETURN", align_right, 15, False),
        ("2M START", align_center, 15, True),
        ("2M END", align_center, 15, True),
        ("5M RETURN", align_right, 15, False),
        ("5M START", align_center, 15, True),
        ("5M END", align_center, 15, True),
        ("9M RETURN", align_right, 15, False),
        ("9M START", align_center, 15, True),
        ("9M END", align_center, 15, True),
        ("1M VOLATILITY", align_right, 16, False),
        ("1M VOL START", align_center, 15, True),
        ("1M VOL END", align_center, 15, True),
        ("3M VOLATILITY", align_right, 16, False),
        ("3M VOL START", align_center, 15, True),
        ("3M VOL END", align_center, 15, True),
        ("QUANTITY", align_right, 12, False),
        ("ALLOCATED AMOUNT", align_right, 19, False),
        ("PORTFOLIO WEIGHT", align_right, 17, False),
    ]
    last_col_letter = get_column_letter(len(columns_spec))

    # 1. Metadata Block (Rows 1 to 5)
    meta_rows = [
        (1, 36, font_title, f"CAPITAL DESK  ·  {strat_name.upper()}  ·  RANKED STOCKS"),
        (2, 20, font_meta, f"Milestone: {run_title}  |  Executed Date: {exec_date}  |  Index Universe: {index_name}  |  Eligible Stocks Evaluated: {len(all_stocks)}"),
        (3, 20, font_formula, f"Momentum Formula: {formula_str}"),
        (4, 20, font_meta, f"Portfolio Allocation Rules: Top {no_of_stocks} Picks (Green / Top Selection)  |  Exit Regime: Rank <= {exit_regime} (Dark Yellow / Safe Holding)  |  Ranks > {exit_regime} (Excluded)"),
    ]
    for r_idx, r_height, r_font, r_val in meta_rows:
        ws.merge_cells(f"A{r_idx}:{last_col_letter}{r_idx}")
        c = ws[f"A{r_idx}"]
        c.value = r_val
        c.font = r_font
        c.fill = meta_bg_fill
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[r_idx].height = r_height

    # Row 5 Blank Separator
    ws.row_dimensions[5].height = 8

    # 2. Table Column Headers (Row 6)
    header_row_idx = 6
    ws.row_dimensions[header_row_idx].height = 28

    for col_idx, (col_name, col_align, _width, is_detail) in enumerate(columns_spec, 1):
        cell = ws.cell(row=header_row_idx, column=col_idx)
        cell.value = col_name
        cell.font = font_detail_header if is_detail else font_col_header
        cell.fill = detail_header_fill if is_detail else navy_header_fill
        cell.alignment = col_align
        cell.border = header_border

    # Sort all_stocks strictly descending by score
    sorted_stocks = sorted(
        all_stocks,
        key=lambda x: float(x.get("total_score") if x.get("total_score") is not None else -9999.0),
        reverse=True,
    )

    action_font_map = {
        "BUY": font_action_buy,
        "HOLD": font_action_hold,
        "EXIT": font_action_exit,
        "SELL": font_action_exit,
    }

    # 3. Data Rows
    current_row = 7
    for i, stock in enumerate(sorted_stocks):
        rank = i + 1
        sym = stock.get("symbol", "")
        score = float(stock.get("total_score") if stock.get("total_score") is not None else 0.0)
        price = float(stock.get("price") if stock.get("price") is not None else 0.0)

        ret_1m = float(stock.get("return_1m", stock.get("ret_1m", 0.0)) or 0.0) / 100.0
        ret_2m = float(stock.get("return_2m", stock.get("ret_2m", 0.0)) or 0.0) / 100.0
        ret_5m = float(stock.get("return_5m", stock.get("ret_5m", 0.0)) or 0.0) / 100.0
        ret_9m = float(stock.get("return_9m", stock.get("ret_9m", 0.0)) or 0.0) / 100.0

        vol_1m = float(stock.get("volatility_1m", stock.get("vol_1m", 0.0)) or 0.0) / 100.0
        vol_3m = float(stock.get("volatility_3m", stock.get("vol_3m", 0.0)) or 0.0) / 100.0

        windows = stock.get("windows") or {}

        action = str(stock.get("action") or "—").strip()
        qty = int(stock.get("quantity") or 0)
        allocated = float(stock.get("allocated_amount") or 0.0)
        weight = float(stock.get("weight_percent") or 0.0) / 100.0

        if rank <= no_of_stocks:
            tier_label = "Top Selection"
            row_fill = top_tier_fill
            tier_font = font_top_tier
        elif rank <= exit_regime:
            tier_label = "Exit Regime"
            row_fill = exit_tier_fill
            tier_font = font_exit_tier
        else:
            tier_label = "Excluded"
            row_fill = alt_row_fill if (rank % 2 == 0) else PatternFill(fill_type=None)
            tier_font = font_excluded

        action_font = action_font_map.get(action, font_excluded)
        score_font = font_sym_bold if rank <= exit_regime else font_data

        ws.row_dimensions[current_row].height = 20

        # Per-cell tuples: (value, font, number_format)
        row_cells = [
            (rank, score_font, None),
            (sym, font_sym_bold, None),
            (tier_label, tier_font, None),
            (action, action_font, None),
            (score, score_font, "0.0000"),
            (price, font_data, "₹#,##0.00"),
            (ret_1m, font_data, "+0.00%;-0.00%;0.00%"),
            (windows.get("ret_1m_start", "—"), font_detail_data, None),
            (windows.get("ret_1m_end", "—"), font_detail_data, None),
            (ret_2m, font_data, "+0.00%;-0.00%;0.00%"),
            (windows.get("ret_2m_start", "—"), font_detail_data, None),
            (windows.get("ret_2m_end", "—"), font_detail_data, None),
            (ret_5m, font_data, "+0.00%;-0.00%;0.00%"),
            (windows.get("ret_5m_start", "—"), font_detail_data, None),
            (windows.get("ret_5m_end", "—"), font_detail_data, None),
            (ret_9m, font_data, "+0.00%;-0.00%;0.00%"),
            (windows.get("ret_9m_start", "—"), font_detail_data, None),
            (windows.get("ret_9m_end", "—"), font_detail_data, None),
            (vol_1m, font_data, "0.00%"),
            (windows.get("vol_1m_start", "—"), font_detail_data, None),
            (windows.get("vol_1m_end", "—"), font_detail_data, None),
            (vol_3m, font_data, "0.00%"),
            (windows.get("vol_3m_start", "—"), font_detail_data, None),
            (windows.get("vol_3m_end", "—"), font_detail_data, None),
            (qty if qty > 0 else "—", font_data, "#,##0" if qty > 0 else None),
            (allocated if allocated > 0 else "—", font_data, "₹#,##0.00" if allocated > 0 else None),
            (weight if weight > 0 else "—", font_data, "0.00%" if weight > 0 else None),
        ]

        for col_idx, (val, cell_font, num_fmt) in enumerate(row_cells, 1):
            c = ws.cell(row=current_row, column=col_idx, value=val)
            c.alignment = columns_spec[col_idx - 1][1]
            c.font = cell_font
            if num_fmt:
                c.number_format = num_fmt
            c.border = thin_border
            if row_fill.fill_type:
                c.fill = row_fill

        current_row += 1

    # Freeze panes below header (row 7) so headers stay visible on scroll
    ws.freeze_panes = "A7"

    # Set widths first, then configure collapsed Start/End column outline groups cleanly
    for col_idx, (_name, _align, width, _is_detail) in enumerate(columns_spec, 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    collapsed_groups = [
        (7, 8, 9),     # 1M RETURN -> 1M START, 1M END
        (10, 11, 12),  # 2M RETURN -> 2M START, 2M END
        (13, 14, 15),  # 5M RETURN -> 5M START, 5M END
        (16, 17, 18),  # 9M RETURN -> 9M START, 9M END
        (19, 20, 21),  # 1M VOLATILITY -> 1M VOL START, 1M VOL END
        (22, 23, 24),  # 3M VOLATILITY -> 3M VOL START, 3M VOL END
    ]
    for parent_idx, start_idx, end_idx in collapsed_groups:
        ws.column_dimensions[get_column_letter(parent_idx)].collapsed = True
        for detail_idx in range(start_idx, end_idx + 1):
            col_dim = ws.column_dimensions[get_column_letter(detail_idx)]
            col_dim.outlineLevel = 1
            col_dim.hidden = True

    return ws


def generate_ranked_stocks_workbook(strategy, run, all_stocks, sheet_title=None):
    """
    Builds an openpyxl Workbook with formatting for all eligible stocks
    ordered descending by momentum score.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    populate_ranked_stocks_worksheet(ws, strategy, run, all_stocks, sheet_title=sheet_title)
    return wb


def export_ranked_stocks_to_bytes(strategy_id, run_index=None, username=None, scope="current"):
    """
    Returns (filename, BytesIO) containing the Excel workbook.
    If scope == 'all': creates a multi-sheet workbook where each run gets its own tab (e.g. '#1 Jan 25').
    If scope == 'current': creates a single-sheet workbook titled with that run (e.g. '#1 Jan 25').
    """
    if str(scope).lower() == "all":
        strat = get_user_strategy(strategy_id, username=username)
        if not strat:
            raise ValueError(f"Strategy '{strategy_id}' not found")
        runs = strat.get("runs", [])
        if runs:
            missing_indices = [
                idx for idx, r in enumerate(runs)
                if not (r.get("all_ranked_stocks") and len(r.get("all_ranked_stocks")) > 0)
            ]
            needs_window_enrich = any(
                not all(s.get("windows") for s in (r.get("all_ranked_stocks") or []))
                for r in runs if r.get("all_ranked_stocks")
            )
            constituents = None
            pending_updates = {}
            prewarm_syms = set()
            if missing_indices:
                constituents = get_strategy_index_constituents(
                    strat.get("index_id"),
                    strat.get("index_type", "manual"),
                    username=username
                )
                if not constituents:
                    raise ValueError(f"No constituents found for index '{strat.get('index_name')}'")
                prewarm_syms.update(c["symbol"] if isinstance(c, dict) else str(c) for c in constituents)

            if needs_window_enrich:
                for r in runs:
                    for s in (r.get("all_ranked_stocks") or []):
                        if s.get("symbol"):
                            prewarm_syms.add(str(s["symbol"]).strip().upper())

            if prewarm_syms and (missing_indices or needs_window_enrich):
                run_dates = [
                    parse_date_fast(r.get("executed_date") or r.get("scheduled_date"))
                    for r in runs
                ]
                run_dates = [d for d in run_dates if d is not None]
                if run_dates:
                    win_min = (min(run_dates) - timedelta(days=450)).isoformat()
                    win_max = max(run_dates).isoformat()
                    prewarm_stock_prices_cache(list(prewarm_syms), min_date=win_min, max_date=win_max)

            wb = openpyxl.Workbook()
            used_titles = set()
            for idx, target_run in enumerate(runs):
                all_stocks = target_run.get("all_ranked_stocks")
                if not (all_stocks and len(all_stocks) > 0):
                    all_stocks = _compute_run_all_ranked_stocks(strat, target_run, constituents, username=username)
                    target_run["all_ranked_stocks"] = all_stocks
                    pending_updates[idx] = all_stocks

                sheet_stocks = _enrich_ranked_stocks_with_windows(strat, target_run, all_stocks, prewarm=False)
                ws = wb.active if idx == 0 else wb.create_sheet()
                st_title = format_run_sheet_title(target_run, idx, used_titles)
                populate_ranked_stocks_worksheet(ws, strat, target_run, sheet_stocks, sheet_title=st_title)

            if pending_updates:
                _persist_backfilled_all_ranked(
                    strategy_id,
                    pending_updates,
                    username=username,
                    runs_list=runs,
                    runs_externalized=bool(strat.get("runs_externalized")),
                )

            clean_strat_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', strat.get("name", "Strategy")).strip('_')
            filename = f"Ranked_Stocks_{clean_strat_name}_ALL_RUNS.xlsx"
            bio = io.BytesIO()
            wb.save(bio)
            bio.seek(0)
            return filename, bio

    strategy, run, all_stocks = get_run_all_ranked_stocks(strategy_id, run_index=run_index, username=username)
    sheet_stocks = _enrich_ranked_stocks_with_windows(strategy, run, all_stocks, prewarm=True)
    sheet_title = format_run_sheet_title(run, run_index)
    wb = generate_ranked_stocks_workbook(strategy, run, sheet_stocks, sheet_title=sheet_title)
    
    clean_strat_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', strategy.get("name", "Strategy")).strip('_')
    exec_date = str(run.get("executed_date") or run.get("scheduled_date") or "run")[:10]
    filename = f"Ranked_Stocks_{clean_strat_name}_{exec_date}.xlsx"

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return filename, bio


def export_ranked_stocks_to_file(strategy_id, run_index=None, username=None, output_path=None):
    """
    Saves the Excel workbook to a file path on disk and returns the absolute path.
    """
    strategy, run, all_stocks = get_run_all_ranked_stocks(strategy_id, run_index=run_index, username=username)
    sheet_stocks = _enrich_ranked_stocks_with_windows(strategy, run, all_stocks, prewarm=True)
    wb = generate_ranked_stocks_workbook(strategy, run, sheet_stocks)

    clean_strat_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', strategy.get("name", "Strategy")).strip('_')
    exec_date = str(run.get("executed_date") or run.get("scheduled_date") or "run")[:10]
    default_name = f"Ranked_Stocks_{clean_strat_name}_{exec_date}.xlsx"

    if not output_path:
        output_path = os.path.join("static", "downloads", default_name)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb.save(output_path)
    return os.path.abspath(output_path)

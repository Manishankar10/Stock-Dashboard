"""
CAPITAL DESK - MOMENTUM SMALLCASES EXCEL EXPORT ENGINE
Generates professional, presentation-ready Excel workbooks (.xlsx) for:
Ranked Stocks by Momentum Formula covering ALL eligible stocks in universe,
ordered descending by total formula score.
"""

import io
import os
import re
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from modules.momentum_smallcases.momentum_smallcases_store import (
    get_user_strategy,
    get_strategy_index_constituents,
    save_user_momentum_smallcases,
    load_user_momentum_smallcases
)
from modules.momentum_smallcases.momentum_smallcases_calculator import (
    rank_and_evaluate_universe,
    save_price_cache
)


def get_run_all_ranked_stocks(strategy_id, run_index=None, username=None):
    """
    Retrieves all eligible constituent stocks calculated and ranked by momentum score
    for a strategy run. If all_ranked_stocks is not yet saved in the run, computes it,
    merges executed actions/allocations, and caches it into the user's strategy file.
    Returns: (strategy, run, all_stocks_list)
    """
    strat = get_user_strategy(strategy_id, username=username)
    if not strat:
        raise ValueError(f"Strategy '{strategy_id}' not found")

    runs = strat.get("runs", [])
    if not runs:
        raise ValueError(f"Strategy '{strategy_id}' has no execution runs yet.")

    # Determine run index (default to selected or latest)
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

    # If all_ranked_stocks is already stored and populated
    all_stocks = target_run.get("all_ranked_stocks")
    if all_stocks and len(all_stocks) > 0:
        return strat, target_run, all_stocks

    # Otherwise, calculate all eligible stocks on the run date
    exec_date_str = target_run.get("executed_date") or target_run.get("scheduled_date")
    try:
        exec_date = datetime.strptime(str(exec_date_str)[:10], "%Y-%m-%d").date()
    except Exception:
        exec_date = datetime.now().date()

    constituents = get_strategy_index_constituents(
        strat.get("index_id"),
        strat.get("index_type", "manual"),
        username=username
    )

    if not constituents:
        raise ValueError(f"No constituents found for index '{strat.get('index_name')}'")

    ranked_displayed, eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target_run.get("formula_used") or strat.get("formula"),
        no_of_stocks=strat.get("no_of_stocks", 12),
        exit_regime_ranking=strat.get("exit_regime_ranking", 15),
        return_meta=True,
        save_cache=True
    )

    all_calculated = meta.get("all_stocks") or ranked_displayed or []

    # Merge executed allocation fields from target_run['ranked_stocks']
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

    # Cache back into user file
    try:
        data = load_user_momentum_smallcases(username)
        for st in data.get("strategies", []):
            if st.get("id") == strategy_id:
                if "runs" in st and len(st["runs"]) > idx:
                    st["runs"][idx]["all_ranked_stocks"] = all_calculated
                    save_user_momentum_smallcases(data, username)
                    break
    except Exception as e:
        # Non-fatal caching warning
        pass

    target_run["all_ranked_stocks"] = all_calculated
    return strat, target_run, all_calculated


def generate_ranked_stocks_workbook(strategy, run, all_stocks):
    """
    Builds an openpyxl Workbook with formatting for all eligible stocks
    ordered descending by momentum score.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Ranked Stocks"

    # Make gridlines visible
    ws.views.sheetView[0].showGridLines = True

    # Palettes & Styling
    navy_header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    meta_bg_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    top_tier_fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")    # soft emerald
    exit_tier_fill = PatternFill(start_color="FEFCE8", end_color="FEFCE8", fill_type="solid")   # soft amber
    alt_row_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    font_title = Font(name="Segoe UI", size=15, bold=True, color="FFFFFF")
    font_meta = Font(name="Segoe UI", size=9.5, color="CBD5E1")
    font_meta_bold = Font(name="Segoe UI", size=9.5, bold=True, color="FFFFFF")
    font_formula = Font(name="Consolas", size=9.5, color="34D399")
    font_col_header = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    font_data = Font(name="Segoe UI", size=10, color="0F172A")
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

    # 1. Metadata Block (Rows 1 to 5)
    ws.merge_cells("A1:O1")
    title_cell = ws["A1"]
    title_cell.value = f"CAPITAL DESK  ·  {strat_name.upper()}  ·  RANKED STOCKS"
    title_cell.font = font_title
    title_cell.fill = meta_bg_fill
    title_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:O2")
    row2_cell = ws["A2"]
    row2_cell.value = f"Milestone: {run_title}  |  Executed Date: {exec_date}  |  Index Universe: {index_name}  |  Eligible Stocks Evaluated: {len(all_stocks)}"
    row2_cell.font = font_meta
    row2_cell.fill = meta_bg_fill
    row2_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[2].height = 20

    ws.merge_cells("A3:O3")
    row3_cell = ws["A3"]
    row3_cell.value = f"Momentum Formula: {formula_str}"
    row3_cell.font = font_formula
    row3_cell.fill = meta_bg_fill
    row3_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[3].height = 20

    ws.merge_cells("A4:O4")
    row4_cell = ws["A4"]
    row4_cell.value = f"Portfolio Allocation Rules: Top {no_of_stocks} Picks (Green / Top Selection)  |  Exit Regime: Rank <= {exit_regime} (Dark Yellow / Safe Holding)  |  Ranks > {exit_regime} (Excluded)"
    row4_cell.font = font_meta
    row4_cell.fill = meta_bg_fill
    row4_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[4].height = 20

    # Row 5 Blank Separator
    ws.row_dimensions[5].height = 8

    # 2. Table Column Headers (Row 6)
    headers = [
        ("RANK", align_center),
        ("STOCK SYMBOL", align_left),
        ("PORTFOLIO TIER", align_center),
        ("ACTION", align_center),
        ("MOMENTUM SCORE", align_right),
        ("CLOSING PRICE (₹)", align_right),
        ("1M RETURN", align_right),
        ("2M RETURN", align_right),
        ("5M RETURN", align_right),
        ("9M RETURN", align_right),
        ("1M VOLATILITY", align_right),
        ("3M VOLATILITY", align_right),
        ("QUANTITY", align_right),
        ("ALLOCATED AMOUNT", align_right),
        ("PORTFOLIO WEIGHT", align_right),
    ]

    header_row_idx = 6
    ws.row_dimensions[header_row_idx].height = 28

    for col_idx, (col_name, col_align) in enumerate(headers, 1):
        cell = ws.cell(row=header_row_idx, column=col_idx)
        cell.value = col_name
        cell.font = font_col_header
        cell.fill = navy_header_fill
        cell.alignment = col_align
        cell.border = header_border

    # Sort all_stocks strictly descending by score
    sorted_stocks = sorted(all_stocks, key=lambda x: float(x.get("total_score") if x.get("total_score") is not None else -9999.0), reverse=True)

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

        action = str(stock.get("action") or "—").strip()
        qty = int(stock.get("quantity") or 0)
        allocated = float(stock.get("allocated_amount") or 0.0)
        weight = float(stock.get("weight_percent") or 0.0) / 100.0

        # Tier assignment
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

        # Action font color
        if action == "BUY":
            action_font = font_action_buy
        elif action == "HOLD":
            action_font = font_action_hold
        elif action in ("EXIT", "SELL"):
            action_font = font_action_exit
        else:
            action_font = font_excluded

        ws.row_dimensions[current_row].height = 20

        # Values & formatting per column
        # Col 1: Rank
        c1 = ws.cell(row=current_row, column=1, value=rank)
        c1.alignment = align_center
        c1.font = font_sym_bold if rank <= exit_regime else font_data
        c1.border = thin_border
        if row_fill.fill_type: c1.fill = row_fill

        # Col 2: Stock Symbol
        c2 = ws.cell(row=current_row, column=2, value=sym)
        c2.alignment = align_left
        c2.font = font_sym_bold
        c2.border = thin_border
        if row_fill.fill_type: c2.fill = row_fill

        # Col 3: Portfolio Tier
        c3 = ws.cell(row=current_row, column=3, value=tier_label)
        c3.alignment = align_center
        c3.font = tier_font
        c3.border = thin_border
        if row_fill.fill_type: c3.fill = row_fill

        # Col 4: Action
        c4 = ws.cell(row=current_row, column=4, value=action)
        c4.alignment = align_center
        c4.font = action_font
        c4.border = thin_border
        if row_fill.fill_type: c4.fill = row_fill

        # Col 5: Momentum Score
        c5 = ws.cell(row=current_row, column=5, value=score)
        c5.alignment = align_right
        c5.font = font_sym_bold if rank <= exit_regime else font_data
        c5.number_format = "0.0000"
        c5.border = thin_border
        if row_fill.fill_type: c5.fill = row_fill

        # Col 6: Closing Price (₹)
        c6 = ws.cell(row=current_row, column=6, value=price)
        c6.alignment = align_right
        c6.font = font_data
        c6.number_format = "₹#,##0.00"
        c6.border = thin_border
        if row_fill.fill_type: c6.fill = row_fill

        # Col 7: 1M Return
        c7 = ws.cell(row=current_row, column=7, value=ret_1m)
        c7.alignment = align_right
        c7.font = font_data
        c7.number_format = "+0.00%;-0.00%;0.00%"
        c7.border = thin_border
        if row_fill.fill_type: c7.fill = row_fill

        # Col 8: 2M Return
        c8 = ws.cell(row=current_row, column=8, value=ret_2m)
        c8.alignment = align_right
        c8.font = font_data
        c8.number_format = "+0.00%;-0.00%;0.00%"
        c8.border = thin_border
        if row_fill.fill_type: c8.fill = row_fill

        # Col 9: 5M Return
        c9 = ws.cell(row=current_row, column=9, value=ret_5m)
        c9.alignment = align_right
        c9.font = font_data
        c9.number_format = "+0.00%;-0.00%;0.00%"
        c9.border = thin_border
        if row_fill.fill_type: c9.fill = row_fill

        # Col 10: 9M Return
        c10 = ws.cell(row=current_row, column=10, value=ret_9m)
        c10.alignment = align_right
        c10.font = font_data
        c10.number_format = "+0.00%;-0.00%;0.00%"
        c10.border = thin_border
        if row_fill.fill_type: c10.fill = row_fill

        # Col 11: 1M Volatility
        c11 = ws.cell(row=current_row, column=11, value=vol_1m)
        c11.alignment = align_right
        c11.font = font_data
        c11.number_format = "0.00%"
        c11.border = thin_border
        if row_fill.fill_type: c11.fill = row_fill

        # Col 12: 3M Volatility
        c12 = ws.cell(row=current_row, column=12, value=vol_3m)
        c12.alignment = align_right
        c12.font = font_data
        c12.number_format = "0.00%"
        c12.border = thin_border
        if row_fill.fill_type: c12.fill = row_fill

        # Col 13: Quantity
        c13 = ws.cell(row=current_row, column=13, value=(qty if qty > 0 else "—"))
        c13.alignment = align_right
        c13.font = font_data
        if qty > 0: c13.number_format = "#,##0"
        c13.border = thin_border
        if row_fill.fill_type: c13.fill = row_fill

        # Col 14: Allocated Amount
        c14 = ws.cell(row=current_row, column=14, value=(allocated if allocated > 0 else "—"))
        c14.alignment = align_right
        c14.font = font_data
        if allocated > 0: c14.number_format = "₹#,##0.00"
        c14.border = thin_border
        if row_fill.fill_type: c14.fill = row_fill

        # Col 15: Weight %
        c15 = ws.cell(row=current_row, column=15, value=(weight if weight > 0 else "—"))
        c15.alignment = align_right
        c15.font = font_data
        if weight > 0: c15.number_format = "0.00%"
        c15.border = thin_border
        if row_fill.fill_type: c15.fill = row_fill

        current_row += 1

    # Freeze panes below header (row 7) so headers stay visible on scroll
    ws.freeze_panes = "A7"

    # Auto-adjust column widths with generous padding
    col_widths = {
        1: 9,    # RANK
        2: 17,   # STOCK SYMBOL
        3: 16,   # PORTFOLIO TIER
        4: 12,   # ACTION
        5: 18,   # MOMENTUM SCORE
        6: 18,   # CLOSING PRICE
        7: 15,   # 1M RETURN
        8: 15,   # 2M RETURN
        9: 15,   # 5M RETURN
        10: 15,  # 9M RETURN
        11: 16,  # 1M VOLATILITY
        12: 16,  # 3M VOLATILITY
        13: 12,  # QUANTITY
        14: 19,  # ALLOCATED AMOUNT
        15: 17,  # PORTFOLIO WEIGHT
    }

    for col_idx, width in col_widths.items():
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = width

    return wb


def export_ranked_stocks_to_bytes(strategy_id, run_index=None, username=None):
    """
    Returns (filename, BytesIO) containing the Excel workbook.
    """
    strategy, run, all_stocks = get_run_all_ranked_stocks(strategy_id, run_index=run_index, username=username)
    wb = generate_ranked_stocks_workbook(strategy, run, all_stocks)
    
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
    wb = generate_ranked_stocks_workbook(strategy, run, all_stocks)

    clean_strat_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', strategy.get("name", "Strategy")).strip('_')
    exec_date = str(run.get("executed_date") or run.get("scheduled_date") or "run")[:10]
    default_name = f"Ranked_Stocks_{clean_strat_name}_{exec_date}.xlsx"

    if not output_path:
        output_path = os.path.join("static", "downloads", default_name)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb.save(output_path)
    return os.path.abspath(output_path)

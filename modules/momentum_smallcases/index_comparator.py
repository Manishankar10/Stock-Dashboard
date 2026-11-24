"""
CAPITAL DESK - MULTI-INDEX MOMENTUM COMPARISON ENGINE
File: modules/momentum_smallcases/index_comparator.py

Simulates and compares multiple momentum smallcase index universes side-by-side:
- Uses ONLY database closing prices (collection: stock_closing_prices) with zero external network requests.
- Shared Start Date and Investment Amount across all compared indices.
- Configurable per-index parameters (Universe, No. of Stocks, Exit Regime, Rebalance Day, Trim Existing Stock, Trading Days per Month).
- Evaluates full portfolio milestone series, drawdowns, and KPIs.
"""

import copy
import logging
import math
import re
import threading
import uuid
from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor

from modules.momentum_smallcases.momentum_smallcases_calculator import (
    DEFAULT_FORMULA,
    TRANSACTION_FEE_RATE,
    prewarm_stock_prices_cache,
    clear_db_prices_cache,
    get_stock_closing_prices_from_db,
    get_next_trading_day,
    calculate_stock_momentum_metrics,
    evaluate_formula_score,
    execute_init_run,
    execute_rebalance_run,
)
from modules.momentum_smallcases.momentum_smallcases_store import (
    get_strategy_index_constituents,
    calculate_strategy_next_rebalance,
)
from modules.momentum_smallcases.momentum_smallcases_chart import (
    _compute_performance_kpis,
)

logger = logging.getLogger("momentum_smallcases.comparator")

COMPARISON_PALETTE = [
    "#3b82f6",  # 0: Blue
    "#10b981",  # 1: Emerald
    "#f59e0b",  # 2: Amber
    "#ec4899",  # 3: Pink
    "#8b5cf6",  # 4: Purple
    "#06b6d4",  # 5: Cyan
    "#ef4444",  # 6: Red
    "#14b8a6",  # 7: Teal
    "#f97316",  # 8: Orange
    "#6366f1",  # 9: Indigo
    "#84cc16",  # 10: Lime
    "#d946ef",  # 11: Fuchsia
    "#0284c7",  # 12: Sky Blue
    "#e11d48",  # 13: Rose
    "#eab308",  # 14: Yellow
    "#22c55e",  # 15: Green
    "#a855f7",  # 16: Violet
    "#38bdf8",  # 17: Light Blue
    "#fb923c",  # 18: Coral
    "#4ade80",  # 19: Mint
    "#c084fc",  # 20: Lavender
    "#f43f5e",  # 21: Watermelon
    "#2dd4bf",  # 22: Aqua
    "#fbbf24",  # 23: Marigold
    "#818cf8",  # 24: Periwinkle
]

# Zero server-side memory: comparison simulations are calculated statelessly on-demand.
# The client browser identifies newly added/searched indices and retains results for comparison.

def clear_comparison_cache():
    """No-op: Server stores zero comparison simulation results in memory."""
    return 0


def _parse_date_flexible(d_str, default_date=None):
    """Parses date string flexibly supporting YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, etc."""
    if not d_str:
        return default_date or date.today()
    if isinstance(d_str, (date, datetime)):
        return d_str if isinstance(d_str, date) else d_str.date()
    s = str(d_str).strip()
    clean = re.sub(r'[^0-9\-\/\.]', '', s)
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y", "%Y.%m.%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(clean[:10], fmt).date()
        except Exception:
            pass
    return default_date or date.today()


def _parse_and_validate_start_date(d_str, default_date=None):
    """
    Parses start date and enforces strict business rules:
    - Start date should strictly be 1st of any month including 2026 (day == 1).
    - Minimum start date is 2013-01-01; clamped to 2013-01-01 if prior.
    - Snaps any day != 1 to the 1st of that month.
    """
    parsed = _parse_date_flexible(d_str, default_date or date(2024, 1, 1))
    min_date = date(2013, 1, 1)
    if parsed < min_date:
        logger.info(f"Start date {parsed.isoformat()} is prior to 2013-01-01; clamping to {min_date.isoformat()}")
        parsed = min_date
    if parsed.day != 1:
        logger.info(f"Start date {parsed.isoformat()} has day != 1; snapping to 1st of month: {parsed.year}-{parsed.month:02d}-01")
        parsed = parsed.replace(day=1)
    return parsed


def _make_sim_cache_key(start_d, cutoff_d, amount_to_invest, stepup_amount, idx_cfg):
    """Generates an immutable tuple key representing the exact input parameters for one index."""
    idx_id = str(idx_cfg.get("index_id") or "").strip().upper()
    no_of_stocks = int(idx_cfg.get("no_of_stocks") or 12)
    exit_regime = int(idx_cfg.get("exit_regime_ranking") or 22)
    rebal_day = 1  # Locked to 1st of month
    trim_existing = idx_cfg.get("trim_existing") in (True, "yes", "true", "1")
    trading_days = int(idx_cfg.get("trading_days_per_month") or 21)
    formula_str = str(idx_cfg.get("formula") or DEFAULT_FORMULA).strip()
    return (
        start_d.isoformat(),
        cutoff_d.isoformat(),
        round(float(amount_to_invest), 2),
        round(float(stepup_amount), 2),
        idx_id,
        no_of_stocks,
        exit_regime,
        rebal_day,
        trim_existing,
        trading_days,
        formula_str
    )


def run_index_comparison_simulation(common_config, index_configs, username=None):
    """
    Executes an in-memory stateless simulation comparing multiple index configurations.
    Uses ONLY MongoDB data from collection 'stock_closing_prices' with monthly average prices.
    Zero server-side caching: newly searched indices are requested by client browser and combined there.
    Frees all temporary prices from server memory immediately upon completion.
    """
    if not index_configs:
        raise ValueError("At least one index configuration is required for comparison.")

    # 1. Parse common settings flexibly with strict business rule for start date
    start_d = _parse_and_validate_start_date(common_config.get("start_date"), date(2024, 1, 1))
    cutoff_d = _parse_date_flexible(common_config.get("cutoff_date"), date.today())
    if start_d > cutoff_d:
        return {
            "success": False,
            "error": f"Start Date ({start_d.strftime('%d-%b-%Y')}) cannot be after Cutoff Date ({cutoff_d.strftime('%d-%b-%Y')}).",
            "results": [],
            "summary": []
        }

    amount_to_invest = float(common_config.get("amount_to_invest") or 100000.0)
    if amount_to_invest <= 0:
        amount_to_invest = 100000.0

    stepup_amount = float(common_config.get("stepup_amount") or 0.0)
    if stepup_amount < 0:
        stepup_amount = 0.0

    results = []
    try:
        all_constituents_by_index = {}
        all_symbols_to_warm = set()

        for i, idx_cfg in enumerate(index_configs):
            if not isinstance(idx_cfg, dict):
                continue
            idx_id = idx_cfg.get("index_id")
            idx_type = idx_cfg.get("index_type")
            if not idx_type:
                idx_type = "manual" if str(idx_id).startswith("midx_") else "nifty"
            constituents = get_strategy_index_constituents(idx_id, idx_type, username=username) or []
            if not constituents:
                fallback_type = "nifty" if idx_type == "manual" else "manual"
                constituents = get_strategy_index_constituents(idx_id, fallback_type, username=username) or []
            all_constituents_by_index[idx_id] = constituents

            for c in constituents:
                if isinstance(c, dict) and c.get("symbol"):
                    all_symbols_to_warm.add(c["symbol"])
                elif isinstance(c, str):
                    all_symbols_to_warm.add(c)

        if all_symbols_to_warm:
            import datetime as _dt
            earliest_needed = (start_d - _dt.timedelta(days=400)).isoformat()
            prewarm_stock_prices_cache(all_symbols_to_warm, min_date=earliest_needed)

        used_colors = set()
        for i, idx_cfg in enumerate(index_configs):
            if not isinstance(idx_cfg, dict):
                continue
            cfg_id = idx_cfg.get("id") or f"idx_{i+1}"
            user_color = (idx_cfg.get("color") or "").strip().lower()
            if user_color and user_color not in used_colors:
                color = idx_cfg.get("color")
            else:
                color = next((c for c in COMPARISON_PALETTE if c.lower() not in used_colors), None)
                if not color:
                    hue = round((i * 137.508) % 360)
                    color = f"hsl({hue}, 80%, 50%)"
            used_colors.add(color.lower())

            idx_id = idx_cfg.get("index_id")
            idx_name = idx_cfg.get("index_name") or idx_id
            no_of_stocks = int(idx_cfg.get("no_of_stocks") or 12)
            exit_regime = int(idx_cfg.get("exit_regime_ranking") or 22)
            rebal_day = 1  # Rebalance day is locked to 1st of month
            trim_existing = idx_cfg.get("trim_existing") in (True, "yes", "true", "1")
            trading_days_per_month = int(idx_cfg.get("trading_days_per_month") or 21)
            formula_str = (idx_cfg.get("formula") or DEFAULT_FORMULA).strip()

            constituents = all_constituents_by_index.get(idx_id) or []
            if not constituents:
                logger.warning(f"No constituents found for index '{idx_name}' ({idx_id}); skipping.")
                continue

            try:
                sim_result = _simulate_single_index(
                    index_id=idx_id,
                    index_name=idx_name,
                    constituents=constituents,
                    start_date=start_d,
                    cutoff_date=cutoff_d,
                    amount_to_invest=amount_to_invest,
                    no_of_stocks=no_of_stocks,
                    exit_regime_ranking=exit_regime,
                    rebalance_day=rebal_day,
                    trim_existing=trim_existing,
                    trading_days_per_month=trading_days_per_month,
                    formula_str=formula_str,
                    color=color,
                    cfg_id=cfg_id,
                    stepup_amount=stepup_amount
                )
                if sim_result:
                    results.append(sim_result)
            except Exception as e:
                logger.error(f"Error simulating index '{idx_name}': {e}", exc_info=True)
    finally:
        # Guarantee zero server-side memory retention: immediately clear prices cache
        clear_db_prices_cache()

    # 5. Build summary comparison matrix
    summary_rows = []
    for res in results:
        kpis = res.get("kpis", {})
        cfg = res.get("config", {})
        pts = res.get("points", [])
        total_invested = pts[-1]["invested"] if pts else amount_to_invest
        final_val = kpis.get("current_value") or (pts[-1]["portfolio_value"] if pts else total_invested)
        tot_pnl = kpis.get("total_return_amount", round(final_val - total_invested, 2))
        tot_pnl_pct = kpis.get("total_return_percent", round((tot_pnl / total_invested) * 100.0, 2) if total_invested > 0 else 0.0)
        max_dd = kpis.get("max_drawdown", {})
        max_below = kpis.get("max_drilldown_below_investment", {})

        summary_rows.append({
            "id": res.get("id", f"idx_{len(summary_rows)+1}"),
            "index_id": res.get("index_id", ""),
            "index_name": res.get("index_name", "Index"),
            "color": res.get("color", "#3b82f6"),
            "no_of_stocks": cfg.get("no_of_stocks"),
            "exit_regime_ranking": cfg.get("exit_regime_ranking"),
            "rebalance_day": cfg.get("rebalance_day"),
            "trim_existing": cfg.get("trim_existing"),
            "trading_days_per_month": cfg.get("trading_days_per_month"),
            "final_valuation": round(final_val, 2),
            "total_invested": round(total_invested, 2),
            "stepup_amount": stepup_amount,
            "total_pnl": round(tot_pnl, 2),
            "total_pnl_percent": round(tot_pnl_pct, 2),
            "cagr": round(kpis.get("cagr", tot_pnl_pct), 2),
            "max_drawdown_percent": round(max_dd.get("max_drawdown_percent", 0.0), 2),
            "max_drawdown_amount": round(max_dd.get("drawdown_amount", 0.0), 2),
            "max_drawdown_peak_date": max_dd.get("peak_date"),
            "max_drawdown_trough_date": max_dd.get("trough_date"),
            "max_below_investment_percent": round(max_below.get("max_deficit_percent", 0.0), 2),
            "max_below_investment_amount": round(max_below.get("max_deficit_amount", 0.0), 2),
            "max_below_investment_date": max_below.get("date"),
            "win_rate": round(kpis.get("win_rate", 0.0), 2),
            "rebalances_count": res.get("rebalances_count", 0),
            "fees_paid": round(res.get("total_fees", 0.0), 2)
        })

    if not results:
        return {
            "success": False,
            "error": f"No simulation data could be generated for the selected indices starting from {start_d.strftime('%d-%b-%Y')}. Please verify that the start date is within the available price history.",
            "results": [],
            "summary": []
        }

    # Sort summary by total_pnl_percent descending
    summary_rows.sort(key=lambda x: x.get("total_pnl_percent", 0.0), reverse=True)

    # Assign rank
    for rank_idx, row in enumerate(summary_rows):
        row["rank"] = rank_idx + 1

    return {
        "success": True,
        "common": {
            "start_date": start_d.isoformat(),
            "cutoff_date": cutoff_d.isoformat(),
            "amount_to_invest": amount_to_invest,
            "stepup_amount": stepup_amount
        },
        "results": results,
        "summary": summary_rows,
        "count": len(results)
    }


def _simulate_single_index(
    index_id,
    index_name,
    constituents,
    start_date,
    cutoff_date,
    amount_to_invest,
    no_of_stocks,
    exit_regime_ranking,
    rebalance_day,
    trim_existing,
    trading_days_per_month,
    formula_str,
    color,
    cfg_id,
    stepup_amount=0.0
):
    """
    Simulates portfolio evolution for one index from start_date to cutoff_date.
    Uses ONLY DB data from collection 'stock_closing_prices'.
    """
    # Determine initial execution date
    init_d, was_moved = get_next_trading_day(start_date)
    if init_d > cutoff_date:
        logger.warning(f"Init date {init_d} is after cutoff date {cutoff_date} for index '{index_name}'")
        return None

    # Step 1: Initial Portfolio Execution (Rank universe on init_d using DB data only)
    ranked_init, eligible_count, meta_init = _evaluate_universe_db_only(
        constituents=constituents,
        target_date=init_d,
        formula_str=formula_str,
        no_of_stocks=no_of_stocks,
        exit_regime_ranking=exit_regime_ranking,
        trading_days_per_month=trading_days_per_month
    )

    if not ranked_init:
        # Check if index has delayed start due to constituent stock entered dates / price available dates
        earliest_eff = meta_init.get("earliest_effective_date") if meta_init else None
        if earliest_eff and earliest_eff > init_d and earliest_eff <= cutoff_date:
            logger.info(f"Index '{index_name}' constituents entered / have price data after {init_d}; delayed start to {earliest_eff}")
            delayed_init_d, _ = get_next_trading_day(earliest_eff)
            if delayed_init_d <= cutoff_date:
                ranked_init, eligible_count, meta_init = _evaluate_universe_db_only(
                    constituents=constituents,
                    target_date=delayed_init_d,
                    formula_str=formula_str,
                    no_of_stocks=no_of_stocks,
                    exit_regime_ranking=exit_regime_ranking,
                    trading_days_per_month=trading_days_per_month
                )
                if ranked_init:
                    init_d = delayed_init_d

    if not ranked_init:
        logger.warning(f"No ranked stocks found for index '{index_name}' on init date {init_d}")
        return None

    init_portfolio = execute_init_run(
        ranked_stocks=ranked_init,
        amount_to_invest=amount_to_invest,
        no_of_stocks=no_of_stocks
    )

    current_holdings = init_portfolio["holdings"]
    current_wallet = init_portfolio["wallet_balance"]
    total_capital = amount_to_invest
    total_fees = init_portfolio.get("fees_paid", 0.0)

    # Milestone points for time series chart
    points = []
    # If simulation started before actual constituent entry date, record initial cash holding at start_date
    if start_date < init_d:
        points.append({
            "date": start_date.isoformat(),
            "portfolio_value": amount_to_invest,
            "invested": amount_to_invest,
            "wallet_balance": amount_to_invest,
            "holdings_count": 0,
            "milestone_type": "START",
            "milestone_label": f"Start Cash ({start_date.strftime('%d-%b-%Y')})",
            "pnl": 0.0,
            "pnl_percent": 0.0,
            "change_amount": 0.0,
            "change_percent": 0.0
        })

    points.append({
        "date": init_d.isoformat(),
        "portfolio_value": init_portfolio["total_portfolio_value"],
        "invested": total_capital,
        "wallet_balance": current_wallet,
        "holdings_count": len(current_holdings),
        "milestone_type": "INIT",
        "milestone_label": f"Init ({init_d.strftime('%d-%b-%Y')})",
        "pnl": 0.0,
        "pnl_percent": 0.0,
        "change_amount": 0.0,
        "change_percent": 0.0
    })

    # Step 2: Scheduled Monthly Rebalances
    current_sim_date = init_d
    rebalance_dates = []
    # Dynamic rebalance limit: allow full historical span from 2012 up to cutoff_date without capping
    year_diff = max(1, cutoff_date.year - init_d.year + 1)
    max_rebal_runs = max(240, year_diff * 14)

    while len(rebalance_dates) < max_rebal_runs:
        _, next_rebal_d, _ = calculate_strategy_next_rebalance(current_sim_date, rebalance_day)
        if not next_rebal_d or next_rebal_d > cutoff_date:
            break
        if rebalance_dates and next_rebal_d <= rebalance_dates[-1]:
            break

        rebalance_dates.append(next_rebal_d)
        current_sim_date = next_rebal_d

        # Rank universe on rebalance date using DB closing prices
        ranked_reb, _, meta_reb = _evaluate_universe_db_only(
            constituents=constituents,
            target_date=next_rebal_d,
            formula_str=formula_str,
            no_of_stocks=no_of_stocks,
            exit_regime_ranking=exit_regime_ranking,
            trading_days_per_month=trading_days_per_month
        )

        if not ranked_reb:
            continue

        if stepup_amount > 0:
            total_capital = round(total_capital + stepup_amount, 2)

        rebal_portfolio = execute_rebalance_run(
            ranked_stocks=ranked_reb,
            previous_holdings=current_holdings,
            previous_wallet=current_wallet,
            stepup_amount=stepup_amount,
            no_of_stocks=no_of_stocks,
            exit_regime_ranking=exit_regime_ranking,
            target_date=next_rebal_d,
            all_universe_stocks=meta_reb.get("all_stocks"),
            total_capital=total_capital,
            trim_existing=trim_existing
        )

        current_holdings = rebal_portfolio["holdings"]
        current_wallet = rebal_portfolio["wallet_balance"]
        total_fees += rebal_portfolio.get("fees_paid", 0.0)

        points.append({
            "date": next_rebal_d.isoformat(),
            "portfolio_value": rebal_portfolio["total_portfolio_value"],
            "invested": total_capital,
            "wallet_balance": current_wallet,
            "holdings_count": len(current_holdings),
            "milestone_type": "REBALANCE",
            "milestone_label": f"Rebal #{len(rebalance_dates)} ({next_rebal_d.strftime('%d-%b-%Y')})",
            "stepup_amount": stepup_amount,
            "pnl": round(rebal_portfolio["total_portfolio_value"] - total_capital, 2),
            "pnl_percent": round(((rebal_portfolio["total_portfolio_value"] - total_capital) / total_capital) * 100.0, 2) if total_capital > 0 else 0.0,
            "change_amount": 0.0,
            "change_percent": 0.0
        })

    # Step 3: Latest Cutoff Date Valuation (if later than last milestone)
    if points and points[-1]["date"] < cutoff_date.isoformat():
        # Value current holdings at cutoff_date closing prices from DB
        cutoff_invested = total_capital
        cutoff_curr_val = 0.0
        for h in current_holdings:
            sym = h.get("symbol")
            qty = int(h.get("quantity", 0))
            if qty <= 0:
                continue
            db_series = get_stock_closing_prices_from_db(sym, cutoff_date.isoformat())
            price = None
            if db_series and len(db_series) > 0:
                last_elem = db_series[-1]
                if isinstance(last_elem, (list, tuple)) and len(last_elem) > 1:
                    price = last_elem[1]
                elif isinstance(last_elem, (int, float)):
                    price = float(last_elem)
            if price is None:
                price = float(h.get("current_price", h.get("buy_price", 0.0)))
            cutoff_curr_val += (qty * price)

        cutoff_total_val = round(cutoff_curr_val + current_wallet, 2)
        cutoff_pnl = round(cutoff_total_val - cutoff_invested, 2)
        cutoff_pnl_pct = round((cutoff_pnl / cutoff_invested) * 100.0, 2) if cutoff_invested > 0 else 0.0

        points.append({
            "date": cutoff_date.isoformat(),
            "portfolio_value": cutoff_total_val,
            "invested": cutoff_invested,
            "wallet_balance": current_wallet,
            "holdings_count": len(current_holdings),
            "milestone_type": "LATEST",
            "milestone_label": f"Latest ({cutoff_date.strftime('%d-%b-%Y')})",
            "pnl": cutoff_pnl,
            "pnl_percent": cutoff_pnl_pct
        })

    # Step 4: Compute Performance KPIs
    kpis = _compute_performance_kpis(points)

    return {
        "id": cfg_id,
        "index_id": index_id,
        "index_name": index_name,
        "color": color,
        "config": {
            "index_id": index_id,
            "index_name": index_name,
            "no_of_stocks": no_of_stocks,
            "exit_regime_ranking": exit_regime_ranking,
            "rebalance_day": rebalance_day,
            "trim_existing": trim_existing,
            "trading_days_per_month": trading_days_per_month,
            "formula": formula_str
        },
        "points": points,
        "kpis": kpis,
        "rebalances_count": len(rebalance_dates),
        "total_fees": round(total_fees, 2)
    }


def _evaluate_universe_db_only(
    constituents,
    target_date,
    formula_str,
    no_of_stocks,
    exit_regime_ranking,
    trading_days_per_month=21
):
    """
    Evaluates and ranks constituent stocks on target_date using ONLY DB closing prices.
    Returns: (displayed_stocks, eligible_count, meta_dict)
    """
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        filter_universe_by_date_with_meta
    )

    eligible_symbols, date_info = filter_universe_by_date_with_meta(constituents, target_date)
    if not eligible_symbols:
        return [], 0, date_info

    calculated_stocks = []
    failed_symbols = []

    def _eval(sym):
        try:
            # calculate_stock_momentum_metrics reads DB cache (db_prices_cache) first with zero network calls
            metrics = calculate_stock_momentum_metrics(
                sym, target_date, in_trading_hours=False, trading_days_per_month=trading_days_per_month, db_only=True
            )
            if metrics:
                score = evaluate_formula_score(metrics, formula_str)
                metrics["total_score"] = score
                return (sym, metrics)
        except Exception as e:
            logger.warning(f"DB evaluation error for {sym} on {target_date}: {e}")
        return (sym, None)

    # In-memory sequential evaluation (sub-millisecond lookups from _db_prices_cache)
    for sym in eligible_symbols:
        s, r = _eval(sym)
        if r:
            calculated_stocks.append(r)
        else:
            failed_symbols.append(sym)

    # Sort descending by momentum formula score
    calculated_stocks.sort(key=lambda x: x["total_score"], reverse=True)

    # Assign ranks
    for idx, s in enumerate(calculated_stocks):
        s["rank"] = idx + 1
        s["is_top_pick"] = (s["rank"] <= no_of_stocks)
        s["is_exit_regime"] = (no_of_stocks < s["rank"] <= exit_regime_ranking)
        s["is_excluded"] = (s["rank"] > exit_regime_ranking)

    display_limit = exit_regime_ranking + 15
    displayed_stocks = calculated_stocks[:display_limit]

    meta = dict(date_info)
    meta["all_stocks"] = calculated_stocks
    meta["failed_symbols"] = failed_symbols
    meta["calculated_count"] = len(calculated_stocks)

    return displayed_stocks, len(eligible_symbols), meta

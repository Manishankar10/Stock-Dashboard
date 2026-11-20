"""
CAPITAL DESK - MULTI-INDEX MOMENTUM COMPARISON ENGINE
File: modules/momentum_smallcases/index_comparator.py

Simulates and compares multiple momentum smallcase index universes side-by-side:
- Uses ONLY database closing prices (collection: stock_closing_prices) with zero external network requests.
- Shared Start Date and Investment Amount across all compared indices.
- Configurable per-index parameters (Universe, No. of Stocks, Exit Regime, Rebalance Day, Trim Existing Stock, Trading Days per Month).
- Evaluates full portfolio milestone series, drawdowns, and KPIs.
"""

import logging
import math
import uuid
from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor

from modules.momentum_smallcases.momentum_smallcases_calculator import (
    DEFAULT_FORMULA,
    TRANSACTION_FEE_RATE,
    prewarm_stock_prices_cache,
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
    "#3b82f6",  # Blue
    "#10b981",  # Emerald
    "#f59e0b",  # Amber
    "#ec4899",  # Pink
    "#8b5cf6",  # Purple
    "#06b6d4",  # Cyan
    "#ef4444",  # Red
    "#14b8a6",  # Teal
]


def run_index_comparison_simulation(common_config, index_configs, username=None):
    """
    Executes an in-memory simulation comparing multiple index configurations.
    Uses ONLY DB data from collection 'stock_closing_prices'.

    common_config:
      - start_date: str (YYYY-MM-DD)
      - amount_to_invest: float (e.g. 100000.0)
      - cutoff_date: str (YYYY-MM-DD, optional, defaults to today)

    index_configs: list of dicts:
      - id: str
      - index_id: str (e.g. 'NIFTY_50', 'NIFTY_SMALLCAP_250', or 'midx_...')
      - index_name: str
      - index_type: str ('nifty' or 'manual')
      - no_of_stocks: int (default 12)
      - exit_regime_ranking: int (default 22)
      - rebalance_day: int (default 21)
      - trim_existing: bool (default False)
      - trading_days_per_month: int (default 21)
      - formula: str (optional)
      - color: str (optional hex color)
    """
    if not index_configs:
        raise ValueError("At least one index configuration is required for comparison.")

    # 1. Parse common settings
    start_date_str = str(common_config.get("start_date", "")).strip()[:10]
    if not start_date_str:
        start_date_str = "2025-10-01"

    try:
        start_d = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except Exception:
        start_d = date(2025, 10, 1)

    cutoff_date_str = str(common_config.get("cutoff_date", "")).strip()[:10]
    if cutoff_date_str:
        try:
            cutoff_d = datetime.strptime(cutoff_date_str, "%Y-%m-%d").date()
        except Exception:
            cutoff_d = date.today()
    else:
        cutoff_d = date.today()

    amount_to_invest = float(common_config.get("amount_to_invest") or 100000.0)
    if amount_to_invest <= 0:
        amount_to_invest = 100000.0

    # 2. Gather all constituent symbols across all compared indices to prewarm DB prices
    all_constituents_by_index = {}
    all_symbols_to_warm = set()

    for idx_cfg in index_configs:
        idx_id = idx_cfg.get("index_id")
        idx_type = idx_cfg.get("index_type", "manual")
        constituents = get_strategy_index_constituents(idx_id, idx_type, username=username) or []
        all_constituents_by_index[idx_id] = constituents

        for c in constituents:
            if isinstance(c, dict) and c.get("symbol"):
                all_symbols_to_warm.add(c["symbol"])
            elif isinstance(c, str):
                all_symbols_to_warm.add(c)

    # Prewarm DB prices into memory cache in bulk (< 0.5s for hundreds of stocks)
    logger.info(f"Prewarming DB prices for {len(all_symbols_to_warm)} stocks across {len(index_configs)} indices...")
    prewarm_stock_prices_cache(all_symbols_to_warm)

    results = []

    # 3. Simulate each index sequentially
    for i, idx_cfg in enumerate(index_configs):
        cfg_id = idx_cfg.get("id") or f"idx_{i+1}"
        idx_id = idx_cfg.get("index_id")
        idx_name = idx_cfg.get("index_name") or idx_id
        idx_type = idx_cfg.get("index_type", "manual")
        no_of_stocks = int(idx_cfg.get("no_of_stocks") or 12)
        exit_regime = int(idx_cfg.get("exit_regime_ranking") or 22)
        rebal_day = int(idx_cfg.get("rebalance_day") or 21)
        trim_existing = idx_cfg.get("trim_existing") in (True, "yes", "true", "1")
        trading_days_per_month = int(idx_cfg.get("trading_days_per_month") or 21)
        formula_str = (idx_cfg.get("formula") or DEFAULT_FORMULA).strip()
        color = idx_cfg.get("color") or COMPARISON_PALETTE[i % len(COMPARISON_PALETTE)]

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
                cfg_id=cfg_id
            )
            if sim_result:
                results.append(sim_result)
        except Exception as e:
            logger.error(f"Error simulating index '{idx_name}': {e}", exc_info=True)

    # 4. Build summary comparison matrix
    summary_rows = []
    for res in results:
        kpis = res.get("kpis", {})
        cfg = res.get("config", {})
        pts = res.get("points", [])
        final_val = kpis.get("current_value") or (pts[-1]["portfolio_value"] if pts else amount_to_invest)
        tot_pnl = kpis.get("total_return_amount", round(final_val - amount_to_invest, 2))
        tot_pnl_pct = kpis.get("total_return_percent", round((tot_pnl / amount_to_invest) * 100.0, 2) if amount_to_invest > 0 else 0.0)
        max_dd = kpis.get("max_drawdown", {})
        max_below = kpis.get("max_drilldown_below_investment", {})

        summary_rows.append({
            "id": res["id"],
            "index_id": res["index_id"],
            "index_name": res["index_name"],
            "color": res["color"],
            "no_of_stocks": cfg.get("no_of_stocks"),
            "exit_regime_ranking": cfg.get("exit_regime_ranking"),
            "rebalance_day": cfg.get("rebalance_day"),
            "trim_existing": cfg.get("trim_existing"),
            "trading_days_per_month": cfg.get("trading_days_per_month"),
            "final_valuation": round(final_val, 2),
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
            "error": "No simulation data could be generated for the selected indices and dates. Please ensure the Start Date is between October 2025 and today (database price history starts Jan 2025 for 9-month momentum lookbacks).",
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
            "amount_to_invest": amount_to_invest
        },
        "results": results,
        "summary": summary_rows
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
    cfg_id
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
    points = [{
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
    }]

    # Step 2: Scheduled Monthly Rebalances
    current_sim_date = init_d
    rebalance_dates = []
    max_rebal_runs = 120

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

        rebal_portfolio = execute_rebalance_run(
            ranked_stocks=ranked_reb,
            previous_holdings=current_holdings,
            previous_wallet=current_wallet,
            stepup_amount=0.0,
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
            "pnl": rebal_portfolio.get("total_pnl", 0.0),
            "pnl_percent": rebal_portfolio.get("total_pnl_percent", 0.0)
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
                price = db_series[-1][1]
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
            # calculate_stock_momentum_metrics reads DB cache (db_prices_cache) first
            metrics = calculate_stock_momentum_metrics(
                sym, target_date, in_trading_hours=False, trading_days_per_month=trading_days_per_month
            )
            if metrics:
                score = evaluate_formula_score(metrics, formula_str)
                metrics["total_score"] = score
                return (sym, metrics)
        except Exception as e:
            logger.warning(f"DB evaluation error for {sym} on {target_date}: {e}")
        return (sym, None)

    # Concurrently evaluate cached prices with worker pool
    worker_count = min(16, max(4, len(eligible_symbols)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = executor.map(_eval, eligible_symbols)
        for sym, r in results:
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

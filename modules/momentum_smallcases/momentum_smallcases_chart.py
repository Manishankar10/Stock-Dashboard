"""
CAPITAL DESK - MOMENTUM SMALLCASES PERFORMANCE GRAPH & DRILLDOWN ENGINE
Evaluates historical portfolio valuation (invested capital vs current value) over time.
- Stock price preference: 1. DB (stock_closing_prices)  2. Live provider (Market Fetcher / Yahoo Finance)
- If total duration > 1 year: evaluates at Init and every Rebalance milestone (+ today).
- If total duration <= 1 year: evaluates day-by-day across all active trading days.
- Background asynchronous calculation with status polling and deduplication.
- Computes comprehensive KPIs: Top 3 negative drops, Top 3 positive momentum days, Consolidated Max Drawdown, CAGR, and Win Rate.
"""

import bisect
import logging
import math
import threading
import time
import uuid
from datetime import date, datetime, timedelta

from modules.momentum_smallcases.momentum_smallcases_calculator import (
    fetch_stock_daily_series,
    get_official_trading_holidays,
    get_stock_closing_prices_from_db,
    prewarm_stock_prices_cache,
)

logger = logging.getLogger(__name__)

# In-memory background jobs registry for performance graph calculations
_GRAPH_JOBS = {}
_GRAPH_LOCK = threading.Lock()

# Cached results per strategy_id: { strategy_id: { "cached_at": iso, "runs_count": int, "data": dict } }
_GRAPH_CACHE = {}


def _parse_date(d_val):
    if not d_val:
        return None
    if isinstance(d_val, date):
        return d_val
    if isinstance(d_val, datetime):
        return d_val.date()
    try:
        return datetime.fromisoformat(str(d_val)[:10]).date()
    except Exception:
        try:
            return datetime.strptime(str(d_val)[:10], "%Y-%m-%d").date()
        except Exception:
            return None


def calculate_strategy_performance_series(strategy, progress_callback=None):
    """
    Computes time-series data and KPIs for the given smallcase strategy.
    Returns:
    {
        "strategy_id": ...,
        "strategy_name": ...,
        "granularity": "DAILY" | "REBALANCE_DATES",
        "start_date": ...,
        "end_date": ...,
        "total_days": ...,
        "points": [...],
        "kpis": {...}
    }
    """
    runs = strategy.get("runs", [])
    if not runs:
        raise ValueError("Cannot calculate performance graph for an uninitialized strategy. Please run Init first.")

    start_date_str = strategy.get("effective_start_date") or strategy.get("start_date")
    start_d = _parse_date(start_date_str)
    if not start_d:
        first_run_date = runs[0].get("executed_date") or runs[0].get("scheduled_date")
        start_d = _parse_date(first_run_date) or date.today()

    today_d = date.today()
    total_days = max(1, (today_d - start_d).days)

    if progress_callback:
        progress_callback("Analyzing strategy milestones and constituents...")

    # Granularity rule: If more than 1 year (365 days), calculate at Init & every Rebalance date.
    # Otherwise, calculate day-by-day.
    if total_days > 365:
        granularity = "REBALANCE_DATES"
        points = _calculate_rebalance_milestone_points(strategy, runs, today_d, progress_callback)
    else:
        granularity = "DAILY"
        points = _calculate_daily_points(strategy, runs, start_d, today_d, progress_callback)

    if not points:
        raise ValueError("No valuation data points could be calculated for this smallcase.")

    if progress_callback:
        progress_callback("Computing drawdown, momentum, and return KPIs...")

    kpis = _compute_performance_kpis(points)

    result = {
        "strategy_id": strategy.get("id"),
        "strategy_name": strategy.get("name"),
        "granularity": granularity,
        "granularity_label": "Rebalance Milestones (> 1 Year)" if granularity == "REBALANCE_DATES" else "Day-by-Day (≤ 1 Year)",
        "start_date": start_d.isoformat(),
        "end_date": today_d.isoformat(),
        "total_days": total_days,
        "points_count": len(points),
        "dates": [p["date"] for p in points],
        "invested_series": [p["invested"] for p in points],
        "portfolio_value_series": [p["portfolio_value"] for p in points],
        "pnl_series": [p.get("pnl", 0.0) for p in points],
        "pnl_percent_series": [p.get("pnl_percent", 0.0) for p in points],
        "points": points,
        "kpis": kpis
    }

    return result


def _calculate_rebalance_milestone_points(strategy, runs, today_d, progress_callback=None):
    """Calculates points at Init and every Rebalance execution milestone, plus latest today."""
    points = []
    seen_dates = set()

    for idx, r in enumerate(runs):
        if progress_callback and (idx % 2 == 0 or idx == len(runs) - 1):
            progress_callback(f"Evaluating milestone {idx + 1} of {len(runs)}...")

        r_raw_date = r.get("executed_date") or r.get("scheduled_date") or ""
        r_d = _parse_date(r_raw_date)
        r_date_str = r_d.isoformat() if r_d else str(r_raw_date)[:10]
        if not r_date_str:
            continue

        snap = r.get("portfolio_snapshot") or {}
        invested = float(snap.get("total_capital") or strategy.get("amount_to_invest") or 0.0)
        val = float(snap.get("total_portfolio_value") or snap.get("current_value") or invested)

        # In case total_capital was not stored on old snapshot, fallback
        if invested <= 0:
            invested = float(strategy.get("amount_to_invest") or 0.0)

        points.append({
            "date": r_date_str,
            "invested": round(invested, 2),
            "portfolio_value": round(val, 2),
            "wallet": round(float(snap.get("wallet_balance") or 0.0), 2),
            "milestone": r.get("title") or ("Init" if idx == 0 else f"Rebalance #{idx}"),
            "run_index": idx
        })
        seen_dates.add(r_date_str)

    # If today is after the last executed run, evaluate current valuation as of today
    last_run = runs[-1]
    last_raw_date = last_run.get("executed_date") or last_run.get("scheduled_date") or ""
    last_d = _parse_date(last_raw_date)
    last_date_str = last_d.isoformat() if last_d else str(last_raw_date)[:10]
    today_str = today_d.isoformat()

    if today_str not in seen_dates and today_str > last_date_str:
        if progress_callback:
            progress_callback("Calculating current day valuation...")

        holdings = strategy.get("holdings") or []
        wallet = float(strategy.get("current_wallet") or 0.0)
        curr_invested = float(strategy.get("total_capital") or strategy.get("amount_to_invest") or 0.0)

        latest_holdings_val = 0.0
        for h in holdings:
            sym = h.get("symbol")
            qty = int(h.get("quantity") or 0)
            if not sym or qty <= 0:
                continue

            # 1. DB (stock_closing_prices) with live fallback
            price = None
            series = fetch_stock_daily_series(sym, target_cutoff_date=today_d)
            if series and len(series) > 0:
                price = float(series[-1][1])
            else:
                price = float(h.get("current_price") or h.get("buy_price") or 0.0)

            latest_holdings_val += qty * price

        curr_total_val = round(latest_holdings_val + wallet, 2)
        points.append({
            "date": today_str,
            "invested": round(curr_invested, 2),
            "portfolio_value": curr_total_val,
            "wallet": round(wallet, 2),
            "milestone": "Current Valuation",
            "run_index": len(runs)
        })

    points.sort(key=lambda x: str(x["date"]))
    return points


def _calculate_daily_points(strategy, runs, start_d, today_d, progress_callback=None):
    """Calculates daily portfolio valuations for smallcases under 1 year."""
    # 1. Collect all participated symbols across runs and current holdings
    all_symbols = set()
    for r in runs:
        snap = r.get("portfolio_snapshot") or {}
        for h in snap.get("holdings", []):
            if h.get("symbol"):
                all_symbols.add(h["symbol"].strip().upper())
    for h in strategy.get("holdings", []):
        if h.get("symbol"):
            all_symbols.add(h["symbol"].strip().upper())

    symbols_list = sorted(list(all_symbols))
    if progress_callback:
        progress_callback(f"Loading prices for {len(symbols_list)} stocks (DB Priority 1, Live Fallback 2)...")

    prewarm_stock_prices_cache(symbols_list)

    # Map: sym -> { date_str: close_price } and sorted_dates list for binary search
    stock_price_dict = {}
    stock_date_keys = {}

    for idx, sym in enumerate(symbols_list):
        if progress_callback and (idx % 3 == 0 or idx == len(symbols_list) - 1):
            progress_callback(f"Fetching quotes for {sym} ({idx + 1}/{len(symbols_list)})...")

        # 1. DB Primary, 2. Live Provider Fallback
        series = fetch_stock_daily_series(sym, target_cutoff_date=today_d)
        if series:
            p_map = {}
            for d_val, c in series:
                if isinstance(d_val, (date, datetime)):
                    d_k = d_val.strftime("%Y-%m-%d")
                else:
                    d_k = str(d_val)[:10]
                try:
                    p_map[d_k] = round(float(c), 2)
                except Exception:
                    continue
            d_keys = sorted(p_map.keys())
            stock_price_dict[sym] = p_map
            stock_date_keys[sym] = d_keys
        else:
            stock_price_dict[sym] = {}
            stock_date_keys[sym] = []

    # 2. Collect official holidays
    holidays_set = get_official_trading_holidays()

    # 3. Build sequence of active run intervals
    # Each run is active from its execution date until the next run
    parsed_runs = []
    for idx, r in enumerate(runs):
        d_raw = r.get("executed_date") or r.get("scheduled_date") or ""
        r_d = _parse_date(d_raw)
        if r_d:
            snap = r.get("portfolio_snapshot") or {}
            invested = float(snap.get("total_capital") or strategy.get("amount_to_invest") or 0.0)
            if invested <= 0:
                invested = float(strategy.get("amount_to_invest") or 0.0)

            parsed_runs.append({
                "run_index": idx,
                "date": r_d,
                "date_str": r_d.isoformat(),
                "invested": invested,
                "wallet": float(snap.get("wallet_balance") or 0.0),
                "holdings": snap.get("holdings") or []
            })

    parsed_runs.sort(key=lambda x: x["date"])
    if not parsed_runs:
        return []

    # 4. Iterate day by day from start_d to today_d
    curr_date = start_d
    trading_days = []
    while curr_date <= today_d:
        # Skip Saturday (5) and Sunday (6) and official market holidays
        if curr_date.weekday() < 5 and curr_date.isoformat() not in holidays_set:
            trading_days.append(curr_date)
        curr_date += timedelta(days=1)

    points = []
    total_td = len(trading_days)

    def _get_close_price(sym_name, target_day_val, fallback_price):
        p_dict = stock_price_dict.get(sym_name)
        if not p_dict:
            return fallback_price
        if isinstance(target_day_val, (date, datetime)):
            target_k = target_day_val.strftime("%Y-%m-%d")
        else:
            target_k = str(target_day_val)[:10]

        if target_k in p_dict:
            return p_dict[target_k]
        keys = stock_date_keys.get(sym_name) or []
        if not keys:
            return fallback_price
        idx = bisect.bisect_right(keys, target_k) - 1
        if idx >= 0:
            return p_dict[keys[idx]]
        return fallback_price

    for i, t_day in enumerate(trading_days):
        t_str = t_day.isoformat()
        if progress_callback and (i % 20 == 0 or i == total_td - 1):
            progress_callback(f"Evaluating daily valuations (day {i + 1} of {total_td})...")

        # Find active run for this day (latest run on or before t_day)
        active_run = None
        for r in parsed_runs:
            if r["date"] <= t_day:
                active_run = r
            else:
                break

        if not active_run:
            continue

        holdings = active_run["holdings"]
        wallet = active_run["wallet"]
        invested = active_run["invested"]

        day_stock_val = 0.0
        for h in holdings:
            sym = h.get("symbol")
            qty = int(h.get("quantity") or 0)
            if not sym or qty <= 0:
                continue
            fallback_p = float(h.get("current_price") or h.get("buy_price") or 0.0)
            close_p = _get_close_price(sym, t_str, fallback_p)
            day_stock_val += qty * close_p

        total_day_val = round(day_stock_val + wallet, 2)
        points.append({
            "date": t_str,
            "invested": round(invested, 2),
            "portfolio_value": total_day_val,
            "wallet": round(wallet, 2),
            "active_run_index": active_run["run_index"]
        })

    return points


def _compute_performance_kpis(points):
    """
    Computes all required performance KPIs:
    - Maximum top 3 negative drilldown % with date
    - Maximum top 3 positive moment % with date
    - Consolidated Maximum negative % with date (Max Drawdown)
    - CAGR, Total Net Return, Win Rate, and Peak Valuation
    """
    if not points:
        return {}

    changes = []
    running_peak_val = points[0]["portfolio_value"]
    running_peak_date = points[0]["date"]

    max_dd_pct = 0.0
    max_dd_amt = 0.0
    max_dd_peak_val = running_peak_val
    max_dd_peak_date = running_peak_date
    max_dd_trough_val = running_peak_val
    max_dd_trough_date = running_peak_date

    overall_peak_val = running_peak_val
    overall_peak_date = running_peak_date

    # Maximum drilldown below cumulative investment amount
    max_below_inv_pct = 0.0
    max_below_inv_amt = 0.0
    max_below_inv_date = None
    max_below_inv_val = None
    max_below_inv_capital = None
    was_ever_below = False
    below_inv_points = []

    for i in range(len(points)):
        pt = points[i]
        val = pt["portfolio_value"]
        d = pt["date"]
        inv = pt["invested"]

        pt["pnl"] = round(val - inv, 2)
        pt["pnl_percent"] = round(((val - inv) / inv) * 100.0, 2) if inv > 0 else 0.0

        # Drilldown below investment amount
        if inv > 0:
            diff_amt = round(val - inv, 2)
            diff_pct = round(((val - inv) / inv) * 100.0, 2)
            if diff_amt < 0:
                was_ever_below = True
                pt["below_invested_amount"] = diff_amt
                pt["below_invested_percent"] = diff_pct
                below_inv_points.append({
                    "date": d,
                    "deficit_percent": diff_pct,
                    "deficit_amount": diff_amt,
                    "portfolio_value": val,
                    "invested": inv
                })
                if max_below_inv_date is None or diff_pct < max_below_inv_pct:
                    max_below_inv_pct = diff_pct
                    max_below_inv_amt = diff_amt
                    max_below_inv_date = d
                    max_below_inv_val = val
                    max_below_inv_capital = inv
            else:
                pt["below_invested_amount"] = 0.0
                pt["below_invested_percent"] = 0.0

        # Running peak and drawdown
        if val > running_peak_val:
            running_peak_val = val
            running_peak_date = d

        dd_pct = round(((val - running_peak_val) / running_peak_val) * 100.0, 2) if running_peak_val > 0 else 0.0
        dd_amt = round(val - running_peak_val, 2)
        pt["drawdown_percent"] = dd_pct

        if dd_pct < max_dd_pct:
            max_dd_pct = dd_pct
            max_dd_amt = dd_amt
            max_dd_peak_val = running_peak_val
            max_dd_peak_date = running_peak_date
            max_dd_trough_val = val
            max_dd_trough_date = d

        if val > overall_peak_val:
            overall_peak_val = val
            overall_peak_date = d

        # Period Change from previous point
        if i > 0:
            prev_pt = points[i - 1]
            prev_val = prev_pt["portfolio_value"]
            inv_stepup = max(0.0, inv - prev_pt["invested"])

            # Net price change excluding stepup injection
            net_change_amt = round(val - prev_val - inv_stepup, 2)
            net_change_pct = round((net_change_amt / prev_val) * 100.0, 2) if prev_val > 0 else 0.0

            pt["change_amount"] = net_change_amt
            pt["change_percent"] = net_change_pct

            changes.append({
                "date": d,
                "change_percent": net_change_pct,
                "change_amount": net_change_amt,
                "portfolio_value": val,
                "invested": inv
            })
        else:
            pt["change_amount"] = 0.0
            pt["change_percent"] = 0.0

    # 1. Top 3 negative drilldown % (Largest drops)
    neg_changes = [c for c in changes if c["change_percent"] < 0]
    neg_changes.sort(key=lambda x: x["change_percent"])  # Most negative first
    top_3_negative = []
    for rank, item in enumerate(neg_changes[:3], 1):
        top_3_negative.append({
            "rank": rank,
            "date": item["date"],
            "change_percent": item["change_percent"],
            "change_amount": item["change_amount"],
            "portfolio_value": item["portfolio_value"]
        })

    # 2. Top 3 positive moment % (Largest gains)
    pos_changes = [c for c in changes if c["change_percent"] > 0]
    pos_changes.sort(key=lambda x: x["change_percent"], reverse=True)  # Most positive first
    top_3_positive = []
    for rank, item in enumerate(pos_changes[:3], 1):
        top_3_positive.append({
            "rank": rank,
            "date": item["date"],
            "change_percent": item["change_percent"],
            "change_amount": item["change_amount"],
            "portfolio_value": item["portfolio_value"]
        })

    # 3. Overall Return & CAGR
    first_pt = points[0]
    last_pt = points[-1]
    total_ret_amt = round(last_pt["portfolio_value"] - last_pt["invested"], 2)
    total_ret_pct = round((total_ret_amt / last_pt["invested"]) * 100.0, 2) if last_pt["invested"] > 0 else 0.0

    try:
        d_start = _parse_date(first_pt["date"])
        d_end = _parse_date(last_pt["date"])
        days_elapsed = max(1, (d_end - d_start).days)
        years = days_elapsed / 365.25
        if years >= 0.08 and last_pt["invested"] > 0 and last_pt["portfolio_value"] > 0:
            cagr = round((((last_pt["portfolio_value"] / last_pt["invested"]) ** (1.0 / years)) - 1.0) * 100.0, 2)
        else:
            cagr = total_ret_pct
    except Exception:
        cagr = total_ret_pct

    positive_days_count = len(pos_changes)
    negative_days_count = len(neg_changes)
    total_traded_periods = len(changes)
    win_rate = round((positive_days_count / total_traded_periods) * 100.0, 2) if total_traded_periods > 0 else 0.0

    # Top 3 negative drilldowns below investment amount
    below_inv_points.sort(key=lambda x: x["deficit_percent"])  # Most negative first
    top_3_below_investment = []
    for rank, item in enumerate(below_inv_points[:3], 1):
        top_3_below_investment.append({
            "rank": rank,
            "date": item["date"],
            "deficit_percent": item["deficit_percent"],
            "deficit_amount": item["deficit_amount"],
            "portfolio_value": item["portfolio_value"],
            "invested": item["invested"]
        })

    max_drilldown_below_investment = {
        "max_deficit_percent": max_below_inv_pct,
        "max_deficit_amount": max_below_inv_amt,
        "date": max_below_inv_date,
        "portfolio_value": max_below_inv_val,
        "invested": max_below_inv_capital,
        "was_ever_below": was_ever_below,
        "below_investment_days_count": len(below_inv_points)
    }

    return {
        "top_3_negative": top_3_negative,
        "top_3_positive": top_3_positive,
        "max_drawdown": {
            "max_drawdown_percent": max_dd_pct,
            "drawdown_amount": max_dd_amt,
            "peak_date": max_dd_peak_date,
            "peak_value": max_dd_peak_val,
            "trough_date": max_dd_trough_date,
            "trough_value": max_dd_trough_val
        },
        "max_drilldown_below_investment": max_drilldown_below_investment,
        "top_3_below_investment": top_3_below_investment,
        "current_invested": last_pt["invested"],
        "current_value": last_pt["portfolio_value"],
        "total_return_amount": total_ret_amt,
        "total_return_percent": total_ret_pct,
        "cagr": cagr,
        "positive_days_count": positive_days_count,
        "negative_days_count": negative_days_count,
        "win_rate": win_rate,
        "peak_portfolio_value": overall_peak_val,
        "peak_date": overall_peak_date
    }


# ==============================================================================
# ASYNC BACKGROUND JOB MANAGEMENT
# ==============================================================================

def start_performance_graph_job(strategy_id, username=None, force_refresh=False):
    """
    Starts an asynchronous background job to evaluate the performance graph.
    If a job is already calculating for this strategy, returns the existing job info
    with already_running=True (as requested by user).
    """
    from modules.momentum_smallcases.momentum_smallcases_store import get_user_strategy

    strategy = get_user_strategy(strategy_id, username=username)
    if not strategy:
        raise ValueError("Strategy not found")

    runs = strategy.get("runs", [])
    if not runs:
        raise ValueError("Cannot calculate performance graph for an uninitialized strategy. Please run Init first.")

    with _GRAPH_LOCK:
        # Check if an existing job is actively running for this strategy
        for j_id, job_info in _GRAPH_JOBS.items():
            if job_info.get("strategy_id") == strategy_id and job_info.get("status") == "RUNNING":
                return {
                    "already_running": True,
                    "job_id": j_id,
                    "status": "RUNNING",
                    "message": "Already calculating for smallcase"
                }

        # Check if cached result exists and is still fresh (same runs count)
        if not force_refresh and strategy_id in _GRAPH_CACHE:
            cached = _GRAPH_CACHE[strategy_id]
            if cached.get("runs_count") == len(runs):
                return {
                    "already_running": False,
                    "job_id": None,
                    "status": "COMPLETED",
                    "data": cached.get("data"),
                    "message": "Performance graph retrieved from cache"
                }

        # Create new job
        job_id = f"job_graph_{uuid.uuid4().hex[:10]}"
        job_data = {
            "id": job_id,
            "strategy_id": strategy_id,
            "strategy_name": strategy.get("name"),
            "status": "RUNNING",
            "progress": "Starting calculation...",
            "started_at": datetime.now().isoformat(),
            "completed_at": None,
            "result": None,
            "error": None
        }
        _GRAPH_JOBS[job_id] = job_data

    def _worker():
        try:
            logger.info(f"Performance graph job {job_id} started for strategy {strategy_id}")

            def progress_cb(text):
                with _GRAPH_LOCK:
                    if job_id in _GRAPH_JOBS:
                        _GRAPH_JOBS[job_id]["progress"] = text

            result = calculate_strategy_performance_series(strategy, progress_callback=progress_cb)

            with _GRAPH_LOCK:
                if job_id in _GRAPH_JOBS:
                    _GRAPH_JOBS[job_id]["status"] = "COMPLETED"
                    _GRAPH_JOBS[job_id]["progress"] = "Calculation complete."
                    _GRAPH_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                    _GRAPH_JOBS[job_id]["result"] = result

                # Update cache
                _GRAPH_CACHE[strategy_id] = {
                    "cached_at": datetime.now().isoformat(),
                    "runs_count": len(runs),
                    "data": result
                }

            logger.info(f"Performance graph job {job_id} completed successfully for {strategy_id}")
        except Exception as e:
            logger.error(f"Error in performance graph job {job_id}: {e}", exc_info=True)
            with _GRAPH_LOCK:
                if job_id in _GRAPH_JOBS:
                    _GRAPH_JOBS[job_id]["status"] = "FAILED"
                    _GRAPH_JOBS[job_id]["progress"] = "Calculation failed."
                    _GRAPH_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                    _GRAPH_JOBS[job_id]["error"] = str(e)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()

    return {
        "already_running": False,
        "job_id": job_id,
        "status": "RUNNING",
        "message": "Performance graph calculation started in background"
    }


def get_performance_graph_job_status(job_id):
    """Retrieves current execution status and result for a performance graph job."""
    with _GRAPH_LOCK:
        job = _GRAPH_JOBS.get(job_id)
        if not job:
            return None
        # Return a copy to avoid mutation
        return dict(job)

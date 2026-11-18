"""
CAPITAL DESK - MOMENTUM SMALLCASES CALCULATION ENGINE
Handles:
1. Trading day adjustments using official trading holidays (collection trading_holidays) and weekends.
2. Market hours detection (09:15 - 15:30 IST) for previous day close vs today's close.
3. Historical daily prices and metrics calculation (1M, 2M, 5M, 9M returns and 1M, 3M volatilities).
4. Formula parsing & evaluation.
5. Stock universe filtering by stock dateAdded.
6. Equal-weighted portfolio initialization & rebalancing with 0.10% transaction fees and wallet tracking.
"""

import os
import math
import re
import json
import logging
from datetime import datetime, date, time, timedelta
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Transaction fee: 0.10% (0.001)
TRANSACTION_FEE_RATE = 0.001

# Default Momentum Formula
DEFAULT_FORMULA = "(50% * 1M price return + 30% * 2M price return + 10% * 5M price return + 10% * 9M price return ) / (1M Price Volatility + 3M Price Volatility)"

import threading

try:
    from curl_cffi import requests as stock_http_requests
    _HAS_CURL_CFFI = True
except ImportError:
    import requests as stock_http_requests
    _HAS_CURL_CFFI = False

_thread_local = threading.local()


def _get_thread_http_session():
    """Provides a thread-local persistent HTTP session with Chrome TLS impersonation or connection pooling."""
    if not hasattr(_thread_local, 'session'):
        if _HAS_CURL_CFFI:
            _thread_local.session = stock_http_requests.Session(impersonate="chrome")
        else:
            s = stock_http_requests.Session()
            adapter = stock_http_requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=1)
            s.mount('https://', adapter)
            s.mount('http://', adapter)
            _thread_local.session = s
    return _thread_local.session


# Cache directory for downloaded historical prices
_CACHE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "app_data",
    "momentum_price_cache.json"
)
_memory_price_cache = {}
_cache_lock = threading.Lock()


def load_price_cache():
    global _memory_price_cache
    with _cache_lock:
        if _memory_price_cache:
            return _memory_price_cache
        if os.path.exists(_CACHE_FILE):
            try:
                with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                    _memory_price_cache = json.load(f)
            except Exception:
                _memory_price_cache = {}
        return _memory_price_cache


def save_price_cache():
    with _cache_lock:
        try:
            os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
            tmp = f"{_CACHE_FILE}.tmp.{os.getpid()}"
            data_copy = dict(_memory_price_cache)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data_copy, f, ensure_ascii=False)
            
            # Robust atomic replacement with brief retries on Windows
            for attempt in range(5):
                try:
                    os.replace(tmp, _CACHE_FILE)
                    break
                except PermissionError:
                    if attempt < 4:
                        time.sleep(0.06)
                    else:
                        import shutil
                        shutil.copyfile(tmp, _CACHE_FILE)
                        try:
                            os.remove(tmp)
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"Failed to save price cache: {e}")


# ==============================================================================
# TRADING CALENDAR & TRADING HOURS RULES
# ==============================================================================

def get_official_trading_holidays():
    """
    Loads all official trading holidays from db_store (collection trading_holidays).
    Returns a set of 'YYYY-MM-DD' holiday strings.
    """
    try:
        from db_store import load_trading_holidays_db
        holidays_list = load_trading_holidays_db() or []
        holidays_set = set()
        for h in holidays_list:
            d_str = h.get("date")
            is_trade = h.get("is_trading_holiday", True)
            if d_str and is_trade:
                # normalize YYYY-MM-DD
                holidays_set.add(str(d_str).strip()[:10])
        return holidays_set
    except Exception as e:
        logger.warning(f"Error loading trading holidays from db: {e}")
        return set()


def is_trading_holiday(d, holidays_set=None):
    """Checks if date is a weekend (Sat/Sun) or an official trading holiday."""
    if isinstance(d, datetime):
        d = d.date()
    if d.weekday() in (5, 6):  # Saturday or Sunday
        return True
    if holidays_set is None:
        holidays_set = get_official_trading_holidays()
    return d.strftime("%Y-%m-%d") in holidays_set


def get_next_trading_day(target_date, holidays_set=None):
    """
    Moves target date to the next available trading day if it falls on a weekend
    or official trading holiday.
    Returns: (adjusted_date, was_moved)
    """
    if isinstance(target_date, datetime):
        curr = target_date.date()
    elif isinstance(target_date, str):
        curr = datetime.strptime(target_date[:10], "%Y-%m-%d").date()
    else:
        curr = target_date

    if holidays_set is None:
        holidays_set = get_official_trading_holidays()

    was_moved = False
    original = curr
    while is_trading_holiday(curr, holidays_set):
        curr += timedelta(days=1)
        was_moved = True

    return curr, was_moved


def is_in_trading_hours_now():
    """
    Indian market trading hours: 09:15 to 15:30 IST on trading days.
    Returns True if current time is within trading hours.
    """
    try:
        # Local time or IST (UTC + 05:30)
        now_dt = datetime.now()
        # Check weekend / holiday
        if is_trading_holiday(now_dt.date()):
            return False
        market_start = time(9, 15)
        market_end = time(15, 30)
        curr_time = now_dt.time()
        return market_start <= curr_time <= market_end
    except Exception:
        return False


# ==============================================================================
# HISTORICAL PRICE FETCHING & CACHING
# ==============================================================================

def fetch_stock_daily_series(symbol, target_cutoff_date=None, force_refresh=False):
    """
    Fetches daily price series for an NSE stock with multi-host failover,
    5-year historical range, and alias support.
    Returns list of (date_obj, close_price) sorted ascending.
    """
    clean_sym = symbol.strip().upper().replace('.NS', '').replace('.BO', '')
    
    # Common ticker alias mappings on NSE
    alias_map = {
        'TATAMOTORS': 'TMPV',
        'HDFC': 'HDFCBANK'
    }
    fetch_sym = alias_map.get(clean_sym, clean_sym)

    cache_key = f"{fetch_sym}_daily"
    cache = load_price_cache()

    today_str = date.today().isoformat()
    with _cache_lock:
        cached = cache.get(cache_key)

    data_points = None
    if cached and not force_refresh:
        cached_date = cached.get("cached_at", "")
        # Use cache if refreshed today and has valid series
        if cached_date == today_str and "series" in cached and len(cached["series"]) > 0:
            data_points = cached["series"]

    if data_points is None:
        session = _get_thread_http_session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com/'
        }
        hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']
        
        for host in hosts:
            url = f"https://{host}/v8/finance/chart/{fetch_sym}.NS?interval=1d&range=5y"
            try:
                r = session.get(url, headers=headers, timeout=3.5)
                if r.status_code == 200:
                    body = r.json()
                    res = body.get('chart', {}).get('result', [{}])[0]
                    timestamps = res.get('timestamp', []) or []
                    quotes = res.get('indicators', {}).get('quote', [{}])[0]
                    closes = quotes.get('close', []) or []
                    
                    series = []
                    for ts, c in zip(timestamps, closes):
                        if c is not None and c > 0:
                            d_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                            series.append((d_str, round(float(c), 2)))
                    
                    if series:
                        data_points = series
                        with _cache_lock:
                            cache[cache_key] = {
                                "cached_at": today_str,
                                "series": series
                            }
                        break
                elif r.status_code == 404:
                    # Symbol not found on NSE query endpoint, break to avoid wasting time on query1
                    break
            except Exception as e:
                logger.warning(f"Error fetching Yahoo series for {fetch_sym} from {host}: {e}")

    # Fallback to existing cached series even if cached earlier
    if not data_points:
        if cached and "series" in cached and len(cached["series"]) > 0:
            data_points = cached["series"]
        else:
            # Fallback to market_fetcher live price if Yahoo chart endpoint is blocked
            try:
                from modules.common.market_fetcher import fetcher
                live_info = fetcher.fetch_stock(f"{fetch_sym}.NS", use_cache=True)
                if live_info and not live_info.get("error") and live_info.get("price"):
                    price = float(live_info["price"])
                    prev = float(live_info.get("previous_close") or price)
                    today_d = date.today().isoformat()
                    yesterday_d = (date.today() - timedelta(days=1)).isoformat()
                    data_points = [(yesterday_d, prev), (today_d, price)]
            except Exception:
                pass

    if not data_points:
        return []

    # Convert to (date_obj, close_price)
    cutoff_date = None
    if target_cutoff_date:
        if isinstance(target_cutoff_date, str):
            try:
                cutoff_date = datetime.strptime(target_cutoff_date[:10], "%Y-%m-%d").date()
            except Exception:
                cutoff_date = None
        elif isinstance(target_cutoff_date, datetime):
            cutoff_date = target_cutoff_date.date()
        elif isinstance(target_cutoff_date, date):
            cutoff_date = target_cutoff_date

    parsed_series = []
    for d_str, price in data_points:
        try:
            dt = datetime.strptime(d_str[:10], "%Y-%m-%d").date()
            if cutoff_date and dt > cutoff_date:
                continue
            parsed_series.append((dt, price))
        except Exception:
            continue

    parsed_series.sort(key=lambda x: x[0])
    return parsed_series


# ==============================================================================
# MOMENTUM FORMULA & METRICS EVALUATION
# ==============================================================================

def calculate_stock_momentum_metrics(symbol, target_date, in_trading_hours=False):
    """
    Calculates 1M, 2M, 5M, 9M price returns and 1M, 3M volatilities for a stock
    at target_date according to the user's trading hours rules:
    - If in trading hours, use previous day's close (T-1 close).
    - Else use today's / target_date's close.
    Gracefully computes metrics even if history is shorter than 9 months.
    """
    series = fetch_stock_daily_series(symbol, target_cutoff_date=target_date)
    if not series:
        return None

    # Apply trading hours price rule
    if in_trading_hours and len(series) >= 2:
        eval_series = series[:-1]
    else:
        eval_series = series

    if not eval_series or len(eval_series) < 2:
        return None

    prices = [p for _, p in eval_series]
    n = len(prices)
    curr_price = prices[-1]

    # Trading days offsets:
    # 1M = 21 days, 2M = 42 days, 5M = 105 days, 9M = 189 days
    # Graceful fallback: use max available days if history is shorter
    idx_1m = max(0, n - 22)
    idx_2m = max(0, n - 43)
    idx_5m = max(0, n - 106)
    idx_9m = max(0, n - 190)

    p_1m = prices[idx_1m]
    p_2m = prices[idx_2m]
    p_5m = prices[idx_5m]
    p_9m = prices[idx_9m]

    r_1m = ((curr_price - p_1m) / p_1m) * 100.0 if p_1m > 0 else 0.0
    r_2m = ((curr_price - p_2m) / p_2m) * 100.0 if p_2m > 0 else 0.0
    r_5m = ((curr_price - p_5m) / p_5m) * 100.0 if p_5m > 0 else 0.0
    r_9m = ((curr_price - p_9m) / p_9m) * 100.0 if p_9m > 0 else 0.0

    # 1M Volatility (up to 21 trading days annualized standard deviation)
    days_1m = min(21, n - 1)
    if days_1m > 1:
        daily_rets_1m = [(prices[-i] - prices[-i-1]) / prices[-i-1] for i in range(1, days_1m + 1) if prices[-i-1] > 0]
        mean_1m = sum(daily_rets_1m) / len(daily_rets_1m) if daily_rets_1m else 0.0
        var_1m = sum((x - mean_1m)**2 for x in daily_rets_1m) / max(1, len(daily_rets_1m) - 1) if len(daily_rets_1m) > 1 else 0.0
        vol_1m = math.sqrt(max(0.0, var_1m)) * math.sqrt(252) * 100.0
    else:
        vol_1m = 15.0  # sensible neutral default volatility

    # 3M Volatility (up to 63 trading days annualized standard deviation)
    days_3m = min(63, n - 1)
    if days_3m > 1:
        daily_rets_3m = [(prices[-i] - prices[-i-1]) / prices[-i-1] for i in range(1, days_3m + 1) if prices[-i-1] > 0]
        mean_3m = sum(daily_rets_3m) / len(daily_rets_3m) if daily_rets_3m else 0.0
        var_3m = sum((x - mean_3m)**2 for x in daily_rets_3m) / max(1, len(daily_rets_3m) - 1) if len(daily_rets_3m) > 1 else 0.0
        vol_3m = math.sqrt(max(0.0, var_3m)) * math.sqrt(252) * 100.0
    else:
        vol_3m = 18.0  # sensible neutral default volatility

    return {
        "symbol": symbol.strip().upper(),
        "price": round(curr_price, 2),
        "return_1m": round(r_1m, 2),
        "return_2m": round(r_2m, 2),
        "return_5m": round(r_5m, 2),
        "return_9m": round(r_9m, 2),
        "ret_1m": round(r_1m, 2),
        "ret_2m": round(r_2m, 2),
        "ret_5m": round(r_5m, 2),
        "ret_9m": round(r_9m, 2),
        "volatility_1m": round(vol_1m, 2),
        "volatility_3m": round(vol_3m, 2),
        "vol_1m": round(vol_1m, 2),
        "vol_3m": round(vol_3m, 2),
    }


def evaluate_formula_score(metrics, formula_str=None):
    """
    Evaluates momentum score from metrics.
    Default formula:
    (50% * 1M price return + 30% * 2M price return + 10% * 5M price return + 10% * 9M price return ) / (1M Price Volatility + 3M Price Volatility)
    """
    r_1m = metrics.get("return_1m", 0.0)
    r_2m = metrics.get("return_2m", 0.0)
    r_5m = metrics.get("return_5m", 0.0)
    r_9m = metrics.get("return_9m", 0.0)
    vol_1m = metrics.get("volatility_1m", 0.0)
    vol_3m = metrics.get("volatility_3m", 0.0)

    # Numerator & Denominator for default formula
    w1, w2, w3, w4 = 0.50, 0.30, 0.10, 0.10

    if formula_str:
        # Check custom weights if pattern like 50% * 1M ... is found
        try:
            m = re.findall(r'(\d+)\s*%\s*\*\s*(\d+)M', formula_str, re.IGNORECASE)
            weights = {f"{month}M": int(pct) / 100.0 for pct, month in m}
            if "1M" in weights: w1 = weights["1M"]
            if "2M" in weights: w2 = weights["2M"]
            if "5M" in weights: w3 = weights["5M"]
            if "9M" in weights: w4 = weights["9M"]
        except Exception:
            pass

    numerator = (w1 * r_1m) + (w2 * r_2m) + (w3 * r_5m) + (w4 * r_9m)
    denominator = max(vol_1m + vol_3m, 0.01)

    score = numerator / denominator
    return round(score, 4)


# ==============================================================================
# UNIVERSE FILTERING & RANKING
# ==============================================================================

def parse_stock_date_added(date_str):
    """Parses dateAdded string into a datetime.date object."""
    if not date_str or not isinstance(date_str, str):
        return None
    cleaned = date_str.strip().replace('-', '/').replace('.', '/')
    parts = cleaned.split('/')
    if len(parts) == 3:
        try:
            if len(parts[0]) == 4:  # YYYY/MM/DD
                y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
            else:  # DD/MM/YYYY
                d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return date(y, m, d)
        except Exception:
            pass
    return None


def filter_universe_by_date_with_meta(stock_items, target_date):
    """
    Filters universe stocks where stock's addition date <= target_date.
    If stock has no date_added (e.g. Nifty benchmark stocks), it is included by default.
    Returns: (eligible_symbols_list, meta_dict)
    """
    eligible = []
    if isinstance(target_date, str):
        target_date = datetime.strptime(target_date[:10], "%Y-%m-%d").date()

    all_dates = []

    for item in stock_items:
        sym = item.get("symbol") if isinstance(item, dict) else str(item)
        date_added_raw = item.get("date_added") if isinstance(item, dict) else None

        if not date_added_raw:
            eligible.append(sym)
            continue

        d_added = parse_stock_date_added(date_added_raw)
        if d_added:
            all_dates.append(d_added)
            if d_added <= target_date:
                eligible.append(sym)
        else:
            eligible.append(sym)

    all_dates.sort()
    meta = {
        "total_constituents": len(stock_items),
        "earliest_date_added": all_dates[0] if all_dates else None,
        "latest_date_added": all_dates[-1] if all_dates else None,
    }

    return list(dict.fromkeys(eligible)), meta


def filter_universe_by_date(stock_items, target_date):
    """Legacy compatibility helper."""
    eligible, _ = filter_universe_by_date_with_meta(stock_items, target_date)
    return eligible


def rank_and_evaluate_universe(stock_items, target_date, formula_str, no_of_stocks, exit_regime_ranking, return_meta=False, save_cache=True):
    """
    Calculates formula scores for all eligible stocks, ranks them descending,
    assigns color tiers (green for top N, dark yellow up to exit regime),
    and limits the output to exit_regime_ranking + 15 stocks.
    Returns: (displayed_stocks, eligible_count, [meta_dict if return_meta=True])
    """
    eligible_symbols, date_info = filter_universe_by_date_with_meta(stock_items, target_date)
    if not eligible_symbols:
        if return_meta:
            return [], 0, date_info
        return [], 0

    in_trading_hours = is_in_trading_hours_now() if (target_date == date.today()) else False

    calculated_stocks = []
    failed_symbols = []

    def _eval(sym):
        try:
            metrics = calculate_stock_momentum_metrics(sym, target_date, in_trading_hours)
            if metrics:
                score = evaluate_formula_score(metrics, formula_str)
                metrics["total_score"] = score
                return (sym, metrics)
        except Exception as e:
            logger.warning(f"Error evaluating {sym}: {e}")
        return (sym, None)

    # Fetch concurrently with safe worker pool
    worker_count = min(24, max(4, len(eligible_symbols)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = executor.map(_eval, eligible_symbols)
        for sym, r in results:
            if r:
                calculated_stocks.append(r)
            else:
                failed_symbols.append(sym)

    # Save disk cache ONCE after all worker threads finish (if save_cache requested)
    if save_cache:
        save_price_cache()

    # Sort descending by total_score
    calculated_stocks.sort(key=lambda x: x["total_score"], reverse=True)

    # Assign ranks and tiers
    for i, stock in enumerate(calculated_stocks):
        rank = i + 1
        stock["rank"] = rank
        if rank <= no_of_stocks:
            stock["tier"] = "TOP_SELECTION"  # Green
        elif rank <= exit_regime_ranking:
            stock["tier"] = "EXIT_REGIME"   # Dark Yellow
        else:
            stock["tier"] = "EXCLUDED"      # Neutral

    # Limit to exit_regime_ranking + 15 stocks only
    max_display = exit_regime_ranking + 15
    displayed_stocks = calculated_stocks[:max_display]

    meta_result = {
        "failed_symbols": failed_symbols,
        "eligible_count": len(eligible_symbols),
        "all_stocks": calculated_stocks,
        **date_info
    }

    if return_meta:
        return displayed_stocks, len(eligible_symbols), meta_result
    return displayed_stocks, len(eligible_symbols)


# ==============================================================================
# PORTFOLIO EXECUTION: INIT & REBALANCE LOGIC
# ==============================================================================

def execute_init_run(ranked_stocks, amount_to_invest, no_of_stocks):
    """
    Initial execution:
    - Equal weight allocated across top no_of_stocks.
    - 0.10% transaction fee deducted on each purchase.
    - Leftover cash remains in wallet.
    """
    amount_to_invest = round(float(amount_to_invest), 2)
    top_picks = [s for s in ranked_stocks if s["rank"] <= no_of_stocks]
    if not top_picks:
        return {
            "holdings": [],
            "invested_value": 0.0,
            "current_value": 0.0,
            "wallet_balance": amount_to_invest,
            "total_portfolio_value": amount_to_invest,
            "total_capital": amount_to_invest,
            "total_pnl": 0.0,
            "total_pnl_percent": 0.0,
            "fees_paid": 0.0,
            "changes": {"added": [], "removed": [], "retained": []}
        }

    target_per_stock = amount_to_invest / float(len(top_picks))
    holdings = []
    total_invested = 0.0
    total_fees = 0.0
    added_symbols = []

    for s in top_picks:
        price = s["price"]
        # Allow purchase taking 0.10% fee into account
        qty = math.floor(target_per_stock / (price * (1.0 + TRANSACTION_FEE_RATE)))
        if qty > 0:
            stock_cost = qty * price
            fee = round(stock_cost * TRANSACTION_FEE_RATE, 2)
            total_invested += stock_cost
            total_fees += fee
            weight_pct = round((stock_cost / amount_to_invest) * 100.0, 2)
            s["action"] = "BUY"
            s["quantity"] = qty
            s["allocated_amount"] = round(stock_cost, 2)
            s["weight_percent"] = weight_pct
            s["fee"] = fee
            s["is_held"] = True
            added_symbols.append(s["symbol"])

            holdings.append({
                "symbol": s["symbol"],
                "quantity": qty,
                "buy_price": price,
                "current_price": price,
                "invested": round(stock_cost, 2),
                "current_value": round(stock_cost, 2),
                "weight_percent": weight_pct,
                "pnl": 0.0,
                "pnl_percent": 0.0
            })
        else:
            s["action"] = "SKIPPED"
            s["quantity"] = 0
            s["fee"] = 0.0
            s["is_held"] = False

    wallet_balance = round(amount_to_invest - total_invested - total_fees, 2)
    total_portfolio_value = round(total_invested + wallet_balance, 2)
    total_pnl = round(total_portfolio_value - amount_to_invest, 2)
    total_pnl_percent = round((total_pnl / amount_to_invest) * 100.0, 2) if amount_to_invest > 0 else 0.0

    return {
        "holdings": holdings,
        "invested_value": round(total_invested, 2),
        "current_value": round(total_invested, 2),
        "wallet_balance": wallet_balance,
        "total_portfolio_value": total_portfolio_value,
        "total_capital": amount_to_invest,
        "total_pnl": total_pnl,
        "total_pnl_percent": total_pnl_percent,
        "fees_paid": round(total_fees, 2),
        "changes": {
            "added": added_symbols,
            "removed": [],
            "retained": []
        }
    }


def execute_rebalance_run(ranked_stocks, previous_holdings, previous_wallet, stepup_amount, no_of_stocks, exit_regime_ranking, target_date=None, all_universe_stocks=None, total_capital=None):
    """
    Rebalance execution with pure equal allocation across all stocks (including stepup and existing stocks):
    1. Retain stocks whose rank <= exit_regime_ranking.
    2. Exit (completely sell) stocks whose rank > exit_regime_ranking or missing from rankings (deduct 0.10% sell fee).
       Exit price is resolved from:
       - ranked_stocks
       - all_universe_stocks (full universe evaluation before display truncation)
       - target_date historical closing quote via fetch_stock_daily_series
       - fallback to previous holding's price
       Negative P&L and negative percentage are accurately recorded and deducted from portfolio value.
    3. Select top-ranked newcomers to fill up to no_of_stocks.
    4. Compute total available equity (current market values of retained holdings + wallet cash + stepup + proceeds from exited stocks).
    5. Calculate target equal allocation per stock = total_equity / no_of_stocks.
    6. Rebalance existing stocks and newcomers:
       - Trim overweight retained stocks (sell excess shares to bring to target allocation).
       - Buy additional shares for underweight retained stocks to bring to target allocation.
       - Buy newcomer stocks up to target allocation.
    7. Deduct 0.10% transaction fees on all rebalancing trades and track wallet balance.
    """
    rank_map = {s["symbol"]: s for s in ranked_stocks}
    all_stocks_map = {}
    if all_universe_stocks:
        for s in all_universe_stocks:
            if isinstance(s, dict) and "symbol" in s:
                all_stocks_map[s["symbol"]] = s
    all_stocks_map.update(rank_map)

    prev_holdings_map = {h["symbol"]: h for h in previous_holdings}

    # Wallet starts with previous cash + newly deposited step-up
    wallet = float(previous_wallet) + float(stepup_amount or 0.0)
    total_fees = 0.0

    removed_symbols = []
    retained_symbols = []
    exited_stocks = []

    # Step 1: Identify Exiting Stocks vs Retained Stocks
    for sym, h in prev_holdings_map.items():
        stk = rank_map.get(sym)
        univ_stk = all_stocks_map.get(sym)

        is_retained = False
        if stk and stk.get("rank") is not None and stk["rank"] <= exit_regime_ranking:
            is_retained = True
        elif univ_stk and univ_stk.get("rank") is not None and univ_stk["rank"] <= exit_regime_ranking:
            is_retained = True
            stk = univ_stk

        if not is_retained:
            # Complete Exit / Sell
            exit_price = None
            if stk and stk.get("price") is not None:
                exit_price = round(float(stk["price"]), 2)
            elif univ_stk and univ_stk.get("price") is not None:
                exit_price = round(float(univ_stk["price"]), 2)
            else:
                try:
                    series = fetch_stock_daily_series(sym, target_cutoff_date=target_date)
                    if series:
                        exit_price = round(float(series[-1][1]), 2)
                except Exception as e:
                    logger.warning(f"Error fetching exit price for {sym}: {e}")

            if exit_price is None or exit_price <= 0:
                exit_price = round(float(h.get("current_price", h.get("buy_price", 0.0))), 2)

            qty = int(h.get("quantity", 0))
            avg_price = round(float(h.get("buy_price", 0.0)), 2)
            invested = round(float(h.get("invested", qty * avg_price)), 2)
            sell_value = round(qty * exit_price, 2)
            fee = round(sell_value * TRANSACTION_FEE_RATE, 2)
            wallet += (sell_value - fee)
            total_fees += fee
            removed_symbols.append(sym)
            pnl = round(sell_value - invested, 2)
            pnl_pct = round(((exit_price - avg_price) / avg_price) * 100.0, 2) if avg_price > 0 else 0.0

            exited_stocks.append({
                "symbol": sym,
                "quantity": qty,
                "average_price": avg_price,
                "exit_price": exit_price,
                "invested": invested,
                "exit_value": sell_value,
                "pnl": pnl,
                "pnl_percent": pnl_pct,
                "fee": fee
            })
            if stk:
                stk["action"] = "SELL"
                stk["action_label"] = "SELL (Exit)"
                stk["is_held"] = False
            elif univ_stk:
                univ_stk["action"] = "SELL"
                univ_stk["action_label"] = "SELL (Exit)"
                univ_stk["is_held"] = False
        else:
            retained_symbols.append(sym)

    # Step 2: Select Newcomers to Fill Up to no_of_stocks
    slots_needed = no_of_stocks - len(retained_symbols)
    candidates = []
    if slots_needed > 0:
        top_candidates = [s for s in ranked_stocks if s["rank"] <= no_of_stocks and s["symbol"] not in retained_symbols]
        if len(top_candidates) < slots_needed:
            extra = [s for s in ranked_stocks if s["symbol"] not in retained_symbols and s not in top_candidates]
            top_candidates.extend(extra[:slots_needed - len(top_candidates)])
        candidates = top_candidates[:slots_needed]

    # Target portfolio basket = Retained symbols + New candidate symbols
    new_candidate_symbols = [s["symbol"] for s in candidates]
    all_target_symbols = list(retained_symbols) + new_candidate_symbols
    total_target_stocks_count = max(1, len(all_target_symbols))

    # Step 3: Compute Total Available Equity
    # Market value of held retained stocks + wallet cash (which includes stepup + exit proceeds)
    retained_equity = 0.0
    for sym in retained_symbols:
        h = prev_holdings_map[sym]
        stk = rank_map[sym]
        retained_equity += float(h["quantity"]) * float(stk["price"])

    total_equity = retained_equity + wallet
    target_per_stock = total_equity / float(total_target_stocks_count)

    # Step 4: Rebalance trades
    holdings_dict = {}
    added_symbols = []

    # Prepare holding states
    for sym in retained_symbols:
        h = prev_holdings_map[sym]
        stk = rank_map[sym]
        price = float(stk["price"])
        q_old = int(h["quantity"])
        p_avg = float(h.get("buy_price", price))
        inv_old = float(h.get("invested", q_old * p_avg))
        holdings_dict[sym] = {
            "symbol": sym,
            "quantity": q_old,
            "buy_price": p_avg,
            "current_price": price,
            "invested": inv_old,
            "is_new": False
        }

    for s in candidates:
        sym = s["symbol"]
        price = float(s["price"])
        holdings_dict[sym] = {
            "symbol": sym,
            "quantity": 0,
            "buy_price": price,
            "current_price": price,
            "invested": 0.0,
            "is_new": True
        }

    # Phase 4A: Trim Overweight Retained Stocks FIRST to free up liquidity
    for sym, item in holdings_dict.items():
        price = item["current_price"]
        q_old = item["quantity"]
        q_target = math.floor(target_per_stock / (price * (1.0 + TRANSACTION_FEE_RATE)))

        if q_target < q_old:
            # Overweight: trim excess shares
            qty_to_sell = q_old - q_target
            sell_val = round(qty_to_sell * price, 2)
            fee = round(sell_val * TRANSACTION_FEE_RATE, 2)
            wallet += (sell_val - fee)
            total_fees += fee

            # Update item: buy_price per share remains the same on trim
            item["quantity"] = q_target
            item["invested"] = round(q_target * item["buy_price"], 2)

            stk = rank_map.get(sym)
            if stk:
                stk["action"] = "SELL"
                stk["action_label"] = f"TRIM (-{qty_to_sell})"
                stk["quantity"] = q_target
                stk["is_held"] = True
                stk["allocated_amount"] = round(q_target * price, 2)

    # Phase 4B: Buy Underweight Retained Stocks and Newcomers
    for sym, item in holdings_dict.items():
        price = item["current_price"]
        q_current = item["quantity"]
        q_target = math.floor(target_per_stock / (price * (1.0 + TRANSACTION_FEE_RATE)))

        if q_target > q_current:
            qty_needed = q_target - q_current
            share_cost_with_fee = price * (1.0 + TRANSACTION_FEE_RATE)
            max_affordable = math.floor(wallet / share_cost_with_fee) if share_cost_with_fee > 0 else 0
            qty_to_buy = min(qty_needed, max(0, max_affordable))

            if qty_to_buy > 0:
                cost = round(qty_to_buy * price, 2)
                fee = round(cost * TRANSACTION_FEE_RATE, 2)
                wallet -= (cost + fee)
                total_fees += fee

                new_qty = q_current + qty_to_buy
                new_invested = round(item["invested"] + cost, 2)
                new_avg_buy_price = round(new_invested / new_qty, 2) if new_qty > 0 else price

                item["quantity"] = new_qty
                item["invested"] = new_invested
                item["buy_price"] = new_avg_buy_price

                stk = rank_map.get(sym)
                if stk:
                    if item["is_new"]:
                        stk["action"] = "BUY"
                        stk["action_label"] = f"BUY ({new_qty})"
                        added_symbols.append(sym)
                    else:
                        stk["action"] = "BUY"
                        stk["action_label"] = f"BUY (+{qty_to_buy})"
                    stk["quantity"] = new_qty
                    stk["is_held"] = True
                    stk["allocated_amount"] = round(new_qty * price, 2)
                    stk["fee"] = fee
            else:
                stk = rank_map.get(sym)
                if stk:
                    stk["action"] = "HOLD"
                    stk["action_label"] = f"HOLD ({q_current})"
                    stk["quantity"] = q_current
                    stk["is_held"] = (q_current > 0)
        elif q_target == q_current and not item["is_new"]:
            stk = rank_map.get(sym)
            if stk and stk.get("action") not in ("SELL", "BUY"):
                stk["action"] = "HOLD"
                stk["action_label"] = f"HOLD ({q_current})"
                stk["quantity"] = q_current
                stk["is_held"] = True
                stk["allocated_amount"] = round(q_current * price, 2)

    # Step 5: Finalize Holdings Snapshot
    final_holdings = []
    for sym in all_target_symbols:
        item = holdings_dict.get(sym)
        if not item or item["quantity"] <= 0:
            continue
        qty = item["quantity"]
        curr_price = item["current_price"]
        curr_val = round(qty * curr_price, 2)
        inv = round(item["invested"], 2)
        pnl = round(curr_val - inv, 2)
        pnl_pct = round((pnl / inv) * 100.0, 2) if inv > 0 else 0.0

        final_holdings.append({
            "symbol": sym,
            "quantity": qty,
            "buy_price": item["buy_price"],
            "current_price": curr_price,
            "invested": inv,
            "current_value": curr_val,
            "pnl": pnl,
            "pnl_percent": pnl_pct
        })

    final_invested = round(sum(h["invested"] for h in final_holdings), 2)
    final_current = round(sum(h["current_value"] for h in final_holdings), 2)
    wallet = round(wallet, 2)
    total_val = round(final_current + wallet, 2)

    # Compute Total Capital and Net P&L (handling negative returns cleanly)
    if total_capital is None:
        total_capital = float(previous_wallet) + sum(float(h.get("invested", 0.0)) for h in previous_holdings) + float(stepup_amount or 0.0)
    total_cap = round(float(total_capital), 2)
    total_pnl = round(total_val - total_cap, 2)
    total_pnl_pct = round((total_pnl / total_cap) * 100.0, 2) if total_cap > 0 else 0.0

    # Weight percentages
    for h in final_holdings:
        h["weight_percent"] = round((h["current_value"] / max(total_val, 1.0)) * 100.0, 2)

    return {
        "holdings": final_holdings,
        "invested_value": final_invested,
        "current_value": final_current,
        "wallet_balance": wallet,
        "total_portfolio_value": total_val,
        "total_capital": total_cap,
        "total_pnl": total_pnl,
        "total_pnl_percent": total_pnl_pct,
        "fees_paid": round(total_fees, 2),
        "exited_stocks": exited_stocks,
        "changes": {
            "added": added_symbols,
            "removed": removed_symbols,
            "retained": retained_symbols,
            "exited_stocks": exited_stocks
        }
    }

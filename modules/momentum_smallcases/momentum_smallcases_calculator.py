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
# DATABASE COLLECTION: stock_closing_prices (PRIMARY PRICE SOURCE WITH CACHE)
# ==============================================================================
_db_prices_cache = {}
_db_prices_range_cache = {}
_db_cache_lock = threading.Lock()
_earliest_price_cache = {}
_earliest_price_lock = threading.Lock()


def _is_range_covered(cached_range, req_min, req_max):
    """Returns True if cached (min_date, max_date) covers [req_min, req_max]."""
    if cached_range is None:
        return False
    c_min, c_max = cached_range
    if c_min is None and c_max is None:
        return True
    if req_min is None:
        if c_min is not None:
            return False
    elif c_min is not None and str(req_min)[:10] < c_min:
        return False
    if req_max is None:
        if c_max is not None:
            return False
    elif c_max is not None and str(req_max)[:10] > c_max:
        return False
    return True


def get_stock_earliest_price_date(symbol):
    """
    Returns datetime.date representing the earliest available price date for symbol.
    Checks in-memory price cache first, then MongoDB Atlas collection 'stock_closing_prices'.
    """
    clean_s = symbol.strip().upper().replace('.NS', '').replace('.BO', '')
    alias_map = {'TATAMOTORS': 'TMPV', 'HDFC': 'HDFCBANK'}
    fetch_sym = alias_map.get(clean_s, clean_s)

    with _earliest_price_lock:
        if fetch_sym in _earliest_price_cache:
            return _earliest_price_cache[fetch_sym]

    # Check _db_prices_cache
    with _db_cache_lock:
        if fetch_sym in _db_prices_cache and _db_prices_cache[fetch_sym]:
            first_d_str = _db_prices_cache[fetch_sym][0][0]
            try:
                first_d = datetime.strptime(first_d_str[:10], "%Y-%m-%d").date()
                with _earliest_price_lock:
                    _earliest_price_cache[fetch_sym] = first_d
                return first_d
            except Exception:
                pass

    # Check MongoDB collection stock_closing_prices
    try:
        from db_store import load_stock_closing_prices_db
        doc = load_stock_closing_prices_db(symbol=fetch_sym, summary_only=True)
        if doc:
            s_date = doc.get("start_date") or doc.get("min_date")
            if s_date:
                first_d = datetime.strptime(str(s_date)[:10], "%Y-%m-%d").date()
                with _earliest_price_lock:
                    _earliest_price_cache[fetch_sym] = first_d
                return first_d
    except Exception as e:
        logger.debug(f"Could not load earliest price date for {fetch_sym}: {e}")

    return None


def get_stock_closing_prices_from_db(symbol, target_cutoff_str=None):
    """
    Fetches historical daily price series from database collection 'stock_closing_prices'.
    Uses an in-memory cache to make repeated lookups sub-millisecond.
    Returns list of (date_str, close_price) or None if stock or price not available.
    """
    clean_sym = symbol.strip().upper().replace('.NS', '').replace('.BO', '')
    alias_map = {'TATAMOTORS': 'TMPV', 'HDFC': 'HDFCBANK'}
    fetch_sym = alias_map.get(clean_sym, clean_sym)

    # 1. Check in-memory cache (verify cached range covers lookback + target_cutoff_str)
    with _db_cache_lock:
        if fetch_sym in _db_prices_cache:
            cached_range = _db_prices_range_cache.get(fetch_sym)
            if target_cutoff_str:
                try:
                    c_dt = datetime.strptime(target_cutoff_str[:10], "%Y-%m-%d").date()
                    lb_min = (c_dt - timedelta(days=400)).isoformat()
                except Exception:
                    lb_min = target_cutoff_str[:10]
                range_ok = (cached_range is None) or _is_range_covered(cached_range, lb_min, target_cutoff_str[:10])
            else:
                range_ok = (cached_range is None) or (cached_range == (None, None))
            if range_ok:
                series = _db_prices_cache[fetch_sym]
                if series and len(series) > 0:
                    if not target_cutoff_str:
                        return series
                    # Binary search for rightmost index where date <= target_cutoff_str
                    lo, hi = 0, len(series)
                    while lo < hi:
                        mid = (lo + hi) // 2
                        if series[mid][0] <= target_cutoff_str:
                            lo = mid + 1
                        else:
                            hi = mid
                    return series[:lo]

    # 2. Query database collection stock_closing_prices
    try:
        from db_store import load_stock_closing_prices_db
        from modules.stock_closing_prices.stock_closing_prices_provider import compute_stock_monthly_prices
        doc = load_stock_closing_prices_db(symbol=fetch_sym, max_date=target_cutoff_str)
        if doc:
            series_dict = {}
            # Priority 1: Exact daily closing prices from DB
            raw_prices = doc.get("prices") or []
            for p in raw_prices:
                d = str(p.get("d") or "")[:10]
                c = p.get("c")
                if d and c is not None and float(c) > 0:
                    series_dict[d] = round(float(c), 2)

            # Fallback to monthly prices only if daily prices were completely unavailable
            if not series_dict and doc.get("monthly_prices"):
                for item in doc.get("monthly_prices", []):
                    m = item.get("m")
                    fc = item.get("first_close") or item.get("avg_close")
                    if m and fc and float(fc) > 0:
                        series_dict[f"{m}-01"] = round(float(fc), 2)

            series = [(d, series_dict[d]) for d in sorted(series_dict.keys())]
            if series:
                with _db_cache_lock:
                    _db_prices_cache[fetch_sym] = series
                    _db_prices_range_cache[fetch_sym] = (None, target_cutoff_str[:10] if target_cutoff_str else None)

                try:
                    first_d = datetime.strptime(series[0][0][:10], "%Y-%m-%d").date()
                    with _earliest_price_lock:
                        _earliest_price_cache[fetch_sym] = first_d
                except Exception:
                    pass

                if not target_cutoff_str:
                    return series
                lo, hi = 0, len(series)
                while lo < hi:
                    mid = (lo + hi) // 2
                    if series[mid][0] <= target_cutoff_str:
                        lo = mid + 1
                    else:
                        hi = mid
                return series[:lo]
    except Exception as e:
        logger.warning(f"Error querying stock_closing_prices from DB for {fetch_sym}: {e}")

    return None


def clear_db_prices_cache():
    """Clears temporary in-memory prices cache to ensure zero server-side memory retention."""
    with _db_cache_lock:
        _db_prices_cache.clear()
        _db_prices_range_cache.clear()
    with _earliest_price_lock:
        _earliest_price_cache.clear()


def prewarm_stock_prices_cache(symbols=None, min_date=None, max_date=None):
    """
    Pre-warms the in-memory cache from database collection 'stock_closing_prices'.
    Pattern 2: Uses MongoDB server-side $filter projection to fetch only the requested
    date window of daily prices, delivering pin-point daily accuracy with zero timeouts.
    """
    try:
        from db_store import load_stock_closing_prices_db
        from modules.stock_closing_prices.stock_closing_prices_provider import compute_stock_monthly_prices
        req_min = str(min_date)[:10] if min_date else None
        req_max = str(max_date)[:10] if max_date else None
        target_syms = None
        if symbols:
            with _db_cache_lock:
                target_syms = [
                    s.strip().upper().replace('.NS', '').replace('.BO', '')
                    for s in symbols
                    if s and (
                        s.strip().upper().replace('.NS', '').replace('.BO', '') not in _db_prices_cache
                        or not _is_range_covered(
                            _db_prices_range_cache.get(s.strip().upper().replace('.NS', '').replace('.BO', '')),
                            req_min,
                            req_max
                        )
                    )
                ]
                # Preserve order while deduplicating
                target_syms = list(dict.fromkeys(target_syms))
                if not target_syms:
                    return len(_db_prices_cache)

        docs = load_stock_closing_prices_db(
            symbols=target_syms,
            summary_only=False,
            min_date=min_date,
            max_date=max_date
        )
        if not docs:
            return len(_db_prices_cache)

        with _db_cache_lock:
            for sym, doc in docs.items():
                if doc:
                    clean_s = sym.strip().upper().replace('.NS', '').replace('.BO', '')
                    series_dict = {}

                    # Pattern 2: Exact daily prices from server-side filtered window
                    for p in doc.get("prices", []):
                        d = str(p.get("d") or "")[:10]
                        c = p.get("c")
                        if d and c is not None and float(c) > 0:
                            if min_date and d < min_date:
                                continue
                            if max_date and d > max_date:
                                continue
                            series_dict[d] = round(float(c), 2)

                    # Fallback to monthly prices only if daily prices were completely empty
                    if not series_dict and doc.get("monthly_prices"):
                        for item in doc.get("monthly_prices", []):
                            m = item.get("m")
                            fc = item.get("first_close") or item.get("avg_close")
                            if m and fc and float(fc) > 0:
                                d_m = f"{m}-01"
                                if min_date and d_m < min_date[:7] + "-01":
                                    continue
                                if max_date and d_m > max_date[:7] + "-28":
                                    continue
                                series_dict[d_m] = round(float(fc), 2)

                    series = [(d, series_dict[d]) for d in sorted(series_dict.keys())]
                    if series:
                        prev_range = _db_prices_range_cache.get(clean_s)
                        if clean_s in _db_prices_cache and _db_prices_cache[clean_s]:
                            merged_dict = dict(_db_prices_cache[clean_s])
                            merged_dict.update(series_dict)
                            series = [(d, merged_dict[d]) for d in sorted(merged_dict.keys())]
                        _db_prices_cache[clean_s] = series
                        if prev_range == (None, None) or (req_min is None and req_max is None):
                            _db_prices_range_cache[clean_s] = (None, None)
                        elif prev_range is None:
                            _db_prices_range_cache[clean_s] = (req_min, req_max)
                        else:
                            p_min, p_max = prev_range
                            new_min = None if (p_min is None or req_min is None) else min(p_min, req_min)
                            new_max = None if (p_max is None or req_max is None) else max(p_max, req_max)
                            _db_prices_range_cache[clean_s] = (new_min, new_max)
                        try:
                            # Prefer actual earliest stored date in doc if available
                            s_date = doc.get("start_date") or doc.get("min_date")
                            first_d_str = str(s_date)[:10] if s_date else series[0][0][:10]
                            first_d = datetime.strptime(first_d_str, "%Y-%m-%d").date()
                            with _earliest_price_lock:
                                _earliest_price_cache[clean_s] = first_d
                        except Exception:
                            pass

        return len(_db_prices_cache)
    except Exception as e:
        logger.warning(f"Error pre-warming stock_closing_prices cache: {e}")
        return len(_db_prices_cache)


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

def fetch_stock_daily_series(symbol, target_cutoff_date=None, force_refresh=False, db_only=False):
    """
    Fetches daily price series for an NSE stock.
    Priority 1: Database collection 'stock_closing_prices' with in-memory fast caching.
    Priority 2: If stock or price not available in DB, fall back to Live Provider
                (Yahoo Finance / Market Fetcher) with disk caching for high performance.
    Returns list of (date_obj, close_price) sorted ascending.
    """
    clean_sym = symbol.strip().upper().replace('.NS', '').replace('.BO', '')
    
    # Common ticker alias mappings on NSE
    alias_map = {
        'TATAMOTORS': 'TMPV',
        'HDFC': 'HDFCBANK'
    }
    fetch_sym = alias_map.get(clean_sym, clean_sym)

    target_cutoff_str = None
    cutoff_date = None
    if target_cutoff_date:
        if isinstance(target_cutoff_date, str):
            target_cutoff_str = target_cutoff_date[:10]
            try:
                cutoff_date = datetime.strptime(target_cutoff_str, "%Y-%m-%d").date()
            except Exception:
                cutoff_date = None
        elif isinstance(target_cutoff_date, datetime):
            cutoff_date = target_cutoff_date.date()
            target_cutoff_str = cutoff_date.isoformat()
        elif isinstance(target_cutoff_date, date):
            cutoff_date = target_cutoff_date
            target_cutoff_str = cutoff_date.isoformat()

    data_points = None

    # =========================================================================
    # 1. PRIMARY: FETCH FROM DATABASE (COLLECTION: stock_closing_prices)
    # =========================================================================
    if not force_refresh:
        db_series = get_stock_closing_prices_from_db(fetch_sym, target_cutoff_str)
        if db_series and len(db_series) > 0:
            data_points = db_series

    # If DB-only execution is explicitly requested, skip live external API fallbacks
    if db_only and not data_points:
        return []

    # =========================================================================
    # 2. FALLBACK: IF STOCK OR PRICE NOT AVAILABLE IN DB, FETCH LIVE PROVIDER
    # =========================================================================
    if not db_only and data_points is None:
        cache_key = f"{fetch_sym}_daily"
        cache = load_price_cache()

        today_str = date.today().isoformat()
        with _cache_lock:
            cached = cache.get(cache_key)

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
                    r = session.get(url, headers=headers, timeout=2.0)
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
                            with _db_cache_lock:
                                _db_prices_cache[fetch_sym] = series
                                _db_prices_range_cache[fetch_sym] = (series[0][0][:10], series[-1][0][:10])
                            break
                    elif r.status_code in (404, 400):
                        break
                except Exception as e:
                    logger.warning(f"Error fetching live provider series for {fetch_sym} from {host}: {e}")

        # Fallback to existing cached series if network call failed
        if not data_points:
            if cached and "series" in cached and len(cached["series"]) > 0:
                data_points = cached["series"]
            else:
                # Fallback to market_fetcher live price
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

def calculate_stock_momentum_metrics(symbol, target_date, in_trading_hours=False, trading_days_per_month=30, db_only=False):
    """
    Calculates 1M, 2M, 5M, 9M price returns and 1M, 3M volatilities for a stock
    at target_date according to the user's trading hours rules:
    - If in trading hours, use previous day's close (T-1 close).
    - Else use today's / target_date's close.
    Gracefully computes metrics even if history is shorter than 9 months.
    trading_days_per_month: 21 or 30 days (default 30).
    """
    series = fetch_stock_daily_series(symbol, target_cutoff_date=target_date, db_only=db_only)
    if not series:
        return None

    # Apply trading hours price rule
    if in_trading_hours and len(series) >= 2:
        eval_series = series[:-1]
    else:
        eval_series = series

    if not eval_series or len(eval_series) < 2:
        return None

    # Ensure all dates are datetime.date objects
    normalized_series = []
    for d, p in eval_series:
        if isinstance(d, str):
            try:
                d = datetime.strptime(d[:10], "%Y-%m-%d").date()
            except Exception:
                continue
        elif isinstance(d, datetime):
            d = d.date()
        normalized_series.append((d, float(p)))

    if not normalized_series or len(normalized_series) < 2:
        return None

    eval_series = normalized_series
    dates = [d for d, _ in eval_series]
    prices = [p for _, p in eval_series]
    n = len(prices)
    curr_date = dates[-1]
    curr_price = prices[-1]

    # Trading days per month (21 or 30 days)
    td = 21 if int(trading_days_per_month or 30) == 21 else 30

    # Determine whether the series consists of monthly average bars or daily bars
    span_days = (dates[-1] - dates[0]).days if len(dates) >= 2 else 0
    avg_step = (span_days / float(len(dates) - 1)) if len(dates) >= 2 else 1.0
    is_monthly = (avg_step >= 20.0)

    import bisect
    import calendar

    def _get_lookback_index(months_back, td_days):
        if is_monthly:
            # On pure monthly series, 1 month = 1 bar back
            return max(0, n - (months_back + 1))
        # On daily or mixed series, compute target calendar date
        y = curr_date.year
        m = curr_date.month - months_back
        while m <= 0:
            y -= 1
            m += 12
        max_d = calendar.monthrange(y, m)[1]
        target_d = date(y, m, min(curr_date.day, max_d))
        pos = bisect.bisect_right(dates, target_d) - 1
        if pos >= 0:
            return pos
        return max(0, n - (td_days + 1))

    idx_1m = _get_lookback_index(1, td)
    idx_2m = _get_lookback_index(2, 2 * td)
    idx_5m = _get_lookback_index(5, 5 * td)
    idx_9m = _get_lookback_index(9, 9 * td)

    p_1m = prices[idx_1m]
    p_2m = prices[idx_2m]
    p_5m = prices[idx_5m]
    p_9m = prices[idx_9m]

    r_1m = ((curr_price - p_1m) / p_1m) * 100.0 if p_1m > 0 else 0.0
    r_2m = ((curr_price - p_2m) / p_2m) * 100.0 if p_2m > 0 else 0.0
    r_5m = ((curr_price - p_5m) / p_5m) * 100.0 if p_5m > 0 else 0.0
    r_9m = ((curr_price - p_9m) / p_9m) * 100.0 if p_9m > 0 else 0.0

    if is_monthly:
        # On monthly bars, calculate volatility using recent monthly returns annualized by sqrt(12)
        m_lookback_1 = min(3, n - 1)
        if m_lookback_1 >= 2:
            m_rets_1 = [(prices[-i] - prices[-i-1]) / prices[-i-1] for i in range(1, m_lookback_1 + 1) if prices[-i-1] > 0]
            mean_1 = sum(m_rets_1) / len(m_rets_1) if m_rets_1 else 0.0
            var_1 = sum((x - mean_1)**2 for x in m_rets_1) / max(1, len(m_rets_1) - 1) if len(m_rets_1) > 1 else 0.0
            vol_1m = math.sqrt(max(0.0, var_1)) * math.sqrt(12) * 100.0
        else:
            vol_1m = 15.0

        m_lookback_3 = min(6, n - 1)
        if m_lookback_3 >= 2:
            m_rets_3 = [(prices[-i] - prices[-i-1]) / prices[-i-1] for i in range(1, m_lookback_3 + 1) if prices[-i-1] > 0]
            mean_3 = sum(m_rets_3) / len(m_rets_3) if m_rets_3 else 0.0
            var_3 = sum((x - mean_3)**2 for x in m_rets_3) / max(1, len(m_rets_3) - 1) if len(m_rets_3) > 1 else 0.0
            vol_3m = math.sqrt(max(0.0, var_3)) * math.sqrt(12) * 100.0
        else:
            vol_3m = 18.0
    else:
        # 1M Volatility (up to td trading days annualized standard deviation)
        days_1m = min(td, n - 1)
        if days_1m > 1:
            daily_rets_1m = [(prices[-i] - prices[-i-1]) / prices[-i-1] for i in range(1, days_1m + 1) if prices[-i-1] > 0]
            mean_1m = sum(daily_rets_1m) / len(daily_rets_1m) if daily_rets_1m else 0.0
            var_1m = sum((x - mean_1m)**2 for x in daily_rets_1m) / max(1, len(daily_rets_1m) - 1) if len(daily_rets_1m) > 1 else 0.0
            vol_1m = math.sqrt(max(0.0, var_1m)) * math.sqrt(252) * 100.0
        else:
            vol_1m = 15.0  # sensible neutral default volatility

        # 3M Volatility (up to 3*td trading days annualized standard deviation)
        days_3m = min(3 * td, n - 1)
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


_FORMULA_WEIGHTS_CACHE = {}
_WEIGHTS_REGEX = re.compile(r'(\d+)\s*%\s*\*\s*(\d+)M', re.IGNORECASE)

def _get_formula_weights(formula_str):
    if not formula_str:
        return (0.50, 0.30, 0.10, 0.10)
    cached = _FORMULA_WEIGHTS_CACHE.get(formula_str)
    if cached is not None:
        return cached
    w1, w2, w3, w4 = 0.50, 0.30, 0.10, 0.10
    try:
        m = _WEIGHTS_REGEX.findall(formula_str)
        if m:
            weights = {f"{month}M": int(pct) / 100.0 for pct, month in m}
            if "1M" in weights: w1 = weights["1M"]
            if "2M" in weights: w2 = weights["2M"]
            if "5M" in weights: w3 = weights["5M"]
            if "9M" in weights: w4 = weights["9M"]
    except Exception:
        pass
    res = (w1, w2, w3, w4)
    _FORMULA_WEIGHTS_CACHE[formula_str] = res
    return res

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

    w1, w2, w3, w4 = _get_formula_weights(formula_str)
    numerator = (w1 * r_1m) + (w2 * r_2m) + (w3 * r_5m) + (w4 * r_9m)
    denominator = max(vol_1m + vol_3m, 0.01)

    return round(numerator / denominator, 4)


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


def filter_universe_by_date_with_meta(stock_items, target_date, check_price_available=True):
    """
    Filters universe constituent stocks based on effective date:
    1) If stock has date_added (e.g. manual index), entered date must be <= target_date.
    2) If check_price_available is True, earliest price available date must be <= target_date.
    If any stock entered date or price available date is after target_date,
    it is excluded on target_date and will be calculated from its effective date onwards.
    Returns: (eligible_symbols_list, meta_dict)
    """
    eligible = []
    if isinstance(target_date, str):
        target_date = datetime.strptime(target_date[:10], "%Y-%m-%d").date()
    elif isinstance(target_date, datetime):
        target_date = target_date.date()

    all_effective_dates = []
    all_dates_added = []
    stock_effective_map = {}

    for item in stock_items:
        sym = item.get("symbol") if isinstance(item, dict) else str(item)
        clean_s = sym.strip().upper().replace('.NS', '').replace('.BO', '')
        date_added_raw = item.get("date_added") if isinstance(item, dict) else None

        d_added = parse_stock_date_added(date_added_raw) if date_added_raw else None
        if d_added:
            all_dates_added.append(d_added)

        d_price = get_stock_earliest_price_date(clean_s) if check_price_available else None

        # Effective date is the later of date_added and earliest price date
        dates_to_compare = [d for d in [d_added, d_price] if d is not None]
        if dates_to_compare:
            eff_date = max(dates_to_compare)
            all_effective_dates.append(eff_date)
            stock_effective_map[clean_s] = eff_date
            if eff_date <= target_date:
                eligible.append(sym)
        else:
            eligible.append(sym)

    all_effective_dates.sort()
    all_dates_added.sort()

    meta = {
        "total_constituents": len(stock_items),
        "eligible_count": len(eligible),
        "earliest_effective_date": all_effective_dates[0] if all_effective_dates else None,
        "latest_effective_date": all_effective_dates[-1] if all_effective_dates else None,
        "earliest_date_added": all_dates_added[0] if all_dates_added else None,
        "latest_date_added": all_dates_added[-1] if all_dates_added else None,
        "stock_effective_map": stock_effective_map,
    }

    return list(dict.fromkeys(eligible)), meta


def filter_universe_by_date(stock_items, target_date, check_price_available=True):
    """Legacy compatibility helper."""
    eligible, _ = filter_universe_by_date_with_meta(stock_items, target_date, check_price_available=check_price_available)
    return eligible


def rank_and_evaluate_universe(stock_items, target_date, formula_str, no_of_stocks, exit_regime_ranking, return_meta=False, save_cache=True, trading_days_per_month=30, check_price_available=True):
    """
    Calculates formula scores for all eligible stocks, ranks them descending,
    assigns color tiers (green for top N, dark yellow up to exit regime),
    and limits the output to exit_regime_ranking + 15 stocks.
    Returns: (displayed_stocks, eligible_count, [meta_dict if return_meta=True])
    """
    eligible_symbols, date_info = filter_universe_by_date_with_meta(stock_items, target_date, check_price_available=check_price_available)
    if not eligible_symbols:
        if return_meta:
            return [], 0, date_info
        return [], 0

    in_trading_hours = is_in_trading_hours_now() if (target_date == date.today()) else False

    calculated_stocks = []
    failed_symbols = []

    def _eval(sym):
        try:
            metrics = calculate_stock_momentum_metrics(
                sym, target_date, in_trading_hours, trading_days_per_month=trading_days_per_month
            )
            if metrics:
                score = evaluate_formula_score(metrics, formula_str)
                metrics["total_score"] = score
                return (sym, metrics)
        except Exception as e:
            logger.warning(f"Error evaluating {sym}: {e}")
        return (sym, None)

    # Pre-warm DB stock closing prices into memory cache for requested target_date window
    if target_date:
        if isinstance(target_date, str):
            td_obj = datetime.strptime(target_date[:10], "%Y-%m-%d").date()
        elif isinstance(target_date, datetime):
            td_obj = target_date.date()
        else:
            td_obj = target_date
        win_min = (td_obj - timedelta(days=450)).isoformat()
        win_max = td_obj.isoformat()
        prewarm_stock_prices_cache(eligible_symbols, min_date=win_min, max_date=win_max)
    else:
        prewarm_stock_prices_cache(eligible_symbols)

    # Fetch concurrently with safe worker pool (cap to 6 to stay lightweight on memory)
    worker_count = min(6, max(2, len(eligible_symbols)))
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

    # If unused amount > 1%, divide it and invest in top 3 stocks
    one_percent_threshold = round(0.01 * amount_to_invest, 2)
    if wallet_balance > one_percent_threshold:
        valid_picks = [s for s in sorted(top_picks, key=lambda x: x.get("rank", 999999)) if s.get("price", 0) > 0]
        top_3 = valid_picks[:min(3, len(valid_picks))]

        if top_3:
            # Pass 1: Divide unused amount equally among top 3
            portion = wallet_balance / float(len(top_3))
            for s in top_3:
                price = float(s["price"])
                cost_per_share = price * (1.0 + TRANSACTION_FEE_RATE)
                extra_qty = math.floor(portion / cost_per_share) if cost_per_share > 0 else 0
                if extra_qty > 0 and (extra_qty * cost_per_share) <= wallet_balance:
                    extra_cost = round(extra_qty * price, 2)
                    extra_fee = round(extra_cost * TRANSACTION_FEE_RATE, 2)
                    wallet_balance = round(wallet_balance - extra_cost - extra_fee, 2)
                    total_invested += extra_cost
                    total_fees += extra_fee
                    s["quantity"] = s.get("quantity", 0) + extra_qty
                    s["allocated_amount"] = round(s["quantity"] * price, 2)
                    s["fee"] = round(s.get("fee", 0.0) + extra_fee, 2)
                    s["action"] = "BUY"
                    s["is_held"] = True
                    if s["symbol"] not in added_symbols:
                        added_symbols.append(s["symbol"])

                    holding_item = next((h for h in holdings if h["symbol"] == s["symbol"]), None)
                    if holding_item:
                        holding_item["quantity"] = s["quantity"]
                        holding_item["invested"] = round(s["quantity"] * price, 2)
                        holding_item["current_value"] = round(s["quantity"] * price, 2)

            # Pass 2: If still > 1% (e.g. integer remainder or high price per share), invest in top 3 in rank priority
            while wallet_balance > one_percent_threshold:
                bought_any = False
                for s in top_3:
                    if wallet_balance <= one_percent_threshold:
                        break
                    price = float(s["price"])
                    cost_per_share = price * (1.0 + TRANSACTION_FEE_RATE)
                    if wallet_balance >= cost_per_share:
                        extra_fee = round(price * TRANSACTION_FEE_RATE, 2)
                        wallet_balance = round(wallet_balance - price - extra_fee, 2)
                        total_invested += price
                        total_fees += extra_fee
                        s["quantity"] = s.get("quantity", 0) + 1
                        s["allocated_amount"] = round(s["quantity"] * price, 2)
                        s["fee"] = round(s.get("fee", 0.0) + extra_fee, 2)
                        s["action"] = "BUY"
                        s["is_held"] = True
                        if s["symbol"] not in added_symbols:
                            added_symbols.append(s["symbol"])

                        holding_item = next((h for h in holdings if h["symbol"] == s["symbol"]), None)
                        if holding_item:
                            holding_item["quantity"] = s["quantity"]
                            holding_item["invested"] = round(s["quantity"] * price, 2)
                            holding_item["current_value"] = round(s["quantity"] * price, 2)
                        bought_any = True
                if not bought_any:
                    break

    # Recalculate portfolio weights
    for s in top_picks:
        s["weight_percent"] = round((s.get("allocated_amount", 0.0) / amount_to_invest) * 100.0, 2)
    for h in holdings:
        h["weight_percent"] = round((h["invested"] / amount_to_invest) * 100.0, 2)

    total_portfolio_value = round(total_invested + wallet_balance, 2)
    total_pnl = round(total_portfolio_value - amount_to_invest, 2)
    total_pnl_percent = round((total_pnl / amount_to_invest) * 100.0, 2) if amount_to_invest > 0 else 0.0

    # Build detailed transactions list
    transactions = []
    for h in holdings:
        trade_amt = round(h["quantity"] * h["buy_price"], 2)
        trade_fee = round(trade_amt * TRANSACTION_FEE_RATE, 2)
        transactions.append({
            "symbol": h["symbol"],
            "action": "BUY",
            "action_label": f"BUY ({h['quantity']})",
            "quantity": h["quantity"],
            "price": h["buy_price"],
            "amount": trade_amt,
            "fee": trade_fee,
            "trade_type": "INITIAL_BUY",
            "notes": "Initial Portfolio Allocation"
        })

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
        "transactions": transactions,
        "changes": {
            "added": added_symbols,
            "removed": [],
            "retained": []
        }
    }


def execute_rebalance_run(ranked_stocks, previous_holdings, previous_wallet, stepup_amount, no_of_stocks, exit_regime_ranking, target_date=None, all_universe_stocks=None, total_capital=None, trim_existing=False):
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
       - If trim_existing=True: Trim overweight retained stocks (sell excess shares to bring to target allocation).
       - If trim_existing=False: Do not touch / decrease existing retained stock sizes.
       - Buy additional shares for underweight retained stocks to bring to target allocation (when need to increase during recalculate can do).
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
                    series = fetch_stock_daily_series(sym, target_cutoff_date=target_date, db_only=True)
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

    # Step 3: Compute Cumulative Investing Capital & Target Allocation per Stock
    if total_capital is None:
        total_capital = float(previous_wallet) + sum(float(h.get("invested", 0.0)) for h in previous_holdings) + float(stepup_amount or 0.0)
    total_cap = round(float(total_capital), 2)
    target_invest_per_stock = total_cap / float(total_target_stocks_count)

    # Market value of held retained stocks + wallet cash (which includes stepup + exit proceeds)
    retained_equity = 0.0
    for sym in retained_symbols:
        h = prev_holdings_map[sym]
        stk = rank_map.get(sym) or all_stocks_map.get(sym)
        price = float(stk["price"]) if (stk and stk.get("price")) else float(h.get("current_price", h.get("buy_price", 0.0)))
        retained_equity += float(h["quantity"]) * price

    total_equity = retained_equity + wallet
    target_per_stock = target_invest_per_stock

    # Step 4: Rebalance trades
    holdings_dict = {}
    added_symbols = []

    # Prepare holding states
    for sym in retained_symbols:
        h = prev_holdings_map[sym]
        stk = rank_map.get(sym) or all_stocks_map.get(sym)
        price = float(stk["price"]) if (stk and stk.get("price")) else float(h.get("current_price", h.get("buy_price", 0.0)))
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

    # Phase 4A: Trim Overweight Retained Stocks FIRST to free up liquidity (only if trim_existing is True)
    if trim_existing:
        for sym, item in holdings_dict.items():
            price = item["current_price"]
            q_old = item["quantity"]
            cost_per_share = price * (1.0 + TRANSACTION_FEE_RATE)
            q_target = math.floor(target_invest_per_stock / cost_per_share) if cost_per_share > 0 else q_old

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

                stk = rank_map.get(sym) or all_stocks_map.get(sym)
                if stk:
                    stk["action"] = "SELL"
                    stk["action_label"] = f"TRIM (-{qty_to_sell})"
                    stk["quantity"] = q_target
                    stk["is_held"] = (q_target > 0)
                    stk["allocated_amount"] = item["invested"]
                    stk["fee"] = fee
    else:
        # If trim_existing is False: do not touch / decrease existing stock sizes!
        for sym, item in holdings_dict.items():
            if not item.get("is_new"):
                q_old = item["quantity"]
                stk = rank_map.get(sym) or all_stocks_map.get(sym)
                if stk:
                    stk["action"] = "HOLD"
                    stk["action_label"] = f"HOLD ({q_old})"
                    stk["quantity"] = q_old
                    stk["is_held"] = (q_old > 0)
                    stk["allocated_amount"] = round(item["invested"], 2)
                    stk["fee"] = 0.0

    # Phase 4B: Buy Underweight Retained Stocks and Newcomers based on Target Allocation of Investing Amount
    stocks_needing_capital = []
    for sym in all_target_symbols:
        item = holdings_dict[sym]
        curr_inv = item["invested"]
        needed = max(0.0, target_invest_per_stock - curr_inv)
        if needed > 0.0:
            stocks_needing_capital.append((sym, needed))

    for sym, needed_cash in stocks_needing_capital:
        item = holdings_dict[sym]
        price = item["current_price"]
        q_current = item["quantity"]
        share_cost_with_fee = price * (1.0 + TRANSACTION_FEE_RATE)

        qty_needed = math.floor(needed_cash / share_cost_with_fee) if share_cost_with_fee > 0 else 0
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

            stk = rank_map.get(sym) or all_stocks_map.get(sym)
            if stk:
                if item["is_new"]:
                    stk["action"] = "BUY"
                    stk["action_label"] = f"BUY ({new_qty})"
                    if sym not in added_symbols:
                        added_symbols.append(sym)
                else:
                    stk["action"] = "BUY"
                    stk["action_label"] = f"BUY (+{qty_to_buy})"
                stk["quantity"] = new_qty
                stk["is_held"] = True
                stk["allocated_amount"] = new_invested
                stk["fee"] = fee
        else:
            stk = rank_map.get(sym) or all_stocks_map.get(sym)
            if stk and stk.get("action") not in ("BUY", "SELL"):
                if item["is_new"]:
                    stk["action"] = "SKIPPED"
                    stk["action_label"] = "SKIPPED (0)"
                    stk["quantity"] = 0
                    stk["is_held"] = False
                    stk["allocated_amount"] = 0.0
                else:
                    stk["action"] = "HOLD"
                    stk["action_label"] = f"HOLD ({q_current})"
                    stk["quantity"] = q_current
                    stk["is_held"] = (q_current > 0)
                    stk["allocated_amount"] = round(item["invested"], 2)

    # For any target stocks that were already at or above target allocation
    for sym in all_target_symbols:
        item = holdings_dict[sym]
        stk = rank_map.get(sym) or all_stocks_map.get(sym)
        if stk and stk.get("action") not in ("BUY", "SELL"):
            stk["action"] = "HOLD"
            stk["action_label"] = f"HOLD ({item['quantity']})"
            stk["quantity"] = item["quantity"]
            stk["is_held"] = (item["quantity"] > 0)
            stk["allocated_amount"] = round(item["invested"], 2)

    # Phase 4C: If unused wallet cash > 1%, divide and invest in top 3 stocks (increasing existing stocks)
    current_portfolio_equity = sum(item["quantity"] * item["current_price"] for item in holdings_dict.values()) + wallet
    rebal_one_pct_threshold = 0.01 * (total_cap or current_portfolio_equity)

    if wallet > rebal_one_pct_threshold:
        def _get_sym_rank(s_sym):
            stk_obj = rank_map.get(s_sym) or all_stocks_map.get(s_sym)
            if stk_obj and stk_obj.get("rank") is not None:
                return stk_obj["rank"]
            return 999999

        valid_targets = [sym for sym in all_target_symbols if sym in holdings_dict and holdings_dict[sym]["current_price"] > 0]
        sorted_targets = sorted(valid_targets, key=_get_sym_rank)
        top_3_symbols = sorted_targets[:min(3, len(sorted_targets))]

        if top_3_symbols:
            # Pass 1: Divide unused cash equally among top 3
            portion = wallet / float(len(top_3_symbols))
            for sym in top_3_symbols:
                item = holdings_dict[sym]
                price = float(item["current_price"])
                cost_per_share = price * (1.0 + TRANSACTION_FEE_RATE)
                extra_qty = math.floor(portion / cost_per_share) if cost_per_share > 0 else 0
                if extra_qty > 0 and (extra_qty * cost_per_share) <= wallet:
                    cost = round(extra_qty * price, 2)
                    fee = round(cost * TRANSACTION_FEE_RATE, 2)
                    wallet = round(wallet - cost - fee, 2)
                    total_fees += fee

                    new_qty = item["quantity"] + extra_qty
                    new_invested = round(item["invested"] + cost, 2)
                    new_avg_buy_price = round(new_invested / new_qty, 2) if new_qty > 0 else price

                    item["quantity"] = new_qty
                    item["invested"] = new_invested
                    item["buy_price"] = new_avg_buy_price

                    stk = rank_map.get(sym) or all_stocks_map.get(sym)
                    if stk:
                        if item["is_new"]:
                            stk["action"] = "BUY"
                            stk["action_label"] = f"BUY ({new_qty})"
                            if sym not in added_symbols:
                                added_symbols.append(sym)
                        else:
                            prev_q = int(prev_holdings_map.get(sym, {}).get("quantity", 0))
                            qty_diff = new_qty - prev_q
                            stk["action"] = "BUY" if qty_diff > 0 else "HOLD"
                            stk["action_label"] = f"BUY (+{qty_diff})" if qty_diff > 0 else f"HOLD ({new_qty})"
                        stk["quantity"] = new_qty
                        stk["is_held"] = True
                        stk["allocated_amount"] = new_invested
                        stk["fee"] = round(stk.get("fee", 0.0) + fee, 2)

            # Pass 2: If still > 1%, invest in top 3 in rank priority until <= 1% or cannot afford
            while wallet > rebal_one_pct_threshold:
                bought_any = False
                for sym in top_3_symbols:
                    if wallet <= rebal_one_pct_threshold:
                        break
                    item = holdings_dict[sym]
                    price = float(item["current_price"])
                    cost_per_share = price * (1.0 + TRANSACTION_FEE_RATE)
                    if wallet >= cost_per_share:
                        fee = round(price * TRANSACTION_FEE_RATE, 2)
                        wallet = round(wallet - price - fee, 2)
                        total_fees += fee

                        new_qty = item["quantity"] + 1
                        new_invested = round(item["invested"] + price, 2)
                        new_avg_buy_price = round(new_invested / new_qty, 2) if new_qty > 0 else price

                        item["quantity"] = new_qty
                        item["invested"] = new_invested
                        item["buy_price"] = new_avg_buy_price

                        stk = rank_map.get(sym) or all_stocks_map.get(sym)
                        if stk:
                            if item["is_new"]:
                                stk["action"] = "BUY"
                                stk["action_label"] = f"BUY ({new_qty})"
                                if sym not in added_symbols:
                                    added_symbols.append(sym)
                            else:
                                prev_q = int(prev_holdings_map.get(sym, {}).get("quantity", 0))
                                qty_diff = new_qty - prev_q
                                stk["action"] = "BUY" if qty_diff > 0 else "HOLD"
                                stk["action_label"] = f"BUY (+{qty_diff})" if qty_diff > 0 else f"HOLD ({new_qty})"
                            stk["quantity"] = new_qty
                            stk["is_held"] = True
                            stk["allocated_amount"] = new_invested
                            stk["fee"] = round(stk.get("fee", 0.0) + fee, 2)
                        bought_any = True
                if not bought_any:
                    break

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

    # Stock allocation % calculated for investing amount only
    for h in final_holdings:
        h["weight_percent"] = round((h["invested"] / max(total_cap, 1.0)) * 100.0, 2)

    for sym in all_target_symbols:
        stk = rank_map.get(sym) or all_stocks_map.get(sym)
        item = holdings_dict.get(sym)
        if stk and item:
            stk["allocated_amount"] = round(item["invested"], 2)
            stk["weight_percent"] = round((item["invested"] / max(total_cap, 1.0)) * 100.0, 2)

    # Build detailed transactions list for rebalance
    transactions = []
    # 1. Exited stocks (SELL)
    for ex in exited_stocks:
        transactions.append({
            "symbol": ex["symbol"],
            "action": "SELL",
            "action_label": "SELL (Exit)",
            "quantity": ex["quantity"],
            "price": ex["exit_price"],
            "amount": ex["exit_value"],
            "fee": ex["fee"],
            "trade_type": "EXIT_SELL",
            "pnl": ex.get("pnl", 0.0),
            "pnl_percent": ex.get("pnl_percent", 0.0),
            "notes": f"Exit (Rank > {exit_regime_ranking})"
        })

    # 2. Holdings trades (Trims and Buys)
    for sym in all_target_symbols:
        item = holdings_dict.get(sym)
        if not item:
            continue
        final_q = item["quantity"]
        prev_q = int(prev_holdings_map.get(sym, {}).get("quantity", 0))
        price = item["current_price"]

        if final_q < prev_q:
            if not trim_existing:
                # Retained stocks must never generate TRIM_SELL when trim_existing is False
                continue
            # Overweight trim (SELL)
            trim_qty = prev_q - final_q
            sell_amt = round(trim_qty * price, 2)
            fee = round(sell_amt * TRANSACTION_FEE_RATE, 2)
            prev_item = prev_holdings_map.get(sym, {})
            avg_price = float(prev_item.get("average_price") or prev_item.get("buy_price") or price)
            trim_invested = round(trim_qty * avg_price, 2)
            trim_pnl = round(sell_amt - trim_invested, 2)
            trim_pnl_pct = round(((price - avg_price) / avg_price) * 100.0, 2) if avg_price > 0 else 0.0
            transactions.append({
                "symbol": sym,
                "action": "SELL",
                "action_label": f"TRIM (-{trim_qty})",
                "quantity": trim_qty,
                "price": price,
                "amount": sell_amt,
                "fee": fee,
                "trade_type": "TRIM_SELL",
                "pnl": trim_pnl,
                "pnl_percent": trim_pnl_pct,
                "notes": f"Trim Overweight (-{trim_qty} shares to target)"
            })
        elif final_q > prev_q:
            # Newcomer or underweight buy (BUY)
            buy_qty = final_q - prev_q
            buy_amt = round(buy_qty * price, 2)
            fee = round(buy_amt * TRANSACTION_FEE_RATE, 2)
            is_new = item.get("is_new", False) or (prev_q == 0)
            transactions.append({
                "symbol": sym,
                "action": "BUY",
                "action_label": f"BUY ({final_q})" if is_new else f"BUY (+{buy_qty})",
                "quantity": buy_qty,
                "price": price,
                "amount": buy_amt,
                "fee": fee,
                "trade_type": "NEW_BUY" if is_new else "ADD_BUY",
                "notes": "New Entry" if is_new else f"Rebalance Addition (+{buy_qty} shares)"
            })

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
        "transactions": transactions,
        "exited_stocks": exited_stocks,
        "changes": {
            "added": added_symbols,
            "removed": removed_symbols,
            "retained": retained_symbols,
            "exited_stocks": exited_stocks
        }
    }

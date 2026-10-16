import os
import re
import time
import threading
import requests

try:
    from curl_cffi import requests as stock_http_requests
    _STOCK_CURL_CFFI = True
except ImportError:
    import requests as stock_http_requests
    _STOCK_CURL_CFFI = False

# Popular Indian stock dictionary for fuzzy matching & typo auto-correction
POPULAR_INDIAN_STOCKS = {
    "POLYMED": "Poly Medicure Ltd",
    "RELIANCE": "Reliance Industries Ltd",
    "TCS": "Tata Consultancy Services Ltd",
    "INFY": "Infosys Ltd",
    "HDFCBANK": "HDFC Bank Ltd",
    "ICICIBANK": "ICICI Bank Ltd",
    "ROLEXRINGS": "Rolex Rings Ltd",
    "KRISHNADEF": "Krishna Defence Ltd",
    "GOLDIAM": "Goldiam International Ltd",
    "TEXRAIL": "Texmaco Rail & Engineering Ltd",
    "TATAMOTORS": "Tata Motors Ltd",
    "TATASTEEL": "Tata Steel Ltd",
    "SBIN": "State Bank of India",
    "BHARTIARTL": "Bharti Airtel Ltd",
    "ITC": "ITC Ltd",
    "LTIM": "LTIMindtree Ltd",
    "WIPRO": "Wipro Ltd",
    "AXISBANK": "Axis Bank Ltd",
    "KOTAKBANK": "Kotak Mahindra Bank Ltd",
    "LT": "Larsen & Toubro Ltd",
    "BAJFINANCE": "Bajaj Finance Ltd",
    "MARUTI": "Maruti Suzuki India Ltd",
    "SUNPHARMA": "Sun Pharmaceutical Industries Ltd",
    "TITAN": "Titan Company Ltd",
    "ASIANPAINT": "Asian Paints Ltd",
    "ULTRACEMCO": "UltraTech Cement Ltd",
    "NTPC": "NTPC Ltd",
    "POWERGRID": "Power Grid Corporation of India Ltd",
    "ONGC": "Oil & Natural Gas Corporation Ltd",
    "COALINDIA": "Coal India Ltd",
    "HAL": "Hindustan Aeronautics Ltd",
    "BEL": "Bharat Electronics Ltd",
    "TATAELXSI": "Tata Elxsi Ltd",
    "DIXON": "Dixon Technologies India Ltd",
    "IRFC": "Indian Railway Finance Corporation Ltd",
    "RVNL": "Rail Vikas Nigam Ltd",
    "CDSL": "Central Depository Services (India) Ltd",
    "BSE": "BSE Ltd",
    "SUZLON": "Suzlon Energy Ltd",
    "ZOMATO": "Zomato Ltd",
    "JIOFIN": "Jio Financial Services Ltd",
    "TATACHEM": "Tata Chemicals Ltd",
    "TATAPOWER": "Tata Power Company Ltd",
    "POLYCAB": "Polycab India Ltd"
}

POPULAR_MARKET_INDEXES = [
    {"symbol": "^NSEI", "name": "NIFTY 50 Index", "exchange": "INDEX", "aliases": ["NIFTY", "NIFTY50", "NIFTY 50"]},
    {"symbol": "^NSEBANK", "name": "NIFTY Bank Index", "exchange": "INDEX", "aliases": ["BANKNIFTY", "NIFTYBANK", "NIFTY BANK", "BANK NIFTY"]},
    {"symbol": "^CNXIT", "name": "NIFTY IT Index", "exchange": "INDEX", "aliases": ["NIFTYIT", "NIFTY IT"]},
    {"symbol": "^BSESN", "name": "S&P BSE SENSEX Index", "exchange": "INDEX", "aliases": ["SENSEX", "BSESN", "BSE SENSEX"]},
    {"symbol": "^CRSMID", "name": "NIFTY Midcap 100 Index", "exchange": "INDEX", "aliases": ["MIDCAP", "NIFTY MIDCAP"]},
    {"symbol": "GIFTNIFTY", "name": "GIFT Nifty Index", "exchange": "INDEX", "aliases": ["GIFTNIFTY", "GIFT NIFTY", "GIFT NIFTY INDEX", "NSEIX:NIFTY1!"]},
    {"symbol": "GOLDBEES.NS", "name": "Nippon India ETF Gold BeES (₹)", "exchange": "COMMODITY", "aliases": ["GOLDBEES", "GOLD BEES", "GOLD ETF"]},
    {"symbol": "GC=F", "name": "Gold Commodity CFD (TVC / USD)", "exchange": "COMMODITY", "aliases": ["GOLD", "GOLD FUTURES", "GOLD USD", "TVC:GOLD", "GOLD CFD", "GOLD(COMMODITY CFD TVC)"]},
    {"symbol": "SILVERBEES.NS", "name": "Nippon India ETF Silver BeES (₹)", "exchange": "COMMODITY", "aliases": ["SILVERBEES", "SILVER BEES", "SILVER ETF"]},
    {"symbol": "SI=F", "name": "Silver Commodity CFD (TVC / USD)", "exchange": "COMMODITY", "aliases": ["SILVER", "SILVER FUTURES", "SILVER USD", "TVC:SILVER", "SILVER CFD", "SILVER(COMMODITY CFD TVC)"]},
    {"symbol": "CL=F", "name": "Crude Oil Futures (USD)", "exchange": "COMMODITY", "aliases": ["CRUDE", "CRUDE OIL", "CRUDEOIL"]},
    {"symbol": "^GSPC", "name": "S&P 500 Index (US)", "exchange": "INDEX", "aliases": ["SP500", "S&P 500", "S&P500"]},
    {"symbol": "^IXIC", "name": "NASDAQ Composite Index (US)", "exchange": "INDEX", "aliases": ["NASDAQ", "NASDAQ 100", "NASDAQ100"]}
]

def format_financial_symbol(raw_symbol):
    if not raw_symbol:
        return ""
    sym = raw_symbol.strip().upper()
    
    # Direct TVC and GIFT alias remappings for in-house chart
    if sym in ("TVC:GOLD", "GOLD CFD", "GOLD(COMMODITY CFD TVC)"):
        return "GC=F"
    if sym in ("TVC:SILVER", "SILVER CFD", "SILVER(COMMODITY CFD TVC)"):
        return "SI=F"
    if sym in ("GIFTNIFTY", "GIFT NIFTY", "NSEIX:NIFTY1!"):
        return "^NSEI"

    # Check direct index / commodity alias matches
    for idx_item in POPULAR_MARKET_INDEXES:
        if sym == idx_item["symbol"].upper():
            return idx_item["symbol"]
        for alias in idx_item["aliases"]:
            if sym == alias.upper():
                return idx_item["symbol"]

    # Keep as-is if starts with ^, contains =F, or ends with .NS / .BO
    if sym.startswith("^") or "=F" in sym or sym.endswith(".NS") or sym.endswith(".BO"):
        return sym
        
    return sym + ".NS"

class HighPerformanceCache:
    def __init__(self, default_ttl=30):
        self.default_ttl = default_ttl
        self.cache = {}
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            entry = self.cache.get(key)
            if entry:
                timestamp, data, ttl = entry
                if time.time() - timestamp < ttl:
                    return data
                else:
                    del self.cache[key]
            return None

    def get_expired_fallback(self, key):
        with self.lock:
            entry = self.cache.get(key)
            if entry:
                timestamp, data, ttl = entry
                if isinstance(data, dict) and not data.get("error"):
                    return data
            return None

    def set(self, key, data, ttl=None):
        if ttl is None:
            ttl = self.default_ttl
        with self.lock:
            if isinstance(data, dict) and data.get("error"):
                ttl = min(ttl, 5)
            self.cache[key] = (time.time(), data, ttl)

    def clear(self):
        with self.lock:
            self.cache.clear()

# In-Memory Cache Containers for Live Stock Quotes, News, and Market Metrics
stock_cache = HighPerformanceCache(default_ttl=30)   # 30-second TTL for live price quotes
news_cache = HighPerformanceCache(default_ttl=300)   # 5-minute TTL for RSS news articles
fiidii_cache = HighPerformanceCache(default_ttl=600) # 10-minute TTL for FII/DII data

_USER_WL_CACHE = {}
_USER_PF_CACHE = {}

class StockFetcher:
    def __init__(self):
        if _STOCK_CURL_CFFI:
            self.session = stock_http_requests.Session(impersonate="chrome")
        else:
            self.session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=50)
            self.session.mount('https://', adapter)
            self.session.mount('http://', adapter)
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        })
        self.crumb = None

    def _init_crumb(self):
        try:
            self.session.get('https://fc.yahoo.com', timeout=3)
            r = self.session.get('https://query1.finance.yahoo.com/v1/test/getcrumb', timeout=3)
            if r.status_code == 200 and r.text and 'Too Many' not in r.text and '404' not in r.text:
                self.crumb = r.text.strip()
        except Exception:
            self.crumb = None

    def fetch_stock(self, symbol, use_cache=True):
        if use_cache:
            cached = stock_cache.get(symbol)
            if cached:
                return cached

        t_now = int(time.time())
        hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']

        # 1. Primary: Fast & Highly Reliable 1d Chart API with Multi-Host Failover
        for host in hosts:
            try:
                url = f'https://{host}/v8/finance/chart/{symbol}?interval=1d&range=5d&_={t_now}'
                r = self.session.get(url, timeout=3.5)
                if r.status_code == 404:
                    err_data = {'error': 'No Data Available'}
                    if use_cache:
                        stock_cache.set(symbol, err_data, ttl=60)
                    return err_data
                if r.status_code == 200:
                    res = r.json()
                    result_list = res.get('chart', {}).get('result', [])
                    if result_list:
                        meta = result_list[0].get('meta', {})
                        price = meta.get('regularMarketPrice')
                        
                        # Fallback for pre-market (9:00-9:15 AM IST) or off-hours when regularMarketPrice is None
                        if price is None:
                            quotes = result_list[0].get('indicators', {}).get('quote', [{}])[0]
                            closes = [c for c in quotes.get('close', []) if c is not None]
                            if closes:
                                price = closes[-1]

                        name = meta.get('shortName') or meta.get('longName') or symbol
                        
                        if price is not None:
                            change_pct = meta.get('regularMarketChangePercent')
                            change = meta.get('regularMarketChange')
                            prev_close = meta.get('previousClose') or meta.get('chartPreviousClose')

                            if change_pct is not None:
                                change_pct = float(change_pct)
                                if change is not None:
                                    change = float(change)
                                else:
                                    prev_calc = price / (1 + (change_pct / 100.0)) if (1 + (change_pct / 100.0)) != 0 else price
                                    change = price - prev_calc
                            else:
                                if prev_close:
                                    change = price - prev_close
                                    change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0
                                else:
                                    change = 0.0
                                    change_pct = 0.0

                            if prev_close is None and price is not None:
                                prev_close = price - change

                            item_data = {
                                'symbol': symbol,
                                'name': name,
                                'price': round(float(price), 2),
                                'change': round(float(change), 2),
                                'change_pct': round(float(change_pct), 2),
                                'previous_close': round(float(prev_close), 2) if prev_close is not None else None,
                                'mcap_cr': 'N/A'
                            }
                            if use_cache:
                                stock_cache.set(symbol, item_data)
                            return item_data
            except Exception:
                pass

        # 2. Secondary: 1-minute Tick Chart API with Multi-Host Failover
        for host in hosts:
            try:
                url = f'https://{host}/v8/finance/chart/{symbol}?interval=1m&range=2d&_={t_now}'
                r = self.session.get(url, timeout=4)
                if r.status_code == 200:
                    res = r.json()
                    result_list = res.get('chart', {}).get('result', [])
                    if result_list:
                        meta = result_list[0].get('meta', {})
                        price = meta.get('regularMarketPrice')
                        
                        if price is None:
                            quotes = result_list[0].get('indicators', {}).get('quote', [{}])[0]
                            closes = [c for c in quotes.get('close', []) if c is not None]
                            if closes:
                                price = closes[-1]
                            
                        name = meta.get('shortName') or meta.get('longName') or symbol
                        
                        if price is not None:
                            change_pct = meta.get('regularMarketChangePercent')
                            change = meta.get('regularMarketChange')
                            prev_close = meta.get('previousClose') or meta.get('chartPreviousClose')

                            if change_pct is not None:
                                change_pct = float(change_pct)
                                if change is not None:
                                    change = float(change)
                                else:
                                    prev_calc = price / (1 + (change_pct / 100.0)) if (1 + (change_pct / 100.0)) != 0 else price
                                    change = price - prev_calc
                            else:
                                if prev_close:
                                    change = price - prev_close
                                    change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0
                                else:
                                    change = 0.0
                                    change_pct = 0.0

                            if prev_close is None and price is not None:
                                prev_close = price - change

                            item_data = {
                                'symbol': symbol,
                                'name': name,
                                'price': round(float(price), 2),
                                'change': round(float(change), 2),
                                'change_pct': round(float(change_pct), 2),
                                'previous_close': round(float(prev_close), 2) if prev_close is not None else None,
                                'mcap_cr': 'N/A'
                            }
                            if use_cache:
                                stock_cache.set(symbol, item_data)
                            return item_data
            except Exception:
                pass

        # 3. Fallback to expired cache item if available
        fallback = stock_cache.get_expired_fallback(symbol)
        if fallback:
            return fallback

        err_data = {'error': 'No Data Available'}
        if use_cache:
            stock_cache.set(symbol, err_data, ttl=5)
        return err_data

fetcher = StockFetcher()

def resolve_watchlist_symbol(raw_symbol):
    """Resolve an Indian stock symbol against Yahoo Finance.

    The base symbol is cleaned first. NSE is always checked first; if Yahoo
    has no data for the NSE ticker, BSE is checked next. The resolved Yahoo
    ticker is returned for storage. Existing index/commodity symbols continue
    to use the existing formatter.
    """
    if raw_symbol is None:
        return None, "INVALID"

    cleaned = str(raw_symbol).strip().upper()
    cleaned = re.sub(r"\s+", "", cleaned)
    if not cleaned:
        return None, "INVALID"

    # Preserve the application's existing handling for indexes/commodities.
    formatted = format_financial_symbol(cleaned)
    if formatted.startswith("^") or "=F" in formatted:
        if not fetcher.fetch_stock(formatted).get("error"):
            return formatted, "SPECIAL"
        return None, "NOT_FOUND"

    base = re.sub(r"\.(NS|BO)$", "", cleaned, flags=re.IGNORECASE)
    if not base:
        return None, "INVALID"

    # Always prefer NSE, as requested.
    nse_symbol = f"{base}.NS"
    if not fetcher.fetch_stock(nse_symbol).get("error"):
        return nse_symbol, "NSE"

    # If NSE is unavailable, check BSE.
    bse_symbol = f"{base}.BO"
    if not fetcher.fetch_stock(bse_symbol).get("error"):
        return bse_symbol, "BSE"

    return None, "NOT_FOUND"

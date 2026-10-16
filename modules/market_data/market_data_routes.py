import datetime
import math
import difflib
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
from flask import Blueprint, request, jsonify, session
from modules.common.auth_utils import login_required
from modules.common.market_fetcher import (
    POPULAR_INDIAN_STOCKS,
    POPULAR_MARKET_INDEXES,
    format_financial_symbol,
    stock_cache,
    fetcher
)
from modules.common.indicators import calculate_indicators

market_data_bp = Blueprint("market_data_api", __name__)

@market_data_bp.route("/api/search", methods=["GET"])
def search_symbol():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])

    results = []
    clean_q = query.upper()

    # 1. Preset Indices & Commodities Matching
    for idx in POPULAR_MARKET_INDEXES:
        match = False
        if clean_q in idx["symbol"].upper() or clean_q in idx["name"].upper():
            match = True
        else:
            for alias in idx["aliases"]:
                if clean_q in alias.upper():
                    match = True
                    break
        if match:
            results.append({
                'symbol': idx["symbol"],
                'name': idx["name"],
                'exchange': idx["exchange"]
            })

    # 2. Yahoo Finance Search API
    def do_search(q_str):
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q_str}&quotesCount=12&newsCount=0"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        try:
            res = requests.get(url, headers=headers, timeout=5).json()
            out = []
            for q in res.get('quotes', []):
                sym = q.get('symbol', '')
                exch = q.get('exchange', '')
                if exch in ['NSI', 'BSE', 'IND', 'INDEX', 'CMX', 'NYM', 'SNP', 'NAS', 'MCX', 'CCY'] or sym.startswith('^') or '=F' in sym or sym.endswith('.NS') or sym.endswith('.BO'):
                    if not any(r['symbol'] == sym for r in results):
                        ex_label = 'INDEX' if (sym.startswith('^') or exch in ['IND', 'INDEX']) else ('COMMODITY' if '=F' in sym else ('NSE' if exch == 'NSI' else ('BSE' if exch == 'BSE' else exch)))
                        out.append({
                            'symbol': sym,
                            'name': q.get('shortname') or q.get('longname') or sym,
                            'exchange': ex_label
                        })
            return out
        except Exception:
            return []

    yahoo_results = do_search(query)
    results.extend(yahoo_results)

    if results:
        return jsonify(results)

    # 3. Fuzzy match fallback
    clean_q_stock = clean_q.replace(".NS", "").replace(".BO", "")
    matches = difflib.get_close_matches(clean_q_stock, POPULAR_INDIAN_STOCKS.keys(), n=3, cutoff=0.5)
    
    if matches:
        for m in matches:
            fuzzy_results = do_search(m)
            if fuzzy_results:
                for fr in fuzzy_results:
                    if not any(r['symbol'] == fr['symbol'] for r in results):
                        fr['name'] = f"{fr['name']} (Auto-suggested for '{query}')"
                        results.append(fr)
                return jsonify(results)

    return jsonify(results)

@market_data_bp.route("/api/stock_data", methods=["POST"])
def get_stock_data():
    symbols = request.json.get("symbols", [])
    force_refresh = request.json.get("force_refresh", False)
    if not symbols:
        return jsonify({})

    result = {}

    # 1. Check warm in-memory cache first (bypassed if force_refresh is requested)
    missing_symbols = []
    if force_refresh:
        missing_symbols = list(symbols)
    else:
        for s in symbols:
            cached = stock_cache.get(s)
            if cached and not cached.get("error"):
                result[s] = cached
            else:
                missing_symbols.append(s)

    # 2. Fetch any missing symbols in parallel using ThreadPoolExecutor
    if missing_symbols:
        def _fetch_single(s):
            return s, fetcher.fetch_stock(s, use_cache=not force_refresh)

        with ThreadPoolExecutor(max_workers=min(len(missing_symbols), 25)) as executor:
            future_to_sym = {executor.submit(_fetch_single, s): s for s in missing_symbols}
            try:
                for future in as_completed(future_to_sym, timeout=5.0):
                    s_sym = future_to_sym[future]
                    try:
                        _, s_data = future.result()
                        if s_data and not s_data.get("error"):
                            result[s_sym] = s_data
                        else:
                            fb = stock_cache.get_expired_fallback(s_sym)
                            result[s_sym] = fb if fb else s_data
                    except Exception:
                        fb = stock_cache.get_expired_fallback(s_sym)
                        if fb:
                            result[s_sym] = fb
            except TimeoutError:
                pass

    # 3. Ensure all requested symbols have an explicit entry
    for sym in symbols:
        if sym not in result:
            fb = stock_cache.get_expired_fallback(sym)
            if fb:
                result[sym] = fb
            else:
                result[sym] = {'error': 'No Data Available'}

    return jsonify(result)

@market_data_bp.route("/api/chart_history", methods=["GET"])
def get_chart_history():
    raw_symbol = request.args.get("symbol", "").strip()
    time_range = request.args.get("range", "1y").strip()
    interval_raw = request.args.get("interval", "1d").strip().lower()
    
    if not raw_symbol:
        return jsonify({"error": "Symbol is required"}), 400

    symbol = format_financial_symbol(raw_symbol)
    fetch_sym = symbol
    if symbol == "TVC:GOLD":
        fetch_sym = "GC=F"
    elif symbol == "TVC:SILVER":
        fetch_sym = "SI=F"
    elif symbol == "GIFTNIFTY":
        fetch_sym = "^NSEI"

    interval_map = {
        '5m': '5m',
        '15m': '15m',
        '1h': '60m',
        '60m': '60m',
        '1d': '1d',
        '1w': '1wk',
        '1wk': '1wk',
        '1m': '1mo',
        '1mo': '1mo'
    }
    interval = interval_map.get(interval_raw, '1d')

    time_range_clean = time_range.lower()
    if time_range_clean in ('all', 'max'):
        time_range = 'max'

    # Auto-adjust time range for intraday intervals to prevent Yahoo 400 errors
    if interval in ('5m', '15m') and time_range not in ('1d', '5d', '7d', '1mo'):
        time_range = '1mo'
    elif interval in ('60m', '1h') and time_range not in ('1d', '5d', '7d', '1mo', '3mo'):
        time_range = '3mo'

    hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
    res = None
    last_error = None

    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

    for host in hosts:
        url = f'https://{host}/v8/finance/chart/{fetch_sym}?interval={interval}&range={time_range}&includePrePost=true&includeAdjustedClose=true'
        try:
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                data = r.json()
                results = data.get('chart', {}).get('result')
                if results and len(results) > 0:
                    res = results[0]
                    break
            else:
                last_error = f"Status {r.status_code}"
        except Exception as ex:
            last_error = str(ex)

    if not res:
        return jsonify({"error": f"Failed to fetch chart data for '{symbol}' ({last_error or 'No data returned'})"}), 400

    meta = res.get('meta', {})
    name = meta.get('shortName') or meta.get('longName') or symbol
    
    timestamps = res.get('timestamp', []) or []
    indicators = res.get('indicators', {})
    quote_list = indicators.get('quote', [{}])
    quote = quote_list[0] if (quote_list and isinstance(quote_list, list)) else {}
    if not quote or not isinstance(quote, dict):
        quote = {}
    adjclose_list = indicators.get('adjclose', [{}])
    adjclose = (adjclose_list[0].get('adjclose', []) if (adjclose_list and isinstance(adjclose_list, list) and len(adjclose_list) > 0 and isinstance(adjclose_list[0], dict)) else []) or []
    
    opens = quote.get('open', []) or []
    highs = quote.get('high', []) or []
    lows = quote.get('low', []) or []
    closes = quote.get('close', []) or []
    volumes = quote.get('volume', []) or []
    
    candles = []
    volume_data = []
    is_intraday = interval in ('5m', '15m', '30m', '60m', '1h', '90m')
    try:
        ist_tz = ZoneInfo("Asia/Kolkata") if ZoneInfo else datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    except Exception:
        ist_tz = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    candle_map = {}
    
    reg_price = meta.get('regularMarketPrice')
    reg_time = meta.get('regularMarketTime')

    for i in range(len(timestamps)):
        ts = int(timestamps[i])
        open_v = opens[i] if i < len(opens) else None
        high_v = highs[i] if i < len(highs) else None
        low_v = lows[i] if i < len(lows) else None
        close_v = closes[i] if i < len(closes) else None
        vol_v = volumes[i] if i < len(volumes) else 0

        # Skip future/holiday placeholder timestamps where quotes are empty
        if reg_time and ts > (reg_time + 3600) and close_v is None and open_v is None:
            continue

        # Fallback to adjclose if close is None
        if close_v is None and adjclose and i < len(adjclose):
            close_v = adjclose[i]
        
        # Fallback to meta price if still None on the last bar
        if close_v is None and i == len(timestamps) - 1:
            close_v = meta.get('regularMarketPrice') or meta.get('chartPreviousClose')

        if close_v is None:
            continue

        if open_v is None:
            open_v = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or close_v
        if high_v is None: high_v = max(open_v, close_v)
        if low_v is None: low_v = min(open_v, close_v)

        dt = datetime.datetime.fromtimestamp(ts, tz=ist_tz)
        
        if is_intraday:
            period_key = ts
            time_val = ts
        elif interval in ('1w', '1wk'):
            iso_year, iso_week, _ = dt.isocalendar()
            period_key = f"{iso_year}-W{iso_week:02d}"
            monday = dt - datetime.timedelta(days=dt.weekday())
            time_val = monday.strftime('%Y-%m-%d')
        elif interval in ('1m', '1mo'):
            period_key = dt.strftime('%Y-%m')
            time_val = dt.strftime('%Y-%m-01')
        else: # 1d
            period_key = dt.strftime('%Y-%m-%d')
            time_val = dt.strftime('%Y-%m-%d')

        open_val = round(float(open_v), 2)
        high_val = round(float(high_v), 2)
        low_val = round(float(low_v), 2)
        close_val = round(float(close_v), 2)
        vol_val = int(vol_v) if vol_v else 0

        if period_key in candle_map:
            idx = candle_map[period_key]
            existing_c = candles[idx]
            existing_v = volume_data[idx]
            
            existing_c['high'] = max(existing_c['high'], high_val)
            existing_c['low'] = min(existing_c['low'], low_val)
            existing_c['close'] = close_val
            
            existing_v['value'] += vol_val
            is_up = existing_c['close'] >= existing_c['open']
            existing_v['color'] = '#26a69a' if is_up else '#ef5350'
        else:
            is_up = close_val >= open_val
            candle_map[period_key] = len(candles)
            candles.append({
                'time': time_val,
                'open': open_val,
                'high': high_val,
                'low': low_val,
                'close': close_val
            })
            volume_data.append({
                'time': time_val,
                'value': vol_val,
                'color': '#26a69a' if is_up else '#ef5350'
            })

    # Merge meta regularMarketPrice if market time date is available
    if reg_price and reg_time:
        reg_dt = datetime.datetime.fromtimestamp(reg_time, tz=ist_tz)
        if is_intraday:
            reg_key = reg_time
            reg_time_val = reg_time
        elif interval in ('1w', '1wk'):
            iso_year, iso_week, _ = reg_dt.isocalendar()
            reg_key = f"{iso_year}-W{iso_week:02d}"
            monday = reg_dt - datetime.timedelta(days=reg_dt.weekday())
            reg_time_val = monday.strftime('%Y-%m-%d')
        elif interval in ('1m', '1mo'):
            reg_key = reg_dt.strftime('%Y-%m')
            reg_time_val = reg_dt.strftime('%Y-%m-01')
        else:
            reg_key = reg_dt.strftime('%Y-%m-%d')
            reg_time_val = reg_dt.strftime('%Y-%m-%d')

        reg_price_val = round(float(reg_price), 2)

        if reg_key in candle_map:
            idx = candle_map[reg_key]
            existing_c = candles[idx]
            existing_v = volume_data[idx]
            existing_c['high'] = max(existing_c['high'], reg_price_val, meta.get('regularMarketDayHigh') or reg_price_val)
            existing_c['low'] = min(existing_c['low'], reg_price_val, meta.get('regularMarketDayLow') or reg_price_val)
            existing_c['close'] = reg_price_val
            is_up = existing_c['close'] >= existing_c['open']
            existing_v['color'] = '#26a69a' if is_up else '#ef5350'
        else:
            reg_open_val = meta.get('regularMarketOpen') or (candles[-1]['close'] if candles else None) or meta.get('chartPreviousClose') or meta.get('previousClose') or reg_price_val
            reg_open_val = round(float(reg_open_val), 2)
            reg_high_val = round(float(meta.get('regularMarketDayHigh') or max(reg_open_val, reg_price_val)), 2)
            reg_low_val = round(float(meta.get('regularMarketDayLow') or min(reg_open_val, reg_price_val)), 2)

            is_up = reg_price_val >= reg_open_val
            candle_map[reg_key] = len(candles)
            candles.append({
                'time': reg_time_val,
                'open': reg_open_val,
                'high': max(reg_high_val, reg_open_val, reg_price_val),
                'low': min(reg_low_val, reg_open_val, reg_price_val),
                'close': reg_price_val
            })
            volume_data.append({
                'time': reg_time_val,
                'value': int(meta.get('regularMarketVolume') or 0),
                'color': '#26a69a' if is_up else '#ef5350'
            })
    # Deduplicate and sort candles and volume_data strictly by time ascending BEFORE calculating indicators
    def get_time_sort_key(t):
        if isinstance(t, (int, float)):
            return (0, int(t))
        return (1, str(t))

    candle_dict = {}
    for c in candles:
        candle_dict[c['time']] = c

    sorted_times = sorted(candle_dict.keys(), key=get_time_sort_key)
    candles = [candle_dict[t] for t in sorted_times]

    volume_dict = {}
    for v in volume_data:
        volume_dict[v['time']] = v

    volume_data = [volume_dict[t] for t in sorted_times if t in volume_dict]

    # Calculate Volume MA (20-period Moving Average)
    volume_ma = []
    if volume_data:
        vol_vals = [float(v.get('value') or 0) for v in volume_data]
        vol_times = [v['time'] for v in volume_data]
        period = 20
        v_sum = 0.0
        for i in range(len(volume_data)):
            v_sum += vol_vals[i]
            if i >= period:
                v_sum -= vol_vals[i - period]
                volume_ma.append({'time': vol_times[i], 'value': round(v_sum / period)})
            else:
                volume_ma.append({'time': vol_times[i], 'value': round(v_sum / (i + 1))})

    if symbol in ("TVC:GOLD", "TVC:SILVER"):
        name = "Gold Commodity CFD (TVC / USD)" if symbol == "TVC:GOLD" else "Silver Commodity CFD (TVC / USD)"
        tvc_quote = fetcher.fetch_stock(symbol)
        if tvc_quote and not tvc_quote.get("error") and candles:
            live_p = tvc_quote.get("price")
            if live_p:
                candles[-1]["close"] = live_p
                candles[-1]["high"] = max(candles[-1]["high"], live_p)
                candles[-1]["low"] = min(candles[-1]["low"], live_p)
    elif symbol == "GIFTNIFTY":
        name = "GIFT Nifty Index"
        gift_quote = fetcher.fetch_stock("GIFTNIFTY")
        if gift_quote and not gift_quote.get("error") and candles:
            live_p = gift_quote.get("price")
            if live_p:
                candles[-1]["close"] = live_p
                candles[-1]["high"] = max(candles[-1]["high"], live_p)
                candles[-1]["low"] = min(candles[-1]["low"], live_p)

    ind = calculate_indicators(candles)
    
    return jsonify({
        'symbol': symbol,
        'name': name,
        'candles': candles,
        'volume': volume_data,
        'volume_ma': volume_ma,
        'sma20': ind['sma20'],
        'sma50': ind['sma50'],
        'sma200': ind['sma200'],
        'ema9': ind['ema9'],
        'ema21': ind['ema21'],
        'ema50': ind['ema50'],
        'bollinger_upper': ind['bollinger_upper'],
        'bollinger_middle': ind['bollinger_middle'],
        'bollinger_lower': ind['bollinger_lower'],
        'gann_2day': ind.get('gann_2day', []),
        'cdrider': ind.get('cdrider', []),
        'cdrider_buy': ind.get('cdrider_buy', []),
        'cdrider_sell': ind.get('cdrider_sell', []),
        'macd_line': ind['macd_line'],
        'macd_signal': ind['macd_signal'],
        'macd_hist': ind['macd_hist'],
        'rsi': ind['rsi']
    })


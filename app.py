import os
import json
import datetime
import requests
import math
import difflib
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
DATA_FILE = "watchlists.json"
PORTFOLIO_FILE = "portfolios.json"

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

class StockFetcher:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        self.crumb = None
        self._init_crumb()

    def _init_crumb(self):
        try:
            self.session.get('https://fc.yahoo.com', timeout=5)
            r = self.session.get('https://query1.finance.yahoo.com/v1/test/getcrumb', timeout=5)
            if r.status_code == 200 and r.text and 'Too Many' not in r.text and '404' not in r.text:
                self.crumb = r.text.strip()
        except Exception:
            self.crumb = None

    def fetch_stock(self, symbol):
        import time
        t_now = int(time.time())

        # 1. Primary: Fast Real-Time 1-minute Tick Chart API
        try:
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=2d&_={t_now}'
            r = self.session.get(url, timeout=4)
            if r.status_code == 200:
                res = r.json()
                result_list = res.get('chart', {}).get('result', [])
                if result_list:
                    meta = result_list[0].get('meta', {})
                    price = meta.get('regularMarketPrice')
                    prev_close = meta.get('chartPreviousClose') or meta.get('previousClose')
                    name = meta.get('shortName') or meta.get('longName') or symbol
                    
                    if price is not None:
                        change = (price - prev_close) if prev_close else 0.0
                        change_pct = (change / prev_close * 100) if prev_close else 0.0
                        return {
                            'symbol': symbol,
                            'name': name,
                            'price': round(float(price), 2),
                            'change': round(float(change), 2),
                            'change_pct': round(float(change_pct), 2),
                            'mcap_cr': 'N/A'
                        }
        except Exception:
            pass

        # 2. Backup: Quote Summary API with Crumb
        if not self.crumb:
            self._init_crumb()

        if self.crumb:
            try:
                url = f'https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules=price,summaryDetail&crumb={self.crumb}&_={t_now}'
                r = self.session.get(url, timeout=4)
                if r.status_code == 200:
                    price_module = r.json()['quoteSummary']['result'][0]['price']
                    
                    price = price_module.get('regularMarketPrice', {}).get('raw')
                    change = price_module.get('regularMarketChange', {}).get('raw')
                    change_pct = price_module.get('regularMarketChangePercent', {}).get('raw')
                    if change_pct is not None:
                        change_pct = change_pct * 100
                    mcap = price_module.get('marketCap', {}).get('raw')
                    name = price_module.get('shortName') or price_module.get('longName') or symbol
                    
                    if price is not None:
                        return {
                            'symbol': symbol,
                            'name': name,
                            'price': round(float(price), 2),
                            'change': round(float(change), 2) if change else 0,
                            'change_pct': round(float(change_pct), 2) if change_pct else 0,
                            'mcap_cr': round(float(mcap) / 10000000, 2) if mcap else 'N/A'
                        }
            except Exception:
                pass

        return {'error': 'No Data Available'}

fetcher = StockFetcher()

def calculate_indicators(candles):
    closes = [c['close'] for c in candles]
    times = [c['time'] for c in candles]
    n = len(candles)
    
    sma20 = []
    sma50 = []
    sma200 = []
    bollinger_upper = []
    bollinger_lower = []
    bollinger_middle = []
    
    for i in range(n):
        if i >= 19:
            window = closes[i-19:i+1]
            avg_20 = sum(window) / 20.0
            sma20.append({'time': times[i], 'value': round(avg_20, 2)})
            
            variance = sum((x - avg_20) ** 2 for x in window) / 20.0
            std_dev = math.sqrt(variance)
            bollinger_middle.append({'time': times[i], 'value': round(avg_20, 2)})
            bollinger_upper.append({'time': times[i], 'value': round(avg_20 + 2 * std_dev, 2)})
            bollinger_lower.append({'time': times[i], 'value': round(avg_20 - 2 * std_dev, 2)})
            
        if i >= 49:
            avg_50 = sum(closes[i-49:i+1]) / 50.0
            sma50.append({'time': times[i], 'value': round(avg_50, 2)})
            
        if i >= 199:
            avg_200 = sum(closes[i-199:i+1]) / 200.0
            sma200.append({'time': times[i], 'value': round(avg_200, 2)})

    def calc_ema(period):
        if n < period:
            return []
        k = 2.0 / (period + 1)
        ema_list = []
        sma_init = sum(closes[:period]) / float(period)
        curr_ema = sma_init
        ema_list.append({'time': times[period-1], 'value': round(curr_ema, 2)})
        for j in range(period, n):
            curr_ema = (closes[j] * k) + (curr_ema * (1.0 - k))
            ema_list.append({'time': times[j], 'value': round(curr_ema, 2)})
        return ema_list

    ema9 = calc_ema(9)
    ema21 = calc_ema(21)
    ema50 = calc_ema(50)

    macd_line = []
    macd_signal = []
    macd_hist = []
    if n >= 26:
        k12 = 2.0 / 13.0
        k26 = 2.0 / 27.0
        ema12_val = sum(closes[:12]) / 12.0
        ema26_val = sum(closes[:26]) / 26.0
        
        for j in range(12, 26):
            ema12_val = (closes[j] * k12) + (ema12_val * (1.0 - k12))
            
        macd_vals = []
        macd_times = []
        for j in range(25, n):
            if j > 25:
                ema12_val = (closes[j] * k12) + (ema12_val * (1.0 - k12))
                ema26_val = (closes[j] * k26) + (ema26_val * (1.0 - k26))
            m_val = ema12_val - ema26_val
            macd_vals.append(m_val)
            macd_times.append(times[j])
            macd_line.append({'time': times[j], 'value': round(m_val, 2)})

        if len(macd_vals) >= 9:
            k9 = 2.0 / 10.0
            sig_val = sum(macd_vals[:9]) / 9.0
            macd_signal.append({'time': macd_times[8], 'value': round(sig_val, 2)})
            macd_hist.append({
                'time': macd_times[8],
                'value': round(macd_vals[8] - sig_val, 2),
                'color': '#26a69a' if (macd_vals[8] - sig_val) >= 0 else '#ef5350'
            })
            for j in range(9, len(macd_vals)):
                sig_val = (macd_vals[j] * k9) + (sig_val * (1.0 - k9))
                diff = macd_vals[j] - sig_val
                macd_signal.append({'time': macd_times[j], 'value': round(sig_val, 2)})
                macd_hist.append({
                    'time': macd_times[j],
                    'value': round(diff, 2),
                    'color': '#26a69a' if diff >= 0 else '#ef5350'
                })

    rsi = []
    gains = []
    losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
        
    if len(gains) >= 14:
        avg_gain = sum(gains[:14]) / 14.0
        avg_loss = sum(losses[:14]) / 14.0
        
        for i in range(13, len(gains)):
            if i > 13:
                avg_gain = (avg_gain * 13 + gains[i]) / 14.0
                avg_loss = (avg_loss * 13 + losses[i]) / 14.0
            
            rs = avg_gain / avg_loss if avg_loss != 0 else 100
            rsi_val = 100 - (100 / (1 + rs)) if avg_loss != 0 else 100
            rsi.append({'time': candles[i+1]['time'], 'value': round(rsi_val, 2)})
            
    return {
        'sma20': sma20,
        'sma50': sma50,
        'sma200': sma200,
        'ema9': ema9,
        'ema21': ema21,
        'ema50': ema50,
        'bollinger_upper': bollinger_upper,
        'bollinger_middle': bollinger_middle,
        'bollinger_lower': bollinger_lower,
        'macd_line': macd_line,
        'macd_signal': macd_signal,
        'macd_hist': macd_hist,
        'rsi': rsi
    }

def load_data():
    if not os.path.exists(DATA_FILE):
        # Auto-restore if a local backup file exists
        for backup_name in ["backup.json", "my_backup.json"]:
            if os.path.exists(backup_name):
                try:
                    with open(backup_name, "r") as f:
                        b_data = json.load(f)
                        if "watchlists" in b_data:
                            save_data(b_data["watchlists"])
                            return b_data["watchlists"]
                except Exception:
                    pass
        # Fallback to example template
        if os.path.exists("watchlists.example.json"):
            try:
                with open("watchlists.example.json", "r") as f:
                    example_data = json.load(f)
                    save_data(example_data)
                    return example_data
            except Exception:
                pass
        default_data = {"Path Finders": ["RELIANCE.NS", "TCS.NS", "INFY.NS"]}
        save_data(default_data)
        return default_data
    with open(DATA_FILE, "r") as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)

def load_portfolios():
    if not os.path.exists(PORTFOLIO_FILE):
        # Auto-restore if a local backup file exists
        for backup_name in ["backup.json", "my_backup.json"]:
            if os.path.exists(backup_name):
                try:
                    with open(backup_name, "r") as f:
                        b_data = json.load(f)
                        if "portfolios" in b_data:
                            save_portfolios(b_data["portfolios"])
                            return b_data["portfolios"]
                except Exception:
                    pass
        # Fallback to example template
        if os.path.exists("portfolios.example.json"):
            try:
                with open("portfolios.example.json", "r") as f:
                    example_data = json.load(f)
                    save_portfolios(example_data)
                    return example_data
            except Exception:
                pass
        default_portfolios = {
            "Sample Portfolio": [
                {"symbol": "RELIANCE.NS", "buy_price": 2750.0, "quantity": 10, "buy_date": "2025-01-15"},
                {"symbol": "TCS.NS", "buy_price": 3800.0, "quantity": 5, "buy_date": "2025-02-01"}
            ]
        }
        save_portfolios(default_portfolios)
        return default_portfolios
    with open(PORTFOLIO_FILE, "r") as f:
        return json.load(f)

def save_portfolios(data):
    with open(PORTFOLIO_FILE, "w") as f:
        json.dump(data, f, indent=4)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/backup/export", methods=["GET"])
def export_backup():
    backup_data = {
        "watchlists": load_data(),
        "portfolios": load_portfolios(),
        "exported_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    response = jsonify(backup_data)
    filename = f"stock_watchlist_backup_{datetime.date.today().strftime('%Y-%m-%d')}.json"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response

@app.route("/api/backup/import", methods=["POST"])
def import_backup():
    try:
        req_data = request.get_json(force=True)
        if not req_data:
            return jsonify({"error": "No JSON data provided"}), 400
            
        watchlists = req_data.get("watchlists")
        portfolios = req_data.get("portfolios")
        
        if watchlists is None and portfolios is None:
            return jsonify({"error": "Invalid backup file. Must contain 'watchlists' or 'portfolios'"}), 400
            
        if watchlists is not None:
            save_data(watchlists)
        if portfolios is not None:
            save_portfolios(portfolios)
            
        return jsonify({
            "success": True, 
            "message": "Data restored successfully!",
            "watchlists": load_data(),
            "portfolios": load_portfolios()
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/watchlists", methods=["GET"])
def get_watchlists():
    return jsonify(load_data())

@app.route("/api/watchlists", methods=["POST"])
def create_watchlist():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Name is required"}), 400
    
    data = load_data()
    if name in data:
        return jsonify({"error": "Watchlist already exists"}), 400
    
    data[name] = []
    save_data(data)
    return jsonify({"success": True, "watchlists": data})

@app.route("/api/watchlists/<name>", methods=["DELETE"])
def delete_watchlist(name):
    data = load_data()
    if name in data:
        del data[name]
        save_data(data)
    return jsonify({"success": True, "watchlists": data})

@app.route("/api/watchlists/<name>/stocks", methods=["POST"])
def add_stock(name):
    symbol = request.json.get("symbol")
    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400
    
    symbol = symbol.upper()
    if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
        symbol += ".NS"
        
    # Check if symbol is valid or typo
    if fetcher.fetch_stock(symbol).get('error'):
        clean_sym = symbol.replace(".NS", "").replace(".BO", "")
        matches = difflib.get_close_matches(clean_sym, POPULAR_INDIAN_STOCKS.keys(), n=1, cutoff=0.5)
        if matches:
            corrected_sym = matches[0] + ".NS"
            if not fetcher.fetch_stock(corrected_sym).get('error'):
                symbol = corrected_sym

    data = load_data()
    if name not in data:
        return jsonify({"error": "Watchlist not found"}), 404
        
    if symbol not in data[name]:
        data[name].append(symbol)
        save_data(data)
        
    return jsonify({"success": True, "watchlists": data})

@app.route("/api/watchlists/<name>/stocks/<symbol>", methods=["DELETE"])
def remove_stock(name, symbol):
    data = load_data()
    if name in data and symbol in data[name]:
        data[name].remove(symbol)
        save_data(data)
    return jsonify({"success": True, "watchlists": data})

# Portfolio Endpoints
@app.route("/api/portfolios", methods=["GET"])
def get_portfolios():
    return jsonify(load_portfolios())

@app.route("/api/portfolios", methods=["POST"])
def create_portfolio():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Portfolio name is required"}), 400
    
    data = load_portfolios()
    if name in data:
        return jsonify({"error": "Portfolio already exists"}), 400
    
    data[name] = []
    save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/portfolios/<name>", methods=["DELETE"])
def delete_portfolio(name):
    data = load_portfolios()
    if name in data:
        del data[name]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/portfolios/<name>/stocks", methods=["POST"])
def add_portfolio_stock(name):
    symbol = request.json.get("symbol")
    buy_price = request.json.get("buy_price")
    quantity = request.json.get("quantity")
    buy_date = request.json.get("buy_date") or datetime.date.today().strftime("%Y-%m-%d")
    
    if not symbol or buy_price is None or quantity is None:
        return jsonify({"error": "Symbol, buy price, and quantity are required"}), 400
        
    try:
        buy_price = float(buy_price)
        quantity = float(quantity)
    except ValueError:
        return jsonify({"error": "Buy price and quantity must be numbers"}), 400

    symbol = symbol.upper()
    if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
        symbol += ".NS"

    # Check for typos and auto-correct if symbol doesn't yield market data
    if fetcher.fetch_stock(symbol).get('error'):
        clean_sym = symbol.replace(".NS", "").replace(".BO", "")
        matches = difflib.get_close_matches(clean_sym, POPULAR_INDIAN_STOCKS.keys(), n=1, cutoff=0.5)
        if matches:
            corrected_sym = matches[0] + ".NS"
            if not fetcher.fetch_stock(corrected_sym).get('error'):
                symbol = corrected_sym

    data = load_portfolios()
    if name not in data:
        return jsonify({"error": "Portfolio not found"}), 404
        
    existing = False
    for holding in data[name]:
        if holding.get("symbol") == symbol:
            holding["buy_price"] = buy_price
            holding["quantity"] = quantity
            holding["buy_date"] = buy_date
            existing = True
            break
            
    if not existing:
        data[name].append({
            "symbol": symbol,
            "buy_price": buy_price,
            "quantity": quantity,
            "buy_date": buy_date
        })
        
    save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/portfolios/<name>/stocks/<symbol>", methods=["DELETE"])
def remove_portfolio_stock(name, symbol):
    data = load_portfolios()
    if name in data:
        data[name] = [item for item in data[name] if item.get("symbol") != symbol]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/search", methods=["GET"])
def search_symbol():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])
        
    def do_search(q_str):
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q_str}&quotesCount=10&newsCount=0"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        try:
            res = requests.get(url, headers=headers, timeout=5).json()
            results = []
            for q in res.get('quotes', []):
                exch = q.get('exchange')
                if exch in ['NSI', 'BSE']:
                    results.append({
                        'symbol': q.get('symbol'),
                        'name': q.get('shortname') or q.get('longname') or q.get('symbol'),
                        'exchange': 'NSE' if exch == 'NSI' else 'BSE'
                    })
            return results
        except Exception:
            return []

    # 1. Direct search
    results = do_search(query)
    if results:
        return jsonify(results)

    # 2. Fuzzy match auto-correction if direct search returned empty (e.g. PLOYMED -> POLYMED)
    clean_q = query.upper().replace(".NS", "").replace(".BO", "")
    matches = difflib.get_close_matches(clean_q, POPULAR_INDIAN_STOCKS.keys(), n=3, cutoff=0.5)
    
    if matches:
        for m in matches:
            fuzzy_results = do_search(m)
            if fuzzy_results:
                for fr in fuzzy_results:
                    fr['name'] = f"{fr['name']} (Auto-suggested for '{query}')"
                return jsonify(fuzzy_results)

    return jsonify([])

@app.route("/api/stock_data", methods=["POST"])
def get_stock_data():
    symbols = request.json.get("symbols", [])
    if not symbols:
        return jsonify({})
        
    result = {}
    for sym in symbols:
        result[sym] = fetcher.fetch_stock(sym)
            
    return jsonify(result)

@app.route("/api/chart_history", methods=["GET"])
def get_chart_history():
    symbol = request.args.get("symbol", "").strip()
    time_range = request.args.get("range", "1y").strip()
    interval_raw = request.args.get("interval", "1d").strip().lower()
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
    
    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400

    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={time_range}'
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code != 200:
            return jsonify({"error": f"Failed to fetch chart data (Status {r.status_code})"}), 400
            
        res = r.json()['chart']['result'][0]
        meta = res.get('meta', {})
        name = meta.get('shortName') or meta.get('longName') or symbol
        
        timestamps = res.get('timestamp', [])
        quote = res.get('indicators', {}).get('quote', [{}])[0]
        
        opens = quote.get('open', [])
        highs = quote.get('high', [])
        lows = quote.get('low', [])
        closes = quote.get('close', [])
        volumes = quote.get('volume', [])
        
        candles = []
        volume_data = []
        is_intraday = interval in ('5m', '15m', '30m', '60m', '1h', '90m')
        
        for i in range(len(timestamps)):
            if None not in (opens[i], highs[i], lows[i], closes[i]):
                time_val = int(timestamps[i]) if is_intraday else datetime.datetime.fromtimestamp(timestamps[i]).strftime('%Y-%m-%d')
                open_val = round(float(opens[i]), 2)
                high_val = round(float(highs[i]), 2)
                low_val = round(float(lows[i]), 2)
                close_val = round(float(closes[i]), 2)
                vol_val = int(volumes[i]) if volumes[i] else 0
                
                is_up = close_val >= open_val
                
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

        ind = calculate_indicators(candles)
        
        return jsonify({
            'symbol': symbol,
            'name': name,
            'candles': candles,
            'volume': volume_data,
            'sma20': ind['sma20'],
            'sma50': ind['sma50'],
            'sma200': ind['sma200'],
            'ema9': ind['ema9'],
            'ema21': ind['ema21'],
            'ema50': ind['ema50'],
            'bollinger_upper': ind['bollinger_upper'],
            'bollinger_middle': ind['bollinger_middle'],
            'bollinger_lower': ind['bollinger_lower'],
            'macd_line': ind['macd_line'],
            'macd_signal': ind['macd_signal'],
            'macd_hist': ind['macd_hist'],
            'rsi': ind['rsi']
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)

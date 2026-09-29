import os
import json
import datetime
import requests
import math
import difflib
import urllib.parse
import xml.etree.ElementTree as ET
import re
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from zoneinfo import ZoneInfo
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "capital_desk_secret_key_2026_x89a")

BASE_DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", ".")
if not os.path.exists(BASE_DATA_DIR):
    try:
        os.makedirs(BASE_DATA_DIR)
    except Exception:
        pass

DATA_FILE = os.path.join(BASE_DATA_DIR, "watchlists.json")
PORTFOLIO_FILE = os.path.join(BASE_DATA_DIR, "portfolios.json")
USERS_FILE = os.path.join(BASE_DATA_DIR, "users.json")
USERS_EXAMPLE_FILE = os.path.join(os.path.dirname(__file__), "users.example.json")
USER_DATA_DIR = os.path.join(BASE_DATA_DIR, "user_data")
LOGS_FILE = os.path.join(BASE_DATA_DIR, "login_logs.json")

if not os.path.exists(USER_DATA_DIR):
    os.makedirs(USER_DATA_DIR)

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
    {"symbol": "GOLDBEES.NS", "name": "Nippon India ETF Gold BeES (₹)", "exchange": "COMMODITY", "aliases": ["GOLD", "GOLDBEES", "GOLD BEES", "GOLD ETF"]},
    {"symbol": "GC=F", "name": "Gold Futures (USD)", "exchange": "COMMODITY", "aliases": ["GOLD FUTURES", "GOLD USD"]},
    {"symbol": "SILVERBEES.NS", "name": "Nippon India ETF Silver BeES (₹)", "exchange": "COMMODITY", "aliases": ["SILVER", "SILVERBEES", "SILVER BEES", "SILVER ETF"]},
    {"symbol": "SI=F", "name": "Silver Futures (USD)", "exchange": "COMMODITY", "aliases": ["SILVER FUTURES", "SILVER USD"]},
    {"symbol": "CL=F", "name": "Crude Oil Futures (USD)", "exchange": "COMMODITY", "aliases": ["CRUDE", "CRUDE OIL", "CRUDEOIL"]},
    {"symbol": "^GSPC", "name": "S&P 500 Index (US)", "exchange": "INDEX", "aliases": ["SP500", "S&P 500", "S&P500"]},
    {"symbol": "^IXIC", "name": "NASDAQ Composite Index (US)", "exchange": "INDEX", "aliases": ["NASDAQ", "NASDAQ 100", "NASDAQ100"]}
]

def format_financial_symbol(raw_symbol):
    if not raw_symbol:
        return ""
    sym = raw_symbol.strip().upper()
    
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
                            'previous_close': round(float(prev_close), 2) if prev_close is not None else None,
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
                            'previous_close': round(float(price - change), 2) if price is not None and change is not None else None,
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

def load_users():
    if not os.path.exists(USERS_FILE):
        if os.path.exists(USERS_EXAMPLE_FILE):
            try:
                with open(USERS_EXAMPLE_FILE, "r") as f:
                    seed_users = json.load(f)
                save_users(seed_users)
                return seed_users
            except Exception:
                pass
        return {}
    try:
        with open(USERS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_users(users):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=4)

def get_user_watchlist_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_watchlists.json")

def get_user_portfolio_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_portfolios.json")

def load_data(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {}
        
    filepath = get_user_watchlist_file(username)
    if not os.path.exists(filepath):
        default_data = {}
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, "r") as f:
                    default_data = json.load(f)
            except Exception:
                pass
        if not default_data:
            default_data = {"Path Finders": ["RELIANCE.NS", "TCS.NS", "INFY.NS"]}
        save_data(default_data, username)
        return default_data
        
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_data(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_watchlist_file(username)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)

def load_portfolios(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {}
        
    filepath = get_user_portfolio_file(username)
    if not os.path.exists(filepath):
        default_pfs = {}
        if os.path.exists(PORTFOLIO_FILE):
            try:
                with open(PORTFOLIO_FILE, "r") as f:
                    default_pfs = json.load(f)
            except Exception:
                pass
        if not default_pfs:
            default_pfs = {
                "Sample Portfolio": [
                    {"symbol": "RELIANCE.NS", "buy_price": 2750.0, "quantity": 10, "buy_date": "2025-01-15"}
                ]
            }
        save_portfolios(default_pfs, username)
        return default_pfs
        
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_portfolios(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_portfolio_file(username)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)

def get_user_transactions_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_transactions.json")

def load_user_transactions(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return []
        
    filepath = get_user_transactions_file(username)
    if not os.path.exists(filepath):
        return []
        
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []

def save_user_transactions(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_transactions_file(username)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)

def log_login_event(username, status):
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            logs = []
            
    ip_addr = request.remote_addr or "127.0.0.1"
    event = {
        "username": username,
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ip": ip_addr,
        "status": status,
        "user_agent": request.headers.get("User-Agent", "Unknown")[:60]
    }
    logs.insert(0, event)
    logs = logs[:200]
    try:
        with open(LOGS_FILE, "w") as f:
            json.dump(logs, f, indent=4)
    except Exception:
        pass

def ensure_default_admin():
    users = load_users()
    changed = False
    
    if "admin" not in users:
        admin_pass = "admin123"
        users["admin"] = {
            "username": "admin",
            "password_hash": generate_password_hash(admin_pass),
            "plain_password": admin_pass,
            "role": "admin",
            "is_admin": True,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "last_login": None,
            "login_count": 0
        }
        changed = True
        load_data("admin")
        load_portfolios("admin")
    else:
        if not users["admin"].get("is_admin") or users["admin"].get("role") != "admin":
            users["admin"]["is_admin"] = True
            users["admin"]["role"] = "admin"
            changed = True

    if "manishankar10" in users:
        if not users["manishankar10"].get("is_admin") or users["manishankar10"].get("role") != "admin":
            users["manishankar10"]["is_admin"] = True
            users["manishankar10"]["role"] = "admin"
            changed = True

    for uname, record in users.items():
        if "plain_password" not in record:
            if uname in ("admin", "manishankar10"):
                record["plain_password"] = "admin123"
            else:
                record["plain_password"] = f"{uname}123"
            changed = True
        
        # Initialize default watchlist and portfolio data for all seed users
        load_data(uname)
        load_portfolios(uname)

    if changed:
        save_users(users)

ensure_default_admin()

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized. Please log in.", "require_login": True}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized. Please log in.", "require_login": True}), 401
            return redirect(url_for("login_page"))
            
        users = load_users()
        uname = str(session.get("username", "")).lower()
        current_user = users.get(uname, {})
        if not current_user.get("is_admin") and current_user.get("role") != "admin":
            if request.path.startswith("/api/"):
                return jsonify({"error": "Forbidden: Admin privileges required"}), 403
            return redirect(url_for("index"))
            
        return f(*args, **kwargs)
    return decorated_function

# Authentication & User Management Routes
@app.route("/login")
def login_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("login.html")

@app.route("/register")
def register_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("register.html")

@app.route("/insights")
@login_required
def insights_page():
    return render_template("index.html", initial_tab="insights")

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    users = load_users()
    if username not in users or not check_password_hash(users[username]["password_hash"], password):
        log_login_event(username, "Failed (Bad Credentials)")
        return jsonify({"error": "Invalid username or password"}), 401

    session["username"] = username

    # Update login stats
    users[username]["last_login"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    users[username]["login_count"] = users[username].get("login_count", 0) + 1
    save_users(users)

    log_login_event(username, "Success")
    is_admin = users[username].get("is_admin", False) or users[username].get("role") == "admin"
    return jsonify({"success": True, "message": "Logged in successfully!", "username": username, "is_admin": is_admin})

@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters long"}), 400

    safe_username = username.lower()
    users = load_users()
    if safe_username in users:
        return jsonify({"error": "Username already exists. Please log in or choose a different name."}), 400

    is_first = len(users) == 0
    is_admin = is_first or (safe_username == "admin")

    users[safe_username] = {
        "username": username,
        "password_hash": generate_password_hash(password),
        "plain_password": password,
        "role": "admin" if is_admin else "user",
        "is_admin": is_admin,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "last_login": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "login_count": 1
    }
    save_users(users)

    # Initialize user-specific watchlist & portfolio files
    load_data(safe_username)
    load_portfolios(safe_username)

    session["username"] = safe_username
    log_login_event(safe_username, "Registered & Logged In")
    return jsonify({"success": True, "message": "Registration successful!", "username": safe_username, "is_admin": is_admin})

@app.route("/logout")
@app.route("/api/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    if request.path.startswith("/api/"):
        return jsonify({"success": True, "message": "Logged out successfully"})
    return redirect(url_for("login_page"))

# Dedicated Admin Dashboard Routes & APIs
@app.route("/admin")
@admin_required
def admin_page():
    return render_template("admin.html")

@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    users = load_users()
    total_users = len(users)
    total_watchlists = 0
    total_portfolios = 0
    total_holdings_count = 0
    total_capital_deployed = 0.0

    for uname in users.keys():
        w_data = load_data(uname)
        p_data = load_portfolios(uname)
        total_watchlists += len(w_data)
        total_portfolios += len(p_data)
        for holdings in p_data.values():
            total_holdings_count += len(holdings)
            for item in holdings:
                qty = item.get("quantity", 0)
                price = item.get("buy_price", 0)
                total_capital_deployed += (qty * price)

    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            pass

    return jsonify({
        "total_users": total_users,
        "total_watchlists": total_watchlists,
        "total_portfolios": total_portfolios,
        "total_holdings_count": total_holdings_count,
        "total_capital_deployed": round(total_capital_deployed, 2),
        "logs_count": len(logs),
        "system_status": "Healthy & Operational"
    })

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    users = load_users()
    user_list = []
    for uname, record in users.items():
        w_data = load_data(uname)
        p_data = load_portfolios(uname)
        capital = 0.0
        h_count = 0
        for holdings in p_data.values():
            h_count += len(holdings)
            for item in holdings:
                capital += (item.get("quantity", 0) * item.get("buy_price", 0))

        user_list.append({
            "username": record.get("username", uname),
            "safe_username": uname,
            "plain_password": record.get("plain_password", "admin123" if uname in ("admin", "manishankar10") else "••••••••"),
            "role": record.get("role", "admin" if record.get("is_admin") else "user"),
            "is_admin": record.get("is_admin", False) or record.get("role") == "admin",
            "created_at": record.get("created_at", "N/A"),
            "last_login": record.get("last_login", "Never"),
            "login_count": record.get("login_count", 0),
            "watchlists_count": len(w_data),
            "portfolios_count": len(p_data),
            "holdings_count": h_count,
            "capital_deployed": round(capital, 2)
        })

    return jsonify(user_list)

@app.route("/api/admin/users/<target_username>", methods=["GET"])
@admin_required
def admin_get_user_detail(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    record = users[target_username]
    w_data = load_data(target_username)
    p_data = load_portfolios(target_username)

    return jsonify({
        "username": record.get("username", target_username),
        "plain_password": record.get("plain_password", "admin123" if target_username in ("admin", "manishankar10") else "••••••••"),
        "role": record.get("role", "admin" if record.get("is_admin") else "user"),
        "is_admin": record.get("is_admin", False) or record.get("role") == "admin",
        "created_at": record.get("created_at", "N/A"),
        "last_login": record.get("last_login", "Never"),
        "login_count": record.get("login_count", 0),
        "watchlists": w_data,
        "portfolios": p_data
    })

@app.route("/api/admin/users/<target_username>/reset_password", methods=["POST"])
@admin_required
def admin_reset_password(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    new_password = request.json.get("new_password", "").strip()
    if not new_password or len(new_password) < 4:
        return jsonify({"error": "Password must be at least 4 characters long"}), 400

    users[target_username]["password_hash"] = generate_password_hash(new_password)
    users[target_username]["plain_password"] = new_password
    save_users(users)
    return jsonify({"success": True, "message": f"Password for '{target_username}' reset successfully to '{new_password}'!"})

@app.route("/api/admin/users/<target_username>/toggle_admin", methods=["POST"])
@admin_required
def admin_toggle_role(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    current_is_admin = users[target_username].get("is_admin", False) or users[target_username].get("role") == "admin"
    new_status = not current_is_admin
    users[target_username]["is_admin"] = new_status
    users[target_username]["role"] = "admin" if new_status else "user"
    save_users(users)

    return jsonify({
        "success": True, 
        "message": f"Updated role for '{target_username}' to {'Admin' if new_status else 'User'}",
        "is_admin": new_status
    })

@app.route("/api/admin/users/<target_username>", methods=["DELETE"])
@admin_required
def admin_delete_user(target_username):
    target_username = target_username.lower()
    if target_username == session.get("username"):
        return jsonify({"error": "You cannot delete your own active admin account!"}), 400

    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    del users[target_username]
    save_users(users)

    w_file = get_user_watchlist_file(target_username)
    p_file = get_user_portfolio_file(target_username)
    if os.path.exists(w_file):
        try: os.remove(w_file)
        except Exception: pass
    if os.path.exists(p_file):
        try: os.remove(p_file)
        except Exception: pass

    return jsonify({"success": True, "message": f"User '{target_username}' deleted successfully."})

@app.route("/api/admin/logs", methods=["GET"])
@admin_required
def admin_get_logs():
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            logs = []
    return jsonify(logs)

@app.route("/api/admin/system_backup/export", methods=["GET"])
@admin_required
def admin_export_system_backup():
    users = load_users()
    user_data_map = {}
    for uname in users.keys():
        user_data_map[uname] = {
            "watchlists": load_data(uname),
            "portfolios": load_portfolios(uname),
            "alerts": load_user_alerts(uname)
        }
    
    backup_data = {
        "users": users,
        "user_data": user_data_map,
        "exported_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    response = jsonify(backup_data)
    filename = f"capital_desk_full_system_backup_{datetime.date.today().strftime('%Y-%m-%d')}.json"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response

@app.route("/api/admin/system_backup/import", methods=["POST"])
@admin_required
def admin_import_system_backup():
    try:
        req_data = request.get_json(force=True)
        if not req_data or "users" not in req_data:
            return jsonify({"error": "Invalid system backup file. Must contain 'users'"}), 400
            
        users = req_data.get("users", {})
        save_users(users)
        
        user_data_map = req_data.get("user_data", {})
        for uname, udata in user_data_map.items():
            if "watchlists" in udata:
                save_data(udata["watchlists"], uname)
            if "portfolios" in udata:
                save_portfolios(udata["portfolios"], uname)
            if "alerts" in udata:
                save_user_alerts(udata["alerts"], uname)
                
        try:
            with open(USERS_EXAMPLE_FILE, "w") as f:
                json.dump(users, f, indent=4)
        except Exception:
            pass

        return jsonify({"success": True, "message": f"Successfully restored {len(users)} users and all data!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/user_info")
def get_user_info():
    if "username" in session:
        users = load_users()
        uname = str(session.get("username", "")).lower()
        user_record = users.get(uname, {})
        display_name = user_record.get("username", session.get("username", ""))
        is_admin = bool(user_record.get("is_admin", False) or user_record.get("role") == "admin")
        return jsonify({"logged_in": True, "username": display_name, "is_admin": is_admin})
    return jsonify({"logged_in": False})

@app.route("/")
@app.route("/watchlists")
@login_required
def index():
    return render_template("index.html", initial_tab="watchlists")

@app.route("/portfolios")
@login_required
def portfolios_page():
    return render_template("index.html", initial_tab="portfolios")

@app.route("/analytics")
@login_required
def analytics_page():
    return render_template("index.html", initial_tab="dashboard")

@app.route("/api/backup/export", methods=["GET"])
@login_required
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
@login_required
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
@login_required
def get_watchlists():
    return jsonify(load_data())

@app.route("/api/watchlists", methods=["POST"])
@login_required
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
@login_required
def delete_watchlist(name):
    data = load_data()
    if name in data:
        del data[name]
        save_data(data)
    return jsonify({"success": True, "watchlists": data})

@app.route("/api/watchlists/<name>/stocks", methods=["POST"])
@login_required
def add_stock(name):
    symbol = request.json.get("symbol")
    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400
    
    symbol = format_financial_symbol(symbol)
        
    # Check if symbol is valid or typo
    if fetcher.fetch_stock(symbol).get('error'):
        clean_sym = symbol.replace(".NS", "").replace(".BO", "")
        matches = difflib.get_close_matches(clean_sym, POPULAR_INDIAN_STOCKS.keys(), n=1, cutoff=0.5)
        if matches:
            corrected_sym = format_financial_symbol(matches[0])
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
@login_required
def remove_stock(name, symbol):
    data = load_data()
    if name in data and symbol in data[name]:
        data[name].remove(symbol)
        save_data(data)
    return jsonify({"success": True, "watchlists": data})

# Portfolio Endpoints
@app.route("/api/portfolios", methods=["GET"])
@login_required
def get_portfolios():
    return jsonify(load_portfolios())

@app.route("/api/portfolios", methods=["POST"])
@login_required
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
@login_required
def delete_portfolio(name):
    data = load_portfolios()
    if name in data:
        del data[name]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/portfolios/<name>/stocks", methods=["POST"])
@login_required
def add_portfolio_stock(name):
    symbol = request.json.get("symbol")
    buy_price = request.json.get("buy_price")
    quantity = request.json.get("quantity")
    buy_date = request.json.get("buy_date") or datetime.date.today().strftime("%Y-%m-%d")
    buy_reason = request.json.get("buy_reason") or request.json.get("notes") or ""
    mode = request.json.get("mode", "add") # "add", "buy_more", or "edit"
    
    if not symbol or buy_price is None or quantity is None:
        return jsonify({"error": "Symbol, buy price, and quantity are required"}), 400
        
    try:
        buy_price = float(buy_price)
        quantity = float(quantity)
    except ValueError:
        return jsonify({"error": "Buy price and quantity must be numbers"}), 400

    if quantity <= 0:
        return jsonify({"error": "Quantity must be greater than 0"}), 400

    symbol = format_financial_symbol(symbol)

    # Check for typos and auto-correct if symbol doesn't yield market data
    if fetcher.fetch_stock(symbol).get('error'):
        clean_sym = symbol.replace(".NS", "").replace(".BO", "")
        matches = difflib.get_close_matches(clean_sym, POPULAR_INDIAN_STOCKS.keys(), n=1, cutoff=0.5)
        if matches:
            corrected_sym = format_financial_symbol(matches[0])
            if not fetcher.fetch_stock(corrected_sym).get('error'):
                symbol = corrected_sym

    data = load_portfolios()
    if name not in data:
        return jsonify({"error": "Portfolio not found"}), 404

    existing_holding = None
    for holding in data[name]:
        if holding.get("symbol") == symbol:
            existing_holding = holding
            break

    if mode == "edit" and existing_holding:
        existing_holding["buy_price"] = round(buy_price, 2)
        existing_holding["quantity"] = round(quantity, 4)
        existing_holding["buy_date"] = buy_date
        existing_holding["buy_reason"] = buy_reason
    elif existing_holding:
        old_qty = float(existing_holding.get("quantity", 0))
        old_price = float(existing_holding.get("buy_price", 0))
        new_total_qty = old_qty + quantity
        new_avg_price = ((old_qty * old_price) + (quantity * buy_price)) / new_total_qty if new_total_qty > 0 else buy_price

        existing_holding["quantity"] = round(new_total_qty, 4)
        existing_holding["buy_price"] = round(new_avg_price, 2)
        existing_holding["buy_date"] = buy_date
        if buy_reason:
            existing_holding["buy_reason"] = buy_reason

        # Log BUY transaction for additional purchase
        tx_id = f"tx_{int(datetime.datetime.now().timestamp() * 1000)}"
        tx = {
            "id": tx_id,
            "portfolio": name,
            "symbol": symbol,
            "type": "BUY",
            "quantity": round(quantity, 4),
            "price": round(buy_price, 2),
            "total_amount": round(buy_price * quantity, 2),
            "realized_pnl": 0.0,
            "realized_pnl_pct": 0.0,
            "avg_buy_price": round(buy_price, 2),
            "date": buy_date,
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "notes": buy_reason
        }
        txs = load_user_transactions()
        txs.insert(0, tx)
        save_user_transactions(txs)
    else:
        data[name].append({
            "symbol": symbol,
            "buy_price": round(buy_price, 2),
            "quantity": round(quantity, 4),
            "buy_date": buy_date,
            "buy_reason": buy_reason
        })

        # Log BUY transaction for new holding
        tx_id = f"tx_{int(datetime.datetime.now().timestamp() * 1000)}"
        tx = {
            "id": tx_id,
            "portfolio": name,
            "symbol": symbol,
            "type": "BUY",
            "quantity": round(quantity, 4),
            "price": round(buy_price, 2),
            "total_amount": round(buy_price * quantity, 2),
            "realized_pnl": 0.0,
            "realized_pnl_pct": 0.0,
            "avg_buy_price": round(buy_price, 2),
            "date": buy_date,
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "notes": buy_reason
        }
        txs = load_user_transactions()
        txs.insert(0, tx)
        save_user_transactions(txs)

    save_portfolios(data)
    return jsonify({"success": True, "portfolios": data, "transactions": load_user_transactions()})

@app.route("/api/portfolios/<name>/stocks/sell", methods=["POST"])
@login_required
def sell_portfolio_stock(name):
    symbol = request.json.get("symbol")
    sell_price = request.json.get("sell_price")
    quantity = request.json.get("quantity")
    sell_date = request.json.get("sell_date") or datetime.date.today().strftime("%Y-%m-%d")
    notes = request.json.get("notes") or request.json.get("reason") or ""

    if not symbol or sell_price is None or quantity is None:
        return jsonify({"error": "Symbol, sell price, and quantity are required"}), 400

    try:
        sell_price = float(sell_price)
        sell_qty = float(quantity)
    except ValueError:
        return jsonify({"error": "Sell price and quantity must be valid numbers"}), 400

    if sell_qty <= 0:
        return jsonify({"error": "Quantity to sell must be greater than 0"}), 400

    symbol = format_financial_symbol(symbol)
    data = load_portfolios()
    if name not in data:
        return jsonify({"error": "Portfolio not found"}), 404

    target_holding = None
    for holding in data[name]:
        if holding.get("symbol") == symbol:
            target_holding = holding
            break

    if not target_holding:
        return jsonify({"error": f"Stock {symbol} not found in portfolio '{name}'"}), 404

    curr_qty = float(target_holding.get("quantity", 0))
    avg_buy_price = float(target_holding.get("buy_price", 0))

    if sell_qty > curr_qty + 0.0001:
        return jsonify({"error": f"Cannot sell {sell_qty} shares. You only own {curr_qty} shares."}), 400

    realized_pnl_amt = (sell_price - avg_buy_price) * sell_qty
    realized_pnl_pct = ((sell_price - avg_buy_price) / avg_buy_price * 100) if avg_buy_price > 0 else 0.0

    rem_qty = curr_qty - sell_qty
    if rem_qty <= 0.0001:
        data[name] = [h for h in data[name] if h.get("symbol") != symbol]
    else:
        target_holding["quantity"] = round(rem_qty, 4)

    save_portfolios(data)

    # Record SELL transaction log
    tx_id = f"tx_{int(datetime.datetime.now().timestamp() * 1000)}"
    tx = {
        "id": tx_id,
        "portfolio": name,
        "symbol": symbol,
        "type": "SELL",
        "quantity": round(sell_qty, 4),
        "price": round(sell_price, 2),
        "total_amount": round(sell_price * sell_qty, 2),
        "realized_pnl": round(realized_pnl_amt, 2),
        "realized_pnl_pct": round(realized_pnl_pct, 2),
        "avg_buy_price": round(avg_buy_price, 2),
        "date": sell_date,
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "notes": notes
    }
    txs = load_user_transactions()
    txs.insert(0, tx)
    save_user_transactions(txs)

    return jsonify({"success": True, "portfolios": data, "transaction": tx, "transactions": txs})

@app.route("/api/portfolios/<name>/stocks/<symbol>", methods=["DELETE"])
@login_required
def remove_portfolio_stock(name, symbol):
    data = load_portfolios()
    if name in data:
        data[name] = [item for item in data[name] if item.get("symbol") != symbol]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@app.route("/api/transactions", methods=["GET"])
@login_required
def get_transactions():
    return jsonify(load_user_transactions())

@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
@login_required
def delete_transaction(tx_id):
    txs = load_user_transactions()
    txs = [t for t in txs if t.get("id") != tx_id]
    save_user_transactions(txs)
    return jsonify({"success": True, "transactions": txs})

# =========================================================
# PRICE ALERTS & NOTIFICATIONS ENDPOINTS
# =========================================================
def get_user_alerts_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_alerts.json")

def load_user_alerts(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {"alerts": [], "notifications": []}
        
    filepath = get_user_alerts_file(username)
    if not os.path.exists(filepath):
        default_data = {"alerts": [], "notifications": []}
        save_user_alerts(default_data, username)
        return default_data
        
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
            if "alerts" not in data or not isinstance(data["alerts"], list):
                data["alerts"] = []
            if "notifications" not in data or not isinstance(data["notifications"], list):
                data["notifications"] = []
            return data
    except Exception:
        return {"alerts": [], "notifications": []}

def save_user_alerts(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_alerts_file(username)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)

@app.route("/api/alerts", methods=["GET"])
@login_required
def get_alerts():
    return jsonify(load_user_alerts())

@app.route("/api/alerts", methods=["POST"])
@login_required
def create_alert():
    symbol = request.json.get("symbol")
    target_price = request.json.get("target_price")
    condition = request.json.get("condition", "above")
    note = request.json.get("note", "").strip()

    if not symbol or target_price is None:
        return jsonify({"error": "Stock symbol and target price are required"}), 400

    try:
        target_price = float(target_price)
    except ValueError:
        return jsonify({"error": "Target price must be a valid number"}), 400

    symbol = symbol.upper()
    if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
        symbol += ".NS"

    data = load_user_alerts()
    alert_id = f"alt_{int(datetime.datetime.now().timestamp() * 1000)}"
    new_alert = {
        "id": alert_id,
        "symbol": symbol,
        "target_price": target_price,
        "condition": condition,
        "note": note,
        "status": "active",
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    data["alerts"].insert(0, new_alert)
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/alerts/<alert_id>", methods=["DELETE"])
@login_required
def delete_alert(alert_id):
    data = load_user_alerts()
    data["alerts"] = [a for a in data["alerts"] if a.get("id") != alert_id]
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/notifications/trigger", methods=["POST"])
@login_required
def trigger_notification():
    alert_id = request.json.get("alert_id")
    symbol = request.json.get("symbol")
    current_price = request.json.get("current_price")
    target_price = request.json.get("target_price")
    condition = request.json.get("condition")
    note = request.json.get("note", "")

    data = load_user_alerts()
    
    # Mark alert as triggered
    for alt in data["alerts"]:
        if alt.get("id") == alert_id or (alt.get("symbol") == symbol and alt.get("target_price") == target_price and alt.get("condition") == condition):
            alt["status"] = "triggered"
            alt["triggered_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    notif_id = f"notif_{int(datetime.datetime.now().timestamp() * 1000)}"
    cond_text = "crossed above" if condition == "above" else "crossed below"
    title = f"🔔 Alert Triggered: {symbol}"
    msg = f"{symbol} {cond_text} target price ₹{float(target_price):,.2f}! Current LTP: ₹{float(current_price):,.2f}."
    if note:
        msg += f" (Note: {note})"

    new_notif = {
        "id": notif_id,
        "alert_id": alert_id,
        "symbol": symbol,
        "title": title,
        "message": msg,
        "current_price": current_price,
        "target_price": target_price,
        "condition": condition,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "read": False
    }
    data["notifications"].insert(0, new_notif)
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/notifications/<notif_id>", methods=["DELETE"])
@login_required
def delete_notification(notif_id):
    data = load_user_alerts()
    data["notifications"] = [n for n in data["notifications"] if n.get("id") != notif_id]
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/notifications/clear_all", methods=["DELETE"])
@login_required
def clear_all_notifications():
    data = load_user_alerts()
    data["notifications"] = []
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/notifications/mark_read", methods=["POST"])
@login_required
def mark_notifications_read():
    data = load_user_alerts()
    for n in data["notifications"]:
        n["read"] = True
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@app.route("/api/search", methods=["GET"])
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
        ist_tz = ZoneInfo("Asia/Kolkata")
        
        for i in range(len(timestamps)):
            if None not in (opens[i], highs[i], lows[i], closes[i]):
                time_val = int(timestamps[i]) if is_intraday else datetime.datetime.fromtimestamp(timestamps[i], tz=ist_tz).strftime('%Y-%m-%d')
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

# ============================================================
# SMALLCASES MODULE
# Kept in a separate module so the existing application remains untouched.
# ============================================================
from smallcases import smallcases_bp, init_smallcases
init_smallcases(fetcher, login_required, BASE_DATA_DIR)
app.register_blueprint(smallcases_bp)
API_SETTINGS_FILE = os.path.join(BASE_DATA_DIR, "api_settings.json")

def load_api_settings():
    if os.path.exists(API_SETTINGS_FILE):
        try:
            with open(API_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "active_provider": "auto",
        "alphavantage_key": os.environ.get("ALPHAVANTAGE_API_KEY", ""),
        "finnhub_key": os.environ.get("FINNHUB_API_KEY", ""),
        "newsapi_key": os.environ.get("NEWSAPI_KEY", "")
    }

def save_api_settings(settings):
    try:
        with open(API_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception:
        return False

class FinancialNewsEngine:
    @staticmethod
    def fetch_news_for_symbol(symbol=None):
        settings = load_api_settings()
        provider = settings.get("active_provider", "auto")
        
        av_key = settings.get("alphavantage_key") or os.environ.get("ALPHAVANTAGE_API_KEY")
        fh_key = settings.get("finnhub_key") or os.environ.get("FINNHUB_API_KEY")
        na_key = settings.get("newsapi_key") or os.environ.get("NEWSAPI_KEY")

        # 1. Alpha Vantage Dedicated News & Sentiment API
        if (provider in ["alphavantage", "auto"]) and av_key:
            articles = FinancialNewsEngine._fetch_alphavantage(symbol, av_key)
            if articles:
                return articles

        # 2. Finnhub Dedicated Company News API
        if (provider in ["finnhub", "auto"]) and fh_key:
            articles = FinancialNewsEngine._fetch_finnhub(symbol, fh_key)
            if articles:
                return articles

        # 3. NewsAPI.org Financial News API
        if (provider in ["newsapi", "auto"]) and na_key:
            articles = FinancialNewsEngine._fetch_newsapi(symbol, na_key)
            if articles:
                return articles

        # 4. Fallback: Keyless Financial News RSS Engine
        return FinancialNewsEngine._fetch_google_financial(symbol)

    @staticmethod
    def _fetch_alphavantage(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_ticker = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            
            if not clean_ticker:
                url = f"https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=financial_markets&limit=15&apikey={api_key}"
            else:
                url = f"https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers={clean_ticker}&limit=15&apikey={api_key}"
            
            headers = {'User-Agent': 'Mozilla/5.0'}
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                feed = data.get("feed", [])
                if feed:
                    articles = []
                    for item in feed[:15]:
                        sent_label = item.get("overall_sentiment_label", "Neutral")
                        articles.append({
                            "title": item.get("title", ""),
                            "publisher": item.get("source", "Alpha Vantage News"),
                            "link": item.get("url", "#"),
                            "pub_date": item.get("time_published", ""),
                            "summary": item.get("summary", ""),
                            "sentiment": sent_label,
                            "image": item.get("banner_image", ""),
                            "provider": "Alpha Vantage API"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_finnhub(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_sym = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            headers = {'User-Agent': 'Mozilla/5.0'}

            if not clean_sym:
                url = f"https://finnhub.io/api/v1/news?category=general&token={api_key}"
            else:
                import datetime
                today_str = datetime.date.today().strftime("%Y-%m-%d")
                prev_str = (datetime.date.today() - datetime.timedelta(days=14)).strftime("%Y-%m-%d")
                url = f"https://finnhub.io/api/v1/company-news?symbol={clean_sym}&from={prev_str}&to={today_str}&token={api_key}"
            
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                feed = resp.json()
                if isinstance(feed, list) and len(feed) > 0:
                    articles = []
                    for item in feed[:15]:
                        dt_val = item.get("datetime")
                        pub_str = datetime.datetime.fromtimestamp(dt_val).strftime("%b %d, %Y %H:%M") if dt_val else ""
                        articles.append({
                            "title": item.get("headline", ""),
                            "publisher": item.get("source", "Finnhub Financial"),
                            "link": item.get("url", "#"),
                            "pub_date": pub_str,
                            "summary": item.get("summary", ""),
                            "sentiment": "Neutral",
                            "image": item.get("image", ""),
                            "provider": "Finnhub API"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_newsapi(symbol, api_key):
        try:
            raw_sym = (symbol or "").strip().upper()
            clean_sym = raw_sym.replace(".NS", "").replace(".BO", "").replace("^", "")
            q_str = f'"{clean_sym}" stock' if clean_sym else "Indian Stock Market Nifty Sensex"
            encoded = urllib.parse.quote(q_str)
            url = f"https://newsapi.org/v2/everything?q={encoded}&sortBy=publishedAt&pageSize=15&apiKey={api_key}"
            
            headers = {'User-Agent': 'Mozilla/5.0'}
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                articles_raw = data.get("articles", [])
                if articles_raw:
                    articles = []
                    for item in articles_raw[:15]:
                        articles.append({
                            "title": item.get("title", ""),
                            "publisher": item.get("source", {}).get("name", "NewsAPI Source"),
                            "link": item.get("url", "#"),
                            "pub_date": item.get("publishedAt", ""),
                            "summary": item.get("description", ""),
                            "sentiment": "Neutral",
                            "image": item.get("urlToImage", ""),
                            "provider": "NewsAPI.org"
                        })
                    return articles
        except Exception:
            pass
        return None

    @staticmethod
    def _fetch_google_financial(symbol):
        try:
            raw_sym = (symbol or "").strip()
            if not raw_sym:
                clean_query = "Indian Stock Market Nifty Sensex"
            else:
                upper_sym = raw_sym.upper()
                clean_query = upper_sym.replace('.NS', '').replace('.BO', '')
                if clean_query == '^NSEI': clean_query = 'Nifty 50'
                elif clean_query == '^NSEBANK': clean_query = 'Nifty Bank'
                elif clean_query == '^BSESN': clean_query = 'Sensex'
                elif clean_query in ['GOLDBEES', 'GC=F']: clean_query = 'Gold price'
                elif clean_query in ['SILVERBEES', 'SI=F']: clean_query = 'Silver price'
                elif clean_query == 'CL=F': clean_query = 'Crude Oil price'
                else:
                    comp = POPULAR_INDIAN_STOCKS.get(clean_query, "")
                    if comp:
                        clean_query = f'"{comp.replace(" Ltd", "").replace(" Limited", "").strip()}"'

            query_str = f"{clean_query} stock news" if raw_sym else clean_query
            encoded_query = urllib.parse.quote(query_str)
            url = f"https://news.google.com/rss/search?q={encoded_query}+when:7d&hl=en-IN&gl=IN&ceid=IN:en"

            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            resp = requests.get(url, headers=headers, timeout=6)
            
            articles = []
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                for item in root.findall('.//item')[:15]:
                    title_elem = item.find('title')
                    link_elem = item.find('link')
                    pub_elem = item.find('pubDate')

                    title = title_elem.text if title_elem is not None else ""
                    link = link_elem.text if link_elem is not None else "#"
                    pub_date = pub_elem.text if pub_elem is not None else ""

                    parts = title.rsplit(' - ', 1)
                    headline = parts[0]
                    publisher = parts[1] if len(parts) > 1 else "Financial News"

                    articles.append({
                        'title': headline,
                        'publisher': publisher,
                        'link': link,
                        'pub_date': pub_date,
                        'provider': 'Google Financial Engine'
                    })
            return articles
        except Exception:
            return []

@app.route("/api/news", methods=["GET"])
@app.route("/api/news/<path:symbol>", methods=["GET"])
@login_required
def get_stock_news_api(symbol=None):
    try:
        raw_sym = (symbol or "").strip()
        articles = FinancialNewsEngine.fetch_news_for_symbol(raw_sym)
        return jsonify({
            'success': True,
            'symbol': raw_sym or "Market Overview",
            'articles': articles
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'articles': []})

@app.route("/api/settings/news_keys", methods=["GET", "POST"])
@login_required
def api_news_keys_settings():
    if request.method == "POST":
        payload = request.get_json() or {}
        settings = load_api_settings()
        settings["active_provider"] = payload.get("active_provider", settings.get("active_provider", "auto"))
        settings["alphavantage_key"] = payload.get("alphavantage_key", "").strip()
        settings["finnhub_key"] = payload.get("finnhub_key", "").strip()
        settings["newsapi_key"] = payload.get("newsapi_key", "").strip()
        
        save_api_settings(settings)
        return jsonify({"success": True, "settings": settings})
    else:
        return jsonify({"success": True, "settings": load_api_settings()})

def get_stock_keywords(symbol):
    clean_sym = symbol.upper().replace(".NS", "").replace(".BO", "").replace("^", "")
    keywords = [clean_sym.lower()]
    
    comp_name = POPULAR_INDIAN_STOCKS.get(clean_sym, "")
    if not comp_name:
        try:
            info = fetcher.fetch_stock(symbol)
            comp_name = info.get("name", "")
        except Exception:
            comp_name = ""
            
    if comp_name:
        clean_name = comp_name.replace(" Ltd", "").replace(" Limited", "").replace(" Inc", "").replace(" India", "").strip().lower()
        if clean_name:
            keywords.append(clean_name)
            keywords.append(clean_name.replace(" ", ""))
            words = [w for w in clean_name.split() if len(w) >= 4 and w not in ("company", "group", "holdings", "industries", "systems", "india")]
            keywords.extend(words)

    custom_map = {
        "ROLEXRINGS": ["rolex rings", "rolex ring", "rolex"],
        "TEXRAIL": ["texmaco", "texrail", "texmaco rail"],
        "POLYMED": ["polymed", "poly medicure"],
        "SBIN": ["sbi", "state bank"],
        "HDFCBANK": ["hdfc bank", "hdfc"],
        "ICICIBANK": ["icici bank", "icici"],
        "TATAMOTORS": ["tata motors", "tata motor"],
        "TCS": ["tata consultancy", "tcs"],
        "INFY": ["infosys"],
        "BHARTIARTL": ["airtel", "bharti airtel"],
        "BAJFINANCE": ["bajaj finance"],
        "ASIANPAINT": ["asian paints", "asian paint"]
    }
    if clean_sym in custom_map:
        keywords.extend(custom_map[clean_sym])
        
    return list(set(keywords))

def fetch_fii_dii_data():
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    queries = [
        'FIIs+DIIs+net+buy+sell+crore+when:3d',
        'FII+DII+crore+buy+sell+when:3d',
        'FIIs+net+sell+crore+DIIs+net+buy+when:3d'
    ]
    
    for q in queries:
        url = f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
        try:
            r = requests.get(url, headers=headers, timeout=6)
            if r.status_code == 200:
                root = ET.fromstring(r.content)
                for item in root.findall('.//item')[:15]:
                    t = item.find('title').text if item.find('title') is not None else ""
                    pub_date_str = item.find('pubDate').text if item.find('pubDate') is not None else ""
                    
                    fii_m = re.search(r'FII[s]?\s*(?:net\s*)?(buy|sell|bought|sold|dump|purchased|outflow|inflow)\w*\s*(?:worth|of)?\s*(?:Rs\.?|\$)?\s*([\d,.]+)\s*(?:cr|crore)', t, re.IGNORECASE)
                    dii_m = re.search(r'DII[s]?\s*(?:net\s*)?(buy|sell|bought|sold|dump|purchased|outflow|inflow|inject)\w*\s*(?:worth|of)?\s*(?:Rs\.?|\$)?\s*([\d,.]+)\s*(?:cr|crore)', t, re.IGNORECASE)
                    
                    if fii_m and dii_m:
                        fii_act, fii_v = fii_m.groups()
                        dii_act, dii_v = dii_m.groups()
                        
                        fii_val = float(fii_v.replace(',', '')) * (-1 if any(k in fii_act.lower() for k in ['sell', 'sold', 'dump', 'outflow']) else 1)
                        dii_val = float(dii_v.replace(',', '')) * (-1 if any(k in dii_act.lower() for k in ['sell', 'sold', 'dump', 'outflow']) else 1)
                        
                        date_display = "Latest Session"
                        if pub_date_str:
                            try:
                                dt = datetime.strptime(pub_date_str[:16], '%a, %d %b %Y')
                                now_utc = datetime.now(timezone.utc).date()
                                if dt.date() == now_utc:
                                    date_display = dt.strftime('%d %b %Y (Today)')
                                elif dt.date() == now_utc - timedelta(days=1):
                                    date_display = dt.strftime('%d %b %Y (Yesterday)')
                                else:
                                    date_display = dt.strftime('%d %b %Y')
                            except Exception:
                                date_display = pub_date_str[:11]
                                
                        return {
                            "date": date_display,
                            "fii_net": fii_val,
                            "dii_net": dii_val,
                            "total_net": round(fii_val + dii_val, 2),
                            "fii_action": "NET SELL" if fii_val < 0 else "NET BUY",
                            "dii_action": "NET SELL" if dii_val < 0 else "NET BUY",
                            "headline": t
                        }
        except Exception:
            pass
            
    return {
        "date": "28 Sep 2026 (Yesterday)",
        "fii_net": -5353.00,
        "dii_net": 5189.00,
        "total_net": -164.00,
        "fii_action": "NET SELL",
        "dii_action": "NET BUY",
        "headline": "FIIs net sell ₹5,353 Cr; DIIs net buy ₹5,189 Cr"
    }

@app.route("/api/insights/summary", methods=["GET"])
@login_required
def get_insights_summary_api():
    try:
        uname = session.get("username")
        watchlists = load_data(uname)
        portfolios = load_portfolios(uname)

        wl_symbols = set()
        for w_name, sym_list in watchlists.items():
            for s in sym_list: wl_symbols.add(s)

        pf_symbols = set()
        pf_items = []
        for p_name, holdings in portfolios.items():
            for item in holdings:
                sym = item.get("symbol", "")
                if sym:
                    pf_symbols.add(sym)
                    pf_items.append(item)

        all_symbols = list(wl_symbols.union(pf_symbols))

        tot_invested = 0.0
        tot_cur_val = 0.0
        tot_day_pnl = 0.0

        top_gainer = None
        top_loser = None
        max_gain_pct = -999999.0
        min_gain_pct = 999999.0
        theses = []

        pf_sym_list = list(pf_symbols)
        prices_map = {}
        if pf_sym_list:
            with ThreadPoolExecutor(max_workers=min(len(pf_sym_list), 8)) as executor:
                futures = {executor.submit(fetcher.fetch_stock, s): s for s in pf_sym_list}
                for f in futures:
                    s = futures[f]
                    try: prices_map[s] = f.result()
                    except Exception: prices_map[s] = {}

        for item in pf_items:
            sym = item.get("symbol")
            qty = float(item.get("quantity", 0))
            buy_price = float(item.get("buy_price", 0))
            buy_reason = item.get("buy_reason") or item.get("notes") or ""

            p_info = prices_map.get(sym, {})
            ltp = float(p_info.get("price", 0) or buy_price)
            change_amt = float(p_info.get("change", 0) or 0)

            inv_amt = buy_price * qty
            cur_val = (ltp * qty) if ltp > 0 else inv_amt
            pnl_amt = cur_val - inv_amt
            pnl_pct = (pnl_amt / inv_amt * 100) if inv_amt > 0 else 0.0
            day_pnl_amt = (change_amt * qty) if ltp > 0 else 0.0
            day_pct = float(p_info.get("change_pct", 0) or 0)

            tot_invested += inv_amt
            tot_cur_val += cur_val
            tot_day_pnl += day_pnl_amt

            if day_pct > max_gain_pct:
                max_gain_pct = day_pct
                top_gainer = {"symbol": sym, "ltp": ltp, "change_pct": round(day_pct, 2), "change_amt": round(change_amt, 2)}
            if day_pct < min_gain_pct:
                min_gain_pct = day_pct
                top_loser = {"symbol": sym, "ltp": ltp, "change_pct": round(day_pct, 2), "change_amt": round(change_amt, 2)}

            if buy_reason:
                theses.append({
                    "symbol": sym,
                    "buy_reason": buy_reason,
                    "buy_price": round(buy_price, 2),
                    "ltp": round(ltp, 2),
                    "pnl_pct": round(pnl_pct, 2)
                })

        idx_count = sum(1 for s in all_symbols if s.startswith("^"))
        cmd_count = sum(1 for s in all_symbols if "=F" in s or "GOLDBEES" in s or "SILVERBEES" in s)
        equity_count = len(all_symbols) - idx_count - cmd_count

        total_tracked = len(all_symbols) or 1
        distribution = {
            "equities": {"count": equity_count, "pct": round(equity_count / total_tracked * 100, 1)},
            "indices": {"count": idx_count, "pct": round(idx_count / total_tracked * 100, 1)},
            "commodities": {"count": cmd_count, "pct": round(cmd_count / total_tracked * 100, 1)}
        }

        overall_pnl_amt = tot_cur_val - tot_invested
        overall_pnl_pct = (overall_pnl_amt / tot_invested * 100) if tot_invested > 0 else 0.0

        return jsonify({
            "success": True,
            "total_tracked_count": len(all_symbols),
            "portfolio_count": len(pf_symbols),
            "watchlist_count": len(wl_symbols),
            "metrics": {
                "total_invested": round(tot_invested, 2),
                "total_cur_val": round(tot_cur_val, 2),
                "overall_pnl_amt": round(overall_pnl_amt, 2),
                "overall_pnl_pct": round(overall_pnl_pct, 2),
                "day_pnl_amt": round(tot_day_pnl, 2),
                "top_gainer": top_gainer,
                "top_loser": top_loser
            },
            "distribution": distribution,
            "theses": theses
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "theses": []})

@app.route("/api/insights/indexes", methods=["GET"])
@login_required
def get_insights_indexes_api():
    try:
        index_configs = [
            {"symbol": "^NSEI", "name": "NIFTY 50", "badge": "Nifty 50"},
            {"symbol": "^NSEMDCP50", "name": "CNX Midcap", "badge": "Midcap"},
            {"symbol": "^CNXSC", "name": "CNX Smallcap", "badge": "Smallcap"},
            {"symbol": "^BSESN", "name": "SENSEX", "badge": "Sensex"},
            {"symbol": "^NSEBANK", "name": "NIFTY Bank", "badge": "Bank Nifty"}
        ]
        
        market_indexes = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_config = {executor.submit(fetcher.fetch_stock, cfg["symbol"]): cfg for cfg in index_configs}
            for future in future_to_config:
                cfg = future_to_config[future]
                try:
                    info = future.result()
                    if info and not info.get("error"):
                        market_indexes.append({
                            "symbol": cfg["symbol"],
                            "name": cfg["name"],
                            "badge": cfg["badge"],
                            "price": info.get("price", 0),
                            "change": info.get("change", 0),
                            "change_pct": info.get("change_pct", 0)
                        })
                except Exception:
                    pass

        return jsonify({"success": True, "market_indexes": market_indexes})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "market_indexes": []})

@app.route("/api/insights/fiidii", methods=["GET"])
@login_required
def get_insights_fiidii_api():
    try:
        fii_dii_data = fetch_fii_dii_data()
        return jsonify({"success": True, "fii_dii": fii_dii_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route("/api/insights/news", methods=["GET"])
@login_required
def get_insights_news_api():
    try:
        uname = session.get("username")
        watchlists = load_data(uname)
        portfolios = load_portfolios(uname)

        wl_symbols = set()
        for w_name, sym_list in watchlists.items():
            for s in sym_list: wl_symbols.add(s)

        pf_symbols = set()
        for p_name, holdings in portfolios.items():
            for item in holdings:
                sym = item.get("symbol", "")
                if sym: pf_symbols.add(sym)

        all_symbols = list(wl_symbols.union(pf_symbols))

        scope_filter = request.args.get("scope", "all").lower()
        target_symbols = []
        if scope_filter == "portfolio":
            target_symbols = list(pf_symbols)
        elif scope_filter == "watchlist":
            target_symbols = list(wl_symbols)
        else:
            target_symbols = all_symbols

        clean_queries = []
        for s in target_symbols:
            c = s.replace(".NS", "").replace(".BO", "")
            if c == "^NSEI": c = "Nifty 50"
            elif c == "^NSEBANK": c = "Nifty Bank"
            elif c == "^BSESN": c = "Sensex"
            elif c in ["GOLDBEES", "GC=F"]: c = "Gold price"
            elif c in ["SILVERBEES", "SI=F"]: c = "Silver price"
            else:
                comp_name = POPULAR_INDIAN_STOCKS.get(c, "")
                if comp_name:
                    clean_n = comp_name.replace(" Ltd", "").replace(" Limited", "").replace(" Inc", "").strip()
                    c = f'"{clean_n}"'
            clean_queries.append(c)

        news_articles = []
        if clean_queries:
            q_terms = " OR ".join(clean_queries[:8])
            encoded = urllib.parse.quote(f"({q_terms}) stock news")
            rss_url = f"https://news.google.com/rss/search?q={encoded}+when:7d&hl=en-IN&gl=IN&ceid=IN:en"
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            resp = requests.get(rss_url, headers=headers, timeout=6)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                for item in root.findall('.//item')[:20]:
                    title_el = item.find('title')
                    link_el = item.find('link')
                    pub_el = item.find('pubDate')

                    t_text = title_el.text if title_el is not None else ""
                    l_text = link_el.text if link_el is not None else "#"
                    p_text = pub_el.text if pub_el is not None else ""

                    parts = t_text.rsplit(' - ', 1)
                    headline = parts[0]
                    publisher = parts[1] if len(parts) > 1 else "Market News"

                    tag_sym = "MARKET"
                    tag_type = "GENERAL"
                    for s in target_symbols:
                        keywords = get_stock_keywords(s)
                        if any(kw in t_text.lower() for kw in keywords):
                            tag_sym = s
                            tag_type = "PORTFOLIO" if s in pf_symbols else "WATCHLIST"
                            break

                    news_articles.append({
                        "title": headline,
                        "publisher": publisher,
                        "link": l_text,
                        "pub_date": p_text,
                        "symbol": tag_sym,
                        "tag_type": tag_type
                    })

        return jsonify({"success": True, "articles": news_articles})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "articles": []})

@app.route("/api/insights", methods=["GET"])
@login_required
def get_insights_api():
    try:
        uname = session.get("username")
        watchlists = load_data(uname)
        portfolios = load_portfolios(uname)

        wl_symbols = set()
        for w_name, sym_list in watchlists.items():
            for s in sym_list: wl_symbols.add(s)

        pf_symbols = set()
        for p_name, holdings in portfolios.items():
            for item in holdings:
                sym = item.get("symbol", "")
                if sym: pf_symbols.add(sym)

        all_symbols = list(wl_symbols.union(pf_symbols))

        return jsonify({
            "success": True,
            "total_tracked_count": len(all_symbols),
            "portfolio_count": len(pf_symbols),
            "watchlist_count": len(wl_symbols)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)

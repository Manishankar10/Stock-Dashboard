import os
import json
from modules.common.ist_datetime import format_ist_display, now_ist

try:
    from modules.app_config import load_local_environment
    load_local_environment()
except Exception:
    pass

_MONGO_URI = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
db = None

if _MONGO_URI:
    try:
        from pymongo import MongoClient
        # 5 second timeout so app boots quickly even if Mongo is slow
        _client = MongoClient(_MONGO_URI, serverSelectionTimeoutMS=5000)
        _client.admin.command('ping')
        db = _client.get_database("capital_desk")
        print(" Successfully connected to MongoDB Atlas!")
    except Exception as e:
        print(f" MongoDB Atlas connection error: {e}")
        db = None

def load_users_db(users_file, example_file):
    if db is not None:
        try:
            users_col = db["users"]
            docs = list(users_col.find({}))
            if docs:
                users_map = {}
                for doc in docs:
                    uname = doc["_id"]
                    doc_copy = dict(doc)
                    doc_copy.pop("_id", None)
                    users_map[uname] = doc_copy
                return users_map
        except Exception as e:
            print(f"MongoDB load_users error: {e}")

    # Fallback to local JSON file
    if not os.path.exists(users_file):
        if os.path.exists(example_file):
            try:
                with open(example_file, "r") as f:
                    seed_users = json.load(f)
                save_users_db(seed_users, users_file)
                return seed_users
            except Exception:
                pass
        return {}
    try:
        with open(users_file, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_users_db(users, users_file):
    try:
        with open(users_file, "w") as f:
            json.dump(users, f, indent=4)
    except Exception:
        pass

    if db is not None:
        try:
            users_col = db["users"]
            for uname, udata in users.items():
                doc = dict(udata)
                doc["_id"] = uname
                users_col.replace_one({"_id": uname}, doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_users error: {e}")

def load_user_doc_db(collection_name, username, filepath, default_factory=dict):
    if db is not None and username:
        try:
            col = db[collection_name]
            safe_user = "".join(c for c in str(username) if c.isalnum() or c in ('_', '-')).lower()
            doc = col.find_one({"_id": safe_user})
            if doc is not None and "data" in doc:
                return doc["data"]
        except Exception as e:
            print(f"MongoDB load_{collection_name} error for {username}: {e}")

    if not os.path.exists(filepath):
        return default_factory()
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default_factory()

def save_user_doc_db(collection_name, username, data, filepath):
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        tmp = filepath + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, filepath)
    except Exception:
        pass

    if db is not None and username:
        try:
            col = db[collection_name]
            safe_user = "".join(c for c in str(username) if c.isalnum() or c in ('_', '-')).lower()
            col.replace_one({"_id": safe_user}, {"_id": safe_user, "username": username, "data": data}, upsert=True)
        except Exception as e:
            print(f"MongoDB save_{collection_name} error for {username}: {e}")

def load_system_settings_db(settings_file, default_factory=dict):
    # 1. MongoDB (if connected)
    if db is not None:
        try:
            col = db["system_settings"]
            doc = col.find_one({"_id": "global_settings"})
            if doc is not None:
                res = default_factory()
                if "settings" in doc and isinstance(doc["settings"], dict):
                    res.update(doc["settings"])
                else:
                    res.update({k: v for k, v in doc.items() if k != "_id"})
                return res
        except Exception as e:
            print(f"MongoDB load_system_settings error: {e}")

    # 2. SQLite DB (capital_desk.db)
    try:
        if os.path.exists(_SQLITE_DB_PATH):
            import sqlite3
            with sqlite3.connect(_SQLITE_DB_PATH) as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT)")
                row = conn.execute("SELECT value FROM system_settings WHERE key = 'global_settings'").fetchone()
                if row and row[0]:
                    res = default_factory()
                    loaded = json.loads(row[0])
                    if isinstance(loaded, dict):
                        res.update(loaded)
                        return res
    except Exception as e:
        print(f"SQLite load_system_settings error: {e}")

    # 3. Fallback to local JSON file
    if not os.path.exists(settings_file):
        return default_factory()
    try:
        with open(settings_file, "r", encoding="utf-8") as f:
            res = default_factory()
            loaded = json.load(f)
            if isinstance(loaded, dict):
                res.update(loaded)
            return res
    except Exception:
        return default_factory()

def save_system_settings_db(settings, settings_file):
    # 1. Save to local JSON file
    try:
        os.makedirs(os.path.dirname(settings_file), exist_ok=True)
        tmp = settings_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4, ensure_ascii=False)
        os.replace(tmp, settings_file)
    except Exception:
        pass

    # 2. Save to SQLite DB
    try:
        os.makedirs(os.path.dirname(_SQLITE_DB_PATH), exist_ok=True)
        import sqlite3
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT)")
            conn.execute(
                "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
                ('global_settings', json.dumps(settings, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_system_settings error: {e}")

    # 3. Save to MongoDB
    if db is not None:
        try:
            col = db["system_settings"]
            col.replace_one({"_id": "global_settings"}, {"_id": "global_settings", "settings": settings}, upsert=True)
        except Exception as e:
            print(f"MongoDB save_system_settings error: {e}")

import sqlite3

_SQLITE_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data", "capital_desk.db")

def _init_sqlite_db():
    try:
        os.makedirs(os.path.dirname(_SQLITE_DB_PATH), exist_ok=True)
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS technical_signals (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS technical_screener_hierarchy (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS technical_screener_info (
                    symbol TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS corporate_actions (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    last_updated TEXT,
                    last_updated_display TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS quarterly_results (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    last_updated TEXT,
                    last_updated_display TEXT,
                    total_records INTEGER DEFAULT 0,
                    metadata TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS industries_overview (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    last_updated TEXT,
                    last_updated_display TEXT,
                    total_industries INTEGER DEFAULT 0,
                    metadata TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shareholding_patterns (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    last_synced REAL,
                    last_synced_display TEXT,
                    total_records INTEGER DEFAULT 0,
                    count_equities INTEGER DEFAULT 0,
                    count_sme INTEGER DEFAULT 0,
                    metadata TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_alerts (
                    username TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transactions_deals (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    last_updated TEXT,
                    last_updated_display TEXT,
                    total_records INTEGER DEFAULT 0,
                    metadata TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS index_constituents (
                    index_key TEXT PRIMARY KEY,
                    index_name TEXT NOT NULL,
                    symbol TEXT,
                    official_size INTEGER DEFAULT 0,
                    stocks TEXT NOT NULL,
                    total_stocks INTEGER DEFAULT 0,
                    last_synced TEXT,
                    last_synced_display TEXT,
                    metadata TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS index_rebalance_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    timestamp_display TEXT NOT NULL,
                    total_entered INTEGER DEFAULT 0,
                    total_exited INTEGER DEFAULT 0,
                    enforce_official_size INTEGER DEFAULT 1,
                    changes_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trading_holidays (
                    holiday_id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    year INTEGER NOT NULL,
                    holiday_name TEXT NOT NULL,
                    day TEXT NOT NULL,
                    exchange TEXT DEFAULT 'NSE, BSE',
                    segment TEXT DEFAULT 'Capital Market (Equities)',
                    is_trading_holiday INTEGER DEFAULT 1,
                    is_clearing_holiday INTEGER DEFAULT 0,
                    morning_session TEXT,
                    evening_session TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_holidays_year ON trading_holidays(year)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_holidays_date ON trading_holidays(date)")
            # SQLite stock_closing_prices removed: all stock calculations execute purely from MongoDB
            conn.execute("DROP TABLE IF EXISTS stock_closing_prices")
            conn.execute("DROP TABLE IF EXISTS stock_closing_prices_telemetry")
            conn.commit()
    except Exception as e:
        print(f"SQLite init error: {e}")

def load_technical_signals_db(username="admin", default_factory=dict):
    """
    Load technical signals strictly and only from the database for the given user:
    1. Primary: MongoDB Atlas (if _MONGO_URI connected)
    2. Local: SQLite database 'user_data/capital_desk.db'
    """
    if isinstance(username, dict) or callable(username):
        default_factory = username
        username = "admin"

    safe_user = "".join(c for c in str(username or 'admin') if c.isalnum() or c in ('_', '-')).lower()
    doc_id = f"signals_{safe_user}"

    if db is not None:
        try:
            col = db["technical_signals"]
            doc = col.find_one({"_id": doc_id})
            if doc is not None and "data" in doc:
                return doc["data"]
            elif doc is not None and "scanners" in doc:
                res = dict(doc)
                res.pop("_id", None)
                return res
        except Exception as e:
            print(f"MongoDB load_technical_signals error for {username}: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM technical_signals WHERE id = ?", (doc_id,))
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
    except Exception as e:
        print(f"SQLite load_technical_signals error for {username}: {e}")

    return default_factory()

def save_technical_signals_db(data, username="admin"):
    """
    Save technical signals strictly and only in the database for the given user:
    1. Primary: MongoDB Atlas (if _MONGO_URI connected)
    2. Local: SQLite database 'user_data/capital_desk.db'
    """
    safe_user = "".join(c for c in str(username or 'admin') if c.isalnum() or c in ('_', '-')).lower()
    doc_id = f"signals_{safe_user}"

    if db is not None:
        try:
            col = db["technical_signals"]
            doc = {"_id": doc_id, "username": username, "data": data}
            col.replace_one({"_id": doc_id}, doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_technical_signals error for {username}: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO technical_signals (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (doc_id, json.dumps(data, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_technical_signals error for {username}: {e}")

# ==============================================================================
# TECHNICAL SCREENER - 2 COLLECTIONS ARCHITECTURE
# Collection 1: technical_screener_hierarchy (Global master categories & definitions)
# Collection 2: technical_screener_info (Symbol-keyed technical signals cache)
# ==============================================================================

def load_technical_screener_hierarchy_db():
    """
    Load master technical screener hierarchy from Collection 1: technical_screener_hierarchy.
    Primary: MongoDB Atlas (db['technical_screener_hierarchy'])
    Fallback: Local SQLite table
    """
    if db is not None:
        try:
            col = db["technical_screener_hierarchy"]
            doc = col.find_one({"_id": "hierarchy"})
            if doc is not None and "data" in doc:
                return doc["data"]
            elif doc is not None:
                res = dict(doc)
                res.pop("_id", None)
                return res
        except Exception as e:
            print(f"MongoDB load_technical_screener_hierarchy error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM technical_screener_hierarchy WHERE id = ?", ("hierarchy",))
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
    except Exception as e:
        print(f"SQLite load_technical_screener_hierarchy error: {e}")

    return None

def save_technical_screener_hierarchy_db(data):
    """
    Save master technical screener hierarchy to Collection 1: technical_screener_hierarchy.
    """
    if db is not None:
        try:
            col = db["technical_screener_hierarchy"]
            col.replace_one({"_id": "hierarchy"}, {"_id": "hierarchy", "data": data}, upsert=True)
        except Exception as e:
            print(f"MongoDB save_technical_screener_hierarchy error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO technical_screener_hierarchy (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                ("hierarchy", json.dumps(data, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_technical_screener_hierarchy error: {e}")

def load_technical_screener_info_db(symbols=None, timeframe=None):
    """
    Load stock technical info from Collection 2: technical_screener_info.
    If timeframe is provided ('daily', 'weekly', 'monthly'), returns dict scoped to that timeframe:
      { symbol: { scanners: { ... }, ltp: ..., change_pct: ..., ... } }
    If timeframe is None, returns complete document with all timeframes:
      { symbol: { "daily": {...}, "weekly": {...}, "monthly": {...} } }
    """
    results = {}
    tf_key = (timeframe or "").strip().lower() if timeframe else None

    if db is not None:
        try:
            col = db["technical_screener_info"]
            query = {}
            if symbols:
                query["_id"] = {"$in": [s.upper() for s in symbols]}
            docs = list(col.find(query))
            for doc in docs:
                sym = doc.get("_id") or doc.get("symbol")
                if sym:
                    clean_sym = sym.upper()
                    d = dict(doc)
                    d.pop("_id", None)
                    if tf_key:
                        if tf_key in d and isinstance(d[tf_key], dict):
                            tf_item = dict(d[tf_key])
                            tf_item["symbol"] = clean_sym
                            tf_item["name"] = d.get("name", clean_sym)
                            results[clean_sym] = tf_item
                        elif "scanners" in d and tf_key == "daily":
                            # Fallback for legacy flat doc
                            results[clean_sym] = d
                        else:
                            results[clean_sym] = {"symbol": clean_sym, "name": d.get("name", clean_sym), "scanners": {}}
                    else:
                        results[clean_sym] = d
            return results
        except Exception as e:
            print(f"MongoDB load_technical_screener_info error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            if symbols:
                sym_list = [s.upper() for s in symbols]
                placeholders = ",".join(["?"] * len(sym_list))
                cursor.execute(f"SELECT symbol, data FROM technical_screener_info WHERE symbol IN ({placeholders})", sym_list)
            else:
                cursor.execute("SELECT symbol, data FROM technical_screener_info")
            for row in cursor.fetchall():
                sym = row[0]
                if row[1]:
                    try:
                        clean_sym = sym.upper()
                        d = json.loads(row[1])
                        if tf_key:
                            if tf_key in d and isinstance(d[tf_key], dict):
                                tf_item = dict(d[tf_key])
                                tf_item["symbol"] = clean_sym
                                tf_item["name"] = d.get("name", clean_sym)
                                results[clean_sym] = tf_item
                            elif "scanners" in d and tf_key == "daily":
                                results[clean_sym] = d
                            else:
                                results[clean_sym] = {"symbol": clean_sym, "name": d.get("name", clean_sym), "scanners": {}}
                        else:
                            results[clean_sym] = d
                    except Exception:
                        pass
        return results
    except Exception as e:
        print(f"SQLite load_technical_screener_info error: {e}")

    return results

def batch_append_technical_screener_info_db(stock_updates, category_id="smart_scanners", timeframe="daily"):
    """
    Append/update calculated technical scanners for stocks in Collection 2: technical_screener_info.
    Structured by timeframe: stockname: { timeframe: { ltp, change_pct, volume, rsi, categories_scanned, scanners: { ... } } }
    Preserves all existing scanners previously calculated under other categories or timeframes.
    """
    if not stock_updates:
        return

    import datetime

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    tf = (timeframe or "daily").strip().lower()

    # 1. MongoDB Atlas update
    if db is not None:
        try:
            col = db["technical_screener_info"]
            for sym, item in stock_updates.items():
                clean_sym = sym.upper()
                update_fields = {
                    "symbol": clean_sym,
                    "name": item.get("name", clean_sym),
                    "updated_at": now_iso,
                    f"{tf}.ltp": item.get("ltp"),
                    f"{tf}.change_pct": item.get("change_pct"),
                    f"{tf}.volume": item.get("volume"),
                    f"{tf}.rsi": item.get("rsi"),
                    f"{tf}.updated_at": now_iso,
                    f"{tf}.categories_scanned.{category_id}": now_iso
                }
                new_scanners = item.get("new_scanners", {})
                for sc_id, sc_val in new_scanners.items():
                    update_fields[f"{tf}.scanners.{sc_id}"] = sc_val
                
                col.update_one({"_id": clean_sym}, {"$set": update_fields}, upsert=True)
        except Exception as e:
            print(f"MongoDB batch_append_technical_screener_info error: {e}")

    # 2. SQLite local update
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            for sym, item in stock_updates.items():
                clean_sym = sym.upper()
                cursor = conn.cursor()
                cursor.execute("SELECT data FROM technical_screener_info WHERE symbol = ?", (clean_sym,))
                row = cursor.fetchone()
                existing_doc = {}
                if row and row[0]:
                    try:
                        existing_doc = json.loads(row[0])
                    except Exception:
                        existing_doc = {}

                existing_doc["symbol"] = clean_sym
                existing_doc["name"] = item.get("name", existing_doc.get("name", clean_sym))
                existing_doc["updated_at"] = now_iso

                tf_doc = existing_doc.setdefault(tf, {})
                if item.get("ltp") is not None: tf_doc["ltp"] = item.get("ltp")
                if item.get("change_pct") is not None: tf_doc["change_pct"] = item.get("change_pct")
                if item.get("volume") is not None: tf_doc["volume"] = item.get("volume")
                if item.get("rsi") is not None: tf_doc["rsi"] = item.get("rsi")
                tf_doc["updated_at"] = now_iso

                cats = tf_doc.setdefault("categories_scanned", {})
                cats[category_id] = now_iso

                scanners_dict = tf_doc.setdefault("scanners", {})
                new_scanners = item.get("new_scanners", {})
                for sc_id, sc_val in new_scanners.items():
                    scanners_dict[sc_id] = sc_val

                conn.execute(
                    "INSERT OR REPLACE INTO technical_screener_info (symbol, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    (clean_sym, json.dumps(existing_doc, ensure_ascii=False))
                )
            conn.commit()
    except Exception as e:
        print(f"SQLite batch_append_technical_screener_info error: {e}")

def load_corporate_actions_db():
    """
    Loads latest corporate actions records from MongoDB Atlas collection 'corporate_actions'.
    Falls back to SQLite local storage if MongoDB is unavailable.
    """
    if db is not None:
        try:
            col = db["corporate_actions"]
            doc = col.find_one({"_id": "latest"})
            if doc and "categories" in doc:
                return {
                    "categories": doc.get("categories", {}),
                    "last_updated": doc.get("last_updated"),
                    "last_updated_display": doc.get("last_updated_display"),
                    "stats": doc.get("stats", {})
                }
        except Exception as e:
            print(f"MongoDB load_corporate_actions error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, last_updated, last_updated_display FROM corporate_actions WHERE id = 'latest'")
            row = cursor.fetchone()
            if row and row[0]:
                categories = json.loads(row[0])
                stats = {cat: len(items) for cat, items in categories.items() if isinstance(items, list)}
                stats["total"] = sum(stats.values())
                return {
                    "categories": categories,
                    "last_updated": row[1],
                    "last_updated_display": row[2],
                    "stats": stats
                }
    except Exception as e:
        print(f"SQLite load_corporate_actions error: {e}")

    return None

def save_corporate_actions_db(categories, last_updated_iso=None, last_updated_display=None):
    """
    Saves corporate actions categorized dictionary and timestamp to MongoDB Atlas collection 'corporate_actions'.
    Also syncs to SQLite local storage.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    last_updated_iso = last_updated_iso or now_utc.isoformat()
    last_updated_display = format_ist_display(last_updated_display)

    stats = {cat: len(items) for cat, items in categories.items() if isinstance(items, list)}
    stats["total"] = sum(stats.values())

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["corporate_actions"]
            col.update_one(
                {"_id": "latest"},
                {"$set": {
                    "categories": categories,
                    "last_updated": last_updated_iso,
                    "last_updated_display": last_updated_display,
                    "stats": stats,
                    "updated_at": last_updated_iso
                }},
                upsert=True
            )
        except Exception as e:
            print(f"MongoDB save_corporate_actions error: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO corporate_actions (id, data, last_updated, last_updated_display, updated_at) VALUES ('latest', ?, ?, ?, CURRENT_TIMESTAMP)",
                (json.dumps(categories, ensure_ascii=False), last_updated_iso, last_updated_display)
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_corporate_actions error: {e}")

    return {
        "last_updated": last_updated_iso,
        "last_updated_display": last_updated_display,
        "stats": stats
    }




# ==============================================================================
# QUARTERLY RESULTS DATABASE STORAGE (MONGODB ATLAS & SQLITE)
# ==============================================================================

def load_quarterly_results_db():
    """
    Loads latest quarterly results records from MongoDB Atlas collection 'quarterly_results'.
    Falls back to SQLite local storage if MongoDB is unavailable.
    """
    if db is not None:
        try:
            col = db["quarterly_results"]
            doc = col.find_one({"_id": "latest"})
            if doc and "data" in doc:
                return {
                    "data": doc.get("data", []),
                    "last_updated": doc.get("last_updated"),
                    "last_updated_display": doc.get("last_updated_display"),
                    "total_records": doc.get("total_records", len(doc.get("data", []))),
                    "metadata": doc.get("metadata", {})
                }
        except Exception as e:
            print(f"MongoDB load_quarterly_results error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, last_updated, last_updated_display, total_records, metadata FROM quarterly_results WHERE id = 'latest'")
            row = cursor.fetchone()
            if row and row[0]:
                data = json.loads(row[0])
                meta = json.loads(row[4]) if (len(row) > 4 and row[4]) else {}
                return {
                    "data": data,
                    "last_updated": row[1],
                    "last_updated_display": row[2],
                    "total_records": row[3] or len(data),
                    "metadata": meta
                }
    except Exception as e:
        print(f"SQLite load_quarterly_results error: {e}")

    return None


def save_quarterly_results_db(records, last_updated_iso=None, last_updated_display=None, metadata=None):
    """
    Saves quarterly results list and timestamp to MongoDB Atlas collection 'quarterly_results'.
    Also syncs to SQLite local storage 'quarterly_results' table.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    last_updated_iso = last_updated_iso or now_utc.isoformat()
    last_updated_display = format_ist_display(last_updated_display)
    total_records = len(records)
    metadata = metadata or {}

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["quarterly_results"]
            col.update_one(
                {"_id": "latest"},
                {"$set": {
                    "data": records,
                    "total_records": total_records,
                    "last_updated": last_updated_iso,
                    "last_updated_display": last_updated_display,
                    "metadata": metadata,
                    "updated_at": last_updated_iso
                }},
                upsert=True
            )
        except Exception as e:
            print(f"MongoDB save_quarterly_results error: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO quarterly_results (id, data, last_updated, last_updated_display, total_records, metadata, updated_at) VALUES ('latest', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (json.dumps(records, ensure_ascii=False), last_updated_iso, last_updated_display, total_records, json.dumps(metadata, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_quarterly_results error: {e}")

    return {
        "success": True,
        "last_updated": last_updated_iso,
        "last_updated_display": last_updated_display,
        "total_records": total_records,
        "metadata": metadata
    }


# ==============================================================================
# INDUSTRIES OVERVIEW DATABASE STORAGE (MONGODB ATLAS & SQLITE)
# ==============================================================================

def load_industries_overview_db(fallback_filepath=None):
    """
    Loads latest industries overview dataset from MongoDB Atlas collection 'industries_overview'.
    Falls back to SQLite local storage if MongoDB is unavailable.
    If neither DB has data yet, checks disk JSON file, auto-seeds the DB, and returns data.
    """
    # 1. Try MongoDB Atlas
    if db is not None:
        try:
            col = db["industries_overview"]
            doc = col.find_one({"_id": "latest"})
            if doc and "data" in doc:
                return {
                    "data": doc.get("data", {}),
                    "last_updated": doc.get("last_updated"),
                    "last_updated_display": doc.get("last_updated_display"),
                    "total_industries": doc.get("total_industries", 0),
                    "metadata": doc.get("metadata", {})
                }
        except Exception as e:
            print(f"MongoDB load_industries_overview error: {e}")

    # 2. Try SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, last_updated, last_updated_display, total_industries, metadata FROM industries_overview WHERE id = 'latest'")
            row = cursor.fetchone()
            if row and row[0]:
                data = json.loads(row[0])
                meta = json.loads(row[4]) if (len(row) > 4 and row[4]) else {}
                return {
                    "data": data,
                    "last_updated": row[1],
                    "last_updated_display": row[2],
                    "total_industries": row[3] or len(data.get("industries", [])),
                    "metadata": meta
                }
    except Exception as e:
        print(f"SQLite load_industries_overview error: {e}")

    # 3. Seed from local disk JSON if DB is completely empty
    seed_paths = [
        fallback_filepath,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "industries_overview.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "industries_overview.json"),
    ]
    for p in seed_paths:
        if p and os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                if isinstance(disk_data, dict) and "industries" in disk_data:
                    print(f"Auto-seeding industries overview from {p} into database...")
                    saved = save_industries_overview_db(
                        disk_data,
                        last_updated_iso=disk_data.get("last_updated"),
                        last_updated_display=disk_data.get("last_updated_display"),
                        metadata={"seeded_from": p, "auto_seed": True}
                    )
                    return {
                        "data": disk_data,
                        "last_updated": disk_data.get("last_updated"),
                        "last_updated_display": disk_data.get("last_updated_display"),
                        "total_industries": len(disk_data.get("industries", [])),
                        "metadata": {"seeded_from": p}
                    }
            except Exception as e:
                print(f"Error reading seed file {p}: {e}")

    return None


def save_industries_overview_db(overview_data, last_updated_iso=None, last_updated_display=None, metadata=None, backup_filepath=None):
    """
    Saves industries overview dataset to MongoDB Atlas collection 'industries_overview'
    and SQLite local table 'industries_overview'. Also updates local disk backup file.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    last_updated_iso = last_updated_iso or now_utc.isoformat()
    last_updated_display = format_ist_display(last_updated_display)
    total_industries = len(overview_data.get("industries", [])) if isinstance(overview_data, dict) else 0
    metadata = metadata or {}

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["industries_overview"]
            col.update_one(
                {"_id": "latest"},
                {"$set": {
                    "data": overview_data,
                    "total_industries": total_industries,
                    "last_updated": last_updated_iso,
                    "last_updated_display": last_updated_display,
                    "metadata": metadata,
                    "updated_at": last_updated_iso
                }},
                upsert=True
            )
        except Exception as e:
            print(f"MongoDB save_industries_overview error: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO industries_overview (id, data, last_updated, last_updated_display, total_industries, metadata, updated_at) VALUES ('latest', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (json.dumps(overview_data, ensure_ascii=False), last_updated_iso, last_updated_display, total_industries, json.dumps(metadata, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_industries_overview error: {e}")

    # 3. Disk file backup for resilience
    backup_path = str(backup_filepath) if backup_filepath else os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "industries_overview.json")
    try:
        os.makedirs(os.path.dirname(backup_path), exist_ok=True)
        tmp = backup_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(overview_data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, backup_path)
    except Exception as e:
        print(f"Disk backup write error: {e}")

    return {
        "success": True,
        "last_updated": last_updated_iso,
        "last_updated_display": last_updated_display,
        "total_industries": total_industries,
        "metadata": metadata
    }


def load_shareholding_patterns_db(fallback_filepath=None):
    """
    Loads latest shareholding patterns dataset from MongoDB Atlas collection 'shareholding_patterns'.
    Falls back to SQLite local storage if MongoDB is unavailable.
    If neither DB has data yet, checks disk JSON file, auto-seeds the DB, and returns data.
    """
    # 1. Try MongoDB Atlas
    if db is not None:
        try:
            col = db["shareholding_patterns"]
            doc = col.find_one({"_id": "latest"})
            if doc and ("records" in doc or "data" in doc):
                records = doc.get("records")
                if records is None and isinstance(doc.get("data"), dict):
                    records = doc["data"].get("records", [])
                elif records is None and isinstance(doc.get("data"), list):
                    records = doc["data"]
                return {
                    "records": records or [],
                    "last_synced": doc.get("last_synced", 0),
                    "last_synced_display": doc.get("last_synced_display", ""),
                    "total_records": doc.get("total_records", len(records or [])),
                    "count_equities": doc.get("count_equities", 0),
                    "count_sme": doc.get("count_sme", 0),
                    "metadata": doc.get("metadata", {})
                }
        except Exception as e:
            print(f"MongoDB load_shareholding_patterns error: {e}")

    # 2. Try SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, last_synced, last_synced_display, total_records, count_equities, count_sme, metadata FROM shareholding_patterns WHERE id = 'latest'")
            row = cursor.fetchone()
            if row and row[0]:
                raw_data = json.loads(row[0])
                records = raw_data.get("records", []) if isinstance(raw_data, dict) else (raw_data if isinstance(raw_data, list) else [])
                return {
                    "records": records,
                    "last_synced": row[1] or (raw_data.get("last_synced", 0) if isinstance(raw_data, dict) else 0),
                    "last_synced_display": row[2] or (raw_data.get("last_synced_display", "") if isinstance(raw_data, dict) else ""),
                    "total_records": row[3] or len(records),
                    "count_equities": row[4] or 0,
                    "count_sme": row[5] or 0,
                    "metadata": json.loads(row[6]) if row[6] else {}
                }
    except Exception as e:
        print(f"SQLite load_shareholding_patterns error: {e}")

    # 3. Seed from local JSON file if neither DB has data yet
    fallback_path = fallback_filepath or os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "shareholding_patterns.json")
    if os.path.exists(fallback_path):
        try:
            with open(fallback_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if payload:
                records = payload.get("records", []) if isinstance(payload, dict) else (payload if isinstance(payload, list) else [])
                last_synced = payload.get("last_synced", 0) if isinstance(payload, dict) else os.path.getmtime(fallback_path)
                import datetime
                last_synced_display = format_ist_display(payload.get("last_synced_display") if isinstance(payload, dict) else last_synced)
                count_eq = sum(1 for r in records if r.get("board", "").lower() != "sme")
                count_sme = sum(1 for r in records if r.get("board", "").lower() == "sme")

                save_shareholding_patterns_db(
                    shp_data=payload,
                    last_synced=last_synced,
                    last_synced_display=last_synced_display,
                    backup_filepath=fallback_path
                )
                return {
                    "records": records,
                    "last_synced": last_synced,
                    "last_synced_display": last_synced_display,
                    "total_records": len(records),
                    "count_equities": count_eq,
                    "count_sme": count_sme,
                    "metadata": {"seeded_from": fallback_path}
                }
        except Exception as e:
            print(f"Error seeding shareholding_patterns from {fallback_path}: {e}")

    return {
        "records": [],
        "last_synced": 0,
        "last_synced_display": "Not synced yet",
        "total_records": 0,
        "count_equities": 0,
        "count_sme": 0,
        "metadata": {}
    }


def save_shareholding_patterns_db(shp_data, last_synced=None, last_synced_display=None, metadata=None, backup_filepath=None):
    """
    Saves shareholding patterns dataset to MongoDB Atlas collection 'shareholding_patterns'
    and SQLite local table 'shareholding_patterns'. Also updates local disk backup file.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_iso = now_utc.isoformat()
    now_ts = datetime.datetime.now().timestamp()

    if isinstance(shp_data, dict):
        records = shp_data.get("records", [])
        last_synced = last_synced or shp_data.get("last_synced", now_ts)
        last_synced_display = format_ist_display(last_synced_display or shp_data.get("last_synced_display") or last_synced)
    elif isinstance(shp_data, list):
        records = shp_data
        last_synced = last_synced or now_ts
        last_synced_display = format_ist_display(last_synced_display or last_synced)
    else:
        records = []
        last_synced = last_synced or now_ts
        last_synced_display = format_ist_display(last_synced_display or last_synced)

    total_records = len(records)
    count_eq = sum(1 for r in records if r.get("board", "").lower() != "sme")
    count_sme = sum(1 for r in records if r.get("board", "").lower() == "sme")
    metadata = metadata or {}

    payload = {
        "last_synced": last_synced,
        "last_synced_display": last_synced_display,
        "total_records": total_records,
        "count_equities": count_eq,
        "count_sme": count_sme,
        "records": records,
    }

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["shareholding_patterns"]
            col.update_one(
                {"_id": "latest"},
                {"$set": {
                    "data": payload,
                    "records": records,
                    "total_records": total_records,
                    "count_equities": count_eq,
                    "count_sme": count_sme,
                    "last_synced": last_synced,
                    "last_synced_display": last_synced_display,
                    "metadata": metadata,
                    "updated_at": now_iso
                }},
                upsert=True
            )
        except Exception as e:
            print(f"MongoDB save_shareholding_patterns error: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO shareholding_patterns (id, data, last_synced, last_synced_display, total_records, count_equities, count_sme, metadata, updated_at) VALUES ('latest', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (json.dumps(payload, ensure_ascii=False), last_synced, last_synced_display, total_records, count_eq, count_sme, json.dumps(metadata, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_shareholding_patterns error: {e}")

    # 3. Disk file backup for resilience
    backup_path = str(backup_filepath) if backup_filepath else os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "shareholding_patterns.json")
    try:
        os.makedirs(os.path.dirname(backup_path), exist_ok=True)
        tmp = backup_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        os.replace(tmp, backup_path)
    except Exception as e:
        print(f"Disk backup write error: {e}")

    return {
        "success": True,
        "last_synced": last_synced,
        "last_synced_display": last_synced_display,
        "total_records": total_records,
        "count_equities": count_eq,
        "count_sme": count_sme,
        "metadata": metadata
    }


# ==============================================================================
# USER ALERTS & NOTIFICATIONS (DATABASE PERSISTENCE)
# Primary: MongoDB (if available) | Local: SQLite capital_desk.db (user_alerts)
# ==============================================================================

def load_user_alerts_db(username="admin", default_factory=dict):
    """
    Load user alerts and notifications strictly from the database:
    1. Primary: MongoDB Atlas (if connected)
    2. Local: SQLite database 'user_data/capital_desk.db' table 'user_alerts'
    3. Auto-migration fallback: existing user_data/<user>_alerts.json file
    """
    if isinstance(username, dict) or callable(username):
        default_factory = username
        username = "admin"

    username = str(username or "admin").strip()
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower() or "admin"

    def _normalize(val):
        if not isinstance(val, dict):
            val = {"alerts": [], "notifications": []}
        if "alerts" not in val or not isinstance(val["alerts"], list):
            val["alerts"] = []
        if "notifications" not in val or not isinstance(val["notifications"], list):
            val["notifications"] = []
        return val

    # 1. MongoDB
    if db is not None:
        try:
            col = db["user_alerts"]
            doc = col.find_one({"_id": safe_user})
            if doc is not None and "data" in doc:
                return _normalize(doc["data"])
        except Exception as e:
            print(f"MongoDB load_user_alerts error for {username}: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM user_alerts WHERE username = ?", (safe_user,))
            row = cursor.fetchone()
            if row and row[0]:
                return _normalize(json.loads(row[0]))
    except Exception as e:
        print(f"SQLite load_user_alerts error for {username}: {e}")

    # 3. Fallback & Auto-migration from legacy JSON
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data", f"{safe_user}_alerts.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, list):
                    loaded = {"alerts": loaded, "notifications": []}
                normalized = _normalize(loaded)
                save_user_alerts_db(normalized, username=safe_user)
                return normalized
        except Exception as e:
            print(f"JSON migration error for {json_path}: {e}")

    init_val = _normalize(default_factory() if callable(default_factory) else default_factory)
    save_user_alerts_db(init_val, username=safe_user)
    return init_val

def save_user_alerts_db(arg1=None, arg2=None, username=None, data=None):
    """
    Save user alerts and notifications strictly into the database:
    Supports:
      - save_user_alerts_db(data, username="admin")
      - save_user_alerts_db(username, data)
      - save_user_alerts_db(data, "admin")
      - save_user_alerts_db(data=data, username=username)
    1. Primary: MongoDB Atlas (if connected)
    2. Local: SQLite database 'user_data/capital_desk.db' table 'user_alerts'
    3. Secondary sync: updates user_data/<user>_alerts.json for backward compatibility
    """
    if username is not None and data is not None:
        target_user = username
        target_data = data
    elif username is not None and arg1 is not None:
        target_user = username
        target_data = arg1
    elif data is not None and arg1 is not None:
        target_data = data
        target_user = arg1
    elif isinstance(arg1, str) and (isinstance(arg2, dict) or arg2 is None):
        target_user = arg1
        target_data = arg2 or {"alerts": [], "notifications": []}
    elif isinstance(arg1, dict) and (isinstance(arg2, str) or arg2 is None):
        target_data = arg1
        target_user = arg2 or "admin"
    else:
        target_data = arg1 if isinstance(arg1, dict) else (data if isinstance(data, dict) else {"alerts": [], "notifications": []})
        target_user = str(arg2) if arg2 else (username or "admin")

    username = str(target_user or "admin").strip()
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower() or "admin"
    data = target_data

    if not isinstance(data, dict):
        data = {"alerts": [], "notifications": []}
    if "alerts" not in data or not isinstance(data["alerts"], list):
        data["alerts"] = []
    if "notifications" not in data or not isinstance(data["notifications"], list):
        data["notifications"] = []

    # 1. MongoDB
    if db is not None:
        try:
            col = db["user_alerts"]
            doc = {"_id": safe_user, "username": safe_user, "data": data}
            col.replace_one({"_id": safe_user}, doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_user_alerts error for {username}: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO user_alerts (username, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (safe_user, json.dumps(data, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_user_alerts error for {username}: {e}")
        return False

    # 3. Keep local JSON file updated for backup
    try:
        json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data", f"{safe_user}_alerts.json")
        os.makedirs(os.path.dirname(json_path), exist_ok=True)
        tmp = json_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, json_path)
    except Exception:
        pass

    return True


def load_transactions_deals_db(fallback_filepath=None):
    """
    Loads latest market transactions dataset from MongoDB Atlas collection 'transactions_deals'.
    Falls back to SQLite local storage if MongoDB is unavailable.
    If neither DB has data yet, checks disk JSON file, auto-seeds the DB, and returns data.
    """
    import datetime
    # 1. Try MongoDB Atlas
    if db is not None:
        try:
            col = db["transactions_deals"]
            doc = col.find_one({"_id": "latest"})
            if doc and ("deals" in doc or "data" in doc):
                deals = doc.get("deals")
                if deals is None and isinstance(doc.get("data"), list):
                    deals = doc["data"]
                return {
                    "deals": deals or [],
                    "last_updated": doc.get("last_updated"),
                    "last_updated_display": doc.get("last_updated_display", ""),
                    "total_records": doc.get("total_records", len(deals or [])),
                    "metadata": doc.get("metadata", {})
                }
        except Exception as e:
            print(f"MongoDB load_transactions_deals error: {e}")

    # 2. Try SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data, last_updated, last_updated_display, total_records, metadata FROM transactions_deals WHERE id = 'latest'")
            row = cursor.fetchone()
            if row and row[0]:
                deals = json.loads(row[0])
                meta = json.loads(row[4]) if (len(row) > 4 and row[4]) else {}
                return {
                    "deals": deals or [],
                    "last_updated": row[1],
                    "last_updated_display": row[2] or "",
                    "total_records": row[3] or len(deals or []),
                    "metadata": meta
                }
    except Exception as e:
        print(f"SQLite load_transactions_deals error: {e}")

    # 3. Fallback to disk JSON file & auto-seed DB
    if fallback_filepath and os.path.exists(fallback_filepath):
        try:
            with open(fallback_filepath, "r", encoding="utf-8") as f:
                disk_deals = json.load(f)
            if isinstance(disk_deals, list):
                print(f"[DB Store] Auto-seeding transactions_deals DB with {len(disk_deals)} deals from {fallback_filepath}...")
                now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
                save_transactions_deals_db(disk_deals, last_updated_iso=now_utc, last_updated_display="Auto-seeded from disk", backup_filepath=fallback_filepath)
                return {
                    "deals": disk_deals,
                    "last_updated": now_utc,
                    "last_updated_display": "Auto-seeded from disk",
                    "total_records": len(disk_deals),
                    "metadata": {}
                }
        except Exception as e:
            print(f"[DB Store] Error loading fallback transactions file {fallback_filepath}: {e}")

    return {
        "deals": [],
        "last_updated": None,
        "last_updated_display": "",
        "total_records": 0,
        "metadata": {}
    }


def save_transactions_deals_db(deals, last_updated_iso=None, last_updated_display=None, metadata=None, backup_filepath=None):
    """
    Saves market transactions list and timestamp to MongoDB Atlas collection 'transactions_deals'.
    Also syncs to SQLite local storage 'transactions_deals' table and backup disk JSON.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    last_updated_iso = last_updated_iso or now_utc.isoformat()
    last_updated_display = format_ist_display(last_updated_display)
    total_records = len(deals)
    metadata = metadata or {}

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["transactions_deals"]
            col.update_one(
                {"_id": "latest"},
                {"$set": {
                    "deals": deals,
                    "total_records": total_records,
                    "last_updated": last_updated_iso,
                    "last_updated_display": last_updated_display,
                    "metadata": metadata,
                    "updated_at": last_updated_iso
                }},
                upsert=True
            )
        except Exception as e:
            print(f"MongoDB save_transactions_deals error: {e}")

    # 2. SQLite
    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO transactions_deals 
                (id, data, last_updated, last_updated_display, total_records, metadata, updated_at) 
                VALUES ('latest', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (json.dumps(deals, ensure_ascii=False), last_updated_iso, last_updated_display, total_records, json.dumps(metadata))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_transactions_deals error: {e}")

    # 3. Disk JSON backup
    if backup_filepath:
        try:
            os.makedirs(os.path.dirname(backup_filepath), exist_ok=True)
            tmp = str(backup_filepath) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(deals, f, indent=2, ensure_ascii=False)
            os.replace(tmp, backup_filepath)
        except Exception as e:
            print(f"[DB Store] Warning saving transactions backup JSON {backup_filepath}: {e}")

    return True


# ==============================================================================
# INDEX STOCKS & CONSTITUENTS (NIFTY 50, 100, 500, BANK, FIN, MID, SML, MICRO)
# ==============================================================================

def load_index_constituents_db(index_key=None):
    """
    Load index constituents from database:
    1. Primary: MongoDB Atlas collection 'index_constituents'
    2. Local: SQLite database 'capital_desk.db' table 'index_constituents'
    If index_key is None, loads all indices.
    """
    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["index_constituents"]
            if index_key:
                doc = col.find_one({"_id": str(index_key).strip()})
                if doc:
                    doc.pop("_id", None)
                    return doc
            else:
                docs = list(col.find({}))
                if docs:
                    res = {}
                    for d in docs:
                        k = d.get("_id") or d.get("index_key")
                        d.pop("_id", None)
                        res[k] = d
                    return res
        except Exception as e:
            print(f"MongoDB load_index_constituents error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        cursor = conn.cursor()
        if index_key:
            cursor.execute(
                "SELECT index_key, index_name, symbol, official_size, stocks, total_stocks, last_synced, last_synced_display, metadata FROM index_constituents WHERE index_key = ?",
                (str(index_key).strip(),)
            )
            row = cursor.fetchone()
            if row:
                stocks = json.loads(row[4]) if row[4] else []
                meta = json.loads(row[8]) if row[8] else {}
                return {
                    "index_key": row[0],
                    "index_name": row[1],
                    "symbol": row[2],
                    "official_size": row[3],
                    "stocks": stocks,
                    "total_stocks": row[5] or len(stocks),
                    "last_synced": row[6],
                    "last_synced_display": row[7],
                    "metadata": meta
                }
        else:
            cursor.execute("SELECT index_key, index_name, symbol, official_size, stocks, total_stocks, last_synced, last_synced_display, metadata FROM index_constituents")
            rows = cursor.fetchall()
            if rows:
                res = {}
                for row in rows:
                    stocks = json.loads(row[4]) if row[4] else []
                    meta = json.loads(row[8]) if row[8] else {}
                    res[row[0]] = {
                        "index_key": row[0],
                        "index_name": row[1],
                        "symbol": row[2],
                        "official_size": row[3],
                        "stocks": stocks,
                        "total_stocks": row[5] or len(stocks),
                        "last_synced": row[6],
                        "last_synced_display": row[7],
                        "metadata": meta
                    }
                return res
    except Exception as e:
        print(f"SQLite load_index_constituents error: {e}")
    finally:
        if conn:
            conn.close()

    return None


def save_index_constituents_db(index_key, index_name, symbol, official_size, stocks, last_synced_iso=None, last_synced_display=None, metadata=None):
    """
    Saves index constituent stocks and telemetry to MongoDB Atlas collection 'index_constituents'
    and SQLite 'index_constituents' table in capital_desk.db.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    last_synced_iso = last_synced_iso or now_utc.isoformat()
    last_synced_display = format_ist_display(last_synced_display)
    total_stocks = len(stocks)
    metadata = metadata or {}
    key_str = str(index_key).strip()

    doc_data = {
        "index_key": key_str,
        "index_name": str(index_name),
        "symbol": str(symbol or index_name),
        "official_size": int(official_size or 0),
        "stocks": stocks,
        "total_stocks": total_stocks,
        "last_synced": last_synced_iso,
        "last_synced_display": last_synced_display,
        "metadata": metadata,
        "updated_at": last_synced_iso
    }

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["index_constituents"]
            mongo_doc = dict(doc_data)
            mongo_doc["_id"] = key_str
            col.replace_one({"_id": key_str}, mongo_doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_index_constituents error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        conn.execute(
            """
            INSERT OR REPLACE INTO index_constituents 
            (index_key, index_name, symbol, official_size, stocks, total_stocks, last_synced, last_synced_display, metadata, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                key_str,
                str(index_name),
                str(symbol or index_name),
                int(official_size or 0),
                json.dumps(stocks, ensure_ascii=False),
                total_stocks,
                last_synced_iso,
                last_synced_display,
                json.dumps(metadata, ensure_ascii=False)
            )
        )
        conn.commit()
    except Exception as e:
        print(f"SQLite save_index_constituents error: {e}")
    finally:
        if conn:
            conn.close()

    return {
        "success": True,
        "index_key": key_str,
        "total_stocks": total_stocks,
        "last_synced_display": last_synced_display
    }


def save_index_rebalance_audit(audit_entry):
    """
    Saves an index rebalance & sync audit entry recording all entered and exited stocks.
    Persisted to MongoDB collection 'index_rebalance_audit' and SQLite table 'index_rebalance_audit'.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    ts_iso = audit_entry.get("timestamp") or now_utc.isoformat()
    ts_display = audit_entry.get("timestamp_display") or format_ist_display(ts_iso)
    total_entered = int(audit_entry.get("total_entered") or 0)
    total_exited = int(audit_entry.get("total_exited") or 0)
    enforce_size = 1 if audit_entry.get("enforce_official_size", True) else 0
    changes_by_index = audit_entry.get("changes_by_index") or {}

    doc = {
        "timestamp": ts_iso,
        "timestamp_display": ts_display,
        "total_entered": total_entered,
        "total_exited": total_exited,
        "enforce_official_size": bool(enforce_size),
        "changes_by_index": changes_by_index,
        "created_at": ts_iso
    }

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["index_rebalance_audit"]
            col.insert_one(dict(doc))
        except Exception as e:
            print(f"MongoDB save_index_rebalance_audit error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        conn.execute(
            """
            INSERT INTO index_rebalance_audit 
            (timestamp, timestamp_display, total_entered, total_exited, enforce_official_size, changes_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                ts_iso,
                ts_display,
                total_entered,
                total_exited,
                enforce_size,
                json.dumps(changes_by_index, ensure_ascii=False)
            )
        )
        conn.commit()
    except Exception as e:
        print(f"SQLite save_index_rebalance_audit error: {e}")
    finally:
        if conn:
            conn.close()

    return doc


def load_index_rebalance_audit(limit=10):
    """
    Loads recent rebalance & sync audit logs from MongoDB or SQLite.
    Returns list of audit entries containing entered and exited stocks per index.
    """
    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["index_rebalance_audit"]
            docs = list(col.find({}, {"_id": 0}).sort("created_at", -1).limit(int(limit)))
            if docs:
                return docs
        except Exception as e:
            print(f"MongoDB load_index_rebalance_audit error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, timestamp, timestamp_display, total_entered, total_exited, enforce_official_size, changes_json, created_at
            FROM index_rebalance_audit
            ORDER BY id DESC
            LIMIT ?
            """,
            (int(limit),)
        )
        rows = cursor.fetchall()
        if rows:
            results = []
            for r in rows:
                changes = {}
                try:
                    changes = json.loads(r[6]) if r[6] else {}
                except Exception:
                    pass
                results.append({
                    "id": r[0],
                    "timestamp": r[1],
                    "timestamp_display": r[2],
                    "total_entered": r[3],
                    "total_exited": r[4],
                    "enforce_official_size": bool(r[5]),
                    "changes_by_index": changes,
                    "created_at": r[7]
                })
            return results
    except Exception as e:
        print(f"SQLite load_index_rebalance_audit error: {e}")
    finally:
        if conn:
            conn.close()

    return []


# ==============================================================================
# OFFICIAL TRADING HOLIDAYS (LAST 10 YEARS: 2017 - 2026)
# ==============================================================================

def load_trading_holidays_db(year=None):
    """
    Loads official trading holidays from database (MongoDB Atlas or SQLite).
    If year is specified, filters by that year. Returns list sorted by date ascending.
    """
    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["trading_holidays"]
            query = {"year": int(year)} if year is not None else {}
            docs = list(col.find(query, {"_id": 0}).sort("date", 1))
            if docs:
                from modules.common.ist_datetime import format_ist_date
                for d in docs:
                    if not d.get("date_display") and d.get("date"):
                        d["date_display"] = format_ist_date(d["date"])
                return docs
        except Exception as e:
            print(f"MongoDB load_trading_holidays error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        cursor = conn.cursor()
        if year is not None:
            cursor.execute(
                """
                SELECT holiday_id, date, year, holiday_name, day, exchange, segment,
                       is_trading_holiday, is_clearing_holiday, morning_session, evening_session, notes, updated_at
                FROM trading_holidays
                WHERE year = ?
                ORDER BY date ASC
                """,
                (int(year),)
            )
        else:
            cursor.execute(
                """
                SELECT holiday_id, date, year, holiday_name, day, exchange, segment,
                       is_trading_holiday, is_clearing_holiday, morning_session, evening_session, notes, updated_at
                FROM trading_holidays
                ORDER BY date ASC
                """
            )
        rows = cursor.fetchall()
        if rows:
            results = []
            from modules.common.ist_datetime import format_ist_date
            for r in rows:
                dt_raw = r[1]
                results.append({
                    "holiday_id": r[0],
                    "date": dt_raw,
                    "date_display": format_ist_date(dt_raw),
                    "year": r[2],
                    "holiday_name": r[3],
                    "day": r[4],
                    "exchange": r[5],
                    "segment": r[6],
                    "is_trading_holiday": bool(r[7]),
                    "is_clearing_holiday": bool(r[8]),
                    "morning_session": r[9],
                    "evening_session": r[10],
                    "notes": r[11],
                    "updated_at": r[12]
                })
            return results
    except Exception as e:
        print(f"SQLite load_trading_holidays error: {e}")
    finally:
        if conn:
            conn.close()

    return []


def save_trading_holidays_db(holidays, year=None, last_synced_display=None):
    """
    Saves a list of trading holiday records to MongoDB Atlas and SQLite.
    Each item must contain: holiday_id, date, year, holiday_name, day.
    """
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    from modules.common.ist_datetime import format_ist_date
    ts_iso = now_utc.isoformat()
    last_synced_display = last_synced_display or format_ist_date(ts_iso)

    if not holidays:
        return {"success": True, "count": 0}

    # 1. MongoDB Atlas
    if db is not None:
        try:
            col = db["trading_holidays"]
            for h in holidays:
                h_doc = dict(h)
                hid = str(h_doc.get("holiday_id") or f"{h_doc.get('date')}_{h_doc.get('holiday_name')}")
                h_doc["holiday_id"] = hid
                h_doc["_id"] = hid
                h_doc["updated_at"] = ts_iso
                if not h_doc.get("date_display") and h_doc.get("date"):
                    h_doc["date_display"] = format_ist_date(h_doc["date"])
                col.replace_one({"_id": hid}, h_doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_trading_holidays error: {e}")

    # 2. SQLite
    conn = None
    try:
        _init_sqlite_db()
        conn = sqlite3.connect(_SQLITE_DB_PATH)
        for h in holidays:
            hid = str(h.get("holiday_id") or f"{h.get('date')}_{h.get('holiday_name')}")
            dt = str(h.get("date", ""))
            yr = int(h.get("year") or (int(dt[:4]) if len(dt) >= 4 else 2026))
            hname = str(h.get("holiday_name", ""))
            day = str(h.get("day", ""))
            exchange = str(h.get("exchange", "NSE, BSE"))
            segment = str(h.get("segment", "Capital Market (Equities)"))
            is_trade = 1 if h.get("is_trading_holiday", True) else 0
            is_clear = 1 if h.get("is_clearing_holiday", False) else 0
            m_sess = h.get("morning_session")
            e_sess = h.get("evening_session")
            notes = str(h.get("notes") or "")

            conn.execute(
                """
                INSERT OR REPLACE INTO trading_holidays
                (holiday_id, date, year, holiday_name, day, exchange, segment,
                 is_trading_holiday, is_clearing_holiday, morning_session, evening_session, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (hid, dt, yr, hname, day, exchange, segment, is_trade, is_clear, m_sess, e_sess, notes)
            )
        conn.commit()
    except Exception as e:
        print(f"SQLite save_trading_holidays error: {e}")
    finally:
        if conn:
            conn.close()

    return {
        "success": True,
        "count": len(holidays),
        "last_synced_display": last_synced_display
    }


def get_trading_holidays_telemetry_db():
    """
    Returns summary telemetry for trading holidays: total records, years covered,
    counts per year, current year holiday count, and latest sync timestamp.
    """
    import datetime
    all_holidays = load_trading_holidays_db()
    counts_by_year = {}
    latest_updated = ""
    for h in all_holidays:
        y = h.get("year")
        if y:
            counts_by_year[y] = counts_by_year.get(y, 0) + 1
        up = str(h.get("updated_at") or "")
        if up > latest_updated:
            latest_updated = up

    now_year = datetime.datetime.now().year
    from modules.common.ist_datetime import format_ist_date
    return {
        "total_holidays": len(all_holidays),
        "years": sorted(list(counts_by_year.keys())),
        "counts_by_year": counts_by_year,
        "current_year": now_year,
        "current_year_count": counts_by_year.get(now_year, 0),
        "has_current_year": counts_by_year.get(now_year, 0) > 0,
        "last_updated_display": format_ist_date(latest_updated) if latest_updated else "Never"
    }


# ==============================================================================
# STOCK CLOSING PRICES (750 STOCKS 2-YEAR EOD HISTORY & DAILY CLOSES)
# ==============================================================================

def load_stock_closing_prices_db(symbol=None, symbols=None, summary_only=False, monthly_only=False, limit=None):
    """
    Loads stock closing prices strictly and solely from MongoDB Atlas collection 'stock_closing_prices'.
    SQLite usage is completely deleted per system architecture rules.
    If symbol is specified as a string, returns single stock document.
    If symbols (or symbol as list/set) is specified, returns dict of {sym: doc} for only those symbols.
    If summary_only is True, excludes prices and monthly_prices arrays for high-performance listing.
    If monthly_only is True, excludes full daily prices array but includes monthly_prices for ultra-fast calculation.
    """
    if db is None:
        print("Warning: MongoDB Atlas is not connected for load_stock_closing_prices_db.")
        return {} if not symbol or isinstance(symbol, (list, tuple, set)) else None

    # Normalize inputs
    single_sym = None
    target_symbols = None
    if symbol and isinstance(symbol, str):
        single_sym = symbol.strip().upper().replace('.NS', '').replace('.BO', '')
    elif symbol and isinstance(symbol, (list, tuple, set)):
        target_symbols = [str(s).strip().upper().replace('.NS', '').replace('.BO', '') for s in symbol if s]
    elif symbols and isinstance(symbols, (list, tuple, set)):
        target_symbols = [str(s).strip().upper().replace('.NS', '').replace('.BO', '') for s in symbols if s]

    try:
        col = db["stock_closing_prices"]
        if single_sym:
            projection = None
            if summary_only:
                projection = {"prices": 0, "monthly_prices": 0}
            elif monthly_only:
                projection = {"prices": 0}
            doc = col.find_one({"_id": single_sym}, projection)
            if doc:
                doc.pop("_id", None)
                return doc
            return None
        else:
            projection = None
            if summary_only:
                projection = {"prices": 0, "monthly_prices": 0}
            elif monthly_only:
                projection = {"prices": 0}

            query = {}
            if target_symbols:
                query = {"_id": {"$in": target_symbols}}
            cursor = col.find(query, projection)
            if limit and isinstance(limit, int) and limit > 0:
                cursor = cursor.limit(limit)
            docs = list(cursor)
            if docs:
                res = {}
                for d in docs:
                    sym = d.get("_id") or d.get("symbol")
                    d.pop("_id", None)
                    res[sym] = d
                return res
            return {}
    except Exception as e:
        print(f"MongoDB load_stock_closing_prices error: {e}")
        return {} if not single_sym else None


def save_stock_closing_prices_db(records):
    """
    Saves or bulk-upserts stock closing prices strictly into MongoDB Atlas collection 'stock_closing_prices'.
    Zero SQLite persistence.
    'records' can be a single dict or a list of dicts.
    """
    if not records:
        return {"success": False, "count": 0}

    if isinstance(records, dict):
        records = [records]

    now_display = format_ist_display()
    now_iso = now_ist().isoformat()
    clean_records = []
    for r in records:
        sym = str(r.get("symbol", "")).strip().upper()
        if not sym:
            continue
        cname = str(r.get("company_name", sym)).strip()
        prices = r.get("prices", [])
        monthly_prices = r.get("monthly_prices", [])
        tot = len(prices)
        s_date = r.get("start_date") or (prices[0]["d"] if prices else "")
        l_date = r.get("latest_date") or (prices[-1]["d"] if prices else "")
        l_close = float(r.get("latest_close") if r.get("latest_close") is not None else (prices[-1]["c"] if prices else 0.0))
        p_close = float(r.get("prev_close") if r.get("prev_close") is not None else (prices[-2]["c"] if len(prices) > 1 else l_close))
        chg = round(l_close - p_close, 2)
        chg_pct = round((chg / p_close * 100.0) if p_close else 0.0, 2)
        synced_iso = r.get("last_synced") or now_iso
        synced_disp = r.get("last_synced_display") or now_display

        doc = {
            "symbol": sym,
            "company_name": cname,
            "start_date": s_date,
            "latest_date": l_date,
            "latest_close": l_close,
            "prev_close": p_close,
            "change": chg,
            "change_pct": chg_pct,
            "total_records": tot,
            "prices": prices,
            "last_synced": synced_iso,
            "last_synced_display": synced_disp
        }
        if monthly_prices:
            doc["monthly_prices"] = monthly_prices

        clean_records.append(doc)

    if not clean_records:
        return {"success": False, "count": 0}

    # MongoDB Atlas Bulk Upsert
    if db is not None:
        try:
            from pymongo import UpdateOne
            col = db["stock_closing_prices"]
            ops = []
            for r in clean_records:
                mongo_doc = dict(r)
                mongo_doc["_id"] = r["symbol"]
                ops.append(UpdateOne({"_id": r["symbol"]}, {"$set": mongo_doc}, upsert=True))
            if ops:
                col.bulk_write(ops, ordered=False)
                try:
                    col.create_index([("latest_date", 1)])
                    col.create_index([("symbol", 1)])
                    col.create_index([("start_date", 1)])
                except Exception:
                    pass
            return {"success": True, "count": len(clean_records)}
        except Exception as e:
            print(f"MongoDB save_stock_closing_prices bulk error: {e}")
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "MongoDB Atlas is not connected"}


def load_stock_closing_prices_telemetry_db():
    """Returns stored telemetry for stock closing prices sync from MongoDB Atlas."""
    if db is not None:
        try:
            col = db["stock_closing_prices_telemetry"]
            doc = col.find_one({"_id": "global_telemetry"})
            if doc:
                doc.pop("_id", None)
                return doc
        except Exception as e:
            print(f"MongoDB load_stock_closing_prices_telemetry error: {e}")
    return None


def save_stock_closing_prices_telemetry_db(telemetry_data):
    """Saves or updates telemetry for stock closing prices sync in MongoDB Atlas."""
    if not telemetry_data or db is None:
        return
    data_copy = dict(telemetry_data)
    data_copy["updated_at"] = now_ist().isoformat()

    try:
        col = db["stock_closing_prices_telemetry"]
        mongo_doc = dict(data_copy)
        mongo_doc["_id"] = "global_telemetry"
        col.replace_one({"_id": "global_telemetry"}, mongo_doc, upsert=True)
    except Exception as e:
        print(f"MongoDB save_stock_closing_prices_telemetry error: {e}")





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
    if db is not None:
        try:
            col = db["system_settings"]
            doc = col.find_one({"_id": "global_settings"})
            if doc is not None and "settings" in doc:
                res = default_factory()
                res.update(doc["settings"])
                return res
        except Exception as e:
            print(f"MongoDB load_system_settings error: {e}")

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
    try:
        os.makedirs(os.path.dirname(settings_file), exist_ok=True)
        tmp = settings_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4, ensure_ascii=False)
        os.replace(tmp, settings_file)
    except Exception:
        pass

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
    backup_path = backup_filepath or os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "industries_overview.json")
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
    backup_path = backup_filepath or os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_data", "shareholding_patterns.json")
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

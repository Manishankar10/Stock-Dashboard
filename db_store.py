import os
import json

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
    last_updated_display = last_updated_display or datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")

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
    last_updated_display = last_updated_display or datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")
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

import os
import json

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
            conn.commit()
    except Exception as e:
        print(f"SQLite init error: {e}")

def load_technical_signals_db(filepath=None, default_factory=dict):
    """
    Load technical signals strictly and only from the database:
    1. Primary: MongoDB Atlas (if _MONGO_URI connected)
    2. Local: SQLite database 'user_data/capital_desk.db'
    """
    if db is not None:
        try:
            col = db["technical_signals"]
            doc = col.find_one({"_id": "latest_signals"})
            if doc is not None and "data" in doc:
                return doc["data"]
            elif doc is not None and "scanners" in doc:
                res = dict(doc)
                res.pop("_id", None)
                return res
        except Exception as e:
            print(f"MongoDB load_technical_signals error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM technical_signals WHERE id = 'latest_signals'")
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
    except Exception as e:
        print(f"SQLite load_technical_signals error: {e}")

    return default_factory()

def save_technical_signals_db(data, filepath=None):
    """
    Save technical signals strictly and only in the database:
    1. Primary: MongoDB Atlas (if _MONGO_URI connected)
    2. Local: SQLite database 'user_data/capital_desk.db'
    """
    if db is not None:
        try:
            col = db["technical_signals"]
            doc = {"_id": "latest_signals", "data": data}
            col.replace_one({"_id": "latest_signals"}, doc, upsert=True)
        except Exception as e:
            print(f"MongoDB save_technical_signals error: {e}")

    try:
        _init_sqlite_db()
        with sqlite3.connect(_SQLITE_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO technical_signals (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                ('latest_signals', json.dumps(data, ensure_ascii=False))
            )
            conn.commit()
    except Exception as e:
        print(f"SQLite save_technical_signals error: {e}")

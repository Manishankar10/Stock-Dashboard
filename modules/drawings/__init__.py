import os
import re
import json
import time
import datetime
import threading
from flask import Blueprint, request, jsonify, session

from modules.common.data_paths import APP_DATA_DIR, USER_DATA_DIR
from modules.common.auth_utils import login_required
import db_store
from db_store import load_user_doc_db, save_user_doc_db

drawings_bp = Blueprint("drawings", __name__)

LEGACY_DRAWINGS_DIR = os.path.join(APP_DATA_DIR, "drawings")
_DRAWINGS_LOCK = threading.RLock()


def _sanitize_name(val):
    if not val:
        return "admin"
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(val).strip().lower())
    return clean or "admin"


def _sanitize_symbol(sym):
    if not sym:
        return "UNKNOWN"
    clean = re.sub(r"[^a-zA-Z0-9_\-\.\^]", "_", str(sym).strip().upper())
    return clean or "UNKNOWN"


def _get_active_username():
    """Retrieve username from active session or fallback to admin."""
    user = session.get("username") or session.get("user")
    if user:
        return str(user)
    # Check query param if session is not set (e.g. headless or auth header)
    req_user = request.args.get("username") or (request.json.get("username") if request.is_json and request.json else None)
    if req_user:
        return str(req_user)
    return "admin"


def get_user_drawings_file(username):
    """
    Returns path to the user's local fallback drawings JSON file:
    user_data/{safe_user}_drawings.json
    """
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    safe_user = _sanitize_name(username)
    return os.path.join(USER_DATA_DIR, f"{safe_user}_drawings.json")


def migrate_legacy_drawings_to_mongo():
    """
    First moves existing drawings data from JSON files in app_data/drawings/ to:
    1. MongoDB Atlas collection 'drawings' (when MongoDB is connected)
    2. user_data/{safe_user}_drawings.json (local fallback)
    Then safely removes the legacy app_data/drawings JSON files so app_data stays clean.
    """
    if not os.path.exists(LEGACY_DRAWINGS_DIR):
        return

    users_found = set()

    try:
        entries = os.listdir(LEGACY_DRAWINGS_DIR)
    except Exception:
        return

    for entry in entries:
        full_path = os.path.join(LEGACY_DRAWINGS_DIR, entry)
        if os.path.isfile(full_path) and entry.endswith(".json") and entry != ".gitkeep":
            user_name = entry[:-5]
            if user_name:
                users_found.add(user_name)
        elif os.path.isdir(full_path):
            users_found.add(entry)

    for user in users_found:
        safe_user = _sanitize_name(user)
        target_file = get_user_drawings_file(safe_user)
        user_drawings = {}

        # 1. Load any data already present in local fallback
        if os.path.exists(target_file):
            try:
                with open(target_file, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                    if isinstance(existing, dict):
                        user_drawings.update(existing)
            except Exception:
                pass

        # 2. Load from app_data/drawings/{user}.json
        legacy_user_file = os.path.join(LEGACY_DRAWINGS_DIR, f"{safe_user}.json")
        if os.path.exists(legacy_user_file):
            try:
                with open(legacy_user_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        for sym, rec in data.items():
                            if isinstance(rec, dict) and sym not in user_drawings:
                                user_drawings[sym] = rec
            except Exception:
                pass

        # 3. Load from app_data/drawings/{user}/*.json
        legacy_user_dir = os.path.join(LEGACY_DRAWINGS_DIR, safe_user)
        if os.path.exists(legacy_user_dir) and os.path.isdir(legacy_user_dir):
            try:
                for fname in os.listdir(legacy_user_dir):
                    if fname.endswith(".json"):
                        fpath = os.path.join(legacy_user_dir, fname)
                        try:
                            with open(fpath, "r", encoding="utf-8") as f:
                                content = json.load(f)
                                if fname == "drawings.json" and isinstance(content, dict):
                                    for sym, rec in content.items():
                                        if isinstance(rec, dict) and sym not in user_drawings:
                                            user_drawings[sym] = rec
                                elif isinstance(content, dict) and "symbol" in content:
                                    sym = content["symbol"]
                                    if sym not in user_drawings:
                                        user_drawings[sym] = content
                        except Exception:
                            pass
            except Exception:
                pass

        # 4. Save merged drawings to MongoDB and local fallback
        if user_drawings:
            save_user_doc_db("drawings", safe_user, user_drawings, target_file)
            print(f" [Drawings Migration] Migrated drawings for user '{safe_user}' ({len(user_drawings)} symbols) to MongoDB & user_data.")

        # 5. Clean up legacy JSON files in app_data/drawings
        if os.path.exists(legacy_user_dir) and os.path.isdir(legacy_user_dir):
            try:
                for fname in os.listdir(legacy_user_dir):
                    if fname.endswith(".json"):
                        try:
                            os.remove(os.path.join(legacy_user_dir, fname))
                        except Exception:
                            pass
                try:
                    os.rmdir(legacy_user_dir)
                except Exception:
                    pass
            except Exception:
                pass

        if os.path.exists(legacy_user_file):
            try:
                os.remove(legacy_user_file)
            except Exception:
                pass


def load_user_drawings_data(username):
    """
    Loads all saved drawings for a given user from MongoDB,
    falling back to user_data/{safe_user}_drawings.json if MongoDB is offline.
    """
    safe_user = _sanitize_name(username)
    filepath = get_user_drawings_file(safe_user)

    with _DRAWINGS_LOCK:
        data = load_user_doc_db("drawings", safe_user, filepath, default_factory=dict)
        if not isinstance(data, dict):
            data = {}

        # Self-healing / auto-sync to Mongo:
        # If MongoDB is connected and the collection doesn't have this document yet,
        # but we have local drawings data, upsert it to MongoDB now.
        if db_store.db is not None and data:
            try:
                col = db_store.db["drawings"]
                if col.find_one({"_id": safe_user}) is None:
                    col.replace_one(
                        {"_id": safe_user},
                        {"_id": safe_user, "username": safe_user, "data": data},
                        upsert=True
                    )
            except Exception as e:
                print(f"MongoDB auto-sync drawings error for {safe_user}: {e}")

        return data


def save_user_drawings_data(username, symbol, lines, shapes):
    """
    Stores drawings for a given symbol in MongoDB (and local fallback file).
    """
    safe_user = _sanitize_name(username)
    safe_symbol = _sanitize_symbol(symbol)
    filepath = get_user_drawings_file(safe_user)

    now_iso = datetime.datetime.now().isoformat()
    symbol_record = {
        "symbol": safe_symbol,
        "lines": lines if isinstance(lines, list) else [],
        "shapes": shapes if isinstance(shapes, list) else [],
        "updated_at": now_iso
    }

    with _DRAWINGS_LOCK:
        user_data = load_user_drawings_data(safe_user)
        user_data[safe_symbol] = symbol_record
        save_user_doc_db("drawings", safe_user, user_data, filepath)

    return symbol_record


def delete_user_drawings_for_symbol(username, symbol):
    """
    Removes drawings for a symbol from MongoDB (and local fallback file).
    """
    safe_user = _sanitize_name(username)
    safe_symbol = _sanitize_symbol(symbol)
    filepath = get_user_drawings_file(safe_user)

    with _DRAWINGS_LOCK:
        user_data = load_user_drawings_data(safe_user)
        if safe_symbol in user_data:
            del user_data[safe_symbol]
            save_user_doc_db("drawings", safe_user, user_data, filepath)


# Run migration of legacy json files on initialization
migrate_legacy_drawings_to_mongo()


# =========================================================================
# API ROUTES
# =========================================================================

@drawings_bp.route("/api/drawings", methods=["GET"])
def get_drawings():
    """
    Fetch chart drawings for the current user from MongoDB / fallback.
    Optional query param ?symbol=INFY to get only a specific stock's drawings.
    """
    username = _get_active_username()
    symbol = request.args.get("symbol")
    user_data = load_user_drawings_data(username)

    if symbol:
        safe_sym = _sanitize_symbol(symbol)
        sym_record = user_data.get(safe_sym, {})
        return jsonify({
            "success": True,
            "username": username,
            "symbol": safe_sym,
            "lines": sym_record.get("lines", []),
            "shapes": sym_record.get("shapes", []),
            "updated_at": sym_record.get("updated_at")
        })

    return jsonify({
        "success": True,
        "username": username,
        "drawings": user_data,
        "symbols_count": len(user_data)
    })


@drawings_bp.route("/api/drawings", methods=["POST"])
def save_drawings():
    """
    Save or update chart drawings for a symbol to MongoDB.
    Expected JSON payload:
    {
        "symbol": "INFY",
        "lines": [...],
        "shapes": [...]
    }
    """
    username = _get_active_username()
    data = request.get_json(silent=True) or {}
    symbol = data.get("symbol")
    if not symbol:
        return jsonify({"success": False, "error": "symbol is required"}), 400

    lines = data.get("lines", [])
    shapes = data.get("shapes", [])

    saved_record = save_user_drawings_data(username, symbol, lines, shapes)
    return jsonify({
        "success": True,
        "message": f"Drawings for {symbol} saved successfully to MongoDB",
        "username": username,
        "symbol": saved_record["symbol"],
        "lines_count": len(saved_record["lines"]),
        "shapes_count": len(saved_record["shapes"]),
        "updated_at": saved_record["updated_at"]
    })


@drawings_bp.route("/api/drawings/sync", methods=["POST"])
def sync_drawings():
    """
    Bulk sync all drawings from client to MongoDB.
    Expected JSON payload:
    {
        "drawings": {
            "INFY": { "lines": [...], "shapes": [...] },
            "TCS": { "lines": [...], "shapes": [...] }
        }
    }
    """
    username = _get_active_username()
    safe_user = _sanitize_name(username)
    filepath = get_user_drawings_file(safe_user)
    data = request.get_json(silent=True) or {}
    drawings_map = data.get("drawings", {})

    now_iso = datetime.datetime.now().isoformat()
    saved_count = 0

    with _DRAWINGS_LOCK:
        user_data = load_user_drawings_data(safe_user)
        for sym, rec in drawings_map.items():
            if not sym:
                continue
            safe_sym = _sanitize_symbol(sym)
            lines = rec.get("lines", []) if isinstance(rec, dict) else []
            shapes = rec.get("shapes", []) if isinstance(rec, dict) else []
            user_data[safe_sym] = {
                "symbol": safe_sym,
                "lines": lines,
                "shapes": shapes,
                "updated_at": now_iso
            }
            saved_count += 1
        save_user_doc_db("drawings", safe_user, user_data, filepath)

    return jsonify({
        "success": True,
        "message": f"Successfully synced {saved_count} symbol drawings to MongoDB",
        "username": username,
        "synced_count": saved_count
    })


@drawings_bp.route("/api/drawings", methods=["DELETE"])
def delete_drawings():
    """
    Delete drawings for a symbol from MongoDB.
    """
    username = _get_active_username()
    symbol = request.args.get("symbol") or (request.json.get("symbol") if request.is_json and request.json else None)
    if not symbol:
        return jsonify({"success": False, "error": "symbol parameter is required"}), 400

    delete_user_drawings_for_symbol(username, symbol)
    return jsonify({
        "success": True,
        "message": f"Drawings for {symbol} removed successfully from MongoDB",
        "username": username,
        "symbol": symbol
    })

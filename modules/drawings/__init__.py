import os
import re
import json
import time
import datetime
import threading
from flask import Blueprint, request, jsonify, session

from modules.common.data_paths import APP_DATA_DIR
from modules.common.auth_utils import login_required

drawings_bp = Blueprint("drawings", __name__)

DRAWINGS_DIR = os.path.join(APP_DATA_DIR, "drawings")
_DRAWINGS_LOCK = threading.Lock()


def _ensure_drawings_dir():
    if not os.path.exists(DRAWINGS_DIR):
        try:
            os.makedirs(DRAWINGS_DIR, exist_ok=True)
        except Exception:
            pass


def _sanitize_name(val):
    if not val:
        return "default_user"
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(val).strip().lower())
    return clean or "default_user"


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


def get_user_drawings_path(username):
    """
    Returns path to the user's master JSON file:
    app_data/drawings/{user_name}.json
    """
    _ensure_drawings_dir()
    safe_user = _sanitize_name(username)
    return os.path.join(DRAWINGS_DIR, f"{safe_user}.json")


def get_user_drawings_dir(username):
    """
    Returns path to the user's folder:
    app_data/drawings/{user_name}/
    """
    _ensure_drawings_dir()
    safe_user = _sanitize_name(username)
    user_dir = os.path.join(DRAWINGS_DIR, safe_user)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


def load_user_drawings_data(username):
    """
    Loads all saved drawings for a given user.
    Reads app_data/drawings/{user_name}.json.
    If missing, falls back to scanning app_data/drawings/{user_name}/.
    """
    _ensure_drawings_dir()
    user_file = get_user_drawings_path(username)
    
    with _DRAWINGS_LOCK:
        if os.path.exists(user_file):
            try:
                with open(user_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception as e:
                pass

        # Fallback: check app_data/drawings/{user_name}/
        safe_user = _sanitize_name(username)
        user_dir = os.path.join(DRAWINGS_DIR, safe_user)
        if os.path.exists(user_dir) and os.path.isdir(user_dir):
            combined = {}
            for fname in os.listdir(user_dir):
                if fname.endswith(".json") and fname != "drawings.json":
                    sym = fname[:-5]
                    try:
                        with open(os.path.join(user_dir, fname), "r", encoding="utf-8") as f:
                            sym_data = json.load(f)
                            combined[sym] = sym_data
                    except Exception:
                        pass
            if combined:
                return combined

    return {}


def save_user_drawings_data(username, symbol, lines, shapes):
    """
    Stores drawings for a given symbol in:
    1. app_data/drawings/{user_name}.json
    2. app_data/drawings/{user_name}/{symbol}.json
    3. app_data/drawings/{user_name}/drawings.json
    """
    _ensure_drawings_dir()
    safe_user = _sanitize_name(username)
    safe_symbol = _sanitize_symbol(symbol)
    user_file = get_user_drawings_path(safe_user)
    user_dir = get_user_drawings_dir(safe_user)
    symbol_file = os.path.join(user_dir, f"{safe_symbol}.json")
    user_dir_drawings = os.path.join(user_dir, "drawings.json")

    now_iso = datetime.datetime.now().isoformat()
    symbol_record = {
        "symbol": safe_symbol,
        "lines": lines if isinstance(lines, list) else [],
        "shapes": shapes if isinstance(shapes, list) else [],
        "updated_at": now_iso
    }

    with _DRAWINGS_LOCK:
        # 1. Update full user dictionary in app_data/drawings/{user_name}.json
        user_data = {}
        if os.path.exists(user_file):
            try:
                with open(user_file, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                    if isinstance(existing, dict):
                        user_data = existing
            except Exception:
                user_data = {}

        user_data[safe_symbol] = symbol_record

        temp_user_file = f"{user_file}.tmp"
        with open(temp_user_file, "w", encoding="utf-8") as f:
            json.dump(user_data, f, indent=2, ensure_ascii=False)
        os.replace(temp_user_file, user_file)

        # 2. Write per-symbol file in app_data/drawings/{user_name}/{symbol}.json
        temp_sym_file = f"{symbol_file}.tmp"
        with open(temp_sym_file, "w", encoding="utf-8") as f:
            json.dump(symbol_record, f, indent=2, ensure_ascii=False)
        os.replace(temp_sym_file, symbol_file)

        # 3. Write drawings.json inside app_data/drawings/{user_name}/
        temp_dir_drawings = f"{user_dir_drawings}.tmp"
        with open(temp_dir_drawings, "w", encoding="utf-8") as f:
            json.dump(user_data, f, indent=2, ensure_ascii=False)
        os.replace(temp_dir_drawings, user_dir_drawings)

    return symbol_record


def delete_user_drawings_for_symbol(username, symbol):
    """
    Removes drawings for a symbol from both master JSON and folder.
    """
    _ensure_drawings_dir()
    safe_user = _sanitize_name(username)
    safe_symbol = _sanitize_symbol(symbol)
    user_file = get_user_drawings_path(safe_user)
    user_dir = get_user_drawings_dir(safe_user)
    symbol_file = os.path.join(user_dir, f"{safe_symbol}.json")

    with _DRAWINGS_LOCK:
        user_data = {}
        if os.path.exists(user_file):
            try:
                with open(user_file, "r", encoding="utf-8") as f:
                    user_data = json.load(f)
            except Exception:
                user_data = {}

        if safe_symbol in user_data:
            del user_data[safe_symbol]
            temp_file = f"{user_file}.tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(user_data, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, user_file)

        if os.path.exists(symbol_file):
            try:
                os.remove(symbol_file)
            except Exception:
                pass


# =========================================================================
# API ROUTES
# =========================================================================

@drawings_bp.route("/api/drawings", methods=["GET"])
def get_drawings():
    """
    Fetch chart drawings for the current user.
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
    Save or update chart drawings for a symbol.
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
        "message": f"Drawings for {symbol} saved successfully",
        "username": username,
        "symbol": saved_record["symbol"],
        "lines_count": len(saved_record["lines"]),
        "shapes_count": len(saved_record["shapes"]),
        "updated_at": saved_record["updated_at"]
    })


@drawings_bp.route("/api/drawings/sync", methods=["POST"])
def sync_drawings():
    """
    Bulk sync all drawings from client to backend.
    Expected JSON payload:
    {
        "drawings": {
            "INFY": { "lines": [...], "shapes": [...] },
            "TCS": { "lines": [...], "shapes": [...] }
        }
    }
    """
    username = _get_active_username()
    data = request.get_json(silent=True) or {}
    drawings_map = data.get("drawings", {})

    saved_count = 0
    for sym, rec in drawings_map.items():
        if not sym:
            continue
        lines = rec.get("lines", []) if isinstance(rec, dict) else []
        shapes = rec.get("shapes", []) if isinstance(rec, dict) else []
        save_user_drawings_data(username, sym, lines, shapes)
        saved_count += 1

    return jsonify({
        "success": True,
        "message": f"Successfully synced {saved_count} symbol drawings",
        "username": username,
        "synced_count": saved_count
    })


@drawings_bp.route("/api/drawings", methods=["DELETE"])
def delete_drawings():
    """
    Delete drawings for a symbol.
    """
    username = _get_active_username()
    symbol = request.args.get("symbol") or (request.json.get("symbol") if request.is_json and request.json else None)
    if not symbol:
        return jsonify({"success": False, "error": "symbol parameter is required"}), 400

    delete_user_drawings_for_symbol(username, symbol)
    return jsonify({
        "success": True,
        "message": f"Drawings for {symbol} removed successfully",
        "username": username,
        "symbol": symbol
    })

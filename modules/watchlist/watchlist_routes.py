import os
import re
import datetime
import urllib.parse
from flask import Blueprint, request, jsonify, session, render_template
from modules.common.auth_utils import login_required
from modules.common.data_paths import BASE_DATA_DIR, DATA_FILE, USER_DATA_DIR
from modules.common.market_fetcher import resolve_watchlist_symbol, fetcher, stock_cache
from db_store import load_user_doc_db, save_user_doc_db

watchlist_bp = Blueprint("watchlist_api", __name__)


@watchlist_bp.route("/watchlists", methods=["GET"])
@login_required
def watchlists_page():
    return render_template("index.html", initial_tab="watchlists")

_USER_WL_CACHE = {}

def find_watchlist_key(data, raw_name):
    if not isinstance(data, dict) or not raw_name:
        return None
    name_str = urllib.parse.unquote(str(raw_name))
    norm_target = re.sub(r"\s+", " ", name_str).strip().lower()
    for k in data.keys():
        if k == raw_name or k == name_str:
            return k
        if re.sub(r"\s+", " ", str(k)).strip().lower() == norm_target:
            return k
    return None


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
    if username in _USER_WL_CACHE:
        return _USER_WL_CACHE[username]

    filepath = get_user_watchlist_file(username)
    def default_wl():
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

    data = load_user_doc_db("watchlists", username, filepath, default_factory=default_wl)
    _USER_WL_CACHE[username] = data
    return data

def save_data(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    _USER_WL_CACHE[username] = data
    filepath = get_user_watchlist_file(username)
    save_user_doc_db("watchlists", username, data, filepath)


@watchlist_bp.route("/api/watchlists", methods=["GET"])
@login_required
def get_watchlists():
    return jsonify(load_data())

@watchlist_bp.route("/api/watchlists/order", methods=["PUT"])
@login_required
def reorder_watchlists():
    data = load_data()
    payload = request.get_json(silent=True) or {}
    names = payload.get("names")
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
        return jsonify({"success": False, "error": "A watchlist name order is required."}), 400
    if len(names) != len(data) or len(set(names)) != len(names) or set(names) != set(data):
        return jsonify({"success": False, "error": "The supplied watchlist order does not match this account's watchlists."}), 400

    reordered = {name: data[name] for name in names}
    save_data(reordered)
    return jsonify({"success": True, "watchlists": reordered})

@watchlist_bp.route("/api/watchlists", methods=["POST"])
@login_required
def create_watchlist():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Name is required"}), 400

    data = load_data()
    target_key = find_watchlist_key(data, name)
    if target_key:
        return jsonify({"error": "Watchlist already exists"}), 400

    clean_name = re.sub(r"\s+", " ", str(name)).strip()
    data[clean_name] = []
    save_data(data)
    return jsonify({"success": True, "watchlists": data})

@watchlist_bp.route("/api/watchlists/<name>", methods=["DELETE"])
@login_required
def delete_watchlist(name):
    data = load_data()
    target_key = find_watchlist_key(data, name)
    if target_key and target_key in data:
        del data[target_key]
        save_data(data)
    return jsonify({"success": True, "watchlists": data})


@watchlist_bp.route("/api/watchlists/<name>/stocks", methods=["POST"])
@login_required
def add_stock(name):
    symbol = request.json.get("symbol")
    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400

    resolved_symbol, exchange = resolve_watchlist_symbol(symbol)

    # Retain the existing typo-correction behavior when Yahoo cannot resolve
    # the supplied symbol directly.
    if not resolved_symbol:
        clean_sym = re.sub(r"\.(NS|BO)$", "", str(symbol).strip().upper())
        matches = difflib.get_close_matches(clean_sym, POPULAR_INDIAN_STOCKS.keys(), n=1, cutoff=0.5)
        if matches:
            resolved_symbol, exchange = resolve_watchlist_symbol(matches[0])

    if not resolved_symbol:
        return jsonify({
            "error": f"Symbol '{str(symbol).strip()}' was not found on Yahoo Finance (NSE or BSE)."
        }), 400

    data = load_data()
    target_key = find_watchlist_key(data, name)
    if not target_key:
        return jsonify({"error": "Watchlist not found"}), 404

    if resolved_symbol not in data[target_key]:
        data[target_key].append(resolved_symbol)
        save_data(data)

    return jsonify({"success": True, "symbol": resolved_symbol, "exchange": exchange, "watchlists": data})


@watchlist_bp.route("/api/watchlists/<name>/stocks/import-txt", methods=["POST"])
@login_required
def import_watchlist_txt(name):
    """Import comma-separated watchlist symbols after Yahoo validation."""
    data = load_data()
    target_key = find_watchlist_key(data, name)
    if not target_key:
        return jsonify({"error": "Watchlist not found"}), 404

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "TXT file is required"}), 400

    try:
        content = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"error": "Unable to read the TXT file. Please use UTF-8 text."}), 400

    # Comma is the documented format; line breaks are also accepted so a
    # manually edited sample remains easy to use.
    raw_symbols = [part.strip() for part in re.split(r"[,\r\n]+", content) if part.strip()]

    # Preserve first occurrence while ignoring duplicates caused by spacing,
    # case, or repeated entries in the TXT file.
    unique_symbols = []
    seen = set()
    for raw in raw_symbols:
        normalized = re.sub(r"\s+", "", raw).upper()
        normalized = re.sub(r"\.(NS|BO)$", "", normalized)
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique_symbols.append(raw.strip())

    if not unique_symbols:
        return jsonify({"error": "The TXT file does not contain any stock symbols."}), 400

    added_symbols = []
    not_added_symbols = []
    already_present_symbols = []
    bse_symbols = []

    for raw_symbol in unique_symbols:
        resolved_symbol, exchange = resolve_watchlist_symbol(raw_symbol)
        if not resolved_symbol:
            not_added_symbols.append(raw_symbol)
            continue

        if resolved_symbol in data[target_key]:
            already_present_symbols.append(raw_symbol)
            continue

        data[target_key].append(resolved_symbol)
        added_symbols.append(resolved_symbol)
        if exchange == "BSE":
            bse_symbols.append(resolved_symbol)

    if added_symbols:
        save_data(data)

    return jsonify({
        "success": True,
        "total_stocks": len(unique_symbols),
        "added_count": len(added_symbols),
        "added_symbols": added_symbols,
        "not_added_count": len(not_added_symbols),
        "not_added_symbols": not_added_symbols,
        "already_present_count": len(already_present_symbols),
        "already_present_symbols": already_present_symbols,
        "bse_count": len(bse_symbols),
        "bse_symbols": bse_symbols,
        "watchlists": data
    })

@watchlist_bp.route("/api/watchlists/<name>/stocks/<symbol>", methods=["DELETE"])
@watchlist_bp.route("/api/watchlists/<name>/stocks/<path:symbol>", methods=["DELETE"])
@login_required
def remove_stock(name, symbol):
    data = load_data()
    target_key = find_watchlist_key(data, name)

    if target_key and target_key in data:
        sym_unquoted = urllib.parse.unquote(str(symbol)).strip()
        sym_clean = re.sub(r"\.(NS|BO)$", "", sym_unquoted, flags=re.IGNORECASE)

        to_remove = []
        for s in data[target_key]:
            s_str = str(s).strip()
            if s_str.upper() == sym_unquoted.upper() or s_str.upper() == str(symbol).strip().upper():
                to_remove.append(s)
            elif re.sub(r"\.(NS|BO)$", "", s_str, flags=re.IGNORECASE).upper() == sym_clean.upper():
                to_remove.append(s)

        for s in to_remove:
            if s in data[target_key]:
                data[target_key].remove(s)

        save_data(data)

    return jsonify({"success": True, "watchlists": data})

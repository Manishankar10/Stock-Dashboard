import os
import re
import json
import time
import datetime
import threading
from flask import Blueprint, request, jsonify, session

from modules.common.data_paths import APP_DATA_DIR, USER_DATA_DIR
from modules.common.auth_utils import login_required
from modules.common.market_fetcher import POPULAR_INDIAN_STOCKS
import db_store
from db_store import load_user_doc_db, save_user_doc_db
from modules.portfolio.portfolio_routes import load_user_transactions, load_portfolios

stock_notes_bp = Blueprint("stock_notes", __name__)
_NOTES_LOCK = threading.RLock()


def _sanitize_username(val):
    if not val:
        return "admin"
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(val).strip().lower())
    return clean or "admin"


def _get_active_username():
    user = session.get("username") or session.get("user")
    if user:
        return str(user)
    req_user = request.args.get("username") or ((request.get_json(silent=True) or {}).get("username") if request.is_json else None)
    if req_user:
        return str(req_user)
    return "admin"


def _normalize_symbol(sym):
    if not sym:
        return ""
    s = str(sym).strip().upper()
    s = re.sub(r"\.(NS|BO|BS)$", "", s, flags=re.IGNORECASE)
    return s


def get_user_notes_filepath(username):
    safe_user = _sanitize_username(username)
    return os.path.join(USER_DATA_DIR, f"{safe_user}_stock_notes.json")


def load_user_stock_notes(username=None):
    if not username:
        username = _get_active_username()
    filepath = get_user_notes_filepath(username)
    data = load_user_doc_db("stock_notes", username, filepath, default_factory=dict)
    return data if isinstance(data, dict) else {}


def save_user_stock_notes(notes_data, username=None):
    if not username:
        username = _get_active_username()
    filepath = get_user_notes_filepath(username)
    save_user_doc_db("stock_notes", username, notes_data, filepath)


def _get_company_name(clean_sym):
    if clean_sym in POPULAR_INDIAN_STOCKS:
        return POPULAR_INDIAN_STOCKS[clean_sym]
    for k, v in POPULAR_INDIAN_STOCKS.items():
        if _normalize_symbol(k) == clean_sym:
            return v
    return clean_sym


@stock_notes_bp.route("/api/stock-notes/<symbol>", methods=["GET"])
@login_required
def get_stock_notes(symbol):
    username = _get_active_username()
    clean_sym = _normalize_symbol(symbol)
    if not clean_sym:
        return jsonify({"error": "Invalid symbol"}), 400

    company_name = _get_company_name(clean_sym)
    user_notes_map = load_user_stock_notes(username)
    custom_notes = user_notes_map.get(clean_sym, [])
    if not isinstance(custom_notes, list):
        custom_notes = []

    all_notes = []

    # 1. Add user custom notes
    for n in custom_notes:
        if isinstance(n, dict):
            all_notes.append({
                "id": n.get("id") or f"note_{int(time.time()*1000)}",
                "date": n.get("date") or datetime.date.today().isoformat(),
                "timestamp": n.get("timestamp") or n.get("date") or "",
                "created_at": n.get("created_at") or "",
                "type": n.get("type", "NOTE").upper(),
                "content": n.get("content", "").strip(),
                "details": n.get("details", ""),
                "is_transaction": False,
                "portfolio": n.get("portfolio", "")
            })

    # 2. Extract Buy & Sell comments from user transactions
    seen_tx_ids = set()
    try:
        transactions = load_user_transactions(username)
        if isinstance(transactions, list):
            for tx in transactions:
                if not isinstance(tx, dict):
                    continue
                tx_sym = _normalize_symbol(tx.get("symbol", ""))
                if tx_sym == clean_sym:
                    tx_id = str(tx.get("id", ""))
                    seen_tx_ids.add(tx_id)
                    tx_type = str(tx.get("type", "BUY")).upper()
                    tx_date = str(tx.get("date") or "").strip()
                    tx_notes = str(tx.get("notes") or tx.get("buy_reason") or "").strip()
                    qty = tx.get("quantity", 0)
                    price = tx.get("price", 0)
                    pf = tx.get("portfolio", "")

                    if tx_type == "BUY":
                        details_str = f"Bought {qty} shares @ ₹{float(price):,.2f}"
                        if pf:
                            details_str += f" | {pf}"
                        all_notes.append({
                            "id": tx_id or f"tx_{int(time.time()*1000)}",
                            "date": tx_date or datetime.date.today().isoformat(),
                            "timestamp": tx.get("timestamp") or tx_date,
                            "created_at": tx.get("timestamp") or tx_date,
                            "type": "BUY",
                            "content": tx_notes or "Buy transaction executed",
                            "details": details_str,
                            "is_transaction": True,
                            "portfolio": pf
                        })
                    elif tx_type == "SELL":
                        pnl_amt = tx.get("realized_pnl")
                        pnl_pct = tx.get("realized_pnl_pct")
                        details_str = f"Sold {qty} shares @ ₹{float(price):,.2f}"
                        if pnl_amt is not None and pnl_pct is not None:
                            sign = "+" if float(pnl_amt) >= 0 else ""
                            details_str += f" | Realized P&L: {sign}₹{float(pnl_amt):,.2f} ({sign}{float(pnl_pct):.2f}%)"
                        if pf:
                            details_str += f" | {pf}"
                        all_notes.append({
                            "id": tx_id or f"tx_{int(time.time()*1000)}",
                            "date": tx_date or datetime.date.today().isoformat(),
                            "timestamp": tx.get("timestamp") or tx_date,
                            "created_at": tx.get("timestamp") or tx_date,
                            "type": "SELL",
                            "content": tx_notes or "Sell transaction executed",
                            "details": details_str,
                            "is_transaction": True,
                            "portfolio": pf
                        })
    except Exception as e:
        print(f"[Stock Notes] Error loading transactions for {clean_sym}: {e}")

    # 3. Extract buy_reason from current active holdings if not already logged in transactions
    try:
        portfolios = load_portfolios(username)
        if isinstance(portfolios, dict):
            for pf_name, holdings in portfolios.items():
                if isinstance(holdings, list):
                    for h_idx, h in enumerate(holdings):
                        if not isinstance(h, dict):
                            continue
                        h_sym = _normalize_symbol(h.get("symbol", ""))
                        if h_sym == clean_sym:
                            buy_reason = str(h.get("buy_reason") or "").strip()
                            h_date = str(h.get("buy_date") or "").strip()
                            # Check if this exact buy reason and date was already captured in a transaction
                            already_in_tx = any(
                                n.get("is_transaction") and n.get("type") == "BUY" and
                                n.get("date") == h_date and n.get("content") == buy_reason
                                for n in all_notes if buy_reason
                            )
                            if buy_reason and not already_in_tx:
                                qty = h.get("quantity", 0)
                                price = h.get("buy_price", 0)
                                details_str = f"Holding in {pf_name}: {qty} shares @ ₹{float(price):,.2f}"
                                all_notes.append({
                                    "id": f"holding_{clean_sym}_{pf_name}_{h_idx}",
                                    "date": h_date or datetime.date.today().isoformat(),
                                    "timestamp": h_date,
                                    "created_at": h_date,
                                    "type": "BUY",
                                    "content": buy_reason,
                                    "details": details_str,
                                    "is_transaction": True,
                                    "portfolio": pf_name
                                })
    except Exception as e:
        print(f"[Stock Notes] Error checking holdings for {clean_sym}: {e}")

    # 4. Sort all notes by date descending (order by date desc)
    def _sort_key(item):
        d = str(item.get("date") or "").strip()
        c = str(item.get("created_at") or "").strip()
        match_dmy = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})", d)
        if match_dmy:
            day, month, year = match_dmy.groups()
            d = f"{year}-{int(month):02d}-{int(day):02d}"
        if not re.match(r"^\d{4}-\d{2}-\d{2}", d):
            d = "1970-01-01"
        return f"{d} {c}"

    all_notes.sort(key=_sort_key, reverse=True)

    return jsonify({
        "success": True,
        "symbol": symbol,
        "clean_symbol": clean_sym,
        "company_name": company_name,
        "count": len(all_notes),
        "notes": all_notes
    })


@stock_notes_bp.route("/api/stock-notes/<symbol>", methods=["POST"])
@login_required
def add_stock_note(symbol):
    username = _get_active_username()
    clean_sym = _normalize_symbol(symbol)
    if not clean_sym:
        return jsonify({"error": "Invalid symbol"}), 400

    payload = request.get_json(silent=True) or {}
    content = str(payload.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Note content cannot be empty"}), 400

    note_date = str(payload.get("date") or "").strip()
    if not note_date:
        note_date = datetime.date.today().isoformat()

    note_type = str(payload.get("type") or "NOTE").strip().upper()
    if note_type not in ["NOTE", "BUY", "SELL", "ANALYSIS", "TARGET"]:
        note_type = "NOTE"

    now_ist = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    timestamp_str = now_ist.strftime("%d %b %Y, %I:%M %p")
    note_id = f"note_{int(time.time() * 1000)}"

    new_note = {
        "id": note_id,
        "date": note_date,
        "timestamp": timestamp_str,
        "created_at": now_ist.isoformat(),
        "type": note_type,
        "content": content,
        "details": payload.get("details", ""),
        "portfolio": payload.get("portfolio", "")
    }

    with _NOTES_LOCK:
        user_notes_map = load_user_stock_notes(username)
        if clean_sym not in user_notes_map or not isinstance(user_notes_map[clean_sym], list):
            user_notes_map[clean_sym] = []
        user_notes_map[clean_sym].insert(0, new_note)
        save_user_stock_notes(user_notes_map, username)

    # Return full refreshed notes list
    return get_stock_notes(symbol)


@stock_notes_bp.route("/api/stock-notes/<symbol>/<note_id>", methods=["DELETE"])
@login_required
def delete_stock_note(symbol, note_id):
    username = _get_active_username()
    clean_sym = _normalize_symbol(symbol)
    if not clean_sym or not note_id:
        return jsonify({"error": "Invalid symbol or note ID"}), 400

    with _NOTES_LOCK:
        user_notes_map = load_user_stock_notes(username)
        if clean_sym in user_notes_map and isinstance(user_notes_map[clean_sym], list):
            user_notes_map[clean_sym] = [n for n in user_notes_map[clean_sym] if isinstance(n, dict) and n.get("id") != note_id]
            save_user_stock_notes(user_notes_map, username)

    # Return refreshed notes list
    return get_stock_notes(symbol)

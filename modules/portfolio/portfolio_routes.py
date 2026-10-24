import os
from modules.common.ist_datetime import format_ist_standard, today_ist_str
import re
import json
import difflib
import datetime
import uuid
import math
import urllib.parse
from flask import Blueprint, request, jsonify, session, render_template
from modules.common.auth_utils import login_required
from modules.common.data_paths import BASE_DATA_DIR, PORTFOLIO_FILE, USER_DATA_DIR
from modules.common.market_fetcher import (
    resolve_watchlist_symbol,
    fetcher,
    stock_cache,
    format_financial_symbol,
    POPULAR_INDIAN_STOCKS
)
from db_store import load_user_doc_db, save_user_doc_db
from modules.watchlist.watchlist_routes import get_user_portfolio_file

# Deferred imports to avoid circular dependency
def _get_external_helpers():
    from modules.watchlist.watchlist_routes import load_data, save_data
    from modules.alerts.alerts_routes import load_user_alerts, save_user_alerts
    from modules.smallcases import load_user_smallcases, save_user_smallcases
    return load_data, save_data, load_user_alerts, save_user_alerts, load_user_smallcases, save_user_smallcases

portfolio_bp = Blueprint("portfolio_api", __name__)


@portfolio_bp.route("/portfolios", methods=["GET"])
@login_required
def portfolios_page():
    return render_template("index.html", initial_tab="portfolios")

_USER_PF_CACHE = {}

def load_portfolios(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {}
    if username in _USER_PF_CACHE:
        return _USER_PF_CACHE[username]

    filepath = get_user_portfolio_file(username)
    def default_pf():
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

    data = load_user_doc_db("portfolios", username, filepath, default_factory=default_pf)
    _USER_PF_CACHE[username] = data
    return data

def save_portfolios(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    _USER_PF_CACHE[username] = data
    filepath = get_user_portfolio_file(username)
    save_user_doc_db("portfolios", username, data, filepath)

def get_user_transactions_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_transactions.json")

def load_user_transactions(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return []
    filepath = get_user_transactions_file(username)
    data = load_user_doc_db("transactions", username, filepath, default_factory=list)
    return data if isinstance(data, list) else []

def save_user_transactions(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_transactions_file(username)
    save_user_doc_db("transactions", username, data, filepath)


def find_portfolio_key(data, target_name):
    if not isinstance(data, dict) or not target_name:
        return None
    if target_name in data:
        return target_name
    name_str = urllib.parse.unquote(str(target_name))
    if name_str in data:
        return name_str
    target_clean = re.sub(r"\s+", " ", name_str).strip().lower()
    for k in data.keys():
        if k == target_name or str(k).strip() == str(name_str).strip():
            return k
        if re.sub(r"\s+", " ", str(k)).strip().lower() == target_clean:
            return k
    return None

@portfolio_bp.route("/api/portfolios", methods=["GET"])
@login_required
def get_portfolios():
    return jsonify(load_portfolios())

@portfolio_bp.route("/api/portfolios", methods=["POST"])
@login_required
def create_portfolio():
    name = request.json.get("name")
    if not name:
        return jsonify({"error": "Portfolio name is required"}), 400
    
    clean_name = re.sub(r"\s+", " ", str(name)).strip()
    data = load_portfolios()
    target_key = find_portfolio_key(data, clean_name)
    if target_key:
        return jsonify({"error": "Portfolio already exists"}), 400
    
    data[clean_name] = []
    save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@portfolio_bp.route("/api/portfolios/<name>", methods=["DELETE"])
@login_required
def delete_portfolio(name):
    data = load_portfolios()
    target_key = find_portfolio_key(data, name)
    if target_key and target_key in data:
        del data[target_key]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@portfolio_bp.route("/api/portfolios/<name>/stocks", methods=["POST"])
@login_required
def add_portfolio_stock(name):
    symbol = request.json.get("symbol")
    buy_price = request.json.get("buy_price")
    quantity = request.json.get("quantity")
    buy_date = request.json.get("buy_date") or today_ist_str()
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
    target_key = find_portfolio_key(data, name)
    if not target_key:
        return jsonify({"error": f"Portfolio '{name}' not found"}), 404

    existing_holding = None
    for holding in data[target_key]:
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
            "portfolio": target_key,
            "symbol": symbol,
            "type": "BUY",
            "quantity": round(quantity, 4),
            "price": round(buy_price, 2),
            "total_amount": round(buy_price * quantity, 2),
            "realized_pnl": 0.0,
            "realized_pnl_pct": 0.0,
            "avg_buy_price": round(buy_price, 2),
            "date": buy_date,
            "timestamp": format_ist_standard(),
            "notes": buy_reason
        }
        txs = load_user_transactions()
        txs.insert(0, tx)
        save_user_transactions(txs)
    else:
        data[target_key].append({
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
            "portfolio": target_key,
            "symbol": symbol,
            "type": "BUY",
            "quantity": round(quantity, 4),
            "price": round(buy_price, 2),
            "total_amount": round(buy_price * quantity, 2),
            "realized_pnl": 0.0,
            "realized_pnl_pct": 0.0,
            "avg_buy_price": round(buy_price, 2),
            "date": buy_date,
            "timestamp": format_ist_standard(),
            "notes": buy_reason
        }
        txs = load_user_transactions()
        txs.insert(0, tx)
        save_user_transactions(txs)

    save_portfolios(data)
    return jsonify({"success": True, "portfolios": data, "transactions": load_user_transactions()})

@portfolio_bp.route("/api/portfolios/<name>/stocks/sell", methods=["POST"])
@login_required
def sell_portfolio_stock(name):
    symbol = request.json.get("symbol")
    sell_price = request.json.get("sell_price")
    quantity = request.json.get("quantity")
    sell_date = request.json.get("sell_date") or today_ist_str()
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
    target_key = find_portfolio_key(data, name)
    if not target_key:
        return jsonify({"error": f"Portfolio '{name}' not found"}), 404

    target_holding = None
    for holding in data[target_key]:
        if holding.get("symbol") == symbol:
            target_holding = holding
            break

    if not target_holding:
        return jsonify({"error": f"Stock {symbol} not found in portfolio '{target_key}'"}), 404

    curr_qty = float(target_holding.get("quantity", 0))
    avg_buy_price = float(target_holding.get("buy_price", 0))

    if sell_qty > curr_qty + 0.0001:
        return jsonify({"error": f"Cannot sell {sell_qty} shares. You only own {curr_qty} shares."}), 400

    realized_pnl_amt = (sell_price - avg_buy_price) * sell_qty
    realized_pnl_pct = ((sell_price - avg_buy_price) / avg_buy_price * 100) if avg_buy_price > 0 else 0.0

    rem_qty = curr_qty - sell_qty
    if rem_qty <= 0.0001:
        data[target_key] = [h for h in data[target_key] if h.get("symbol") != symbol]
    else:
        target_holding["quantity"] = round(rem_qty, 4)

    save_portfolios(data)

    # Record SELL transaction log
    tx_id = f"tx_{int(datetime.datetime.now().timestamp() * 1000)}"
    tx = {
        "id": tx_id,
        "portfolio": target_key,
        "symbol": symbol,
        "type": "SELL",
        "quantity": round(sell_qty, 4),
        "price": round(sell_price, 2),
        "total_amount": round(sell_price * sell_qty, 2),
        "realized_pnl": round(realized_pnl_amt, 2),
        "realized_pnl_pct": round(realized_pnl_pct, 2),
        "avg_buy_price": round(avg_buy_price, 2),
        "date": sell_date,
        "timestamp": format_ist_standard(),
        "notes": notes
    }
    txs = load_user_transactions()
    txs.insert(0, tx)
    save_user_transactions(txs)

    return jsonify({"success": True, "portfolios": data, "transaction": tx, "transactions": txs})

@portfolio_bp.route("/api/portfolios/<name>/stocks/<symbol>", methods=["DELETE"])
@login_required
def remove_portfolio_stock(name, symbol):
    data = load_portfolios()
    target_key = find_portfolio_key(data, name)
    if target_key and target_key in data:
        data[target_key] = [item for item in data[target_key] if item.get("symbol") != symbol]
        save_portfolios(data)
    return jsonify({"success": True, "portfolios": data})

@portfolio_bp.route("/api/transactions", methods=["GET"])
@login_required
def get_transactions():
    return jsonify(load_user_transactions())

@portfolio_bp.route("/api/transactions/<tx_id>", methods=["DELETE"])
@login_required
def delete_transaction(tx_id):
    txs = load_user_transactions()
    txs = [t for t in txs if t.get("id") != tx_id]
    save_user_transactions(txs)
    return jsonify({"success": True, "transactions": txs})

# =========================================================
# PRICE ALERTS & NOTIFICATIONS ENDPOINTS
# =========================================================


@portfolio_bp.route("/api/backup/export", methods=["GET"])
@login_required
def export_backup():
    backup_data = {
        "watchlists": _get_external_helpers()[0](),
        "portfolios": load_portfolios(),
        "transactions": load_user_transactions(),
        "alerts": _get_external_helpers()[2](),
        "smallcases": _get_external_helpers()[4](),
        "exported_at": format_ist_standard()
    }
    response = jsonify(backup_data)
    filename = f"stock_watchlist_backup_{today_ist_str()}.json"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response

@portfolio_bp.route("/api/backup/import", methods=["POST"])
@login_required
def import_backup():
    try:
        req_data = request.get_json(force=True)
        if not req_data:
            return jsonify({"error": "No JSON data provided"}), 400
            
        watchlists = req_data.get("watchlists")
        portfolios = req_data.get("portfolios")
        transactions = req_data.get("transactions")
        alerts = req_data.get("alerts")
        smallcases = req_data.get("smallcases")
        
        if watchlists is None and portfolios is None and transactions is None and alerts is None and smallcases is None:
            return jsonify({"error": "Invalid backup file. Must contain watchlists, portfolios, transactions, alerts, or smallcases"}), 400
            
        if watchlists is not None:
            _get_external_helpers()[1](watchlists)
        if portfolios is not None:
            save_portfolios(portfolios)
        if transactions is not None:
            save_user_transactions(transactions)
        if alerts is not None:
            _get_external_helpers()[3](alerts)
        if smallcases is not None:
            _get_external_helpers()[5](smallcases)
            
        return jsonify({
            "success": True, 
            "message": "Data restored successfully!",
            "watchlists": _get_external_helpers()[0](),
            "portfolios": load_portfolios(),
            "transactions": load_user_transactions(),
            "alerts": _get_external_helpers()[2](),
            "smallcases": _get_external_helpers()[4]()
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


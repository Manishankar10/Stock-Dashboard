import os
import datetime
import uuid
from flask import Blueprint, request, jsonify, session
from modules.common.auth_utils import login_required
from modules.common.data_paths import BASE_DATA_DIR, USER_DATA_DIR
from modules.common.market_fetcher import fetcher
from db_store import load_user_doc_db, save_user_doc_db

alerts_bp = Blueprint("alerts_api", __name__)

def get_user_alerts_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_alerts.json")

def load_user_alerts(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {"alerts": [], "notifications": []}
    filepath = get_user_alerts_file(username)
    def default_alt():
        d = {"alerts": [], "notifications": []}
        save_user_alerts(d, username)
        return d
    data = load_user_doc_db("alerts", username, filepath, default_factory=default_alt)
    if not isinstance(data, dict):
        data = {"alerts": [], "notifications": []}
    if "alerts" not in data or not isinstance(data["alerts"], list):
        data["alerts"] = []
    if "notifications" not in data or not isinstance(data["notifications"], list):
        data["notifications"] = []
    return data

def save_user_alerts(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    filepath = get_user_alerts_file(username)


@alerts_bp.route("/api/alerts", methods=["GET"])
@login_required
def get_alerts():
    return jsonify(load_user_alerts())

@alerts_bp.route("/api/alerts", methods=["POST"])
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

@alerts_bp.route("/api/alerts/<alert_id>", methods=["DELETE"])
@login_required
def delete_alert(alert_id):
    data = load_user_alerts()
    data["alerts"] = [a for a in data["alerts"] if a.get("id") != alert_id]
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@alerts_bp.route("/api/notifications/trigger", methods=["POST"])
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

@alerts_bp.route("/api/notifications/<notif_id>", methods=["DELETE"])
@login_required
def delete_notification(notif_id):
    data = load_user_alerts()
    data["notifications"] = [n for n in data["notifications"] if n.get("id") != notif_id]
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@alerts_bp.route("/api/notifications/clear_all", methods=["DELETE"])
@login_required
def clear_all_notifications():
    data = load_user_alerts()
    data["notifications"] = []
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})

@alerts_bp.route("/api/notifications/mark_read", methods=["POST"])
@login_required
def mark_notifications_read():
    data = load_user_alerts()
    for n in data["notifications"]:
        n["read"] = True
    save_user_alerts(data)
    return jsonify({"success": True, "alerts_data": data})


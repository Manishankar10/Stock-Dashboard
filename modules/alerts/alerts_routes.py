import os
import datetime
import uuid
from flask import Blueprint, request, jsonify, session
from modules.common.auth_utils import login_required
from modules.common.ist_datetime import format_ist_standard
from modules.common.data_paths import BASE_DATA_DIR, USER_DATA_DIR
from modules.common.market_fetcher import fetcher
from db_store import load_user_alerts_db, save_user_alerts_db

alerts_bp = Blueprint("alerts_api", __name__)

def get_user_alerts_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_alerts.json")

def load_user_alerts(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {"alerts": [], "notifications": []}
    return load_user_alerts_db(username=username)

def save_user_alerts(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return False
    return save_user_alerts_db(data=data, username=username)


@alerts_bp.route("/api/alerts", methods=["GET"])
@login_required
def get_alerts():
    return jsonify(load_user_alerts())

@alerts_bp.route("/api/alerts", methods=["POST"])
@login_required
def create_alert():
    req_data = request.get_json(silent=True) or {}
    symbol = req_data.get("symbol")
    target_price = req_data.get("target_price")
    condition = req_data.get("condition", "above")
    note = str(req_data.get("note", "")).strip()

    if not symbol or target_price is None:
        return jsonify({"error": "Stock symbol and target price are required"}), 400

    try:
        target_price = float(target_price)
        if target_price <= 0:
            return jsonify({"error": "Target price must be greater than zero"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Target price must be a valid number"}), 400

    symbol = str(symbol).strip().upper()
    if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
        symbol += ".NS"

    data = load_user_alerts()
    alert_id = f"alt_{int(datetime.datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:6]}"
    new_alert = {
        "id": alert_id,
        "symbol": symbol,
        "target_price": target_price,
        "condition": "below" if condition == "below" else "above",
        "note": note,
        "status": "active",
        "created_at": format_ist_standard()
    }
    data["alerts"].insert(0, new_alert)
    save_user_alerts(data)
    return jsonify({"success": True, "alert": new_alert, "alerts_data": data})

@alerts_bp.route("/api/alerts/<alert_id>", methods=["DELETE"])
@login_required
def delete_alert(alert_id):
    data = load_user_alerts()
    before_len = len(data["alerts"])
    data["alerts"] = [a for a in data["alerts"] if a.get("id") != alert_id]
    save_user_alerts(data)
    deleted = len(data["alerts"]) < before_len
    return jsonify({"success": True, "deleted": deleted, "alerts_data": data})

@alerts_bp.route("/api/notifications/trigger", methods=["POST"])
@login_required
def trigger_notification():
    req_data = request.get_json(silent=True) or {}
    alert_id = req_data.get("alert_id")
    symbol = str(req_data.get("symbol") or "").strip().upper()
    current_price = req_data.get("current_price")
    target_price = req_data.get("target_price")
    condition = req_data.get("condition", "above")
    note = str(req_data.get("note", "")).strip()

    data = load_user_alerts()
    
    # Mark alert as triggered
    matched = False
    for alt in data["alerts"]:
        if alt.get("id") == alert_id or (
            alt.get("symbol") == symbol and 
            float(alt.get("target_price", 0)) == float(target_price or 0) and 
            alt.get("condition") == condition
        ):
            alt["status"] = "triggered"
            alt["triggered_at"] = format_ist_standard()
            matched = True

    notif_id = f"notif_{int(datetime.datetime.now().timestamp() * 1000)}_{uuid.uuid4().hex[:6]}"
    cond_text = "crossed above" if condition == "above" else "crossed below"
    title = f"🔔 Alert Triggered: {symbol}"
    try:
        fmt_target = f"₹{float(target_price):,.2f}"
    except (ValueError, TypeError):
        fmt_target = str(target_price)
    try:
        fmt_current = f"₹{float(current_price):,.2f}"
    except (ValueError, TypeError):
        fmt_current = str(current_price)

    msg = f"{symbol} {cond_text} target price {fmt_target}! Current LTP: {fmt_current}."
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
        "created_at": format_ist_standard(),
        "read": False
    }
    data["notifications"].insert(0, new_notif)
    save_user_alerts(data)
    return jsonify({"success": True, "notification": new_notif, "alerts_data": data})

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

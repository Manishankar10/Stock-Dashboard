import os
import json
import datetime
from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from modules.common.auth_utils import (
    load_users,
    save_users,
    log_login_event,
    login_required,
    admin_required
)
from modules.common.data_paths import (
    LOGS_FILE,
    USERS_EXAMPLE_FILE
)

auth_admin_bp = Blueprint("auth_admin", __name__)

def _get_user_dependencies():
    from modules.watchlist.watchlist_routes import load_data, save_data, get_user_watchlist_file
    from modules.portfolio.portfolio_routes import load_portfolios, save_portfolios, load_user_transactions, save_user_transactions, get_user_portfolio_file
    from modules.alerts.alerts_routes import load_user_alerts, save_user_alerts
    from modules.smallcases import load_user_smallcases, save_user_smallcases
    return {
        "load_data": load_data,
        "save_data": save_data,
        "load_portfolios": load_portfolios,
        "save_portfolios": save_portfolios,
        "load_user_transactions": load_user_transactions,
        "save_user_transactions": save_user_transactions,
        "load_user_alerts": load_user_alerts,
        "save_user_alerts": save_user_alerts,
        "load_user_smallcases": load_user_smallcases,
        "save_user_smallcases": save_user_smallcases,
        "get_user_watchlist_file": get_user_watchlist_file,
        "get_user_portfolio_file": get_user_portfolio_file
    }

@auth_admin_bp.route("/login")
def login_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("login.html")

@auth_admin_bp.route("/register")
def register_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("register.html")

@auth_admin_bp.route("/insights")
@login_required
def insights_page():
    return render_template("index.html", initial_tab="insights")

@auth_admin_bp.route("/api/login", methods=["POST"])
def api_login():
    data = request.json or {}
    username = data.get("username", "").strip().lower()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    users = load_users()
    if username not in users or not check_password_hash(users[username]["password_hash"], password):
        log_login_event(username, "Failed (Bad Credentials)")
        return jsonify({"error": "Invalid username or password"}), 401

    session["username"] = username

    # Update login stats
    users[username]["last_login"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    users[username]["login_count"] = users[username].get("login_count", 0) + 1
    save_users(users)

    log_login_event(username, "Success")
    is_admin = users[username].get("is_admin", False) or users[username].get("role") == "admin"
    return jsonify({"success": True, "message": "Logged in successfully!", "username": username, "is_admin": is_admin})

@auth_admin_bp.route("/api/register", methods=["POST"])
def api_register():
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters long"}), 400

    safe_username = username.lower()
    users = load_users()
    if safe_username in users:
        return jsonify({"error": "Username already exists. Please log in or choose a different name."}), 400

    is_first = len(users) == 0
    is_admin = is_first or (safe_username == "admin")

    users[safe_username] = {
        "username": username,
        "password_hash": generate_password_hash(password),
        "plain_password": password,
        "role": "admin" if is_admin else "user",
        "is_admin": is_admin,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "last_login": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "login_count": 1
    }
    save_users(users)

    # Initialize user-specific watchlist & portfolio files
    _get_user_dependencies()["load_data"](safe_username)
    _get_user_dependencies()["load_portfolios"](safe_username)

    session["username"] = safe_username
    log_login_event(safe_username, "Registered & Logged In")
    return jsonify({"success": True, "message": "Registration successful!", "username": safe_username, "is_admin": is_admin})

@auth_admin_bp.route("/logout")
@auth_admin_bp.route("/api/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    if request.path.startswith("/api/"):
        return jsonify({"success": True, "message": "Logged out successfully"})
    return redirect(url_for("login_page"))


# Dedicated Admin Dashboard Routes & APIs
@auth_admin_bp.route("/admin")
@admin_required
def admin_page():
    return render_template("admin.html")

@auth_admin_bp.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    users = load_users()
    total_users = len(users)
    total_watchlists = 0
    total_portfolios = 0
    total_holdings_count = 0
    total_capital_deployed = 0.0

    for uname in users.keys():
        w_data = _get_user_dependencies()["load_data"](uname)
        p_data = _get_user_dependencies()["load_portfolios"](uname)
        total_watchlists += len(w_data)
        total_portfolios += len(p_data)
        for holdings in p_data.values():
            total_holdings_count += len(holdings)
            for item in holdings:
                qty = item.get("quantity", 0)
                price = item.get("buy_price", 0)
                total_capital_deployed += (qty * price)

    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            pass

    return jsonify({
        "total_users": total_users,
        "total_watchlists": total_watchlists,
        "total_portfolios": total_portfolios,
        "total_holdings_count": total_holdings_count,
        "total_capital_deployed": round(total_capital_deployed, 2),
        "logs_count": len(logs),
        "system_status": "Healthy & Operational"
    })

@auth_admin_bp.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    users = load_users()
    user_list = []
    for uname, record in users.items():
        w_data = _get_user_dependencies()["load_data"](uname)
        p_data = _get_user_dependencies()["load_portfolios"](uname)
        capital = 0.0
        h_count = 0
        for holdings in p_data.values():
            h_count += len(holdings)
            for item in holdings:
                capital += (item.get("quantity", 0) * item.get("buy_price", 0))

        user_list.append({
            "username": record.get("username", uname),
            "safe_username": uname,
            "plain_password": record.get("plain_password", "admin123" if uname in ("admin", "manishankar10") else "••••••••"),
            "role": record.get("role", "admin" if record.get("is_admin") else "user"),
            "is_admin": record.get("is_admin", False) or record.get("role") == "admin",
            "created_at": record.get("created_at", "N/A"),
            "last_login": record.get("last_login", "Never"),
            "login_count": record.get("login_count", 0),
            "watchlists_count": len(w_data),
            "portfolios_count": len(p_data),
            "holdings_count": h_count,
            "capital_deployed": round(capital, 2)
        })

    return jsonify(user_list)

@auth_admin_bp.route("/api/admin/users/<target_username>", methods=["GET"])
@admin_required
def admin_get_user_detail(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    record = users[target_username]
    w_data = _get_user_dependencies()["load_data"](target_username)
    p_data = _get_user_dependencies()["load_portfolios"](target_username)

    return jsonify({
        "username": record.get("username", target_username),
        "plain_password": record.get("plain_password", "admin123" if target_username in ("admin", "manishankar10") else "••••••••"),
        "role": record.get("role", "admin" if record.get("is_admin") else "user"),
        "is_admin": record.get("is_admin", False) or record.get("role") == "admin",
        "created_at": record.get("created_at", "N/A"),
        "last_login": record.get("last_login", "Never"),
        "login_count": record.get("login_count", 0),
        "watchlists": w_data,
        "portfolios": p_data
    })

@auth_admin_bp.route("/api/admin/users/<target_username>/reset_password", methods=["POST"])
@admin_required
def admin_reset_password(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    new_password = request.json.get("new_password", "").strip()
    if not new_password or len(new_password) < 4:
        return jsonify({"error": "Password must be at least 4 characters long"}), 400

    users[target_username]["password_hash"] = generate_password_hash(new_password)
    users[target_username]["plain_password"] = new_password
    save_users(users)
    return jsonify({"success": True, "message": f"Password for '{target_username}' reset successfully to '{new_password}'!"})

@auth_admin_bp.route("/api/admin/users/<target_username>/toggle_admin", methods=["POST"])
@admin_required
def admin_toggle_role(target_username):
    target_username = target_username.lower()
    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    current_is_admin = users[target_username].get("is_admin", False) or users[target_username].get("role") == "admin"
    new_status = not current_is_admin
    users[target_username]["is_admin"] = new_status
    users[target_username]["role"] = "admin" if new_status else "user"
    save_users(users)

    return jsonify({
        "success": True, 
        "message": f"Updated role for '{target_username}' to {'Admin' if new_status else 'User'}",
        "is_admin": new_status
    })

@auth_admin_bp.route("/api/admin/users/<target_username>", methods=["DELETE"])
@admin_required
def admin_delete_user(target_username):
    target_username = target_username.lower()
    if target_username == session.get("username"):
        return jsonify({"error": "You cannot delete your own active admin account!"}), 400

    users = load_users()
    if target_username not in users:
        return jsonify({"error": "User not found"}), 404

    del users[target_username]
    save_users(users)

    w_file = _get_user_dependencies()["get_user_watchlist_file"](target_username)
    p_file = _get_user_dependencies()["get_user_portfolio_file"](target_username)
    if os.path.exists(w_file):
        try: os.remove(w_file)
        except Exception: pass
    if os.path.exists(p_file):
        try: os.remove(p_file)
        except Exception: pass

    return jsonify({"success": True, "message": f"User '{target_username}' deleted successfully."})

@auth_admin_bp.route("/api/admin/logs", methods=["GET"])
@admin_required
def admin_get_logs():
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            logs = []
    return jsonify(logs)

@auth_admin_bp.route("/api/admin/system_backup/export", methods=["GET"])
@admin_required
def admin_export_system_backup():
    users = load_users()
    user_data_map = {}
    for uname in users.keys():
        user_data_map[uname] = {
            "watchlists": _get_user_dependencies()["load_data"](uname),
            "portfolios": _get_user_dependencies()["load_portfolios"](uname),
            "transactions": _get_user_dependencies()["load_user_transactions"](uname),
            "alerts": _get_user_dependencies()["load_user_alerts"](uname),
            "smallcases": _get_user_dependencies()["load_user_smallcases"](uname)
        }
    
    backup_data = {
        "users": users,
        "user_data": user_data_map,
        "exported_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    response = jsonify(backup_data)
    filename = f"capital_desk_full_system_backup_{datetime.date.today().strftime('%Y-%m-%d')}.json"
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response

@auth_admin_bp.route("/api/admin/system_backup/import", methods=["POST"])
@admin_required
def admin_import_system_backup():
    try:
        req_data = request.get_json(force=True)
        if not req_data or "users" not in req_data:
            return jsonify({"error": "Invalid system backup file. Must contain 'users'"}), 400
            
        users = req_data.get("users", {})
        save_users(users)
        
        user_data_map = req_data.get("user_data", {})
        for uname, udata in user_data_map.items():
            if "watchlists" in udata:
                _get_user_dependencies()["save_data"](udata["watchlists"], uname)
            if "portfolios" in udata:
                _get_user_dependencies()["save_portfolios"](udata["portfolios"], uname)
            if "transactions" in udata:
                _get_user_dependencies()["save_user_transactions"](udata["transactions"], uname)
            if "alerts" in udata:
                _get_user_dependencies()["save_user_alerts"](udata["alerts"], uname)
            if "smallcases" in udata:
                _get_user_dependencies()["save_user_smallcases"](udata["smallcases"], uname)
                
        try:
            with open(USERS_EXAMPLE_FILE, "w") as f:
                json.dump(users, f, indent=4)
        except Exception:
            pass

        return jsonify({"success": True, "message": f"Successfully restored {len(users)} users and all data (watchlists, portfolios, transactions, alerts, smallcases)!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@auth_admin_bp.route("/api/user_info")
def get_user_info():
    if "username" in session:
        users = load_users()
        uname = str(session.get("username", "")).lower()
        user_record = users.get(uname, {})
        display_name = user_record.get("username", session.get("username", ""))
        is_admin = bool(user_record.get("is_admin", False) or user_record.get("role") == "admin")
        return jsonify({"logged_in": True, "username": display_name, "is_admin": is_admin})

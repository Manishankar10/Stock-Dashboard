from modules.common.system_settings import get_system_settings, update_system_settings
import os
import io
import zipfile
import json
import datetime
from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from modules.common.auth_utils import (
    load_users,
    save_users,
    log_login_event,
    login_required,
    admin_required
)
from modules.common.data_paths import (
    BASE_DATA_DIR,
    APP_DATA_DIR,
    USER_DATA_DIR,
    LOGS_FILE,
    USERS_EXAMPLE_FILE
)
from modules.common.external_api_logger import (
    get_external_api_logs,
    get_external_api_logs_paginated,
    get_external_api_stats,
    delete_all_external_api_logs,
    EXTERNAL_LOGS_DIR,
    EXTERNAL_LOGS_INDEX
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

    session.permanent = True
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

    session.permanent = True
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


@auth_admin_bp.route("/api/admin/external_api_logs", methods=["GET"])
@admin_required
def admin_get_external_api_logs():
    page = request.args.get("page", 1, type=int)
    limit = request.args.get("limit", 20, type=int)
    search = request.args.get("search", None)
    method = request.args.get("method", None)
    domain = request.args.get("domain", None) or request.args.get("target", None)
    sort_by = request.args.get("sort_by", "timestamp")
    order = request.args.get("order", "desc")
    result = get_external_api_logs_paginated(
        page=page,
        limit=limit,
        search=search,
        method=method,
        domain=domain,
        sort_by=sort_by,
        order=order
    )
    stats = get_external_api_stats()
    return jsonify({
        "success": True,
        "logs": result["logs"],
        "pagination": {
            "page": result["page"],
            "limit": result["limit"],
            "total_count": result["total_count"],
            "total_pages": result["total_pages"],
            "has_next": result["has_next"],
            "has_prev": result["has_prev"]
        },
        "stats": stats,
        "domains": result["domains"]
    })


@auth_admin_bp.route("/api/admin/external_api_logs/clear", methods=["POST", "DELETE"])
@admin_required
def admin_clear_external_api_logs():
    result = delete_all_external_api_logs()
    return jsonify(result)


@auth_admin_bp.route("/api/admin/external_api_logs/export", methods=["GET"])
@admin_required
def admin_export_external_api_logs():
    logs = get_external_api_logs(limit=0)
    return jsonify(logs)


@auth_admin_bp.route("/api/admin/external_api_logs/<log_id>", methods=["GET"])
@admin_required
def admin_get_external_api_log_detail(log_id):
    safe_id = os.path.basename(log_id)
    if not safe_id.endswith(".json"):
        safe_id = f"{safe_id}.json"
    file_path = os.path.join(EXTERNAL_LOGS_DIR, safe_id)
    if not os.path.exists(file_path):
        return jsonify({"error": "Log file not found"}), 404
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify({"success": True, "log": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@auth_admin_bp.route("/api/admin/system_settings", methods=["GET"])
@admin_required
def admin_get_system_settings():
    return jsonify({
        "success": True,
        "settings": get_system_settings()
    })

@auth_admin_bp.route("/api/admin/system_settings", methods=["POST"])
@admin_required
def admin_save_system_settings():
    data = request.get_json(silent=True) or {}
    try:
        updated = update_system_settings(data)
        return jsonify({
            "success": True,
            "message": "System settings saved successfully.",
            "settings": updated
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to save system settings: {str(e)}"}), 500

@auth_admin_bp.route("/api/system_settings", methods=["GET"])
@login_required
def get_public_system_settings():
    return jsonify({
        "success": True,
        "settings": get_system_settings()
    })

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
        "system_settings": get_system_settings(),
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
        if "system_settings" in req_data and isinstance(req_data["system_settings"], dict):
            try:
                update_system_settings(req_data["system_settings"])
            except Exception:
                pass
                
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
        favorite_tools = user_record.get("favorite_tools", ["trendline", "support", "rectangle", "pricerange"])
        return jsonify({
            "logged_in": True,
            "username": display_name,
            "is_admin": is_admin,
            "favorite_tools": favorite_tools
        })
    return jsonify({"logged_in": False}), 401


@auth_admin_bp.route("/api/user/favorite_tools", methods=["POST"])
@login_required
def save_favorite_tools():
    uname = str(session.get("username", "")).lower()
    users = load_users()
    if uname not in users:
        return jsonify({"error": "User not found"}), 404
    data = request.json or {}
    favorite_tools = data.get("favorite_tools", [])
    if not isinstance(favorite_tools, list):
        return jsonify({"error": "Invalid format"}), 400
    users[uname]["favorite_tools"] = favorite_tools
    save_users(users)
    return jsonify({"success": True, "favorite_tools": favorite_tools})


@auth_admin_bp.route("/api/admin/industries_overview/status", methods=["GET"])
@admin_required
def admin_industries_overview_status():
    from modules.industries_overview import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Industries Overview provider not initialized."}), 500
    return jsonify({
        "success": True,
        "status": provider.get_refresh_status()
    })


@auth_admin_bp.route("/api/admin/industries_overview/refresh", methods=["POST"])
@admin_required
def admin_industries_overview_refresh():
    from modules.industries_overview import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Industries Overview provider not initialized."}), 500
    res = provider.start_admin_background_refresh()
    if not res.get("success"):
        return jsonify(res), 400
    return jsonify(res)


@auth_admin_bp.route("/api/admin/corporate_actions/status", methods=["GET"])
@admin_required
def admin_corporate_actions_status():
    from modules.corporate_actions import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Corporate Actions provider not initialized."}), 500
    return jsonify({
        "success": True,
        "status": provider.get_refresh_status()
    })


@auth_admin_bp.route("/api/admin/corporate_actions/refresh", methods=["POST"])
@admin_required
def admin_corporate_actions_refresh():
    from modules.corporate_actions import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Corporate Actions provider not initialized."}), 500
    res = provider.start_admin_background_refresh()
    if not res.get("success"):
        return jsonify(res), 400
    return jsonify(res)


@auth_admin_bp.route("/api/admin/ipos/status", methods=["GET"])
@admin_required
def admin_ipos_status():
    from modules.ipo_tracker.ipo_tracker_provider import get_ipo_refresh_status
    return jsonify({
        "success": True,
        "status": get_ipo_refresh_status()
    })


@auth_admin_bp.route("/api/admin/ipos/refresh", methods=["POST"])
@admin_required
def admin_ipos_refresh():
    from modules.ipo_tracker.ipo_tracker_provider import start_admin_ipo_refresh
    res = start_admin_ipo_refresh()
    if not res.get("success"):
        return jsonify(res), 400
    return jsonify(res)


@auth_admin_bp.route("/api/admin/quarterly_results/status", methods=["GET"])
@admin_required
def admin_quarterly_results_status():
    from modules.quarterly_results import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Quarterly Results provider not initialized."}), 500
    return jsonify({
        "success": True,
        "status": provider.get_refresh_status()
    })


@auth_admin_bp.route("/api/admin/quarterly_results/refresh", methods=["POST"])
@admin_required
def admin_quarterly_results_refresh():
    from modules.quarterly_results import get_provider
    provider = get_provider()
    if not provider:
        return jsonify({"error": "Quarterly Results provider not initialized."}), 500
    res = provider.start_admin_background_refresh()
    if not res.get("success"):
        return jsonify(res), 400
    return jsonify(res)


# ==============================================================================
# PRODUCTION JSON FILES DOWNLOAD & MANAGEMENT
# ==============================================================================
def _scan_json_files(include_external_logs=False):
    """Scan all valid JSON files in BASE_DATA_DIR, APP_DATA_DIR, and USER_DATA_DIR."""
    found_files = []
    seen_rel_paths = set()
    dirs_to_scan = [
        ("app_data", APP_DATA_DIR),
        ("user_data", USER_DATA_DIR),
        ("root", BASE_DATA_DIR)
    ]
    for category, base_dir in dirs_to_scan:
        if not os.path.exists(base_dir):
            continue
        for root_dir, _, files in os.walk(base_dir):
            norm_root = root_dir.replace('\\', '/')
            if any(skip in norm_root for skip in ['/venv', '/.git', '/__pycache__', '/site-packages', '/scratch', '/.gemini']):
                continue
            if not include_external_logs and 'external_api_logs' in norm_root:
                continue
            for f in files:
                if f.endswith('.json'):
                    abs_path = os.path.join(root_dir, f)
                    try:
                        rel_path = os.path.relpath(abs_path, BASE_DATA_DIR).replace('\\', '/')
                    except Exception:
                        rel_path = f
                    if rel_path in seen_rel_paths:
                        continue
                    seen_rel_paths.add(rel_path)
                    try:
                        stat = os.stat(abs_path)
                        sz = stat.st_size
                        mtime = stat.st_mtime
                    except Exception:
                        sz = 0
                        mtime = 0
                    if sz < 1024:
                        sz_str = f"{sz} B"
                    elif sz < 1024 * 1024:
                        sz_str = f"{sz / 1024:.1f} KB"
                    else:
                        sz_str = f"{sz / (1024 * 1024):.2f} MB"
                    cat = category
                    if 'drawings' in rel_path:
                        cat = 'drawings'
                    elif 'external_api_logs' in rel_path:
                        cat = 'logs'
                    elif 'user_data' in rel_path:
                        cat = 'user_data'
                    elif 'app_data' in rel_path:
                        cat = 'app_data'
                    else:
                        cat = 'root'
                    found_files.append({
                        "name": f,
                        "rel_path": rel_path,
                        "abs_path": abs_path,
                        "category": cat,
                        "size_bytes": sz,
                        "size_formatted": sz_str,
                        "modified": datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S") if mtime else "-"
                    })
    cat_order = {'app_data': 1, 'user_data': 2, 'drawings': 3, 'root': 4, 'logs': 5}
    found_files.sort(key=lambda x: (cat_order.get(x['category'], 99), x['name'].lower()))
    return found_files


@auth_admin_bp.route("/api/admin/json_files/list", methods=["GET"])
@admin_required
def admin_list_json_files():
    include_logs = request.args.get("include_logs", "").lower() in ["1", "true", "yes"]
    files = _scan_json_files(include_external_logs=include_logs)
    
    total_bytes = sum(f["size_bytes"] for f in files)
    if total_bytes < 1024:
        total_formatted = f"{total_bytes} B"
    elif total_bytes < 1024 * 1024:
        total_formatted = f"{total_bytes / 1024:.1f} KB"
    else:
        total_formatted = f"{total_bytes / (1024 * 1024):.2f} MB"
        
    clean_files = []
    for f in files:
        clean_files.append({
            "name": f["name"],
            "rel_path": f["rel_path"],
            "category": f["category"],
            "size_bytes": f["size_bytes"],
            "size_formatted": f["size_formatted"],
            "modified": f["modified"],
            "download_url": f"/api/admin/json_files/download?file={f['rel_path']}"
        })
        
    return jsonify({
        "success": True,
        "total_files": len(clean_files),
        "total_size_bytes": total_bytes,
        "total_size_formatted": total_formatted,
        "files": clean_files
    })


@auth_admin_bp.route("/api/admin/json_files/download", methods=["GET"])
@admin_required
def admin_download_single_json_file():
    rel_path = request.args.get("file", "").strip()
    if not rel_path or not rel_path.endswith(".json"):
        return jsonify({"error": "Invalid or missing file parameter. Must be a .json file."}), 400
    
    clean_rel = rel_path.replace("\\", "/").lstrip("/")
    if ".." in clean_rel or clean_rel.startswith("/"):
        return jsonify({"error": "Access denied: Invalid path traversal."}), 403
        
    abs_path = os.path.abspath(os.path.join(BASE_DATA_DIR, clean_rel))
    allowed_bases = [
        os.path.abspath(BASE_DATA_DIR),
        os.path.abspath(APP_DATA_DIR),
        os.path.abspath(USER_DATA_DIR)
    ]
    if not any(abs_path.startswith(b) for b in allowed_bases):
        return jsonify({"error": "Access denied: Path outside allowed directories."}), 403
        
    if not os.path.exists(abs_path) or not os.path.isfile(abs_path):
        return jsonify({"error": f"File '{clean_rel}' not found on server."}), 404
        
    return send_file(
        abs_path,
        as_attachment=True,
        download_name=os.path.basename(abs_path),
        mimetype="application/json"
    )


@auth_admin_bp.route("/api/admin/json_files/download_all_zip", methods=["GET"])
@admin_required
def admin_download_all_json_zip():
    scope = request.args.get("scope", "core").strip().lower()
    include_logs = (scope == "all" or request.args.get("include_logs", "").lower() in ["1", "true", "yes"])
    
    files = _scan_json_files(include_external_logs=include_logs)
    if scope in ["app_data", "user_data", "drawings", "root"]:
        files = [f for f in files if f["category"] == scope]
        
    if not files:
        return jsonify({"error": "No JSON files found for the requested scope."}), 404
        
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            if os.path.exists(f["abs_path"]):
                zf.write(f["abs_path"], f["rel_path"])
                
    buf.seek(0)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"capital_desk_production_json_files_{scope}_{ts}.zip"
    
    return send_file(
        buf,
        as_attachment=True,
        download_name=zip_name,
        mimetype="application/zip"
    )


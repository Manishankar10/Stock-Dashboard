import os
import json
import datetime
from functools import wraps
from flask import request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash
from db_store import load_users_db, save_users_db
from modules.common.data_paths import USERS_FILE, USERS_EXAMPLE_FILE, LOGS_FILE

def load_users():
    return load_users_db(USERS_FILE, USERS_EXAMPLE_FILE)

def save_users(users):
    save_users_db(users, USERS_FILE)

def log_login_event(username, status):
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r") as f:
                logs = json.load(f)
        except Exception:
            logs = []
            
    ip_addr = request.remote_addr or "127.0.0.1"
    event = {
        "username": username,
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ip": ip_addr,
        "status": status,
        "user_agent": request.headers.get("User-Agent", "Unknown")[:60]
    }
    logs.insert(0, event)
    logs = logs[:200]
    try:
        with open(LOGS_FILE, "w") as f:
            json.dump(logs, f, indent=4)
    except Exception:
        pass

def ensure_default_admin(init_user_fn=None):
    users = load_users()
    changed = False
    
    if "admin" not in users:
        admin_pass = "admin123"
        users["admin"] = {
            "username": "admin",
            "password_hash": generate_password_hash(admin_pass),
            "plain_password": admin_pass,
            "role": "admin",
            "is_admin": True,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "last_login": None,
            "login_count": 0
        }
        changed = True
        if init_user_fn:
            init_user_fn("admin")
    else:
        if not users["admin"].get("is_admin") or users["admin"].get("role") != "admin":
            users["admin"]["is_admin"] = True
            users["admin"]["role"] = "admin"
            changed = True

    if "manishankar10" in users:
        if not users["manishankar10"].get("is_admin") or users["manishankar10"].get("role") != "admin":
            users["manishankar10"]["is_admin"] = True
            users["manishankar10"]["role"] = "admin"
            changed = True

    for uname, record in users.items():
        if "plain_password" not in record:
            if uname in ("admin", "manishankar10"):
                record["plain_password"] = "admin123"
            else:
                record["plain_password"] = f"{uname}123"
            changed = True
        
        if init_user_fn:
            init_user_fn(uname)

    if changed:
        save_users(users)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized. Please log in.", "require_login": True}), 401
            return redirect(url_for("auth_admin.login_page"))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized. Please log in.", "require_login": True}), 401
            return redirect(url_for("auth_admin.login_page"))
            
        users = load_users()
        uname = str(session.get("username", "")).lower()
        current_user = users.get(uname, {})
        if not current_user.get("is_admin") and current_user.get("role") != "admin":
            if request.path.startswith("/api/"):
                return jsonify({"error": "Forbidden: Admin privileges required"}), 403
            return redirect(url_for("index"))
            
        return f(*args, **kwargs)
    return decorated_function

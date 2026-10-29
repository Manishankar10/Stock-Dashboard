import os
import re
import json
import time
import urllib.parse
from flask import Blueprint, request, jsonify, session, Response
from modules.common.auth_utils import login_required
from modules.common.data_paths import USER_DATA_DIR
from modules.common.ist_datetime import now_ist
from db_store import load_user_doc_db, save_user_doc_db

custom_queries_bp = Blueprint("custom_queries_api", __name__)

_USER_CQ_CACHE = {}

def get_user_custom_queries_file(username):
    safe_user = "".join(c for c in username if c.isalnum() or c in ('_', '-')).lower()
    return os.path.join(USER_DATA_DIR, f"{safe_user}_custom_queries.json")

def load_user_custom_queries(username=None):
    if not username:
        username = session.get("username")
    if not username:
        return {}
    if username in _USER_CQ_CACHE:
        return _USER_CQ_CACHE[username]

    filepath = get_user_custom_queries_file(username)
    data = load_user_doc_db("custom_queries", username, filepath, default_factory=dict)
    if not isinstance(data, dict):
        data = {}
    _USER_CQ_CACHE[username] = data
    return data

def save_user_custom_queries(data, username=None):
    if not username:
        username = session.get("username")
    if not username:
        return
    _USER_CQ_CACHE[username] = data
    filepath = get_user_custom_queries_file(username)
    save_user_doc_db("custom_queries", username, data, filepath)

def get_unique_query_name(existing_names, base_name):
    base_name = str(base_name or "Query").strip()
    existing_lower = {n.strip().lower() for n in existing_names if n}
    if base_name.lower() not in existing_lower:
        return base_name

    # Check for trailing number in base_name (e.g. "Query 1" -> "Query")
    match = re.match(r"^(.*?)\s+(\d+)$", base_name)
    prefix = match.group(1).strip() if match else base_name

    counter = 1
    candidate = f"{prefix} {counter}"
    while candidate.lower() in existing_lower or candidate.lower() == base_name.lower():
        counter += 1
        candidate = f"{prefix} {counter}"

    return candidate


@custom_queries_bp.route("/api/custom-queries/<module_name>", methods=["GET"])
@login_required
def get_custom_queries(module_name):
    mod = str(module_name).strip().lower()
    data = load_user_custom_queries()
    queries = data.get(mod, [])
    if not isinstance(queries, list):
        queries = []
    return jsonify({"success": True, "module": mod, "queries": queries})


@custom_queries_bp.route("/api/custom-queries/<module_name>", methods=["POST"])
@login_required
def save_custom_query(module_name):
    mod = str(module_name).strip().lower()
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    expression = (payload.get("expression") or "").strip()
    action = payload.get("action", "new")  # "new" or "update"
    query_id = payload.get("id")

    if not expression:
        return jsonify({"success": False, "error": "Query expression cannot be empty."}), 400

    data = load_user_custom_queries()
    if mod not in data or not isinstance(data[mod], list):
        data[mod] = []

    module_queries = data[mod]
    existing_names = [q.get("name", "") for q in module_queries]

    if action == "update" and query_id:
        target = None
        for q in module_queries:
            if q.get("id") == query_id:
                target = q
                break

        if target:
            target["expression"] = expression
            if name:
                target["name"] = name
            target["updated_at"] = now_ist().strftime("%Y-%m-%d %H:%M:%S")
            save_user_custom_queries(data)
            return jsonify({
                "success": True,
                "action": "updated",
                "query": target,
                "queries": module_queries
            })

    # Saving as new query
    if not name:
        name = "Query"

    unique_name = get_unique_query_name(existing_names, name)
    new_id = f"{mod}_{int(time.time() * 1000)}"
    new_query = {
        "id": new_id,
        "name": unique_name,
        "expression": expression,
        "created_at": now_ist().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at": now_ist().strftime("%Y-%m-%d %H:%M:%S")
    }
    module_queries.append(new_query)
    save_user_custom_queries(data)

    return jsonify({
        "success": True,
        "action": "created",
        "query": new_query,
        "queries": module_queries
    })


@custom_queries_bp.route("/api/custom-queries/<module_name>/<query_id>", methods=["PUT"])
@login_required
def update_or_rename_custom_query(module_name, query_id):
    mod = str(module_name).strip().lower()
    payload = request.get_json(silent=True) or {}
    new_name = (payload.get("name") or "").strip()
    new_expression = payload.get("expression")

    data = load_user_custom_queries()
    module_queries = data.get(mod, [])
    target = None
    other_names = []

    for q in module_queries:
        if q.get("id") == query_id:
            target = q
        else:
            other_names.append(q.get("name", ""))

    if not target:
        return jsonify({"success": False, "error": f"Query '{query_id}' not found."}), 404

    if new_name:
        target["name"] = get_unique_query_name(other_names, new_name)
    if new_expression is not None and str(new_expression).strip():
        target["expression"] = str(new_expression).strip()

    target["updated_at"] = now_ist().strftime("%Y-%m-%d %H:%M:%S")
    save_user_custom_queries(data)

    return jsonify({
        "success": True,
        "query": target,
        "queries": module_queries
    })


@custom_queries_bp.route("/api/custom-queries/<module_name>/<query_id>", methods=["DELETE"])
@login_required
def delete_custom_query(module_name, query_id):
    mod = str(module_name).strip().lower()
    data = load_user_custom_queries()
    module_queries = data.get(mod, [])

    data[mod] = [q for q in module_queries if q.get("id") != query_id]
    save_user_custom_queries(data)

    return jsonify({
        "success": True,
        "deleted_id": query_id,
        "queries": data[mod]
    })

"""Plan calculator page routes."""

from functools import wraps
import os
from pathlib import Path

from flask import Blueprint, jsonify, render_template, request, send_from_directory, session
from db_store import load_user_doc_db, save_user_doc_db


plan_calculator_bp = Blueprint("plan_calculator", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent
_LOGIN_REQUIRED = None
_DATA_DIR = "."
_CALCULATORS = {"sip", "lumpsum", "swp", "fd", "emi", "xirr", "cagr", "retirement", "averager"}


def init_plan_calculator(login_required, data_dir="."):
    """Use the host app's login policy without importing app.py."""
    global _LOGIN_REQUIRED, _DATA_DIR
    _LOGIN_REQUIRED = login_required
    _DATA_DIR = data_dir or "."


def _state_path():
    username = str(session.get("username", "unknown"))
    safe_user = "".join(char for char in username if char.isalnum() or char in ("_", "-")).lower() or "unknown"
    return os.path.join(_DATA_DIR, "user_data", f"{safe_user}_plan_calculator.json")


def _load_state():
    username = str(session.get("username", ""))
    data = load_user_doc_db("plan_calculator", username, _state_path(), default_factory=dict)
    return data if isinstance(data, dict) else {}


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Plan Calculator module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)
    return wrapper


@plan_calculator_bp.get("/plan-calculator")
@_guard
def plan_calculator_page():
    return render_template("plan_calculator.html")


@plan_calculator_bp.get("/plan-calculator.css")
@_guard
def plan_calculator_stylesheet():
    return send_from_directory(_MODULE_DIR, "plan_calculator.css", mimetype="text/css")


@plan_calculator_bp.get("/plan-calculator.js")
@_guard
def plan_calculator_javascript():
    return send_from_directory(_MODULE_DIR, "plan_calculator.js", mimetype="application/javascript")


@plan_calculator_bp.get("/api/plan-calculator/state")
@_guard
def get_plan_calculator_state():
    data = _load_state()
    saved_active = data.get("active")
    active = saved_active if isinstance(saved_active, str) and saved_active in _CALCULATORS else "sip"
    calculators = data.get("calculators") if isinstance(data.get("calculators"), dict) else {}
    response = jsonify({"active": active, "calculators": calculators})
    response.headers["Cache-Control"] = "no-store"
    return response


@plan_calculator_bp.put("/api/plan-calculator/state")
@_guard
def save_plan_calculator_state():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Calculator state must be an object."}), 400
    active = payload.get("active")
    if not isinstance(active, str) or active not in _CALCULATORS:
        return jsonify({"error": "Choose a valid calculator."}), 400

    submitted = payload.get("calculators")
    if not isinstance(submitted, dict):
        return jsonify({"error": "Calculator inputs must be an object."}), 400
    calculators = {
        name: values for name, values in submitted.items()
        if name in _CALCULATORS and isinstance(values, dict)
    }
    if len(str(calculators)) > 1_000_000:
        return jsonify({"error": "Calculator state is too large to save."}), 413

    data = {"active": active, "calculators": calculators}
    save_user_doc_db("plan_calculator", str(session.get("username", "")), data, _state_path())
    response = jsonify({"success": True})
    response.headers["Cache-Control"] = "no-store"
    return response

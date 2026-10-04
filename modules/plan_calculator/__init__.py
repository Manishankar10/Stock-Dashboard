"""Plan calculator page routes."""

from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, render_template, send_from_directory


plan_calculator_bp = Blueprint("plan_calculator", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent
_LOGIN_REQUIRED = None


def init_plan_calculator(login_required):
    """Use the host app's login policy without importing app.py."""
    global _LOGIN_REQUIRED
    _LOGIN_REQUIRED = login_required


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

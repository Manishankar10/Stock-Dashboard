"""Capital Desk - Peoples (Ace Investors, FII & DII Portfolios) Module.

Provides routes and on-time data feeds for tracking ace investor,
FII, and DII public shareholdings from 2022 to the latest quarter.
"""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from flask import Blueprint, jsonify, render_template, request, send_from_directory

from .peoples_provider import fetch_investor_portfolio, fetch_investors_by_category, get_all_investors

peoples_bp = Blueprint("peoples", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None


def init_peoples(login_required: Callable):
    """Initialize the Peoples module with the app login decorator."""
    global _LOGIN_REQUIRED
    _LOGIN_REQUIRED = login_required


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Peoples module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


@peoples_bp.get("/peoples")
@_guard
def peoples_page():
    """Direct route for Peoples tab in SPA."""
    return render_template("index.html", initial_tab="peoples")


@peoples_bp.get("/peoples.css")
def peoples_stylesheet():
    """Serve the module stylesheet."""
    return send_from_directory(_MODULE_DIR, "peoples.css", mimetype="text/css")


@peoples_bp.get("/peoples.js")
def peoples_javascript():
    """Serve the module client script."""
    return send_from_directory(_MODULE_DIR, "peoples.js", mimetype="application/javascript")


@peoples_bp.get("/api/peoples/investors")
@_guard
def api_get_all_investors():
    """Retrieve directory list of all investors segregated by Ace, FII, and DII tabs."""
    category = request.args.get("category", "all").lower()
    if category in ("ace", "fii", "dii"):
        data = fetch_investors_by_category(category)
        return jsonify({"category": category, "investors": data, "count": len(data)})

    all_data = get_all_investors()
    return jsonify(all_data)


@peoples_bp.get("/api/peoples/portfolio/<investor_id>/<slug>")
@_guard
def api_get_investor_portfolio(investor_id: str, slug: str):
    """Retrieve on-time historical shareholding portfolio from 2022 to latest quarter."""
    if not investor_id or not slug:
        return jsonify({"error": "Missing investor identifier."}), 400

    data = fetch_investor_portfolio(investor_id, slug)
    return jsonify(data)

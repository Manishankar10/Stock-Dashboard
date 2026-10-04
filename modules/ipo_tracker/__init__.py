"""IPO tracker page and authenticated API routes."""

from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, render_template, request, send_from_directory

from .ipo_tracker_provider import IPOFeedError, get_ipo_data


ipo_tracker_bp = Blueprint(
    "ipo_tracker",
    __name__,
    template_folder=".",
)

_MODULE_DIR = Path(__file__).resolve().parent
_LOGIN_REQUIRED = None


def init_ipo_tracker(login_required):
    """Pass in the app's login decorator without importing app.py here."""
    global _LOGIN_REQUIRED
    _LOGIN_REQUIRED = login_required


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "IPO tracker module is not initialized"}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


@ipo_tracker_bp.get("/ipos")
@_guard
def ipo_tracker_page():
    return render_template("ipo_tracker.html")


@ipo_tracker_bp.get("/ipo-tracker.css")
@_guard
def ipo_tracker_stylesheet():
    return send_from_directory(_MODULE_DIR, "ipo_tracker.css", mimetype="text/css")


@ipo_tracker_bp.get("/ipo-tracker.js")
@_guard
def ipo_tracker_javascript():
    return send_from_directory(_MODULE_DIR, "ipo_tracker.js", mimetype="application/javascript")


@ipo_tracker_bp.get("/api/ipos")
@_guard
def ipo_tracker_data():
    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")
    try:
        response = jsonify(get_ipo_data(force_refresh=force_refresh))
        response.headers["Cache-Control"] = "no-store"
        return response
    except IPOFeedError as exc:
        return jsonify({"error": str(exc)}), 503

"""Shareholding Patterns Module Routes and Initialization."""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from flask import Blueprint, jsonify, render_template, request, send_file, send_from_directory

from .shareholding_provider import ShareholdingProvider

shareholding_bp = Blueprint("shareholding", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_PROVIDER: Optional[ShareholdingProvider] = None


def init_shareholding(login_required: Callable, data_dir: str = "."):
    """Initialize shareholding module with login decorator and local data directory."""
    global _LOGIN_REQUIRED, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _PROVIDER = ShareholdingProvider(data_dir=data_dir)


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Shareholding module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


@shareholding_bp.get("/shareholding")
@_guard
def shareholding_page():
    return render_template("index.html", initial_tab="shareholding")


@shareholding_bp.get("/shareholding-patterns.css")
@_guard
def shareholding_stylesheet():
    return send_from_directory(_MODULE_DIR, "shareholding.css", mimetype="text/css")


@shareholding_bp.get("/shareholding-patterns.js")
@_guard
def shareholding_javascript():
    return send_from_directory(_MODULE_DIR, "shareholding.js", mimetype="application/javascript")


@shareholding_bp.get("/api/shareholding/data")
@_guard
def get_shareholding_data():
    """Retrieve filtered, sorted, and paginated shareholding records.
    Strictly reads from local app_data/shareholding_patterns.json without external network requests.
    """
    if _PROVIDER is None:
        return jsonify({"error": "Shareholding provider is not initialized."}), 500

    board = request.args.get("board", "all")
    category_filter = request.args.get("category", "all")
    search = request.args.get("search", "")
    sort_key = request.args.get("sort_key", "broadcastDate")
    sort_dir = request.args.get("sort_dir", "desc")
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 50))

    data = _PROVIDER.query_records(
        board=board,
        category_filter=category_filter,
        search=search,
        sort_key=sort_key,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )
    return jsonify(data)


@shareholding_bp.post("/api/shareholding/refresh")
@_guard
def refresh_shareholding_data():
    """Trigger manual refresh of shareholding patterns from official exchange feeds.
    Enforces 15-minute rate-limit window. Stops immediately when existing records are met.
    """
    if _PROVIDER is None:
        return jsonify({"error": "Shareholding provider is not initialized."}), 500

    force = request.args.get("force", "false").lower() in ("true", "1", "yes")
    result = _PROVIDER.fetch_live_records(force=force)
    return jsonify(result)


@shareholding_bp.get("/api/shareholding/status")
@_guard
def get_shareholding_status():
    """Return status metadata, including last synced timestamp and rate-limit countdown."""
    if _PROVIDER is None:
        return jsonify({"error": "Shareholding provider is not initialized."}), 500
    return jsonify(_PROVIDER.get_status())


@shareholding_bp.get("/api/shareholding/download")
@_guard
def download_shareholding_json():
    """Download the raw app_data/shareholding_patterns.json file."""
    if _PROVIDER is None or not _PROVIDER.json_file.exists():
        return jsonify({"error": "Shareholding data file not found."}), 404

    return send_file(
        _PROVIDER.json_file.resolve(),
        as_attachment=True,
        download_name="shareholding_patterns.json",
        mimetype="application/json",
    )

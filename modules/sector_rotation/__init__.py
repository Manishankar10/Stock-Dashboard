"""
Sector Rotation Module blueprint and routes definition.
"""

from functools import wraps
from pathlib import Path
from typing import Callable, Optional

from flask import Blueprint, jsonify, render_template, request, send_from_directory

from .sector_rotation_provider import SectorRotationProvider

sector_rotation_bp = Blueprint("sector_rotation", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[SectorRotationProvider] = None


def init_sector_rotation(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = SectorRotationProvider(data_dir=data_dir)


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Sector Rotation module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


@sector_rotation_bp.get("/sector-rotation")
@_guard
def sector_rotation_page():
    return render_template("index.html", initial_tab="sector-rotation")


@sector_rotation_bp.get("/sector-rotation.css")
def sector_rotation_stylesheet():
    return send_from_directory(_MODULE_DIR, "sector_rotation.css", mimetype="text/css")


@sector_rotation_bp.get("/sector-rotation.js")
def sector_rotation_javascript():
    return send_from_directory(_MODULE_DIR, "sector_rotation.js", mimetype="application/javascript")


@sector_rotation_bp.get("/api/sector-rotation")
@_guard
def get_sector_rotation_data():
    if _PROVIDER is None:
        return jsonify({"error": "Sector Rotation provider is not initialized."}), 500

    frequency = request.args.get("frequency", "1M").strip().upper()
    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    try:
        data = _PROVIDER.get_sector_rotation(frequency=frequency, force_refresh=force_refresh)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@sector_rotation_bp.post("/api/sector-rotation/refresh")
@_guard
def refresh_sector_rotation():
    if _PROVIDER is None:
        return jsonify({"error": "Sector Rotation provider is not initialized."}), 500
    try:
        data = _PROVIDER.get_sector_rotation(frequency="1M", force_refresh=True)
        return jsonify({"success": True, "message": "Official sector rotation and RRG metrics refreshed."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

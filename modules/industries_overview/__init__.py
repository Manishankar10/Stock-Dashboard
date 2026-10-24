"""
Industries Overview Module blueprint and routes definition.
Harmonized 4-Tier SEBI / NSE Industry Classification and Stocks Overview.
"""

from functools import wraps
from pathlib import Path
from typing import Callable, Optional

from flask import Blueprint, jsonify, make_response, render_template, request, send_from_directory

from .industries_overview_provider import IndustriesOverviewProvider

industries_overview_bp = Blueprint("industries_overview", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[IndustriesOverviewProvider] = None


def init_industries_overview(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "data"):
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = IndustriesOverviewProvider(data_dir=data_dir)


def get_provider() -> Optional[IndustriesOverviewProvider]:
    global _PROVIDER
    return _PROVIDER


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Industries Overview module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


@industries_overview_bp.get("/industries-overview")
@_guard
def industries_overview_page():
    return render_template("index.html", initial_tab="industries-overview")


@industries_overview_bp.get("/industries-overview.css")
def industries_overview_stylesheet():
    return send_from_directory(_MODULE_DIR, "industries_overview.css", mimetype="text/css")


@industries_overview_bp.get("/industries-overview.js")
def industries_overview_javascript():
    return send_from_directory(_MODULE_DIR, "industries_overview.js", mimetype="application/javascript")


@industries_overview_bp.get("/api/industries-overview/list")
@_guard
def get_industries_overview_list():
    if _PROVIDER is None:
        return jsonify({"error": "Industries Overview provider is not initialized."}), 500

    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    # Fast ETag check for conditional caching
    etag = _PROVIDER.get_etag()
    client_etag = request.headers.get("If-None-Match")
    if not force_refresh and client_etag and client_etag.strip('"') == etag.strip('"'):
        res = make_response("", 304)
        res.headers["ETag"] = etag
        res.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=120"
        return res

    try:
        data = _PROVIDER.get_industries_overview(force_refresh=force_refresh)
        res = make_response(jsonify(data))
        res.headers["ETag"] = _PROVIDER.get_etag()
        res.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=120"
        return res
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@industries_overview_bp.get("/api/industries-overview/stocks")
@_guard
def get_industry_stocks():
    if _PROVIDER is None:
        return jsonify({"error": "Industries Overview provider is not initialized."}), 500

    path = request.args.get("path") or request.args.get("code") or request.args.get("industry") or ""
    if not path:
        return jsonify({"error": "Missing industry path or code parameter."}), 400

    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    # Fast ETag check for industry stocks
    etag = _PROVIDER.get_stocks_etag(path)
    client_etag = request.headers.get("If-None-Match")
    if not force_refresh and client_etag and client_etag.strip('"') == etag.strip('"'):
        res = make_response("", 304)
        res.headers["ETag"] = etag
        res.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=120"
        return res

    try:
        data = _PROVIDER.get_industry_stocks(path, force_refresh=force_refresh)
        res = make_response(jsonify(data))
        res.headers["ETag"] = _PROVIDER.get_stocks_etag(path)
        res.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=120"
        return res
    except Exception as e:
        return jsonify({
            "success": False,
            "error": "The external market data feed is temporarily unreachable. Please retry in a few moments.",
            "details": str(e),
            "stocks": []
        }), 200


@industries_overview_bp.post("/api/industries-overview/refresh")
@_guard
def refresh_industries_overview():
    return jsonify({
        "error": "Dataset refreshes are restricted to Admin in System Settings only."
    }), 403

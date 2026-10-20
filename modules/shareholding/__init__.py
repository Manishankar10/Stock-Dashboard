"""Shareholding Patterns Module Routes and Initialization."""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set, Tuple

from flask import Blueprint, jsonify, render_template, request, send_file, send_from_directory, session

from .shareholding_provider import ShareholdingProvider, clean_symbol

shareholding_bp = Blueprint("shareholding", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[ShareholdingProvider] = None


def init_shareholding(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    """Initialize shareholding module with login decorator, user data loader, and local data directory."""
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = ShareholdingProvider(data_dir=data_dir)


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Shareholding module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


def _extract_user_symbols() -> Tuple[Dict[str, Set[str]], Set[str]]:
    """Extract current logged-in user's watchlists and portfolio symbols."""
    watchlists_result: Dict[str, Set[str]] = {}
    portfolio_symbols: Set[str] = set()

    username = session.get("username")
    if _LOAD_DATA and username:
        try:
            user_data = _LOAD_DATA(username) or {}
            # Watchlists
            if isinstance(user_data, dict) and "watchlists" in user_data and isinstance(user_data["watchlists"], dict):
                watchlists = user_data["watchlists"]
            elif isinstance(user_data, dict):
                watchlists = user_data
            else:
                watchlists = {}

            for wl_name, items in watchlists.items():
                if wl_name in ("portfolios", "alerts", "transactions", "smallcases"):
                    continue
                symbols_set = set()
                if isinstance(items, list):
                    for sym in items:
                        if isinstance(sym, str):
                            symbols_set.add(clean_symbol(sym))
                        elif isinstance(sym, dict) and sym.get("symbol"):
                            symbols_set.add(clean_symbol(sym["symbol"]))
                watchlists_result[wl_name] = symbols_set

            # Portfolios
            portfolios = user_data.get("portfolios") or {}
            for holdings in portfolios.values():
                if isinstance(holdings, list):
                    for item in holdings:
                        if isinstance(item, dict) and item.get("symbol"):
                            portfolio_symbols.add(clean_symbol(item["symbol"]))
        except Exception:
            pass

    if not portfolio_symbols and username:
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            pf_data = load_portfolios(username) or {}
            for holdings in pf_data.values():
                if isinstance(holdings, list):
                    for item in holdings:
                        if isinstance(item, dict) and item.get("symbol"):
                            portfolio_symbols.add(clean_symbol(item["symbol"]))
        except Exception:
            pass

    return watchlists_result, portfolio_symbols


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
    custom_query = request.args.get("custom_query", "")
    scope = request.args.get("scope", "all")
    search = request.args.get("search", "")
    sort_key = request.args.get("sort_key", "broadcastDate")
    sort_dir = request.args.get("sort_dir", "desc")
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 50))

    watchlists_map, portfolio_symbols = _extract_user_symbols()
    all_watchlist_symbols = set().union(*watchlists_map.values()) if watchlists_map else set()

    data = _PROVIDER.query_records(
        board=board,
        category_filter=category_filter,
        custom_query=custom_query,
        scope=scope,
        search=search,
        sort_key=sort_key,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
        portfolio_symbols=portfolio_symbols,
        watchlist_symbols=all_watchlist_symbols,
    )
    return jsonify(data)


@shareholding_bp.route("/api/shareholding/validate-query", methods=["GET", "POST"])
@_guard
def validate_shareholding_query():
    """Validate a custom query string and return syntax status, match count, and sample matches."""
    if _PROVIDER is None:
        return jsonify({"error": "Shareholding provider is not initialized."}), 500

    if request.method == "POST" and request.is_json:
        query_str = request.json.get("query", "")
    else:
        query_str = request.args.get("query", "")

    result = _PROVIDER.validate_custom_query(query_str)
    return jsonify(result)


@shareholding_bp.post("/api/shareholding/refresh")
@_guard
def refresh_shareholding_data():
    """Trigger manual refresh of shareholding patterns from official exchange feeds.
    Enforces 15-minute rate-limit window. Stops immediately when existing records are met.
    """
    if _PROVIDER is None:
        return jsonify({"error": "Shareholding provider is not initialized."}), 500

    force = request.args.get("force", "true").lower() in ("true", "1", "yes")
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

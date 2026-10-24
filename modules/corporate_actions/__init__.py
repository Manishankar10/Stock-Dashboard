"""Corporate actions module routes and initialization."""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set

from flask import Blueprint, jsonify, render_template, request, send_from_directory, session

from .corporate_actions_provider import CorporateActionsProvider, clean_symbol

corporate_actions_bp = Blueprint("corporate_actions", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[CorporateActionsProvider] = None


def init_corporate_actions(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    """Initialize corporate actions blueprint with login guard and data loader."""
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = CorporateActionsProvider(data_dir=data_dir)


def get_provider() -> Optional[CorporateActionsProvider]:
    """Retrieve the singleton CorporateActionsProvider instance."""
    global _PROVIDER
    return _PROVIDER


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Corporate actions module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


def _extract_user_symbols() -> Dict[str, Set[str]]:
    """Extract current user's portfolio and watchlist symbols."""
    portfolio_symbols: Set[str] = set()
    watchlist_symbols: Set[str] = set()

    username = session.get("username")
    if not username:
        return {"portfolio": portfolio_symbols, "watchlist": watchlist_symbols}

    if _LOAD_DATA:
        try:
            user_data = _LOAD_DATA(username) or {}
            # Watchlists can be nested under "watchlists" or provided directly at top-level
            if isinstance(user_data, dict) and "watchlists" in user_data and isinstance(user_data["watchlists"], dict):
                watchlists = user_data["watchlists"]
            elif isinstance(user_data, dict):
                watchlists = user_data
            else:
                watchlists = {}

            for wl_name, items in watchlists.items():
                if wl_name in ("portfolios", "alerts", "transactions", "smallcases"):
                    continue
                if isinstance(items, list):
                    for sym in items:
                        if isinstance(sym, str):
                            watchlist_symbols.add(clean_symbol(sym))
                        elif isinstance(sym, dict) and sym.get("symbol"):
                            watchlist_symbols.add(clean_symbol(sym["symbol"]))

            # Portfolios from user_data if present
            portfolios = user_data.get("portfolios") or {}
            for holdings in portfolios.values():
                if isinstance(holdings, list):
                    for item in holdings:
                        if isinstance(item, dict) and item.get("symbol"):
                            portfolio_symbols.add(clean_symbol(item["symbol"]))
        except Exception:
            pass

    # Direct fallback for portfolios via modules.portfolio.portfolio_routes
    if not portfolio_symbols and username:
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            pf_data = load_portfolios(username) or {}
            for holdings in pf_data.values():
                if isinstance(holdings, list):
                    for item in holdings:
                        if isinstance(item, dict) and item.get("symbol"):
                            portfolio_symbols.add(clean_symbol(item["symbol"]))
                        elif isinstance(item, str):
                            portfolio_symbols.add(clean_symbol(item))
        except Exception:
            pass

    return {"portfolio": portfolio_symbols, "watchlist": watchlist_symbols}


@corporate_actions_bp.get("/corporate-actions")
@_guard
def corporate_actions_page():
    return render_template("index.html", initial_tab="corporate-actions")


@corporate_actions_bp.get("/corporate-actions.css")
@_guard
def corporate_actions_stylesheet():
    return send_from_directory(_MODULE_DIR, "corporate_actions.css", mimetype="text/css")


@corporate_actions_bp.get("/corporate-actions.js")
@_guard
def corporate_actions_javascript():
    return send_from_directory(_MODULE_DIR, "corporate_actions.js", mimetype="application/javascript")


@corporate_actions_bp.get("/api/corporate-actions")
@_guard
def get_corporate_actions_data():
    if _PROVIDER is None:
        return jsonify({"error": "Provider not initialized"}), 500

    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")
    user_symbols = _extract_user_symbols()

    try:
        data = _PROVIDER.get_corporate_actions(
            portfolio_symbols=user_symbols["portfolio"],
            watchlist_symbols=user_symbols["watchlist"],
            force_refresh=force_refresh,
        )
        meta_disp = (data.get("meta", {}) or {}).get("last_updated_display")
        response = jsonify({
            "success": True,
            "last_updated_display": meta_disp,
            **data,
            "user_symbols": {
                "portfolio": sorted(list(user_symbols["portfolio"])),
                "watchlist": sorted(list(user_symbols["watchlist"])),
            },
        })
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as exc:
        return jsonify({"error": f"Failed to load corporate actions: {exc}"}), 500

"""Upcoming events module routes and initialization."""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set

from flask import Blueprint, jsonify, request, send_from_directory, session

from .upcoming_events_provider import UpcomingEventsProvider, clean_symbol

upcoming_events_bp = Blueprint("upcoming_events", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[UpcomingEventsProvider] = None


def init_upcoming_events(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = UpcomingEventsProvider(data_dir=data_dir)


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Upcoming events module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


def _extract_watchlist_symbols(target_watchlist: Optional[str] = None) -> Dict[str, Set[str]]:
    """Extract symbols for the target watchlist or all watchlists of the current user."""
    result: Dict[str, Set[str]] = {}
    if not _LOAD_DATA:
        return result

    username = session.get("username")
    if not username:
        return result

    try:
        user_data = _LOAD_DATA(username) or {}
        if isinstance(user_data, dict) and "watchlists" in user_data and isinstance(user_data["watchlists"], dict):
            watchlists = user_data["watchlists"]
        elif isinstance(user_data, dict):
            watchlists = user_data
        else:
            watchlists = {}

        for wl_name, items in watchlists.items():
            symbols_set = set()
            if isinstance(items, list):
                for sym in items:
                    if isinstance(sym, str):
                        symbols_set.add(clean_symbol(sym))
                    elif isinstance(sym, dict) and sym.get("symbol"):
                        symbols_set.add(clean_symbol(sym["symbol"]))
            result[wl_name] = symbols_set
    except Exception:
        pass

    return result


def _extract_portfolio_symbols() -> Set[str]:
    """Extract all distinct portfolio symbols for the current user."""
    portfolio_symbols: Set[str] = set()
    username = session.get("username")
    if not username:
        return portfolio_symbols

    if _LOAD_DATA:
        try:
            user_data = _LOAD_DATA(username) or {}
            portfolios = user_data.get("portfolios") or {}
            if isinstance(portfolios, dict):
                for holdings in portfolios.values():
                    if isinstance(holdings, list):
                        for item in holdings:
                            if isinstance(item, dict) and item.get("symbol"):
                                portfolio_symbols.add(clean_symbol(item["symbol"]))
                            elif isinstance(item, str):
                                portfolio_symbols.add(clean_symbol(item))
        except Exception:
            pass

    # Direct fallback for portfolios via modules.portfolio.portfolio_routes
    if not portfolio_symbols and username:
        try:
            from modules.portfolio.portfolio_routes import load_portfolios
            pf_data = load_portfolios(username) or {}
            if isinstance(pf_data, dict):
                for holdings in pf_data.values():
                    if isinstance(holdings, list):
                        for item in holdings:
                            if isinstance(item, dict) and item.get("symbol"):
                                portfolio_symbols.add(clean_symbol(item["symbol"]))
                            elif isinstance(item, str):
                                portfolio_symbols.add(clean_symbol(item))
        except Exception:
            pass

    return portfolio_symbols


@upcoming_events_bp.get("/upcoming-events.css")
def upcoming_events_stylesheet():
    return send_from_directory(_MODULE_DIR, "upcoming_events.css", mimetype="text/css")


@upcoming_events_bp.get("/upcoming-events.js")
def upcoming_events_javascript():
    return send_from_directory(_MODULE_DIR, "upcoming_events.js", mimetype="application/javascript")


@upcoming_events_bp.get("/api/upcoming-events")
@_guard
def get_upcoming_events_data():
    if _PROVIDER is None:
        return jsonify({"error": "Provider not initialized"}), 500

    scope = str(request.args.get("scope", "")).strip().lower()
    watchlist_name = str(request.args.get("watchlist", "")).strip()
    show_all = str(request.args.get("all", "")).lower() in ("1", "true", "yes")
    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    all_watchlists = _extract_watchlist_symbols()
    target_symbols: Optional[Set[str]] = None
    display_title = ""

    if scope == "all_stocks" or show_all:
        target_symbols = None
        display_title = "All Stocks"
    elif scope == "all_watchlists":
        combined_symbols: Set[str] = set()
        for sym_set in all_watchlists.values():
            combined_symbols.update(sym_set)
        target_symbols = combined_symbols
        display_title = "All Watchlists"
    elif scope in ("all_portfolios", "portfolio", "portfolios"):
        target_symbols = _extract_portfolio_symbols()
        display_title = "All Portfolio"
    else:
        # Default: "current" active watchlist
        if watchlist_name:
            target_symbols = all_watchlists.get(watchlist_name)
            if target_symbols is None:
                # Check case-insensitive match
                for name, syms in all_watchlists.items():
                    if name.lower() == watchlist_name.lower():
                        target_symbols = syms
                        watchlist_name = name
                        break
            if target_symbols is None:
                target_symbols = set()
            display_title = watchlist_name
        else:
            display_title = "Current Watchlist"
            target_symbols = set()

    try:
        data = _PROVIDER.get_upcoming_events(
            watchlist_symbols=target_symbols,
            watchlist_name=display_title,
            force_refresh=force_refresh,
        )
        response = jsonify({"success": True, "scope": scope or ("all_stocks" if show_all else "current"), **data})
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as exc:
        return jsonify({"error": f"Failed to load upcoming events: {exc}"}), 500

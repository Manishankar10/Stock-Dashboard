"""Transactions module routes and blueprint definition."""

from functools import wraps
from pathlib import Path
import time
from typing import Any, Callable, Dict, Optional, Set, Tuple

from flask import Blueprint, jsonify, render_template, request, send_from_directory, session

from .transactions_provider import TransactionsProvider, clean_symbol

transactions_bp = Blueprint("transactions", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[TransactionsProvider] = None


def init_transactions(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = TransactionsProvider(data_dir=data_dir)


def get_provider() -> Optional[TransactionsProvider]:
    """Retrieve the singleton TransactionsProvider instance."""
    global _PROVIDER
    if _PROVIDER is None:
        _PROVIDER = TransactionsProvider(data_dir=".")
    return _PROVIDER


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Transactions module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)

    return wrapper


def _extract_user_symbols() -> Tuple[Dict[str, Set[str]], Set[str]]:
    """Extract current user's watchlists and portfolio symbols."""
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


@transactions_bp.get("/transactions")
@_guard
def transactions_page():
    return render_template("index.html", initial_tab="transactions")


@transactions_bp.get("/transactions.css")
def transactions_stylesheet():
    return send_from_directory(_MODULE_DIR, "transactions.css", mimetype="text/css")


@transactions_bp.get("/transactions.js")
def transactions_javascript():
    return send_from_directory(_MODULE_DIR, "transactions.js", mimetype="application/javascript")


@transactions_bp.get("/api/market-transactions")
@_guard
def get_transactions_data():
    if _PROVIDER is None:
        return jsonify({"error": "Transactions Provider not initialized"}), 500

    deal_type = str(request.args.get("deal_type", "block")).strip().lower()
    scope = str(request.args.get("scope", "all")).strip()
    from_date = str(request.args.get("from_date", "")).strip() or None
    to_date = str(request.args.get("to_date", "")).strip() or None
    action = str(request.args.get("action", "all")).strip().lower()
    search = str(request.args.get("search", "")).strip()
    custom_query = str(request.args.get("custom_query", "")).strip() or None
    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    user_watchlists, portfolio_symbols = _extract_user_symbols()

    try:
        data = _PROVIDER.get_transactions(
            deal_type=deal_type,
            scope=scope,
            user_watchlists=user_watchlists,
            portfolio_symbols=portfolio_symbols,
            from_date=from_date,
            to_date=to_date,
            action=action,
            search=search,
            force_refresh=force_refresh,
            custom_query=custom_query
        )
        data["user_watchlists"] = list(user_watchlists.keys())
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@transactions_bp.post("/api/market-transactions/refresh")
@_guard
def refresh_transactions_data():
    if _PROVIDER is None:
        return jsonify({"error": "Transactions Provider not initialized"}), 500
    try:
        # User constraint: "dont load data from provider when refresh in transactions page. just load data from our database."
        _PROVIDER._load_stored_deals()
        return jsonify({
            "success": True,
            "official_called": False,
            "message": "Transactions data reloaded from database.",
            "total_records": len(_PROVIDER._cache_deals),
            "deals_count": len(_PROVIDER._cache_deals)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@transactions_bp.route("/api/market-transactions/validate-query", methods=["GET", "POST"])
@_guard
def validate_transactions_query():
    """Validate a custom transaction screener query string and return syntax status, match count, and sample deals."""
    if _PROVIDER is None:
        return jsonify({"error": "Transactions Provider not initialized"}), 500

    if request.method == "POST" and request.is_json:
        query_str = request.json.get("query", "")
    else:
        query_str = request.args.get("query", "")

    result = _PROVIDER.validate_custom_query(query_str)
    return jsonify(result)

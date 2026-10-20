"""Quarterly results module routes and initialization."""

from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Set, Tuple

from flask import Blueprint, jsonify, redirect, render_template, request, send_file, send_from_directory, session

from .quarterly_results_provider import QuarterlyResultsProvider, clean_symbol

quarterly_results_bp = Blueprint("quarterly_results", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent

_LOGIN_REQUIRED: Optional[Callable] = None
_LOAD_DATA: Optional[Callable] = None
_PROVIDER: Optional[QuarterlyResultsProvider] = None


def init_quarterly_results(login_required: Callable, load_data_fn: Optional[Callable] = None, data_dir: str = "."):
    global _LOGIN_REQUIRED, _LOAD_DATA, _PROVIDER
    _LOGIN_REQUIRED = login_required
    _LOAD_DATA = load_data_fn
    _PROVIDER = QuarterlyResultsProvider(data_dir=data_dir)


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Quarterly results module is not initialized."}), 500
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


@quarterly_results_bp.get("/quarterly-results")
@_guard
def quarterly_results_page():
    return render_template("index.html", initial_tab="quarterly-results")


@quarterly_results_bp.get("/quarterly-results.css")
def quarterly_results_stylesheet():
    return send_from_directory(_MODULE_DIR, "quarterly_results.css", mimetype="text/css")


@quarterly_results_bp.get("/quarterly-results.js")
def quarterly_results_javascript():
    return send_from_directory(_MODULE_DIR, "quarterly_results.js", mimetype="application/javascript")


@quarterly_results_bp.get("/api/quarterly-results")
@_guard
def get_quarterly_results_data():
    if _PROVIDER is None:
        return jsonify({"error": "Provider not initialized"}), 500

    search = str(request.args.get("search", "")).strip()
    industry = str(request.args.get("industry", "")).strip()
    mcap_tier = str(request.args.get("mcap_tier", "")).strip()
    sorting = str(request.args.get("sorting", "latest")).strip()
    exchange = str(request.args.get("exchange", "all")).strip()
    watchlist = str(request.args.get("watchlist", "portfolio")).strip()
    date_val = str(request.args.get("date", "")).strip()
    force_refresh = str(request.args.get("refresh", "")).lower() in ("1", "true", "yes")

    min_mcap = None
    max_mcap = None
    try:
        if request.args.get("min_mcap"):
            min_mcap = float(request.args.get("min_mcap"))
        if request.args.get("max_mcap"):
            max_mcap = float(request.args.get("max_mcap"))
    except (ValueError, TypeError):
        pass

    user_watchlists, portfolio_symbols = _extract_user_symbols()

    try:
        data = _PROVIDER.get_quarterly_results(
            search=search,
            industry=industry,
            market_cap_tier=mcap_tier,
            min_mcap=min_mcap,
            max_mcap=max_mcap,
            sorting=sorting,
            exchange=exchange,
            watchlist_scope=watchlist,
            user_watchlists=user_watchlists,
            portfolio_symbols=portfolio_symbols,
            date_filter=date_val,
            force_refresh=force_refresh,
        )
        # Add user's watchlist names for the filter UI
        data["user_watchlists"] = list(user_watchlists.keys())
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@quarterly_results_bp.get("/api/quarterly-results/download")
@_guard
def download_quarterly_results_data():
    live_file = Path("app_data") / "quarterly_results_live.json"
    if live_file.exists():
        return send_file(
            live_file.resolve(),
            as_attachment=True,
            download_name="quarterly_results_latest.json",
            mimetype="application/json",
        )
    return jsonify({"error": "Quarterly results file not found."}), 404


@quarterly_results_bp.get("/api/quarterly-results/pdf-open")
def open_exchange_pdf():
    target = str(request.args.get("target", "")).strip()
    if not target:
        return jsonify({"error": "Target URL required"}), 400
    if "bseindia.com" in target or "nseindia.com" in target:
        return redirect(target)
    if _PROVIDER:
        resolved = _PROVIDER.resolve_pdf_url(target)
        return redirect(resolved)
    return redirect(target)


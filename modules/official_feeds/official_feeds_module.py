import os

from flask import Blueprint, jsonify, request, send_from_directory

from .official_feeds_ai import OfficialFeedSummaryError, summarize_official_filing
from .official_feeds_provider import OfficialFeedsProvider


official_feeds_bp = Blueprint("watchlist_official_feeds", __name__, url_prefix="/api/watchlist-official-feeds")
_provider = OfficialFeedsProvider()
_load_watchlists = None
_load_portfolios = None
_login_required = None


def init_official_feeds(login_required, load_watchlists, load_portfolios=None):
    global _login_required, _load_watchlists, _load_portfolios
    _login_required = login_required
    _load_watchlists = load_watchlists
    _load_portfolios = load_portfolios


def _get_user_portfolios():
    global _load_portfolios
    if _load_portfolios:
        try:
            return _load_portfolios() or {}
        except Exception:
            pass
    try:
        from modules.portfolio.portfolio_routes import load_portfolios
        return load_portfolios() or {}
    except Exception:
        return {}


@official_feeds_bp.get("/assets/<path:filename>")
def official_feeds_asset(filename):
    return send_from_directory(os.path.dirname(__file__), filename)


@official_feeds_bp.get("")
def get_watchlist_official_feeds():
    if not _login_required or not _load_watchlists:
        return jsonify({"error": "Official feeds module is not initialized."}), 500

    return _login_required(_get_feed_response)()


@official_feeds_bp.post("/summarize")
def summarize_watchlist_filing():
    if not _login_required:
        return jsonify({"error": "Official feeds module is not initialized."}), 500
    return _login_required(_summarize_filing_response)()


def _summarize_filing_response():
    data = request.get_json(silent=True) or {}
    try:
        summary = summarize_official_filing(
            url=data.get("url"),
            company=data.get("company"),
            subject=data.get("subject"),
            details=data.get("details"),
        )
        return jsonify({"summary": summary})
    except OfficialFeedSummaryError as exc:
        message = str(exc)
        status = 503 if "GEMINI_API_KEY" in message else (429 if "rate limit" in message else 502)
        return jsonify({"error": message}), status


def _extract_symbols_from_list(items):
    symbols = []
    seen = set()
    for item in items or []:
        sym = item.get("symbol") if isinstance(item, dict) else (item if isinstance(item, str) else "")
        sym = str(sym).strip()
        if sym and sym not in seen:
            seen.add(sym)
            symbols.append(sym)
    return symbols


def _get_feed_response():
    raw_target = (request.args.get("watchlist") or "").strip()
    watchlists = _load_watchlists() or {}
    portfolios = _get_user_portfolios() or {}

    # 1. Collect all distinct watchlist symbols
    all_wl_symbols = []
    seen_wl = set()
    for wl_items in watchlists.values():
        for s in _extract_symbols_from_list(wl_items):
            if s not in seen_wl:
                seen_wl.add(s)
                all_wl_symbols.append(s)

    # 2. Collect all distinct portfolio symbols
    all_pf_symbols = []
    seen_pf = set()
    for pf_items in portfolios.values():
        for s in _extract_symbols_from_list(pf_items):
            if s not in seen_pf:
                seen_pf.add(s)
                all_pf_symbols.append(s)

    target_lower = raw_target.lower()
    selected_target = raw_target
    target_scope = "watchlist"
    symbols = []

    # Check scopes
    if target_lower in ["all watchlists", "all_watchlists", "all_watchlist", "__all_watchlists__"]:
        symbols = all_wl_symbols
        selected_target = "All Watchlists"
        target_scope = "all_watchlists"
    elif target_lower in ["portfolio", "all portfolios", "all_portfolios", "__portfolio__"]:
        symbols = all_pf_symbols
        selected_target = "Portfolio"
        target_scope = "portfolio"
    elif raw_target.startswith("portfolio:"):
        pf_name = raw_target[len("portfolio:"):].strip()
        symbols = _extract_symbols_from_list(portfolios.get(pf_name, []))
        selected_target = raw_target
        target_scope = "portfolio_single"
    elif raw_target in portfolios and raw_target not in watchlists:
        symbols = _extract_symbols_from_list(portfolios.get(raw_target, []))
        selected_target = f"portfolio:{raw_target}"
        target_scope = "portfolio_single"
    elif raw_target in watchlists:
        symbols = _extract_symbols_from_list(watchlists.get(raw_target, []))
        selected_target = raw_target
        target_scope = "watchlist"
    else:
        # Check case-insensitive match in watchlists
        matched_wl = next((k for k in watchlists.keys() if k.lower() == target_lower), None)
        if matched_wl:
            symbols = _extract_symbols_from_list(watchlists.get(matched_wl, []))
            selected_target = matched_wl
            target_scope = "watchlist"
        elif not raw_target:
            if watchlists:
                first_wl = list(watchlists.keys())[0]
                symbols = _extract_symbols_from_list(watchlists.get(first_wl, []))
                selected_target = first_wl
                target_scope = "watchlist"
            elif portfolios:
                symbols = all_pf_symbols
                selected_target = "Portfolio"
                target_scope = "portfolio"
            else:
                symbols = []
                selected_target = "All Watchlists"
                target_scope = "all_watchlists"
        else:
            # Fallback to All Watchlists
            symbols = all_wl_symbols
            selected_target = "All Watchlists"
            target_scope = "all_watchlists"

    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1
    subcategory = (request.args.get("subcategory") or "").strip()
    selected_symbol = (request.args.get("symbol") or "").strip()

    if selected_symbol:
        fetch_symbols = [selected_symbol]
    else:
        fetch_symbols = symbols

    refresh = request.args.get("refresh") == "1"
    result = _provider.get_feed(fetch_symbols, page=page, subcategory=subcategory, refresh=refresh)
    result["watchlist"] = selected_target
    result["watchlists"] = list(watchlists.keys())
    result["portfolios"] = list(portfolios.keys())
    result["scope"] = target_scope
    result["stocks"] = sorted(symbols, key=lambda s: str(s).upper())
    result["selected_symbol"] = selected_symbol
    return jsonify(result)

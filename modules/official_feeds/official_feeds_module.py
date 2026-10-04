import os

from flask import Blueprint, jsonify, request, send_from_directory

from .official_feeds_ai import OfficialFeedSummaryError, summarize_official_filing
from .official_feeds_provider import OfficialFeedsProvider


official_feeds_bp = Blueprint("watchlist_official_feeds", __name__, url_prefix="/api/watchlist-official-feeds")
_provider = OfficialFeedsProvider()
_load_watchlists = None
_login_required = None


def init_official_feeds(login_required, load_watchlists):
    global _login_required, _load_watchlists
    _login_required = login_required
    _load_watchlists = load_watchlists


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


def _get_feed_response():
    watchlist_name = (request.args.get("watchlist") or "").strip()
    watchlists = _load_watchlists()
    symbols = watchlists.get(watchlist_name)
    if symbols is None:
        return jsonify({"error": "Watchlist not found."}), 404

    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1
    subcategory = (request.args.get("subcategory") or "").strip()
    selected_symbol = (request.args.get("symbol") or "").strip()
    if selected_symbol and selected_symbol not in symbols:
        return jsonify({"error": "Select a stock from this watchlist."}), 400
    if selected_symbol:
        symbols = [selected_symbol]

    refresh = request.args.get("refresh") == "1"
    result = _provider.get_feed(symbols, page=page, subcategory=subcategory, refresh=refresh)
    result["watchlist"] = watchlist_name
    result["watchlists"] = list(watchlists.keys())
    result["stocks"] = watchlists.get(watchlist_name, [])
    result["selected_symbol"] = selected_symbol
    return jsonify(result)

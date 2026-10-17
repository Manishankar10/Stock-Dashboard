import os
from flask import Blueprint, jsonify, request, send_from_directory

from .broker_research_ai import summarize_research_report
from .broker_research_provider import BrokerResearchProvider, clean_symbol

broker_research_bp = Blueprint("broker_research", __name__, url_prefix="/api/broker-research")

_provider = BrokerResearchProvider()
_load_watchlists = None
_login_required = None


def init_broker_research(login_required=None, load_watchlists=None):
    global _login_required, _load_watchlists
    _login_required = login_required
    _load_watchlists = load_watchlists


@broker_research_bp.get("/assets/<path:filename>")
def broker_research_asset(filename):
    """Serve static CSS/JS assets from this module's directory."""
    return send_from_directory(os.path.dirname(__file__), filename)


@broker_research_bp.get("")
def get_broker_research_reports():
    """
    Retrieve recent 6 months institutional research reports and mutual fund papers.
    Query params:
      - symbol: single stock symbol (e.g. TCS)
      - watchlist: watchlist name to aggregate reports for
      - company: optional company name for better title generation
      - refresh: '1' to bypass cache
    """
    symbol = request.args.get("symbol", "").strip()
    watchlist = request.args.get("watchlist", "").strip()
    company_name = request.args.get("company", "").strip()
    force_refresh = request.args.get("refresh") == "1"

    if symbol:
        clean_sym = clean_symbol(symbol)
        reports = _provider.get_stock_research_reports(clean_sym, company_name=company_name, force_refresh=force_refresh)
        return jsonify({
            "success": True,
            "type": "stock",
            "symbol": clean_sym,
            "company": company_name or clean_sym,
            "count": len(reports),
            "reports": reports
        })

    if watchlist:
        symbols = []
        if _load_watchlists:
            try:
                watchlists_data = _load_watchlists() or {}
                # Match watchlist case-insensitively
                target_wl = None
                for wl_name in watchlists_data:
                    if wl_name.lower() == watchlist.lower():
                        target_wl = wl_name
                        break
                if target_wl:
                    raw_items = watchlists_data[target_wl]
                    if isinstance(raw_items, list):
                        for item in raw_items:
                            if isinstance(item, str):
                                symbols.append(item)
                            elif isinstance(item, dict) and "symbol" in item:
                                symbols.append(item["symbol"])
            except Exception as e:
                pass

        if not symbols and watchlist:
            # Fallback sample if watchlist is empty or symbols couldn't be loaded
            symbols = ["TCS", "INFY", "RELIANCE", "HDFCBANK", "ICICIBANK", "LT", "BHARTIARTL"]

        reports = _provider.get_watchlist_research_reports(watchlist, symbols, force_refresh=force_refresh)
        return jsonify({
            "success": True,
            "type": "watchlist",
            "watchlist": watchlist,
            "symbols": symbols,
            "count": len(reports),
            "reports": reports
        })

    # Default to popular benchmark heavyweights
    default_symbols = ["TCS", "INFY", "RELIANCE", "HDFCBANK", "WIPRO", "TECHM"]
    reports = _provider.get_watchlist_research_reports("Nifty Top Holdings", default_symbols, force_refresh=force_refresh)
    return jsonify({
        "success": True,
        "type": "default",
        "watchlist": "Top Holdings",
        "symbols": default_symbols,
        "count": len(reports),
        "reports": reports
    })


@broker_research_bp.post("/summarize")
def summarize_report():
    """Generate or retrieve AI summary for an institutional research report."""
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"success": False, "error": "Missing report payload"}), 400

    try:
        summary_md = summarize_research_report(data)
        return jsonify({
            "success": True,
            "summary": summary_md,
            "symbol": data.get("symbol"),
            "author": data.get("author"),
            "title": data.get("title")
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

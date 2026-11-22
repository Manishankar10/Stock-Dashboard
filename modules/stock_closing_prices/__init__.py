"""
Stock Closing Prices Module for Capital Desk.
Provides routes, EOD closing prices queries, and background synchronization
for all 750 benchmark index constituent stocks.
"""

import logging
from flask import Blueprint, jsonify, request
from modules.common.auth_utils import login_required, admin_required
import db_store
from .stock_closing_prices_provider import stock_closing_prices_provider

logger = logging.getLogger("stock_closing_prices")

stock_closing_prices_bp = Blueprint("stock_closing_prices", __name__)


@stock_closing_prices_bp.route("/api/stock_closing_prices", methods=["GET"])
def get_all_closing_prices():
    """
    Returns latest closing price summary for all 750 constituent stocks.
    Query parameters:
    - q: optional search filter for symbol or company name
    - limit: optional max items to return
    """
    try:
        q = request.args.get("q", "").strip().upper()
        limit_param = request.args.get("limit")
        limit = int(limit_param) if limit_param and limit_param.isdigit() else None

        records = db_store.load_stock_closing_prices_db(summary_only=True, limit=limit) or {}
        
        results = []
        for sym, doc in records.items():
            if q:
                cname = str(doc.get("company_name", "")).upper()
                if q not in sym and q not in cname:
                    continue
            results.append(doc)

        # Sort alphabetically by symbol
        results.sort(key=lambda x: x.get("symbol", ""))

        status = stock_closing_prices_provider.get_sync_status()

        return jsonify({
            "success": True,
            "total_stocks": len(results),
            "latest_trading_date": status.get("latest_trading_date", ""),
            "last_synced_display": status.get("last_synced_display", "Never"),
            "stocks": results
        })
    except Exception as e:
        logger.error(f"Error in get_all_closing_prices: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@stock_closing_prices_bp.route("/api/stock_closing_prices/<symbol>", methods=["GET"])
def get_stock_closing_history(symbol):
    """
    Returns 2-year daily closing price series for a single stock.
    Query parameters:
    - days: number of most recent trading days to return (e.g. 50, 200, 500)
    """
    try:
        clean_sym = str(symbol).strip().upper()
        doc = db_store.load_stock_closing_prices_db(clean_sym)
        if not doc:
            return jsonify({
                "success": False,
                "error": f"Stock '{clean_sym}' not found in closing prices database."
            }), 404

        days_param = request.args.get("days")
        if days_param and days_param.isdigit():
            n_days = int(days_param)
            prices = doc.get("prices", [])
            if len(prices) > n_days:
                doc["prices"] = prices[-n_days:]
                doc["total_records"] = len(doc["prices"])

        return jsonify({
            "success": True,
            "stock": doc
        })
    except Exception as e:
        logger.error(f"Error in get_stock_closing_history for {symbol}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@stock_closing_prices_bp.route("/api/admin/stock_closing_prices/status", methods=["GET"])
@admin_required
def admin_stock_closing_prices_status():
    """Telemetry status endpoint for Admin Exchange Datasets & Feed Synchronization table."""
    try:
        status = stock_closing_prices_provider.get_sync_status()
        return jsonify({
            "success": True,
            "status": status
        })
    except Exception as e:
        logger.error(f"Error in admin_stock_closing_prices_status: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@stock_closing_prices_bp.route("/api/admin/stock_closing_prices/sync", methods=["POST"])
@admin_required
def admin_stock_closing_prices_sync():
    """
    Triggers background synchronization to update pending closing prices up to date.
    STRICT REQUIREMENT: Sync is permitted only when market is closed (post 03:30 PM IST / weekends / holidays).
    Payload parameters:
    - force: bool (optional administrative force override)
    - full_resync: bool (optional full reload)
    - start_date: str (optional baseline date: '2012-01-01' or '2013-01-01')
    """
    try:
        payload = request.get_json(silent=True) or {}
        force = bool(payload.get("force", False))
        full_resync = bool(payload.get("full_resync", False))
        start_date = payload.get("start_date") or "2012-01-01"

        res = stock_closing_prices_provider.start_background_sync(
            force=force,
            full_resync=full_resync,
            start_date=start_date
        )
        return jsonify(res)
    except Exception as e:
        logger.error(f"Error in admin_stock_closing_prices_sync: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


def init_stock_closing_prices(app):
    """
    Initializes the stock closing prices subsystem on app boot.
    Verifies database state without triggering automatic background syncs.
    All future syncs are triggered manually via the Admin Settings button.
    """
    try:
        stock_closing_prices_provider.ensure_initialized()
    except Exception as e:
        logger.warning(f"Error initializing stock closing prices provider: {e}")

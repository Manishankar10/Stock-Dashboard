"""
Index Stocks Module for Capital Desk.
Provides routes and background synchronization for official NSE benchmark and sectoral index constituents.
Persistent Storage: MongoDB Atlas + SQLite.
"""

from flask import Blueprint, jsonify, request
from modules.common.auth_utils import login_required, admin_required
from .index_stocks_provider import index_stocks_provider, INDEX_REGISTRY

index_stocks_bp = Blueprint("index_stocks", __name__)


@index_stocks_bp.route("/api/indices", methods=["GET"])
def get_indices():
    """Returns overview of all 10 benchmark & sectoral indices with official sizes and DB counts."""
    try:
        indices = index_stocks_provider.get_all_indices()
        return jsonify({
            "success": True,
            "total_indices": len(indices),
            "indices": indices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@index_stocks_bp.route("/api/indices/stocks", methods=["GET"])
def get_index_stocks():
    """
    Returns constituent stocks for a specified index.
    Query param: `index` (e.g. 'NIFTY 50', 'NIFTY_50', 'NIFTY BANK', 'NIFTY MIDCAP 150', etc.)
    """
    index_param = request.args.get("index") or request.args.get("key") or request.args.get("name") or "NIFTY_50"
    try:
        data = index_stocks_provider.get_index_stocks(index_param)
        if not data:
            return jsonify({"success": False, "error": f"Index '{index_param}' not found."}), 404
        return jsonify({
            "success": True,
            "index": data
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@index_stocks_bp.route("/api/indices/all", methods=["GET"])
def get_all_indices_with_stocks():
    """Returns all 10 indices populated with their full constituent stock lists."""
    try:
        result = {}
        for key in INDEX_REGISTRY:
            result[key] = index_stocks_provider.get_index_stocks(key)
        return jsonify({
            "success": True,
            "total_indices": len(result),
            "indices": result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@index_stocks_bp.route("/api/indices/audit", methods=["GET"])
def get_indices_audit():
    """Returns rebalance audit log showing newly entered and exited constituent stocks across syncs."""
    try:
        import db_store
        limit = int(request.args.get("limit", 10))
        logs = db_store.load_index_rebalance_audit(limit=limit)
        return jsonify({
            "success": True,
            "total_logs": len(logs),
            "audit": logs
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@index_stocks_bp.route("/api/admin/indices/status", methods=["GET"])
@admin_required
def admin_indices_status():
    """Telemetry endpoint for Admin Exchange Datasets & Feed Synchronization table."""
    try:
        status = index_stocks_provider.get_sync_status()
        return jsonify({
            "success": True,
            "status": status
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@index_stocks_bp.route("/api/admin/indices/sync", methods=["POST"])
@admin_required
def admin_indices_sync():
    """Triggers background synchronization and official size rebalancing across all 10 indices."""
    try:
        payload = request.get_json(silent=True) or {}
        # Default enforce_official_size to True unless explicitly disabled
        rebalance = True
        if "rebalance" in payload:
            rebalance = bool(payload.get("rebalance"))
        elif request.args.get("rebalance") is not None:
            rebalance = request.args.get("rebalance", "").lower() in ("1", "true", "yes")

        res = index_stocks_provider.start_background_sync(enforce_official_size=rebalance)
        status_code = 200 if res.get("success") else 400
        return jsonify(res), status_code
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

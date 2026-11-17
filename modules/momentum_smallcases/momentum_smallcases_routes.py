"""
CAPITAL DESK - MOMENTUM SMALLCASES ROUTE HANDLERS
Exposes endpoints for listing, creating, viewing, editing, and deleting Manual Momentum Indices.
"""

import logging
from flask import Blueprint, jsonify, request, render_template, session
from modules.momentum_smallcases.momentum_smallcases_store import (
    get_user_indices,
    get_user_index,
    create_user_index,
    update_user_index,
    delete_user_index,
    parse_stocks_input,
)

logger = logging.getLogger(__name__)

momentum_smallcases_bp = Blueprint("momentum_smallcases", __name__)
_login_required = None


def init_routes(login_required_fn=None):
    global _login_required
    if login_required_fn:
        _login_required = login_required_fn


def _require_auth(f):
    if _login_required:
        return _login_required(f)
    return f


@momentum_smallcases_bp.route("/momentum-smallcases", methods=["GET"])
def momentum_smallcases_page():
    return render_template("index.html", initial_tab="momentum-smallcases")


@momentum_smallcases_bp.route("/smallcase-baskets", methods=["GET"])
def smallcase_baskets_page():
    return render_template("index.html", initial_tab="smallcase-baskets")


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices", methods=["GET"])
def list_indices_api():
    """Lists all manual indices for current user with summary stats."""
    try:
        user = session.get("username") or "admin"
        indices = get_user_indices(user)
        total_indices = len(indices)
        total_stocks = sum(idx.get("stock_count", len(idx.get("stocks", []))) for idx in indices)
        avg_stocks = round(total_stocks / total_indices, 1) if total_indices > 0 else 0

        summary = {
            "total_indices": total_indices,
            "total_stocks": total_stocks,
            "avg_stocks": avg_stocks,
            "last_updated": indices[0].get("updated_at") if indices else None
        }

        return jsonify({
            "success": True,
            "indices": indices,
            "summary": summary
        })
    except Exception as e:
        logger.error(f"Error listing momentum indices: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices", methods=["POST"])
def create_index_api():
    """Creates a new manual index."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        name = body.get("name")
        description = body.get("description", "")
        stocks_str = body.get("stocks", "")

        if not name or not str(name).strip():
            return jsonify({"success": False, "error": "Index name is required"}), 400

        new_index = create_user_index(
            name=name,
            description=description,
            stocks_str=stocks_str,
            username=user
        )
        return jsonify({"success": True, "index": new_index, "message": "Manual Index created successfully"}), 201
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error creating momentum index: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices/<index_id>", methods=["GET"])
def get_index_api(index_id):
    """Retrieves a single manual index by ID with optional live quotes."""
    try:
        user = session.get("username") or "admin"
        enrich = request.args.get("enrich", "1").lower() in ("1", "true", "yes")
        idx = get_user_index(index_id, username=user, enrich_quotes=enrich)
        if not idx:
            return jsonify({"success": False, "error": "Manual Index not found"}), 404

        return jsonify({"success": True, "index": idx})
    except Exception as e:
        logger.error(f"Error getting momentum index '{index_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices/<index_id>", methods=["PUT"])
def update_index_api(index_id):
    """Updates an existing manual index."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        name = body.get("name")
        description = body.get("description", "")
        stocks_str = body.get("stocks", "")

        if not name or not str(name).strip():
            return jsonify({"success": False, "error": "Index name is required"}), 400

        updated_index = update_user_index(
            index_id=index_id,
            name=name,
            description=description,
            stocks_str=stocks_str,
            username=user
        )
        return jsonify({"success": True, "index": updated_index, "message": "Manual Index updated successfully"})
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error updating momentum index '{index_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices/<index_id>", methods=["DELETE"])
def delete_index_api(index_id):
    """Deletes a manual index."""
    try:
        user = session.get("username") or "admin"
        ok = delete_user_index(index_id, username=user)
        if not ok:
            return jsonify({"success": False, "error": "Manual Index not found"}), 404

        return jsonify({"success": True, "message": "Manual Index deleted successfully"})
    except Exception as e:
        logger.error(f"Error deleting momentum index '{index_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/parse-stocks", methods=["POST"])
def parse_stocks_api():
    """Utility endpoint to test/preview parsed stocks input."""
    try:
        body = request.get_json(silent=True) or {}
        stocks_str = body.get("stocks", "")
        parsed = parse_stocks_input(stocks_str)
        return jsonify({"success": True, "count": len(parsed), "stocks": parsed})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

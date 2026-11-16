"""
CAPITAL DESK - CHARTINK SCREENER API ROUTES
Exposes endpoints for category discovery, real-time scan execution,
and importing/copying any screener from Chartink.com.
"""

import logging
from flask import Blueprint, jsonify, request
from modules.common.auth_utils import login_required
from modules.chartink.chartink_store import (
    get_all_screeners,
    get_screener_by_slug,
    run_screener_scan,
    import_chartink_screener,
    delete_screener,
    toggle_screener_favourite,
    update_screener_tags,
)

logger = logging.getLogger(__name__)

chartink_bp = Blueprint("chartink", __name__)


@chartink_bp.route("/api/chartink/categories", methods=["GET"])
def get_categories_api():
    """Returns all screener categories."""
    try:
        categories = get_all_screeners()
        return jsonify({"success": True, "categories": categories})
    except Exception as e:
        logger.error(f"Error fetching Chartink categories: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@chartink_bp.route("/api/chartink/scan/<slug>", methods=["GET"])
def run_scan_api(slug):
    """Executes or fetches cached scan results for a category."""
    try:
        force_refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
        data = run_screener_scan(slug, force_refresh=force_refresh)
        return jsonify({"success": True, "scan": data})
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 404
    except Exception as e:
        logger.error(f"Error executing Chartink scan for '{slug}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@chartink_bp.route("/api/chartink/import", methods=["POST"])
def import_screener_api():
    """Imports any screener directly from a Chartink URL or slug."""
    try:
        body = request.get_json(silent=True) or {}
        url_or_slug = body.get("url") or body.get("slug")
        if not url_or_slug:
            return jsonify({"success": False, "error": "Chartink URL or slug is required"}), 400

        category_group = body.get("category_group") or "Custom Scans"
        tags = body.get("tags") or "Custom"
        imported = import_chartink_screener(url_or_slug, category_group=category_group, tags=tags)
        return jsonify({"success": True, "screener": imported})
    except Exception as e:
        logger.error(f"Error importing screener from Chartink: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@chartink_bp.route("/api/chartink/category/<slug>/favourite", methods=["POST"])
def toggle_favourite_api(slug):
    """Toggles favourite status of a screener."""
    try:
        ok, msg, is_fav = toggle_screener_favourite(slug)
        if not ok:
            return jsonify({"success": False, "error": msg}), 400
        return jsonify({"success": True, "is_favourite": is_fav})
    except Exception as e:
        logger.error(f"Error toggling favourite for '{slug}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@chartink_bp.route("/api/chartink/category/<slug>/tags", methods=["POST"])
def update_tags_api(slug):
    """Updates tags for a screener."""
    try:
        body = request.get_json(silent=True) or {}
        tags = body.get("tags", "")
        ok, msg = update_screener_tags(slug, tags)
        if not ok:
            return jsonify({"success": False, "error": msg}), 400
        return jsonify({"success": True, "message": msg, "tags": tags})
    except Exception as e:
        logger.error(f"Error updating tags for '{slug}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@chartink_bp.route("/api/chartink/category/<slug>", methods=["DELETE"])
def delete_category_api(slug):
    """Deletes a custom category."""
    try:
        ok, msg = delete_screener(slug)
        if not ok:
            return jsonify({"success": False, "error": msg}), 400
        return jsonify({"success": True, "message": msg})
    except Exception as e:
        logger.error(f"Error deleting category '{slug}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

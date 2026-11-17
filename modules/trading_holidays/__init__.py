"""
Official Trading Holidays Module for Capital Desk.
Provides endpoints and background synchronization for official NSE & BSE equity trading holidays.
Persistent Storage: MongoDB Atlas + SQLite.
"""

from flask import Blueprint, jsonify, request
from modules.common.auth_utils import login_required, admin_required
from .trading_holidays_provider import trading_holidays_provider

trading_holidays_bp = Blueprint("trading_holidays", __name__)


@trading_holidays_bp.route("/api/trading_holidays", methods=["GET"])
def get_trading_holidays():
    """
    Returns list of official trading holidays.
    Query parameters:
    - year: e.g. 2026, 2025 (defaults to all if omitted)
    - upcoming: true/1 (filters for today or future dates)
    """
    try:
        year_param = request.args.get("year")
        year = int(year_param) if year_param and year_param.isdigit() else None
        holidays = trading_holidays_provider.get_all_holidays(year=year)

        upcoming_param = request.args.get("upcoming", "").lower() in ("true", "1", "yes")
        if upcoming_param:
            from modules.common.ist_datetime import today_ist_str
            today_str = today_ist_str()
            holidays = [h for h in holidays if h.get("date", "") >= today_str]

        return jsonify({
            "success": True,
            "total_holidays": len(holidays),
            "year_filter": year,
            "upcoming_only": upcoming_param,
            "holidays": holidays
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@trading_holidays_bp.route("/api/trading_holidays/years", methods=["GET"])
def get_holiday_years():
    """Returns summary of available years, holiday counts per year, and next upcoming holiday."""
    try:
        status = trading_holidays_provider.get_sync_status()
        return jsonify({
            "success": True,
            "years": status["years"],
            "counts_by_year": status["counts_by_year"],
            "total_holidays": status["total_holidays"],
            "current_year": status["current_year"],
            "next_holiday": status.get("next_holiday")
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@trading_holidays_bp.route("/api/trading_holidays/is_today_holiday", methods=["GET"])
def is_today_holiday_route():
    """Checks whether today is an exchange trading holiday or weekend."""
    try:
        res = trading_holidays_provider.is_today_holiday()
        return jsonify({
            "success": True,
            **res
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@trading_holidays_bp.route("/api/admin/trading_holidays/status", methods=["GET"])
@admin_required
def admin_trading_holidays_status():
    """Telemetry endpoint for Admin Exchange Datasets & Feed Synchronization table."""
    try:
        status = trading_holidays_provider.get_sync_status()
        return jsonify({
            "success": True,
            "status": status
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@trading_holidays_bp.route("/api/admin/trading_holidays/sync", methods=["POST"])
@admin_required
def admin_trading_holidays_sync():
    """
    Triggers synchronization for current year trading holidays.
    Payload options:
    - only_if_not_exists (bool): if True and current year exists in DB, skips sync.
    - force (bool): if True, forces live re-fetch from NSE regardless of DB status.
    """
    try:
        payload = request.get_json(silent=True) or {}
        only_if_not_exists = True
        if "only_if_not_exists" in payload:
            only_if_not_exists = bool(payload.get("only_if_not_exists"))
        elif request.args.get("only_if_not_exists") is not None:
            only_if_not_exists = request.args.get("only_if_not_exists", "").lower() in ("1", "true", "yes")

        force = bool(payload.get("force", False))
        if not force and request.args.get("force") is not None:
            force = request.args.get("force", "").lower() in ("1", "true", "yes")

        res = trading_holidays_provider.start_background_sync(only_if_not_exists=only_if_not_exists, force=force)
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

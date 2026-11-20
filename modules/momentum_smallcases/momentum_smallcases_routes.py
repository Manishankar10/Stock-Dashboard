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
    get_combined_indices_list,
    get_user_strategies,
    get_user_strategy,
    create_user_strategy,
    update_user_strategy_formula,
    update_user_strategy_settings,
    run_strategy_init,
    run_strategy_rebalance,
    run_strategy_all_rebalances,
    start_async_execution_job,
    get_execution_job_status,
    get_strategy_consolidated_stocks,
    delete_user_strategy,
    reset_all_momentum_data,
)
from modules.momentum_smallcases.momentum_smallcases_chart import (
    start_performance_graph_job,
    get_performance_graph_job_status,
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


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices/<index_id>", methods=["DELETE", "POST"])
@momentum_smallcases_bp.route("/api/momentum-smallcases/indices/<index_id>/delete", methods=["POST", "DELETE"])
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


# ==============================================================================
# STRATEGY & CALCULATION ENDPOINTS
# ==============================================================================

def get_earliest_stock_price_month():
    try:
        import sqlite3
        conn = sqlite3.connect("user_data/capital_desk.db")
        cur = conn.cursor()
        cur.execute("SELECT MIN(start_date) FROM stock_closing_prices WHERE start_date IS NOT NULL")
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            from datetime import datetime
            d = datetime.strptime(str(row[0])[:10], "%Y-%m-%d")
            return d.strftime("%b %Y")
    except Exception:
        pass
    return "Jan 2012"


@momentum_smallcases_bp.route("/api/momentum-smallcases/indices-catalog", methods=["GET"])
def get_indices_catalog_api():
    """Returns all available indices: manual indices + official Nifty benchmark indices."""
    try:
        user = session.get("username") or "admin"
        catalog = get_combined_indices_list(user)
        earliest_month = get_earliest_stock_price_month()
        return jsonify({
            "success": True,
            "indices": catalog,
            "earliest_month": earliest_month
        })
    except Exception as e:
        logger.error(f"Error fetching indices catalog: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies", methods=["GET"])
def list_strategies_api():
    """Lists all momentum smallcase strategies for current user."""
    try:
        user = session.get("username") or "admin"
        strategies = get_user_strategies(user)
        total_strategies = len(strategies)
        active_strategies = sum(1 for s in strategies if s.get("status") == "ACTIVE")
        total_capital = sum(float(s.get("amount_to_invest", 0.0)) for s in strategies)
        total_value = sum(float(s.get("current_portfolio_value", s.get("amount_to_invest", 0.0))) for s in strategies)

        summary = {
            "total_strategies": total_strategies,
            "active_strategies": active_strategies,
            "total_capital": round(total_capital, 2),
            "total_portfolio_value": round(total_value, 2)
        }

        return jsonify({
            "success": True,
            "strategies": strategies,
            "summary": summary
        })
    except Exception as e:
        logger.error(f"Error listing strategies: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies", methods=["POST"])
def create_strategy_api():
    """Creates a new Momentum Smallcase strategy."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        trim_existing = body.get("trim_existing")
        trading_days = body.get("trading_days_per_month")

        new_strat = create_user_strategy(
            name=body.get("name"),
            start_date=body.get("start_date"),
            index_id=body.get("index_id"),
            no_of_stocks=body.get("no_of_stocks"),
            exit_regime_ranking=body.get("exit_regime_ranking"),
            rebalance_day=body.get("rebalance_day"),
            amount_to_invest=body.get("amount_to_invest"),
            formula=body.get("formula"),
            username=user,
            trim_existing=trim_existing,
            trading_days_per_month=trading_days
        )
        return jsonify({"success": True, "strategy": new_strat, "message": "Momentum Smallcase created successfully"}), 201
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error creating strategy: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>", methods=["GET"])
def get_strategy_api(strategy_id):
    """Retrieves full details of a strategy."""
    try:
        user = session.get("username") or "admin"
        strat = get_user_strategy(strategy_id, username=user)
        if not strat:
            return jsonify({"success": False, "error": "Strategy not found"}), 404
        return jsonify({"success": True, "strategy": strat})
    except Exception as e:
        logger.error(f"Error getting strategy '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/consolidated-stocks", methods=["GET"])
def get_strategy_consolidated_stocks_api(strategy_id):
    """Retrieves consolidated participated stocks performance history for a strategy."""
    try:
        user = session.get("username") or "admin"
        data = get_strategy_consolidated_stocks(strategy_id, username=user)
        return jsonify({"success": True, "data": data})
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 404
    except Exception as e:
        logger.error(f"Error fetching consolidated stocks for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/export-ranked-excel", methods=["GET"])
@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/runs/<int:run_index>/export-ranked-excel", methods=["GET"])
def export_ranked_stocks_excel_api(strategy_id, run_index=None):
    """Exports an Excel workbook (.xlsx) containing all eligible stocks ranked by momentum formula score."""
    try:
        from flask import send_file
        from modules.momentum_smallcases.momentum_smallcases_excel import export_ranked_stocks_to_bytes
        user = session.get("username") or "admin"
        filename, bio = export_ranked_stocks_to_bytes(strategy_id, run_index=run_index, username=user)
        return send_file(
            bio,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 404
    except Exception as e:
        logger.error(f"Error exporting ranked stocks Excel for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/formula", methods=["PUT", "POST"])
def update_formula_api(strategy_id):
    """Updates formula and optional settings for a strategy."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        formula = body.get("formula")
        trim_existing = body.get("trim_existing")
        trading_days = body.get("trading_days_per_month")
        updated = update_user_strategy_settings(
            strategy_id,
            formula=formula,
            trim_existing=trim_existing,
            trading_days_per_month=trading_days,
            username=user
        )
        return jsonify({"success": True, "strategy": updated, "message": "Formula & settings updated successfully"})
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error updating formula for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/settings", methods=["PUT", "PATCH", "POST"])
def update_settings_api(strategy_id):
    """Updates settings (formula, trim_existing, trading_days_per_month) for a strategy."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        formula = body.get("formula")
        trim_existing = body.get("trim_existing")
        trading_days = body.get("trading_days_per_month")
        updated = update_user_strategy_settings(
            strategy_id,
            formula=formula,
            trim_existing=trim_existing,
            trading_days_per_month=trading_days,
            username=user
        )
        return jsonify({"success": True, "strategy": updated, "message": "Settings updated successfully"})
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error updating settings for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/run-init", methods=["POST"])
def run_init_api(strategy_id):
    """Executes initial portfolio calculation & allocation."""
    try:
        user = session.get("username") or "admin"
        if request.args.get("sync") == "1":
            updated = run_strategy_init(strategy_id, username=user)
            return jsonify({
                "success": True,
                "strategy": updated,
                "message": "Init execution completed successfully"
            })
        
        job_id = start_async_execution_job("INIT", strategy_id, username=user)
        return jsonify({
            "success": True,
            "async": True,
            "job_id": job_id,
            "message": "Init execution started"
        }), 202
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error running Init for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/run-rebalance", methods=["POST"])
def run_rebalance_api(strategy_id):
    """Executes rebalance calculation & allocation, with optional step-up capital and trim override."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        stepup = float(body.get("stepup_amount") or 0.0)
        trim_existing = body.get("trim_existing")
        
        if request.args.get("sync") == "1":
            updated = run_strategy_rebalance(strategy_id, stepup_amount=stepup, username=user, trim_existing=trim_existing)
            return jsonify({
                "success": True,
                "strategy": updated,
                "message": "Rebalance execution completed successfully"
            })
        
        job_id = start_async_execution_job("REBALANCE", strategy_id, username=user, stepup_amount=stepup, trim_existing=trim_existing)
        return jsonify({
            "success": True,
            "async": True,
            "job_id": job_id,
            "message": "Rebalance execution started"
        }), 202
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error running rebalance for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/run-all", methods=["POST"])
def run_all_strategy_api(strategy_id):
    """Executes Init (if DRAFT) and all scheduled rebalances up to today (or specified cutoff date)."""
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        stepup = float(body.get("stepup_amount") or body.get("stepup_per_rebalance") or 0.0)
        up_to = body.get("up_to_date")
        trim_existing = body.get("trim_existing")
        
        if request.args.get("sync") == "1":
            result = run_strategy_all_rebalances(
                strategy_id=strategy_id,
                stepup_per_rebalance=stepup,
                up_to_date=up_to,
                username=user,
                trim_existing=trim_existing
            )
            return jsonify({
                "success": True,
                "strategy": result["strategy"],
                "init_executed": result["init_executed"],
                "rebalances_executed": result["rebalances_executed"],
                "total_runs_executed": result["total_runs_executed"],
                "message": result["message"]
            })
        
        job_id = start_async_execution_job("RUN_ALL", strategy_id, username=user, stepup_per_rebalance=stepup, up_to_date=up_to, trim_existing=trim_existing)
        return jsonify({
            "success": True,
            "async": True,
            "job_id": job_id,
            "message": "Run All execution started"
        }), 202
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except RuntimeError as re:
        strat = get_user_strategy(strategy_id, username=user)
        return jsonify({
            "success": False,
            "strategy": strat,
            "error": str(re)
        }), 400
    except Exception as e:
        logger.error(f"Error running all rebalances for '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/jobs/<job_id>", methods=["GET"])
def get_job_status_api(job_id):
    """Returns execution status for an async momentum job, with strategy status fallback."""
    job = get_execution_job_status(job_id)
    if not job:
        # Graceful fallback: If strategy_id is provided, check if strategy is already saved / has runs
        strategy_id = request.args.get("strategy_id")
        user = session.get("username") or "admin"
        if strategy_id:
            strat = get_user_strategy(strategy_id, username=user)
            if strat and strat.get("runs"):
                return jsonify({
                    "success": True,
                    "job": {
                        "id": job_id,
                        "status": "COMPLETED",
                        "strategy_id": strategy_id,
                        "result": {
                            "success": True,
                            "strategy": strat,
                            "message": "Execution already completed."
                        }
                    }
                })
        return jsonify({"success": False, "error": "Job not found"}), 404
    return jsonify({"success": True, "job": job})


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/performance-graph", methods=["POST"])
def start_performance_graph_api(strategy_id):
    """
    Starts an asynchronous background job to evaluate the performance graph.
    If already calculating for this smallcase, returns already_running=True with the existing job_id.
    """
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        force = bool(body.get("force_refresh", False))

        job_info = start_performance_graph_job(strategy_id, username=user, force_refresh=force)
        status_code = 200 if job_info.get("status") == "COMPLETED" or job_info.get("already_running") else 202
        return jsonify({
            "success": True,
            **job_info
        }), status_code
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error starting performance graph for strategy '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/performance-graph/jobs/<job_id>", methods=["GET"])
def get_performance_graph_job_api(job_id):
    """Returns execution status for an async performance graph job."""
    job = get_performance_graph_job_status(job_id)
    if not job:
        return jsonify({"success": False, "error": "Graph job not found"}), 404
    return jsonify({"success": True, "job": job})


@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>", methods=["DELETE", "POST"])
@momentum_smallcases_bp.route("/api/momentum-smallcases/strategies/<strategy_id>/delete", methods=["POST", "DELETE"])
def delete_strategy_api(strategy_id):
    """Deletes a strategy."""
    try:
        user = session.get("username") or "admin"
        ok = delete_user_strategy(strategy_id, username=user)
        if not ok:
            return jsonify({"success": False, "error": "Strategy not found"}), 404
        return jsonify({"success": True, "message": "Strategy deleted successfully"})
    except Exception as e:
        logger.error(f"Error deleting strategy '{strategy_id}': {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/resolve-stocks", methods=["POST"])
def resolve_stocks_api():
    """Resolves company names or tickers in raw input into official NSE symbols."""
    try:
        body = request.get_json(silent=True) or {}
        stocks_str = body.get("stocks", "")
        from modules.momentum_smallcases.symbol_resolver import resolve_stocks_summary
        summary = resolve_stocks_summary(stocks_str)
        return jsonify(summary)
    except Exception as e:
        logger.error(f"Error resolving stocks: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/reset-data", methods=["POST"])
def reset_momentum_data_api():
    """Cleans all momentum smallcases data so user can start fresh from scratch."""
    try:
        user = session.get("username") or "admin"
        res = reset_all_momentum_data(username=user)
        return jsonify(res)
    except Exception as e:
        logger.error(f"Error resetting momentum data: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@momentum_smallcases_bp.route("/api/momentum-smallcases/compare-indices", methods=["POST"])
def compare_indices_api():
    """
    Simulates and compares multiple index universes in the same graph using only DB closing prices.
    Shared start_date and amount_to_invest, customizable per-index parameters.
    """
    try:
        user = session.get("username") or "admin"
        body = request.get_json(silent=True) or {}
        common_config = body.get("common") or {}
        index_configs = body.get("indices") or []

        from modules.momentum_smallcases.index_comparator import run_index_comparison_simulation
        res = run_index_comparison_simulation(common_config, index_configs, username=user)
        return jsonify(res)
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        logger.error(f"Error comparing indices: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Simulation failed: {str(e)}"}), 200



import os
from datetime import timedelta
import jinja2
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory

from modules.app_config import load_local_environment
load_local_environment()

# Core Data Paths & Utilities
from modules.common.data_paths import (
    BASE_DATA_DIR,
    DATA_FILE,
    PORTFOLIO_FILE,
    USERS_FILE,
    USERS_EXAMPLE_FILE,
    USER_DATA_DIR,
    LOGS_FILE
)
from modules.common.market_fetcher import (
    fetcher,
    StockFetcher,
    stock_cache,
    news_cache,
    fiidii_cache,
    POPULAR_INDIAN_STOCKS,
    POPULAR_MARKET_INDEXES,
    format_financial_symbol,
    resolve_watchlist_symbol
)
from modules.common.indicators import calculate_indicators
from modules.common.auth_utils import (
    login_required,
    admin_required,
    load_users,
    save_users,
    log_login_event,
    ensure_default_admin
)

# Feature Module Route Handlers
from modules.watchlist import watchlist_bp, load_data, save_data, find_watchlist_key, get_user_watchlist_file
from modules.portfolio import portfolio_bp, load_portfolios, save_portfolios, load_user_transactions, save_user_transactions, get_user_portfolio_file
from modules.alerts.alerts_routes import alerts_bp, load_user_alerts, save_user_alerts, get_user_alerts_file
from modules.market_data.market_data_routes import market_data_bp
from modules.news.news_routes import news_bp
from modules.insights import insights_bp
from modules.analytics import analytics_bp, init_analytics
from modules.auth_admin.auth_admin_routes import auth_admin_bp

# Standalone Blueprints
from modules.fundamentals import fundamentals_bp
from modules.fundamentals_concalls import fundamentals_concalls_bp
from modules.smallcases import smallcases_bp, init_smallcases, load_user_smallcases, save_user_smallcases
from modules.ipo_tracker import ipo_tracker_bp, init_ipo_tracker
from modules.mutual_funds import mutual_funds_bp, init_mutual_funds
from modules.plan_calculator import plan_calculator_bp, init_plan_calculator
from modules.official_feeds import official_feeds_bp, init_official_feeds
from modules.corporate_actions import corporate_actions_bp, init_corporate_actions
from modules.upcoming_events import upcoming_events_bp, init_upcoming_events
from modules.quarterly_results import quarterly_results_bp, init_quarterly_results
from modules.transactions import transactions_bp, init_transactions
from modules.sector_rotation import sector_rotation_bp, init_sector_rotation
from modules.broker_research import broker_research_bp, init_broker_research
from modules.industries_overview import industries_overview_bp, init_industries_overview
from modules.shareholding import shareholding_bp, init_shareholding

# Initialize Flask Application
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "capital_desk_secret_key_2026_x89a")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=1)
app.config["SESSION_REFRESH_EACH_REQUEST"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.permanent_session_lifetime = timedelta(days=1)

@app.before_request
def make_session_permanent():
    if "username" in session:
        session.permanent = True

@app.after_request
def add_auth_cache_control(response):
    if request.path in ["/login", "/register", "/logout"]:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

try:
    app.json.sort_keys = False
except AttributeError:
    app.config["JSON_SORT_KEYS"] = False

# Configure Jinja Template Loader (templates/, modules/, and project root)
app.jinja_loader = jinja2.ChoiceLoader([
    app.jinja_loader,
    jinja2.FileSystemLoader([
        os.path.join(os.path.dirname(__file__), "templates"),
        os.path.join(os.path.dirname(__file__), "modules"),
        os.path.join(os.path.dirname(__file__), "modules", "fundamentals"),
        os.path.dirname(__file__)
    ])
])

# Ensure default admin user and data structures exist
ensure_default_admin(init_user_fn=lambda u: (load_data(u), load_portfolios(u)))

# Initialize dependent standalone modules
init_smallcases(fetcher, login_required, BASE_DATA_DIR)
init_analytics(login_required)
init_ipo_tracker(login_required)
init_mutual_funds(login_required, BASE_DATA_DIR)
init_plan_calculator(login_required, BASE_DATA_DIR)
init_official_feeds(login_required, load_data, load_portfolios)
init_corporate_actions(login_required, load_data, BASE_DATA_DIR)
init_upcoming_events(login_required, load_data, BASE_DATA_DIR)
init_quarterly_results(login_required, load_data, BASE_DATA_DIR)
init_transactions(login_required, load_data, BASE_DATA_DIR)
init_sector_rotation(login_required, load_data, BASE_DATA_DIR)
init_broker_research(login_required, load_data)
init_industries_overview(login_required, load_data, BASE_DATA_DIR)
init_shareholding(login_required, load_data, BASE_DATA_DIR)

# Register Feature Blueprints
app.register_blueprint(auth_admin_bp)
app.register_blueprint(market_data_bp)
app.register_blueprint(watchlist_bp)
app.register_blueprint(portfolio_bp)
app.register_blueprint(analytics_bp)
app.register_blueprint(alerts_bp)
app.register_blueprint(news_bp)
app.register_blueprint(insights_bp)
app.register_blueprint(fundamentals_bp)
app.register_blueprint(fundamentals_concalls_bp)
app.register_blueprint(smallcases_bp)
app.register_blueprint(ipo_tracker_bp)
app.register_blueprint(mutual_funds_bp)
app.register_blueprint(plan_calculator_bp)
app.register_blueprint(official_feeds_bp)
app.register_blueprint(corporate_actions_bp)
app.register_blueprint(upcoming_events_bp)
app.register_blueprint(quarterly_results_bp)
app.register_blueprint(transactions_bp)
app.register_blueprint(sector_rotation_bp)
app.register_blueprint(broker_research_bp)
app.register_blueprint(industries_overview_bp)
app.register_blueprint(shareholding_bp)

# Static Asset Serving for Modules
@app.route("/modules/<path:filename>")
def serve_module_asset(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext in [".py", ".pyc", ".db", ".env", ".json"]:
        return "Access denied", 403
    mimetype = "application/javascript" if ext == ".js" else ("text/css" if ext == ".css" else None)
    return send_from_directory(os.path.join(app.root_path, "modules"), filename, mimetype=mimetype)

# App Shell SPA Entrypoints
@app.route("/", endpoint="index")
@app.route("/watchlists")
@login_required
def index():
    return render_template("index.html", initial_tab="watchlists")

@app.route("/portfolios")
@login_required
def portfolios_page():
    return render_template("index.html", initial_tab="portfolios")

@app.route("/analytics")
@login_required
def analytics_page():
    return render_template("index.html", initial_tab="dashboard")

@app.route("/insights")
@login_required
def insights_page():
    return render_template("index.html", initial_tab="insights")

@app.route("/smallcases")
@login_required
def smallcases_page():
    return render_template("index.html", initial_tab="smallcases")

@app.route("/quarterly-results")
@login_required
def quarterly_results_page():
    return render_template("index.html", initial_tab="quarterly-results")

@app.route("/transactions")
@login_required
def transactions_page():
    return render_template("index.html", initial_tab="transactions")

@app.route("/sector-rotation")
@login_required
def sector_rotation_page():
    return render_template("index.html", initial_tab="sector-rotation")

@app.route("/industries-overview")
@login_required
def industries_overview_page():
    return render_template("index.html", initial_tab="industries-overview")

@app.route("/login", endpoint="login_page")
def login_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("login.html")

@app.route("/register", endpoint="register_page")
def register_page():
    if "username" in session:
        return redirect(url_for("index"))
    return render_template("register.html")

@app.route("/logout")
def logout_redirect():
    session.clear()
    return redirect(url_for("login_page"))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)

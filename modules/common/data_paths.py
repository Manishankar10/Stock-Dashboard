import os

BASE_DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", ".")
if not os.path.exists(BASE_DATA_DIR):
    try:
        os.makedirs(BASE_DATA_DIR, exist_ok=True)
    except Exception:
        pass

# Centralized app_data folder for all data collection, caching, and storage
APP_DATA_DIR = os.path.join(BASE_DATA_DIR, "app_data")
if not os.path.exists(APP_DATA_DIR):
    try:
        os.makedirs(APP_DATA_DIR, exist_ok=True)
    except Exception:
        pass

# Point all data files directly to app_data
USER_DATA_DIR = APP_DATA_DIR
DATA_FILE = os.path.join(APP_DATA_DIR, "watchlists.json")
PORTFOLIO_FILE = os.path.join(APP_DATA_DIR, "portfolios.json")
USERS_FILE = os.path.join(APP_DATA_DIR, "users.json")
USERS_EXAMPLE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "users.example.json")
LOGS_FILE = os.path.join(APP_DATA_DIR, "login_logs.json")
SYSTEM_SETTINGS_FILE = os.path.join(APP_DATA_DIR, "system_settings.json")

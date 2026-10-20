import os

BASE_DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", ".")
if not os.path.exists(BASE_DATA_DIR):
    try:
        os.makedirs(BASE_DATA_DIR, exist_ok=True)
    except Exception:
        pass

# Centralized app_data folder for application datasets used to populate and calculate application data
APP_DATA_DIR = os.path.join(BASE_DATA_DIR, "app_data")
if not os.path.exists(APP_DATA_DIR):
    try:
        os.makedirs(APP_DATA_DIR, exist_ok=True)
    except Exception:
        pass

# User data directory (local fallback for user data moved to MongoDB)
USER_DATA_DIR = os.path.join(BASE_DATA_DIR, "user_data")
if not os.path.exists(USER_DATA_DIR):
    try:
        os.makedirs(USER_DATA_DIR, exist_ok=True)
    except Exception:
        pass

DATA_FILE = os.path.join(USER_DATA_DIR, "watchlists.json")
PORTFOLIO_FILE = os.path.join(USER_DATA_DIR, "portfolios.json")
USERS_FILE = os.path.join(USER_DATA_DIR, "users.json")
USERS_EXAMPLE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "users.example.json")
LOGS_FILE = os.path.join(USER_DATA_DIR, "login_logs.json")
SYSTEM_SETTINGS_FILE = os.path.join(APP_DATA_DIR, "system_settings.json")

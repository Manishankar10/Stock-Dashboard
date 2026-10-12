import os

BASE_DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", ".")
if not os.path.exists(BASE_DATA_DIR):
    try:
        os.makedirs(BASE_DATA_DIR)
    except Exception:
        pass

DATA_FILE = os.path.join(BASE_DATA_DIR, "watchlists.json")
PORTFOLIO_FILE = os.path.join(BASE_DATA_DIR, "portfolios.json")
USERS_FILE = os.path.join(BASE_DATA_DIR, "users.json")
USERS_EXAMPLE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "users.example.json")
USER_DATA_DIR = os.path.join(BASE_DATA_DIR, "user_data")
LOGS_FILE = os.path.join(BASE_DATA_DIR, "login_logs.json")

if not os.path.exists(USER_DATA_DIR):
    try:
        os.makedirs(USER_DATA_DIR)
    except Exception:
        pass

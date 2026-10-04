"""Central application environment configuration."""

import os
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent.parent
LOCAL_ENV_FILE = APP_ROOT / ".env"


def load_local_environment():
    """Load simple KEY=value entries from the ignored root .env file.

    Values already defined by the process environment take precedence. This
    avoids adding a runtime dependency solely for local environment loading.
    """
    try:
        lines = LOCAL_ENV_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def get_app_setting(name, default=""):
    return os.environ.get(name, default)


load_local_environment()

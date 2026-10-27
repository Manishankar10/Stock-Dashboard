import os
import json
from modules.common.data_paths import SYSTEM_SETTINGS_FILE
from db_store import load_system_settings_db, save_system_settings_db

DEFAULT_SYSTEM_SETTINGS = {
    "max_watchlists_per_user": 10,
    "max_stocks_per_watchlist": 50,
    "ai_prompts": {}
}

_SYSTEM_SETTINGS_CACHE = None

def get_system_settings():
    global _SYSTEM_SETTINGS_CACHE
    if _SYSTEM_SETTINGS_CACHE is not None:
        return dict(_SYSTEM_SETTINGS_CACHE)

    settings = load_system_settings_db(SYSTEM_SETTINGS_FILE, lambda: dict(DEFAULT_SYSTEM_SETTINGS))
    _SYSTEM_SETTINGS_CACHE = settings
    return dict(settings)

def update_system_settings(new_settings):
    global _SYSTEM_SETTINGS_CACHE
    current = get_system_settings()

    if "max_watchlists_per_user" in new_settings:
        try:
            val = int(new_settings["max_watchlists_per_user"])
            if val < 1:
                raise ValueError("Total number of watchlists per user must be a positive integer (minimum 1).")
            current["max_watchlists_per_user"] = val
        except (ValueError, TypeError) as e:
            raise ValueError("Total number of watchlists per user must be a positive integer (minimum 1).") from e

    if "max_stocks_per_watchlist" in new_settings:
        try:
            val = int(new_settings["max_stocks_per_watchlist"])
            if val < 1:
                raise ValueError("Total number of stocks per watchlist must be a positive integer (minimum 1).")
            current["max_stocks_per_watchlist"] = val
        except (ValueError, TypeError) as e:
            raise ValueError("Total number of stocks per watchlist must be a positive integer (minimum 1).") from e

    if "ai_prompts" in new_settings and isinstance(new_settings["ai_prompts"], dict):
        if "ai_prompts" not in current or not isinstance(current["ai_prompts"], dict):
            current["ai_prompts"] = {}
        for k, v in new_settings["ai_prompts"].items():
            if isinstance(v, str):
                current["ai_prompts"][k] = v.strip()

    save_system_settings_db(current, SYSTEM_SETTINGS_FILE)
    _SYSTEM_SETTINGS_CACHE = current
    return dict(current)

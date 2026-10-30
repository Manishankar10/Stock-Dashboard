import os
import json
import time
from modules.common.data_paths import SYSTEM_SETTINGS_FILE
from db_store import load_system_settings_db, save_system_settings_db

DEFAULT_SYSTEM_SETTINGS = {
    "max_watchlists_per_user": 10,
    "max_stocks_per_watchlist": 50,
    "ai_prompts": {},
    "fcm_vapid_public_key": "",
    "fcm_vapid_private_key": "",
    "fcm_project_id": "",
    "fcm_messaging_sender_id": "",
    "fcm_api_key": "",
    "fcm_app_id": ""
}

_SYSTEM_SETTINGS_CACHE = None
_SYSTEM_SETTINGS_CACHE_TIME = 0
_SYSTEM_SETTINGS_CACHE_TTL = 10  # 10s TTL for multi-process/multi-worker freshness


def get_system_settings(force_refresh=False):
    global _SYSTEM_SETTINGS_CACHE, _SYSTEM_SETTINGS_CACHE_TIME
    now = time.time()
    if not force_refresh and _SYSTEM_SETTINGS_CACHE is not None and (now - _SYSTEM_SETTINGS_CACHE_TIME) < _SYSTEM_SETTINGS_CACHE_TTL:
        return dict(_SYSTEM_SETTINGS_CACHE)

    settings = load_system_settings_db(SYSTEM_SETTINGS_FILE, lambda: dict(DEFAULT_SYSTEM_SETTINGS))
    _SYSTEM_SETTINGS_CACHE = settings
    _SYSTEM_SETTINGS_CACHE_TIME = now
    return dict(settings)


def invalidate_system_settings_cache():
    global _SYSTEM_SETTINGS_CACHE, _SYSTEM_SETTINGS_CACHE_TIME
    _SYSTEM_SETTINGS_CACHE = None
    _SYSTEM_SETTINGS_CACHE_TIME = 0


def update_system_settings(new_settings):
    global _SYSTEM_SETTINGS_CACHE, _SYSTEM_SETTINGS_CACHE_TIME
    current = get_system_settings(force_refresh=True)

    # Unwrap nested settings if passed
    if "settings" in new_settings and isinstance(new_settings["settings"], dict):
        new_settings = new_settings["settings"]

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

    if "fcm_vapid_public_key" in new_settings:
        current["fcm_vapid_public_key"] = str(new_settings["fcm_vapid_public_key"]).strip()
    if "fcm_vapid_private_key" in new_settings:
        current["fcm_vapid_private_key"] = str(new_settings["fcm_vapid_private_key"]).strip()
    if "fcm_project_id" in new_settings:
        current["fcm_project_id"] = str(new_settings["fcm_project_id"]).strip()
    if "fcm_messaging_sender_id" in new_settings:
        current["fcm_messaging_sender_id"] = str(new_settings["fcm_messaging_sender_id"]).strip()
    if "fcm_api_key" in new_settings:
        current["fcm_api_key"] = str(new_settings["fcm_api_key"]).strip()
    if "fcm_app_id" in new_settings:
        current["fcm_app_id"] = str(new_settings["fcm_app_id"]).strip()

    # Smart Auto-Correction: If VAPID Key and Web API Key were swapped
    v_val = current.get("fcm_vapid_public_key", "")
    a_val = current.get("fcm_api_key", "")
    if v_val.startswith("AIzaSy") and (a_val.startswith("B") or len(a_val) > 50):
        current["fcm_vapid_public_key"] = a_val
        current["fcm_api_key"] = v_val
    elif v_val.startswith("AIzaSy") and not a_val:
        current["fcm_api_key"] = v_val
        current["fcm_vapid_public_key"] = ""

    # Clean any accidental root keys like 'success' or nested 'settings'
    clean_settings = {
        "max_watchlists_per_user": current.get("max_watchlists_per_user", 10),
        "max_stocks_per_watchlist": current.get("max_stocks_per_watchlist", 50),
        "ai_prompts": current.get("ai_prompts", {}),
        "fcm_vapid_public_key": current.get("fcm_vapid_public_key", ""),
        "fcm_vapid_private_key": current.get("fcm_vapid_private_key", ""),
        "fcm_project_id": current.get("fcm_project_id", ""),
        "fcm_messaging_sender_id": current.get("fcm_messaging_sender_id", ""),
        "fcm_api_key": current.get("fcm_api_key", ""),
        "fcm_app_id": current.get("fcm_app_id", "")
    }

    save_system_settings_db(clean_settings, SYSTEM_SETTINGS_FILE)
    _SYSTEM_SETTINGS_CACHE = clean_settings
    _SYSTEM_SETTINGS_CACHE_TIME = time.time()
    return dict(clean_settings)

import os
import json
import logging
from datetime import datetime
from modules.common.ist_datetime import format_ist_standard, now_ist
from modules.common.data_paths import BASE_DATA_DIR, USER_DATA_DIR, APP_DATA_DIR

try:
    from db_store import db
except Exception:
    db = None

logger = logging.getLogger(__name__)

PUSH_SUBSCRIPTIONS_FILE = os.path.join(USER_DATA_DIR, "push_subscriptions.json")
NOTIFICATION_HISTORY_FILE = os.path.join(USER_DATA_DIR, "notification_history.json")
DEFAULT_SERVICE_ACCOUNT_FILE = os.path.join(APP_DATA_DIR, "firebase_service_account.json")

# Singleton state
_firebase_app = None
_fcm_initialized = False
_fcm_init_error = None


def get_fcm_config():
    """
    Returns current FCM configuration status, VAPID public key, and project ID.
    """
    vapid_key = os.environ.get("FIREBASE_VAPID_PUBLIC_KEY", "")
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "")

    # Check system_settings if not in env
    try:
        from modules.common.system_settings import get_system_settings
        settings = get_system_settings()
        if not vapid_key:
            vapid_key = settings.get("fcm_vapid_public_key", "")
        if not project_id:
            project_id = settings.get("fcm_project_id", "")
    except Exception:
        pass

    service_account_exists = (
        bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")) or
        os.path.exists(os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")) or
        os.path.exists(DEFAULT_SERVICE_ACCOUNT_FILE) or
        os.path.exists("firebase_service_account.json")
    )

    return {
        "is_configured": service_account_exists and _is_firebase_ready(),
        "service_account_detected": service_account_exists,
        "vapid_public_key": vapid_key,
        "project_id": project_id,
        "init_error": _fcm_init_error
    }


def _is_firebase_ready():
    global _firebase_app, _fcm_initialized, _fcm_init_error
    if _fcm_initialized and _firebase_app:
        return True

    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check existing apps
        if firebase_admin._apps:
            _firebase_app = firebase_admin.get_app()
            _fcm_initialized = True
            _fcm_init_error = None
            return True

        cred = None
        # 1. Environment variable raw JSON
        raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if raw_json:
            try:
                cert_dict = json.loads(raw_json)
                cred = credentials.Certificate(cert_dict)
            except Exception as e:
                _fcm_init_error = f"Invalid FIREBASE_SERVICE_ACCOUNT_JSON: {e}"

        # 2. Path in env
        if not cred:
            path_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
            if path_env and os.path.exists(path_env):
                cred = credentials.Certificate(path_env)

        # 3. Standard app_data file
        if not cred and os.path.exists(DEFAULT_SERVICE_ACCOUNT_FILE):
            cred = credentials.Certificate(DEFAULT_SERVICE_ACCOUNT_FILE)

        # 4. Root file
        if not cred and os.path.exists("firebase_service_account.json"):
            cred = credentials.Certificate("firebase_service_account.json")

        if cred:
            _firebase_app = firebase_admin.initialize_app(cred)
            _fcm_initialized = True
            _fcm_init_error = None
            return True
        else:
            _fcm_init_error = "Firebase Service Account credentials file not found."
            return False
    except Exception as e:
        _fcm_init_error = str(e)
        logger.error(f"FCM Initialization error: {e}")
        return False


def reload_fcm():
    """Forces re-initialization of Firebase Admin SDK (used after saving new credentials)."""
    global _firebase_app, _fcm_initialized, _fcm_init_error
    try:
        import firebase_admin
        if firebase_admin._apps:
            for app_name in list(firebase_admin._apps.keys()):
                firebase_admin.delete_app(firebase_admin._apps[app_name])
    except Exception as e:
        logger.warning(f"Error resetting firebase apps: {e}")
    _firebase_app = None
    _fcm_initialized = False
    _fcm_init_error = None
    return _is_firebase_ready()



# =====================================================================
# Database Subscriptions Management (MongoDB with JSON fallback)
# =====================================================================

def load_subscriptions():
    """Load all device subscriptions from MongoDB or JSON fallback."""
    if db is not None:
        try:
            col = db["push_subscriptions"]
            docs = list(col.find({}, {"_id": 0}))
            return {d["token"]: d for d in docs if "token" in d}
        except Exception as e:
            logger.error(f"MongoDB load_subscriptions error: {e}")

    if os.path.exists(PUSH_SUBSCRIPTIONS_FILE):
        try:
            with open(PUSH_SUBSCRIPTIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_subscriptions(subs):
    """Save subscriptions mapping to MongoDB and local JSON fallback."""
    # Local JSON
    try:
        os.makedirs(os.path.dirname(PUSH_SUBSCRIPTIONS_FILE), exist_ok=True)
        with open(PUSH_SUBSCRIPTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(subs, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save local subscriptions: {e}")

    # MongoDB
    if db is not None:
        try:
            col = db["push_subscriptions"]
            col.delete_many({})
            if subs:
                records = [dict(v, _id=k) for k, v in subs.items()]
                col.insert_many(records)
        except Exception as e:
            logger.error(f"MongoDB save_subscriptions error: {e}")


def register_device_token(token, username="guest", user_agent="", topics=None):
    """
    Registers or updates an FCM Web/PWA device token.
    """
    if not token or not isinstance(token, str):
        return False, "Invalid push token"

    if topics is None:
        topics = ["gold_silver_rates", "portfolio_performance"]

    subs = load_subscriptions()
    timestamp = format_ist_standard()

    if token in subs:
        subs[token]["last_active"] = timestamp
        subs[token]["username"] = username
        subs[token]["user_agent"] = user_agent or subs[token].get("user_agent", "")
        subs[token]["topics"] = list(set(subs[token].get("topics", []) + topics))
        subs[token]["is_active"] = True
    else:
        subs[token] = {
            "token": token,
            "username": username,
            "user_agent": user_agent,
            "topics": topics,
            "created_at": timestamp,
            "last_active": timestamp,
            "is_active": True
        }

    save_subscriptions(subs)
    return True, "Device subscribed successfully"


def unregister_device_token(token):
    """Marks a device token as deactivated or deletes it."""
    subs = load_subscriptions()
    if token in subs:
        del subs[token]
        save_subscriptions(subs)
        return True, "Device unsubscribed"
    return False, "Token not found"


def get_active_tokens(topic=None):
    """Returns active tokens list, optionally filtered by topic."""
    subs = load_subscriptions()
    tokens = []
    for t, data in subs.items():
        if not data.get("is_active", True):
            continue
        if topic:
            if topic in data.get("topics", []):
                tokens.append(t)
        else:
            tokens.append(t)
    return tokens


# =====================================================================
# Notification History & Audit Trail
# =====================================================================

def log_notification_event(event_type, title, body, status="Sent", recipient_count=0, metadata=None, error_msg=None):
    """
    Records an entry in the Notification Audit Trail.
    """
    entry = {
        "timestamp": format_ist_standard(),
        "type": event_type,
        "title": title,
        "body": body,
        "status": status,
        "recipient_count": recipient_count,
        "metadata": metadata or {},
        "error": error_msg
    }

    # MongoDB
    if db is not None:
        try:
            col = db["notification_history"]
            col.insert_one(dict(entry))
        except Exception as e:
            logger.error(f"MongoDB log_notification_event error: {e}")

    # Local JSON fallback (capped at 200 recent events)
    try:
        os.makedirs(os.path.dirname(NOTIFICATION_HISTORY_FILE), exist_ok=True)
        history = []
        if os.path.exists(NOTIFICATION_HISTORY_FILE):
            with open(NOTIFICATION_HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        history.insert(0, entry)
        history = history[:200]
        with open(NOTIFICATION_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        logger.error(f"Local notification history log error: {e}")

    return entry


def get_notification_history(limit=50):
    """Retrieves recent notification logs."""
    if db is not None:
        try:
            col = db["notification_history"]
            docs = list(col.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit))
            if docs:
                return docs
        except Exception as e:
            logger.error(f"MongoDB get_notification_history error: {e}")

    if os.path.exists(NOTIFICATION_HISTORY_FILE):
        try:
            with open(NOTIFICATION_HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data[:limit]
        except Exception:
            return []
    return []


# =====================================================================
# Push Dispatch Engine (FCM v1 / Web Push)
# =====================================================================

def send_web_push(title, body, image_url=None, data_payload=None, target_topic=None, specific_tokens=None, icon_url="/static/favicon-192.png"):
    """
    Sends a push notification to registered Web & PWA browsers.
    Supports real FCM sending if credentials are present, or simulated dispatch with full audit trail.
    """
    tokens = specific_tokens or get_active_tokens(topic=target_topic)
    recipient_count = len(tokens)

    payload_data = data_payload or {}
    if image_url:
        payload_data["image"] = image_url
    if "url" not in payload_data:
        payload_data["url"] = "/"

    ready = _is_firebase_ready()

    if not ready:
        # Graceful simulation mode: records audit trail and informs admin
        status = "Logged (Simulated - FCM credentials pending)"
        note = "Notification prepared and logged. Please configure your Firebase Service Account in Admin settings to dispatch live browser alerts."
        log_notification_event(
            event_type=target_topic or "broadcast",
            title=title,
            body=body,
            status=status,
            recipient_count=recipient_count,
            metadata={"image": image_url, "simulated": True},
            error_msg=_fcm_init_error
        )
        return {
            "success": True,
            "simulated": True,
            "message": note,
            "recipient_count": recipient_count,
            "status": status,
            "fcm_configured": False
        }

    # Live Firebase Admin Dispatch
    try:
        from firebase_admin import messaging

        if recipient_count == 0:
            log_notification_event(
                event_type=target_topic or "broadcast",
                title=title,
                body=body,
                status="No Active Subscribers",
                recipient_count=0,
                metadata={"image": image_url}
            )
            return {
                "success": True,
                "message": "No registered Web/PWA devices found. Enable notifications on your client device to test.",
                "recipient_count": 0,
                "status": "No Active Subscribers"
            }

        # Helper to resolve URLs to valid https:// required by WebpushFCMOptions
        def _resolve_https(url_str):
            if not url_str or not isinstance(url_str, str):
                return None
            url_str = url_str.strip()
            if url_str.startswith("https://"):
                return url_str
            if url_str.startswith("http://"):
                return "https://" + url_str[7:]
            try:
                from flask import has_request_context, request
                if has_request_context() and request and request.host:
                    path = url_str if url_str.startswith("/") else f"/{url_str}"
                    return f"https://{request.host}{path}"
            except Exception:
                pass
            return None

        # Build WebpushConfig with valid https:// link or None (never relative '/')
        raw_link = payload_data.get("url", "/")
        https_link = _resolve_https(raw_link)

        fcm_options = None
        if https_link and https_link.startswith("https://"):
            fcm_options = messaging.WebpushFCMOptions(link=https_link)

        full_icon = _resolve_https(icon_url) or icon_url
        full_badge = _resolve_https("/static/favicon-32.png") or "/static/favicon-32.png"
        full_image = _resolve_https(image_url) if image_url else None

        webpush_notification = messaging.WebpushNotification(
            title=title,
            body=body,
            icon=full_icon,
            badge=full_badge,
            image=full_image
        )
        webpush_config = messaging.WebpushConfig(
            notification=webpush_notification,
            fcm_options=fcm_options,
            data={str(k): str(v) for k, v in payload_data.items()}
        )

        # Batch Multicast Send (chunks of 500 max)
        chunk_size = 500
        success_count = 0
        failure_count = 0
        invalid_tokens = []

        for i in range(0, len(tokens), chunk_size):
            chunk = tokens[i:i + chunk_size]
            multicast = messaging.MulticastMessage(
                tokens=chunk,
                notification=messaging.Notification(title=title, body=body, image=full_image),
                webpush=webpush_config,
                data={str(k): str(v) for k, v in payload_data.items()}
            )
            batch_response = messaging.send_each_for_multicast(multicast)
            success_count += batch_response.success_count
            failure_count += batch_response.failure_count

            # Collect invalid tokens to prune
            for idx, resp in enumerate(batch_response.responses):
                if not resp.success:
                    err_code = resp.exception.code if hasattr(resp.exception, 'code') else str(resp.exception)
                    if "registration-token-not-registered" in str(err_code).lower() or "invalid-argument" in str(err_code).lower():
                        invalid_tokens.append(chunk[idx])

        # Prune dead tokens
        if invalid_tokens:
            subs = load_subscriptions()
            for inv_tok in invalid_tokens:
                subs.pop(inv_tok, None)
            save_subscriptions(subs)

        status = f"Delivered ({success_count} succeeded, {failure_count} failed)"
        log_notification_event(
            event_type=target_topic or "broadcast",
            title=title,
            body=body,
            status=status,
            recipient_count=success_count,
            metadata={"image": image_url, "failures": failure_count}
        )

        return {
            "success": True,
            "simulated": False,
            "message": f"Push notification dispatched to {success_count} device(s) successfully.",
            "recipient_count": success_count,
            "failed_count": failure_count,
            "status": status,
            "fcm_configured": True
        }

    except Exception as e:
        logger.error(f"FCM Multicast Dispatch error: {e}")
        status = f"Dispatch Error: {str(e)[:100]}"
        log_notification_event(
            event_type=target_topic or "broadcast",
            title=title,
            body=body,
            status="Failed",
            recipient_count=0,
            metadata={"image": image_url},
            error_msg=str(e)
        )
        return {
            "success": False,
            "message": f"Error dispatching notification: {e}",
            "recipient_count": 0,
            "status": "Failed",
            "fcm_configured": True
        }

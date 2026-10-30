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
    Returns current FCM configuration status, VAPID public key, project ID, and sender ID.
    """
    vapid_key = os.environ.get("FIREBASE_VAPID_PUBLIC_KEY", "")
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "")
    sender_id = os.environ.get("FIREBASE_MESSAGING_SENDER_ID", "")
    api_key = os.environ.get("FIREBASE_API_KEY", "")

    # Check system_settings if not in env
    try:
        from modules.common.system_settings import get_system_settings
        settings = get_system_settings()
        if not vapid_key:
            vapid_key = settings.get("fcm_vapid_public_key", "")
        if not project_id:
            project_id = settings.get("fcm_project_id", "")
        if not sender_id:
            sender_id = settings.get("fcm_messaging_sender_id", "")
        if not api_key:
            api_key = settings.get("fcm_api_key", "")
    except Exception:
        pass

    service_account_exists = (
        bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")) or
        os.path.exists(os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")) or
        os.path.exists(DEFAULT_SERVICE_ACCOUNT_FILE) or
        os.path.exists("firebase_service_account.json")
    )

    # Auto-extract project_id from service account file/env if not explicitly set
    if service_account_exists:
        try:
            sa_data = None
            if os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"):
                sa_data = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
            elif os.path.exists(DEFAULT_SERVICE_ACCOUNT_FILE):
                with open(DEFAULT_SERVICE_ACCOUNT_FILE, "r", encoding="utf-8") as f:
                    sa_data = json.load(f)
            elif os.path.exists("firebase_service_account.json"):
                with open("firebase_service_account.json", "r", encoding="utf-8") as f:
                    sa_data = json.load(f)
            if sa_data and isinstance(sa_data, dict):
                if not project_id:
                    project_id = sa_data.get("project_id", "")
        except Exception:
            pass

    return {
        "is_configured": service_account_exists and _is_firebase_ready(),
        "service_account_detected": service_account_exists,
        "vapid_public_key": vapid_key,
        "project_id": project_id,
        "messaging_sender_id": sender_id,
        "api_key": api_key,
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


def clean_fcm_token(token_str):
    """Extracts the clean FCM registration token if an endpoint URL was passed."""
    if not token_str or not isinstance(token_str, str):
        return ""
    token_str = token_str.strip()
    if "fcm.googleapis.com/fcm/send/" in token_str:
        return token_str.split("fcm.googleapis.com/fcm/send/")[-1]
    if "fcm.googleapis.com/wpush/v2/" in token_str:
        return token_str.split("fcm.googleapis.com/wpush/v2/")[-1]
    return token_str


def register_device_token(token, username=None, user_agent="", topics=None):
    """
    Registers or updates an FCM Web/PWA device key for a registered user.
    Supports storing more than one key/device per user (e.g. PC, Phone PWA, Laptop).
    Strictly rejects unregistered or guest users.
    """
    if not token or not isinstance(token, str) or str(token).startswith("browser-granted-"):
        return False, "Invalid push token. Device subscription was not established by browser."
        return False, "Invalid push token"

    # 1. Enforce that ONLY registered users can have device keys registered
    try:
        from modules.common.auth_utils import load_users
        registered_users = load_users()
    except Exception:
        registered_users = {}

    if not username or username == "guest" or username not in registered_users:
        logger.warning(f"[Push Security] Rejected subscription for non-registered user: '{username}'")
        return False, "Unregistered user. Only registered Capital Desk accounts can enable push notifications."

    if topics is None:
        topics = ["gold_silver_rates", "portfolio_performance"]

    subs = load_subscriptions()
    timestamp = format_ist_standard()
    clean_tok = clean_fcm_token(token)

    # Derive human-friendly device label from User-Agent
    device_label = "Browser Device"
    ua = (user_agent or "").lower()
    if "iphone" in ua or "ipad" in ua:
        device_label = "Apple iOS Device (PWA)"
    elif "android" in ua:
        device_label = "Android Device (PWA)"
    elif "windows" in ua:
        device_label = "Windows PC"
    elif "macintosh" in ua or "mac os" in ua:
        device_label = "Mac Desktop"
    elif "linux" in ua:
        device_label = "Linux Desktop"

    if "chrome" in ua and "edg" not in ua:
        device_label += " - Chrome"
    elif "edg" in ua:
        device_label += " - Edge"
    elif "firefox" in ua:
        device_label += " - Firefox"
    elif "safari" in ua and "chrome" not in ua:
        device_label += " - Safari"

    # Store key: Each unique device produces a unique token, so one user can store multiple keys
    subs[token] = {
        "token": token,
        "clean_token": clean_tok,
        "username": username,
        "user_agent": user_agent or subs.get(token, {}).get("user_agent", ""),
        "device_name": device_label,
        "topics": list(set(topics)),
        "created_at": subs.get(token, {}).get("created_at", timestamp),
        "last_active": timestamp,
        "is_active": True
    }

    save_subscriptions(subs)

    # Count active keys for this user
    user_keys_count = sum(1 for s in subs.values() if s.get("username") == username and s.get("is_active", True))
    logger.info(f"[Push] Registered key for '{username}' ({device_label}). Total active keys for user: {user_keys_count}")
    return True, f"Key registered successfully for '{username}'. Active keys: {user_keys_count}"


def unregister_device_token(token):
    """Marks a device token as deactivated or deletes it."""
    subs = load_subscriptions()
    if token in subs:
        del subs[token]
        save_subscriptions(subs)
        return True, "Device unsubscribed"
    return False, "Token not found"


def get_user_tokens(username, topic=None):
    """
    Returns ALL active registered device keys/tokens for a specific registered user.
    Enables sending targeted notifications across multiple devices of the same user.
    Returns empty list if user is unregistered.
    """
    if not username or username == "guest":
        return []

    try:
        from modules.common.auth_utils import load_users
        registered_users = load_users()
        if username not in registered_users:
            return []
    except Exception:
        pass

    subs = load_subscriptions()
    tokens = []
    for t, data in subs.items():
        if not data.get("is_active", True):
            continue
        if data.get("username") != username:
            continue
        if topic and topic not in data.get("topics", []):
            continue
        clean_tok = data.get("clean_token") or clean_fcm_token(t)
        if clean_tok:
            tokens.append(clean_tok)
    return list(dict.fromkeys(tokens))


def get_active_tokens(topic=None):
    """
    Returns active tokens list ONLY for verified registered users.
    STRICT: Unregistered users and guests are completely excluded from receiving notifications.
    """
    try:
        from modules.common.auth_utils import load_users
        registered_users = set(load_users().keys())
    except Exception:
        registered_users = set()

    subs = load_subscriptions()
    tokens = []
    for t, data in subs.items():
        if not data.get("is_active", True):
            continue
        sub_user = data.get("username", "")
        # NEVER send notifications to unregistered or guest users
        if not sub_user or sub_user == "guest" or sub_user not in registered_users:
            continue
        if topic and topic not in data.get("topics", []):
            continue
        clean_tok = data.get("clean_token") or clean_fcm_token(t)
        if clean_tok:
            tokens.append(clean_tok)
    return list(dict.fromkeys(tokens))


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

            # Collect failure details and invalid tokens to prune
            failure_details = []
            for idx, resp in enumerate(batch_response.responses):
                if not resp.success:
                    err = resp.exception
                    err_code = getattr(err, 'code', 'error')
                    err_str = str(err)
                    failure_details.append(f"{err_code}: {err_str}")
                    logger.warning(f"[FCM Send Failure] Token {chunk[idx][:25]}... failed: {err_code} - {err_str}")

                    err_lower = err_str.lower()
                    if "not-registered" in err_lower or "invalid" in err_lower or "not_found" in err_lower or "mismatch" in err_lower:
                        invalid_tokens.append(chunk[idx])

        # Prune dead/invalid tokens from subs
        if invalid_tokens:
            subs = load_subscriptions()
            pruned_count = 0
            for inv_tok in invalid_tokens:
                if inv_tok in subs:
                    subs.pop(inv_tok, None)
                    pruned_count += 1
                to_delete = [k for k, v in subs.items() if k == inv_tok or v.get("clean_token") == inv_tok or (len(inv_tok) > 10 and inv_tok in k)]
                for k in to_delete:
                    subs.pop(k, None)
                    pruned_count += 1
            if pruned_count > 0:
                save_subscriptions(subs)
                logger.info(f"[Push] Pruned {pruned_count} invalid push key(s) from database.")

        first_err = failure_details[0] if failure_details else "Device token rejected by Firebase"

        # STRICT: If 0 devices succeeded and there were failures, this is a FAILURE
        if success_count == 0 and failure_count > 0:
            status = f"Failed (All {failure_count} device(s) failed: {first_err[:80]})"
            log_notification_event(
                event_type=target_topic or "broadcast",
                title=title,
                body=body,
                status="Failed",
                recipient_count=0,
                metadata={"image": image_url, "failures": failure_count, "error": first_err},
                error_msg=first_err
            )
            return {
                "success": False,
                "simulated": False,
                "message": f"Dispatch failed: 0 succeeded, {failure_count} device(s) rejected ({first_err}).",
                "recipient_count": 0,
                "failed_count": failure_count,
                "status": "Failed",
                "fcm_configured": True,
                "error": first_err
            }

        # When at least 1 succeeded
        status = f"Delivered ({success_count} succeeded, {failure_count} failed)" if failure_count > 0 else f"Delivered ({success_count} succeeded)"
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
            "message": f"Push notification dispatched to {success_count} device(s) successfully." + (f" ({failure_count} failed)" if failure_count else ""),
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

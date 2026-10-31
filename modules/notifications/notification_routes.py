import os
from flask import Blueprint, request, jsonify, session, send_file, current_app
from modules.common.auth_utils import login_required, admin_required, load_users
from modules.common.ist_datetime import format_ist_standard, format_ist_display, today_ist_str
from modules.notifications.fcm_service import (
    get_fcm_config,
    register_device_token,
    unregister_device_token,
    is_token_registered,
    send_web_push,
    get_notification_history,
    load_subscriptions,
    get_user_tokens,
    get_active_tokens,
    reload_fcm,
    DEFAULT_SERVICE_ACCOUNT_FILE
)
from modules.notifications.card_generator import (
    generate_gold_silver_card,
    generate_portfolio_card,
    generate_watchlist_card,
    clean_stock_symbol
)
from modules.notifications.live_bullion import fetch_live_bullion_rates
from modules.notifications.user_portfolio_notifier import (
    calculate_user_portfolio_performance,
    get_all_users_portfolio_summaries,
    dispatch_unique_portfolio_notifications
)
from modules.notifications.user_watchlist_notifier import (
    get_user_watchlist_top_gainers,
    dispatch_unique_watchlist_notifications,
    send_watchlist_digest_to_user
)

notifications_bp = Blueprint("notifications", __name__)


# =====================================================================
# Client Registration & Config Routes
# =====================================================================

@notifications_bp.route("/api/notifications/config", methods=["GET"])
def api_notification_config():
    """Returns VAPID Public key and push configuration for the client."""
    config = get_fcm_config()
    subs = load_subscriptions()
    try:
        registered_users = set(load_users().keys())
    except Exception:
        registered_users = set()

    active_keys = [
        s for s in subs.values()
        if s.get("is_active", True) and (s.get("username") in registered_users if registered_users else (s.get("username") and s.get("username") != "guest"))
    ]
    unique_users = set(s.get("username") for s in active_keys if s.get("username"))

    return jsonify({
        "success": True,
        "is_configured": config["is_configured"],
        "vapid_public_key": config["vapid_public_key"],
        "project_id": config["project_id"],
        "total_subscribers": len(unique_users),
        "active_subscribers": len(active_keys),
        "unique_subscribers": len(unique_users),
        "total_devices": len(active_keys),
        "total_active_keys": len(active_keys)
    })


@notifications_bp.route("/api/notifications/check-subscription", methods=["POST"])
def api_check_subscription():
    """Checks whether the client's current device token/endpoint is registered in the database."""
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or data.get("endpoint") or "").strip()
    username = session.get("username")

    if not token or not username or username == "guest":
        return jsonify({"registered": False})

    is_reg = is_token_registered(token, username=username)
    return jsonify({"registered": is_reg, "username": username})


@notifications_bp.route("/api/notifications/subscribe", methods=["POST"])
def api_subscribe_device():
    """Registers an FCM device key for an authenticated registered user. Allows multiple keys per user."""
    data = request.get_json(silent=True) or {}
    token = data.get("token", "").strip()
    if not token:
        return jsonify({"success": False, "error": "Token is required"}), 400

    username = session.get("username")
    if not username or username == "guest":
        return jsonify({
            "success": False,
            "error": "Authentication required. Please log in with a registered Capital Desk account to enable push notifications."
        }), 401

    try:
        registered_users = load_users()
    except Exception:
        registered_users = {}

    if username not in registered_users:
        return jsonify({
            "success": False,
            "error": f"User '{username}' is not a registered user."
        }), 403

    user_agent = request.headers.get("User-Agent", "")
    topics = data.get("topics", ["gold_silver_rates", "portfolio_performance"])
    subscription_obj = data.get("subscription")
    is_pwa = bool(data.get("is_pwa", False))

    success, msg = register_device_token(
        token=token,
        username=username,
        user_agent=user_agent,
        topics=topics,
        subscription=subscription_obj,
        is_pwa=is_pwa
    )
    if not success:
        return jsonify({"success": False, "error": msg}), 400

    user_keys = get_user_tokens(username)
    return jsonify({
        "success": True,
        "message": msg,
        "username": username,
        "registered_keys_count": len(user_keys)
    })


@notifications_bp.route("/api/notifications/unsubscribe", methods=["POST"])
def api_unsubscribe_device():
    """De-registers an FCM token."""
    data = request.get_json(silent=True) or {}
    token = data.get("token", "").strip()
    if not token:
        return jsonify({"success": False, "error": "Token is required"}), 400

    success, msg = unregister_device_token(token)
    return jsonify({"success": success, "message": msg})


# =====================================================================
# Dynamic Live Bullion Rates Route
# =====================================================================

@notifications_bp.route("/api/notifications/live-bullion", methods=["GET"])
def api_live_bullion():
    """Fetches real-time dynamic market rates for Gold 22K (916) and Ready Silver."""
    force_refresh = request.args.get("refresh", "0") == "1"
    rates = fetch_live_bullion_rates(force_refresh=force_refresh)
    return jsonify({
        "success": True,
        "rates": rates
    })


# =====================================================================
# Visual Image Card Rendering Endpoints
# =====================================================================

@notifications_bp.route("/api/notifications/render-gold-card.png", methods=["GET"])
def render_gold_card_endpoint():
    """Renders the custom Gold & Silver card image dynamically."""
    gold_1g = request.args.get("gold_1g", "13,195")
    gold_8g = request.args.get("gold_8g", "1,05,560")
    silver_1g = request.args.get("silver_1g", "215.00")
    silver_8g = request.args.get("silver_8g", "1,720")

    buf = generate_gold_silver_card(
        gold_1g=gold_1g,
        gold_8g=gold_8g,
        silver_1g=silver_1g,
        silver_8g=silver_8g
    )
    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=False,
        download_name="gold_silver_rates.png"
    )


@notifications_bp.route("/api/notifications/render-portfolio-card.png", methods=["GET"])
def render_portfolio_card_endpoint():
    """Renders the custom Portfolio Performance card image dynamically."""
    perf = request.args.get("perf", "+0.50%")
    tg_sym = clean_stock_symbol(request.args.get("top_gainer", "POCL"))
    tg_chg = request.args.get("top_gainer_pct", "+4.56%")
    tl_sym = clean_stock_symbol(request.args.get("top_loser", "Polymedicure"))
    tl_chg = request.args.get("top_loser_pct", "-0.65%")
    uname = request.args.get("username", "")
    p_name = f"{uname.capitalize()}'s Portfolio" if uname else "Portfolio Digest"

    buf = generate_portfolio_card(
        performance=perf,
        top_gainer_symbol=tg_sym,
        top_gainer_change=tg_chg,
        top_loser_symbol=tl_sym,
        top_loser_change=tl_chg,
        portfolio_name=p_name,
        date_str=today_ist_str()
    )
    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=False,
        download_name="portfolio_performance.png"
    )


@notifications_bp.route("/api/notifications/render-watchlist-card.png", methods=["GET"])
def render_watchlist_card_endpoint():
    """Renders the custom Watchlist Top Gainers card image dynamically."""
    uname = request.args.get("username", "") or session.get("username", "sampath")
    try:
        limit = int(request.args.get("limit", 5) or 5)
    except Exception:
        limit = 5
    gainers = get_user_watchlist_top_gainers(uname, limit=limit)

    buf = generate_watchlist_card(
        stocks=gainers,
        username=uname,
        date_str=today_ist_str(),
        limit=limit
    )
    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=False,
        download_name="watchlist_top_gainers.png"
    )


# =====================================================================
# Admin Dispatch Endpoints
# =====================================================================

@notifications_bp.route("/api/admin/notifications/stats", methods=["GET"])
@admin_required
def admin_notification_stats():
    """Returns detailed notification statistics, subscriptions, and audit trail for Admin Panel."""
    subs = load_subscriptions()
    history = get_notification_history(limit=500)
    config = get_fcm_config()

    try:
        from modules.common.auth_utils import load_users
        registered_users = set(load_users().keys())
    except Exception:
        registered_users = set()

    active_device_list = [
        s for s in subs.values()
        if s.get("is_active", True) and (s.get("username") in registered_users if registered_users else (s.get("username") and s.get("username") != "guest"))
    ]
    unique_users = set(s.get("username") for s in active_device_list if s.get("username"))

    total_subscribers = len(unique_users)          # Unique users count
    active_subscribers = len(active_device_list)   # Total devices enrolled count

    for h in history:
        if not h.get("timestamp_display") and h.get("timestamp"):
            try:
                h["timestamp_display"] = format_ist_display(h["timestamp"], with_tz=True)
            except Exception:
                h["timestamp_display"] = h.get("timestamp")

    return jsonify({
        "success": True,
        "config": config,
        "total_subscribers": total_subscribers,
        "active_subscribers": active_subscribers,
        "unique_subscribers": total_subscribers,
        "total_devices": active_subscribers,
        "subscribers_list": list(subs.values())[:30],
        "history": history
    })


@notifications_bp.route("/api/admin/notifications/send-gold", methods=["POST"])
@admin_required
def admin_send_gold_notification():
    """
    Dispatches Gold & Silver Rates Notification to all Web & PWA subscribers (or a specific user).
    Can dynamically fetch real-time bullion rates if not manually specified.
    """
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    target_user = (data.get("username") or data.get("target_username") or "").strip()

    specific_tokens = None
    if target_user and target_user.lower() != "all":
        specific_tokens = get_user_tokens(target_user)
        if not specific_tokens:
            return jsonify({
                "success": False,
                "message": f"User '{target_user}' has 0 active registered devices in database. Please ask '{target_user}' to log in on their browser/phone and click 'Enable Notifications' first.",
                "recipient_count": 0,
                "target_username": target_user
            })
    else:
        active_tokens = get_active_tokens(topic="gold_silver_rates")
        if not active_tokens:
            return jsonify({
                "success": False,
                "message": "0 active subscribers found for Gold & Silver rates. No card calculated or logged.",
                "recipient_count": 0,
                "target_username": "all"
            })
        specific_tokens = active_tokens

    # If use_live requested or values not provided, dynamically fetch from market
    if data.get("use_live") or not data.get("gold_1g"):
        live = fetch_live_bullion_rates(force_refresh=True)
        gold_1g = live["gold_1g"]
        gold_8g = live["gold_8g"]
        silver_1g = live["silver_1g"]
        silver_8g = live["silver_8g"]
    else:
        gold_1g = data.get("gold_1g", "13,040").replace("₹", "").strip()
        gold_8g = data.get("gold_8g", "104,320").replace("₹", "").strip()
        silver_1g = data.get("silver_1g", "210.00").replace("₹", "").strip()
        silver_8g = data.get("silver_8g", "1,680").replace("₹", "").strip()

    # Pre-render physical PNG for push image banner
    gen_dir = os.path.join(current_app.root_path, "static", "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)
    card_path = os.path.join(gen_dir, "gold_rates_latest.png")
    generate_gold_silver_card(
        gold_1g=gold_1g,
        gold_8g=gold_8g,
        silver_1g=silver_1g,
        silver_8g=silver_8g,
        output_path=card_path
    )

    base_url = request.url_root.rstrip("/")
    image_url = f"{base_url}/static/notifications/generated/gold_rates_latest.png"

    # Notification text (Optimized for mobile & desktop)
    title = "👑 Gold (22K) & Silver Rates"
    body = f"🟡 Gold: ₹{gold_1g}/g (8g: ₹{gold_8g}) • ⚪ Silver: ₹{silver_1g}/g"

    result = send_web_push(
        title=title,
        body=body,
        image_url=image_url,
        data_payload={
            "url": "/watchlists",
            "type": "gold_silver_rates",
            "gold_1g": gold_1g,
            "gold_8g": gold_8g,
            "silver_1g": silver_1g,
            "silver_8g": silver_8g,
            "target_user": target_user or "all"
        },
        target_topic="gold_silver_rates" if not specific_tokens else None,
        specific_tokens=specific_tokens
    )

    result["gold_1g"] = gold_1g
    result["gold_8g"] = gold_8g
    result["silver_1g"] = silver_1g
    result["silver_8g"] = silver_8g
    result["target_username"] = target_user or "all"
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/send-sample-user", methods=["POST"])
@admin_required
def admin_send_sample_user():
    """Directly dispatches a sample gold or portfolio notification to a specific user (e.g. sampath)."""
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    username = (data.get("username") or "sampath").strip()
    notif_type = data.get("type", "gold").strip().lower()

    if not username:
        return jsonify({"success": False, "message": "Username is required."}), 400

    tokens = get_user_tokens(username)
    if not tokens:
        return jsonify({
            "success": False,
            "message": f"User '{username}' has 0 active registered devices. Enable notifications on the user device first.",
            "recipient_count": 0,
            "username": username
        })

    if notif_type == "gold":
        live = fetch_live_bullion_rates(force_refresh=True)
        gold_1g = live["gold_1g"]
        gold_8g = live["gold_8g"]
        silver_1g = live["silver_1g"]
        silver_8g = live["silver_8g"]

        gen_dir = os.path.join(current_app.root_path, "static", "notifications", "generated")
        os.makedirs(gen_dir, exist_ok=True)
        card_path = os.path.join(gen_dir, "gold_rates_latest.png")
        generate_gold_silver_card(
            gold_1g=gold_1g,
            gold_8g=gold_8g,
            silver_1g=silver_1g,
            silver_8g=silver_8g,
            output_path=card_path
        )
        base_url = request.url_root.rstrip("/")
        image_url = f"{base_url}/static/notifications/generated/gold_rates_latest.png"

        title = "👑 Gold (22K) & Silver Rates"
        body = f"🟡 Gold: ₹{gold_1g}/g (8g: ₹{gold_8g}) • ⚪ Silver: ₹{silver_1g}/g"

        res = send_web_push(
            title=title,
            body=body,
            image_url=image_url,
            data_payload={
                "url": "/watchlists",
                "type": "gold_silver_rates",
                "target_user": username
            },
            specific_tokens=tokens
        )
        res["username"] = username
        return jsonify(res)
    else:
        from modules.notifications.user_portfolio_notifier import send_portfolio_digest_to_user
        res = send_portfolio_digest_to_user(username)
        return jsonify(res)


@notifications_bp.route("/api/admin/notifications/send-welcome", methods=["POST"])
@admin_required
def admin_send_welcome():
    """
    Sends a welcoming greeting notification:
    'Welcome to Capital Desk!! Best wishes message only'
    Can be targeted to 'all' or to a specific user (e.g. 'sampath').
    """
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    target_user = (data.get("username") or data.get("target_username") or "").strip()

    title = "🎉 Welcome to Capital Desk!"
    if target_user and target_user.lower() != "all":
        body = f"Welcome to Capital Desk, {target_user.capitalize()}!! Best wishes on your financial journey. 🚀"
        specific_tokens = get_user_tokens(target_user)
        if not specific_tokens:
            return jsonify({
                "success": False,
                "message": f"User '{target_user}' has 0 active registered devices. Enable notifications on the user device first.",
                "recipient_count": 0,
                "target_username": target_user
            })
    else:
        body = "Welcome to Capital Desk!! Best wishes on your financial journey. 🚀"
        active_tokens = get_active_tokens()
        if not active_tokens:
            return jsonify({
                "success": False,
                "message": "0 active registered devices found. Enable notifications on a client device first.",
                "recipient_count": 0,
                "target_username": "all"
            })
        specific_tokens = active_tokens

    result = send_web_push(
        title=title,
        body=body,
        data_payload={
            "url": "/",
            "type": "welcome",
            "target_user": target_user or "all"
        },
        specific_tokens=specific_tokens
    )
    result["target_username"] = target_user or "all"
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/generate-vapid-keys", methods=["POST"])
@admin_required
def admin_generate_vapid_keys():
    """Generates a fresh, mathematically matched EC P-256 VAPID keypair."""
    try:
        from py_vapid import Vapid
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from modules.notifications.fcm_service import VAPID_KEYS_FILE
        import base64
        import json

        v = Vapid()
        v.generate_keys()
        raw_pub = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        pub_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b'=').decode('ascii')
        raw_priv = v.private_key.private_numbers().private_value.to_bytes(32, 'big')
        priv_b64 = base64.urlsafe_b64encode(raw_priv).rstrip(b'=').decode('ascii')

        os.makedirs(os.path.dirname(VAPID_KEYS_FILE), exist_ok=True)
        with open(VAPID_KEYS_FILE, "w", encoding="utf-8") as f:
            json.dump({"public_key": pub_b64, "private_key": priv_b64}, f, indent=2)

        from modules.common.system_settings import get_system_settings, update_system_settings
        settings = get_system_settings()
        settings["fcm_vapid_public_key"] = pub_b64
        settings["fcm_vapid_private_key"] = priv_b64
        update_system_settings(settings)

        return jsonify({
            "success": True,
            "public_key": pub_b64,
            "private_key": priv_b64,
            "message": "Generated new 100% matched VAPID keypair successfully! Browser subscriptions will use this keypair."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@notifications_bp.route("/api/admin/notifications/users-portfolio-overview", methods=["GET"])
@admin_required
def admin_users_portfolio_overview():
    """
    Computes and returns today's real performance summary for every user
    based on their current stock holdings in the database, plus sample watchlist gainers.
    """
    summaries = get_all_users_portfolio_summaries()
    sample_watchlist = []
    try:
        sample_watchlist = get_user_watchlist_top_gainers("sampath", limit=5)
        if not sample_watchlist and summaries:
            sample_watchlist = get_user_watchlist_top_gainers(summaries[0]["username"], limit=5)
    except Exception:
        sample_watchlist = []

    return jsonify({
        "success": True,
        "users": summaries,
        "sample_watchlist": sample_watchlist
    })


@notifications_bp.route("/api/admin/notifications/send-watchlist-all-users", methods=["POST"])
@admin_required
def admin_send_watchlist_all_users():
    """
    DISPATCHES PERSONALIZED TOP N WATCHLIST GAINERS NOTIFICATIONS TO EVERY USER:
    1. Reads each user's watchlist from DB.
    2. Fetches live market quotes.
    3. Strictly filters out negative stocks and sorts descending by change %.
    4. Generates a glassy image card in the requested format.
    5. Dispatches FCM push targeted to each user's active devices.
    """
    base_url = request.url_root.rstrip("/")
    static_root = os.path.join(current_app.root_path, "static")
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    try:
        limit = int(data.get("limit", 5) or 5)
    except Exception:
        limit = 5

    result = dispatch_unique_watchlist_notifications(base_url=base_url, static_root=static_root, limit=limit)
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/send-watchlist-sample-user", methods=["POST"])
@admin_required
def admin_send_watchlist_sample_user():
    """Dispatches personalized Top N Watchlist Gainers specifically to a sample user (e.g. Sampath)."""
    data = request.get_json(silent=True) or request.form.to_dict() or {}
    username = data.get("username", "sampath").strip()
    try:
        limit = int(data.get("limit", 5) or 5)
    except Exception:
        limit = 5
    base_url = request.url_root.rstrip("/")

    result = send_watchlist_digest_to_user(username=username, base_url=base_url, limit=limit)
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/send-portfolio-all-users", methods=["POST"])
@admin_required
def admin_send_portfolio_all_users():
    """
    DISPATCHES PERSONALIZED EOD NOTIFICATIONS TO EVERY USER:
    1. Reads each user's unique portfolio from the DB.
    2. Fetches live market quotes for their stocks.
    3. Calculates their net daily return %, top gainer, and top loser.
    4. Generates a personalized PNG card banner for each user.
    5. Dispatches FCM push targeted to each user's registered devices.
    """
    base_url = request.url_root.rstrip("/")
    static_root = os.path.join(current_app.root_path, "static")

    result = dispatch_unique_portfolio_notifications(base_url=base_url, static_root=static_root)
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/send-portfolio", methods=["POST"])
@admin_required
def admin_send_portfolio_notification():
    """Dispatches EOD Portfolio Performance Notification (Custom/Broadcast)."""
    data = request.get_json(silent=True) or request.form.to_dict() or {}

    perf = data.get("perf", "+0.50%").strip()
    top_gainer = clean_stock_symbol(data.get("top_gainer", "POCL"))
    top_gainer_pct = data.get("top_gainer_pct", "+4.56%").strip()
    top_loser = clean_stock_symbol(data.get("top_loser", "Polymedicure"))
    top_loser_pct = data.get("top_loser_pct", "-0.65%").strip()

    if not perf.startswith("+") and not perf.startswith("-"):
        perf = f"+{perf}"
    if not top_gainer_pct.startswith("+"):
        top_gainer_pct = f"+{top_gainer_pct}"
    if not top_loser_pct.startswith("-"):
        top_loser_pct = f"-{top_loser_pct}"

    gen_dir = os.path.join(current_app.root_path, "static", "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)
    card_path = os.path.join(gen_dir, "portfolio_latest.png")
    generate_portfolio_card(
        performance=perf,
        top_gainer_symbol=top_gainer,
        top_gainer_change=top_gainer_pct,
        top_loser_symbol=top_loser,
        top_loser_change=top_loser_pct,
        date_str=today_ist_str(),
        output_path=card_path
    )

    base_url = request.url_root.rstrip("/")
    image_url = f"{base_url}/static/notifications/generated/portfolio_latest.png"

    g_display = "-" if top_gainer in ("-", "N/A") or top_gainer_pct in ("-", "N/A") else f"{top_gainer} ({top_gainer_pct})"
    l_display = "-" if top_loser in ("-", "N/A") or top_loser_pct in ("-", "N/A") else f"{top_loser} ({top_loser_pct})"
    title = f"📈 Today's Portfolio: {perf}"
    body = f"🚀 Gainer: {g_display} • 🔻 Loser: {l_display}"

    result = send_web_push(
        title=title,
        body=body,
        image_url=image_url,
        data_payload={
            "url": "/portfolios",
            "type": "portfolio_performance",
            "performance": perf,
            "top_gainer": top_gainer,
            "top_loser": top_loser
        },
        target_topic="portfolio_performance"
    )

    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/send-test", methods=["POST"])
@admin_required
def admin_send_test_notification():
    """Sends a quick test push notification."""
    base_url = request.url_root.rstrip("/")
    result = send_web_push(
        title="🔔 Capital Desk Test Alert",
        body="This is a test notification confirming your Web & PWA push connection is operational!",
        image_url=f"{base_url}/static/screenshots/desktop-dashboard.png",
        data_payload={"url": "/"},
        target_topic=None
    )
    return jsonify(result)


@notifications_bp.route("/api/admin/notifications/save-config", methods=["POST"])
@admin_required
def admin_save_fcm_config():
    """Allows admin to save VAPID public key, project ID, and service account JSON."""
    data = request.get_json(silent=True) or {}
    vapid_key = data.get("vapid_public_key", "").strip()
    vapid_priv_key = data.get("vapid_private_key", "").strip()
    project_id = data.get("project_id", "").strip()
    sender_id = data.get("messaging_sender_id", data.get("sender_id", "")).strip()
    api_key = data.get("api_key", "").strip()
    service_account_json = data.get("service_account_json", "").strip()

    # Smart Auto-Correction: If user swapped VAPID Public Key and Web API Key
    swapped = False
    if vapid_key.startswith("AIzaSy") and (api_key.startswith("B") or len(api_key) > 50):
        vapid_key, api_key = api_key, vapid_key
        swapped = True
    elif vapid_key.startswith("AIzaSy") and not api_key:
        api_key = vapid_key
        vapid_key = ""
        swapped = True

    from modules.common.system_settings import get_system_settings, update_system_settings
    settings = get_system_settings()

    if vapid_key:
        settings["fcm_vapid_public_key"] = vapid_key
    if vapid_priv_key:
        settings["fcm_vapid_private_key"] = vapid_priv_key
    if project_id:
        settings["fcm_project_id"] = project_id
    if sender_id:
        settings["fcm_messaging_sender_id"] = sender_id
    if api_key:
        settings["fcm_api_key"] = api_key

    if service_account_json:
        try:
            import json
            parsed = json.loads(service_account_json)
            os.makedirs(os.path.dirname(DEFAULT_SERVICE_ACCOUNT_FILE), exist_ok=True)
            with open(DEFAULT_SERVICE_ACCOUNT_FILE, "w", encoding="utf-8") as f:
                json.dump(parsed, f, indent=2)
            with open("firebase_service_account.json", "w", encoding="utf-8") as f:
                json.dump(parsed, f, indent=2)

            if "project_id" in parsed and not project_id:
                project_id = parsed["project_id"]
                settings["fcm_project_id"] = project_id
        except Exception as e:
            return jsonify({"success": False, "error": f"Invalid JSON format for Service Account: {e}"}), 400

    update_system_settings(settings)

    # Force re-initialize Firebase Admin
    from modules.notifications.fcm_service import reload_fcm
    is_ready = reload_fcm()
    cfg = get_fcm_config()

    if is_ready:
        msg = f"Firebase successfully connected to project '{project_id or cfg.get('project_id')}'! Web Push is now live."
    else:
        if service_account_json or os.path.exists(DEFAULT_SERVICE_ACCOUNT_FILE):
            msg = f"Settings saved, but Firebase reported: {cfg.get('init_error')}"
        else:
            msg = "VAPID key and Project ID saved! (Service Account JSON pending for live dispatch)"

    return jsonify({
        "success": True,
        "message": msg,
        "is_configured": is_ready,
        "config": cfg
    })

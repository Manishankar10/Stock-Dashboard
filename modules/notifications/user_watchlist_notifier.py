import os
import logging
from modules.common.auth_utils import load_users
from modules.watchlist.watchlist_routes import load_data as load_user_watchlists
from modules.common.market_fetcher import format_financial_symbol, fetcher
from modules.notifications.card_generator import generate_watchlist_card, clean_stock_symbol
from modules.notifications.fcm_service import (
    load_subscriptions,
    send_web_push,
    log_notification_event,
    get_user_tokens
)
from modules.common.ist_datetime import format_ist_standard, today_ist_str

logger = logging.getLogger(__name__)


def get_user_watchlist_top_gainers(username, limit=5):
    """
    Retrieves all unique stocks from user's watchlists in the database,
    fetches live market quotes, filters out non-positive stocks (change_pct <= 0),
    and returns top positive gainers sorted descending by percentage gain.
    """
    wl_data = load_user_watchlists(username)
    symbols = []

    if isinstance(wl_data, dict):
        for wl_name, s_list in wl_data.items():
            if isinstance(s_list, list):
                for s in s_list:
                    if isinstance(s, str) and s.strip():
                        symbols.append(s.strip())
                    elif isinstance(s, dict) and s.get("symbol"):
                        symbols.append(str(s["symbol"]).strip())
    elif isinstance(wl_data, list):
        for s in wl_data:
            if isinstance(s, str) and s.strip():
                symbols.append(s.strip())
            elif isinstance(s, dict) and s.get("symbol"):
                symbols.append(str(s["symbol"]).strip())

    # Fallback to popular market leaders if user has empty watchlist
    if not symbols:
        symbols = ["POCL.NS", "INDHOTEL.NS", "TCS.NS", "INFY.NS", "RELIANCE.NS"]

    unique_symbols = list(dict.fromkeys(symbols))
    stock_stats = []

    for sym in unique_symbols:
        try:
            formatted_sym = format_financial_symbol(sym)
            q = fetcher.fetch_stock(formatted_sym)
            curr_p = float(q.get("price") or 0.0)
            chg_abs = float(q.get("change") or 0.0)
            chg_pct = float(q.get("change_pct") or 0.0)
        except Exception as e:
            logger.warning(f"Failed to fetch market quote for watchlist symbol {sym}: {e}")
            continue

        # Strictly positive stocks only: "dont show negatie stocks"
        if chg_pct <= 0.0:
            continue

        upper_s = sym.upper()
        if upper_s.endswith(".BO") or upper_s.endswith(".BSE"):
            exchange = "BSE"
        else:
            exchange = "NSE"

        clean_sym = clean_stock_symbol(sym)

        stock_stats.append({
            "symbol": clean_sym,
            "raw_symbol": sym,
            "exchange": exchange,
            "ltp": f"₹{curr_p:,.2f}",
            "ltp_float": curr_p,
            "change_val": f"+₹{chg_abs:,.2f}" if chg_abs >= 0 else f"-₹{abs(chg_abs):,.2f}",
            "change_pct": f"+{chg_pct:.2f}%",
            "change_pct_float": chg_pct
        })

    # Sort descending by change percentage
    stock_stats.sort(key=lambda x: x["change_pct_float"], reverse=True)
    return stock_stats[:limit]


def dispatch_unique_watchlist_notifications(base_url="", static_root=None, limit=5):
    """
    Dispatches personalized Top N Watchlist Gainers notifications to all verified users with active devices.
    """
    try:
        limit = int(limit or 5)
    except Exception:
        limit = 5
    from modules.common.data_paths import BASE_DATA_DIR
    if static_root is None:
        static_root = os.path.join(BASE_DATA_DIR, "static")

    users = load_users()
    subs = load_subscriptions()

    # Filter active tokens for verified registered users
    user_tokens = {}
    for token, s in subs.items():
        if not s.get("is_active", True):
            continue
        u = s.get("username")
        if not u or u == "guest" or u not in users:
            continue
        if u not in user_tokens:
            user_tokens[u] = []
        user_tokens[u].append(token)

    results = []
    total_dispatched = 0

    gen_dir = os.path.join(static_root, "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)

    for uname in users.keys():
        tokens = user_tokens.get(uname, [])
        # Strictly ignore users with no registered devices
        if not tokens:
            continue

        gainers = get_user_watchlist_top_gainers(uname, limit=limit)

        card_filename = f"watchlist_{uname}.png"
        card_disk_path = os.path.join(gen_dir, card_filename)

        generate_watchlist_card(
            stocks=gainers,
            username=uname,
            date_str=today_ist_str(),
            output_path=card_disk_path,
            limit=limit
        )

        image_url = f"{base_url.rstrip('/')}/static/notifications/generated/{card_filename}" if base_url else f"/static/notifications/generated/{card_filename}"

        if gainers:
            gainers_str = " • ".join(f"{s['symbol']} ({s['change_pct']})" for s in gainers[:3])
            title = f"⭐ Watchlist: Top {limit} Gainers"
            body = f"🟢 {gainers_str}"
        else:
            title = "⭐ Watchlist Momentum"
            body = "No positive stock gainers in your watchlist today."

        push_res = send_web_push(
            title=title,
            body=body,
            image_url=image_url,
            data_payload={
                "url": "/watchlists",
                "type": "watchlist_gainers",
                "username": uname,
                "count": len(gainers)
            },
            target_topic=None,
            specific_tokens=tokens
        )

        dispatched_count = push_res.get("recipient_count", 0)
        if push_res.get("success"):
            status_text = push_res.get("status", "Sent")
        else:
            status_text = f"Failed ({push_res.get('error', push_res.get('message', 'Rejected by FCM'))[:80]})"

        total_dispatched += dispatched_count
        results.append({
            "username": uname,
            "gainers_count": len(gainers),
            "top_gainers": [f"{s['symbol']} ({s['change_pct']})" for s in gainers],
            "devices_targeted": len(tokens),
            "status": status_text,
            "image_url": image_url
        })

    if not results:
        return {
            "success": False,
            "message": "No users with active registered devices found. Enable notifications on the user device first.",
            "total_users_processed": 0,
            "total_devices_targeted": 0,
            "user_breakdown": []
        }

    return {
        "success": True,
        "total_users_processed": len(users),
        "total_devices_targeted": total_dispatched,
        "user_breakdown": results
    }


def send_watchlist_digest_to_user(username, base_url="", limit=5):
    """Dispatches a personalized watchlist top gainers digest specifically to a single user."""
    try:
        limit = int(limit or 5)
    except Exception:
        limit = 5
    tokens = get_user_tokens(username)
    if not tokens:
        return {
            "success": False,
            "message": f"User '{username}' has 0 active registered devices. Enable notifications on the user device first.",
            "recipient_count": 0,
            "username": username,
            "status": "No Registered Device"
        }

    from modules.common.data_paths import BASE_DATA_DIR
    gen_dir = os.path.join(BASE_DATA_DIR, "static", "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)

    gainers = get_user_watchlist_top_gainers(username, limit=limit)
    card_filename = f"watchlist_{username}.png"
    card_disk_path = os.path.join(gen_dir, card_filename)

    generate_watchlist_card(
        stocks=gainers,
        username=username,
        date_str=today_ist_str(),
        output_path=card_disk_path,
        limit=limit
    )

    image_url = f"{base_url.rstrip('/')}/static/notifications/generated/{card_filename}" if base_url else f"/static/notifications/generated/{card_filename}"

    if gainers:
        gainers_str = " • ".join(f"{s['symbol']} ({s['change_pct']})" for s in gainers[:3])
        title = f"⭐ Watchlist: Top {limit} Gainers"
        body = f"🟢 {gainers_str}"
    else:
        title = "⭐ Watchlist Momentum"
        body = "No positive stock gainers in your watchlist today."

    push_res = send_web_push(
        title=title,
        body=body,
        image_url=image_url,
        data_payload={
            "url": "/watchlists",
            "type": "watchlist_gainers",
            "username": username,
            "count": len(gainers)
        },
        target_topic=None,
        specific_tokens=tokens
    )

    return {
        "success": push_res.get("success", False),
        "message": push_res.get("message", "Dispatched"),
        "recipient_count": push_res.get("recipient_count", 0),
        "status": push_res.get("status", "Sent"),
        "username": username,
        "gainers_count": len(gainers),
        "image_url": image_url
    }

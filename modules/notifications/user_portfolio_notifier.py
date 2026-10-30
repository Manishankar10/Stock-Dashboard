import os
import logging
from modules.common.auth_utils import load_users
from modules.portfolio.portfolio_routes import load_portfolios
from modules.common.market_fetcher import format_financial_symbol, fetcher
from modules.notifications.card_generator import generate_portfolio_card
from modules.notifications.fcm_service import (
    load_subscriptions,
    send_web_push,
    log_notification_event,
    get_user_tokens
)
from modules.common.ist_datetime import format_ist_standard, today_ist_str

logger = logging.getLogger(__name__)


def calculate_user_portfolio_performance(username):
    """
    Computes real-time daily portfolio return, top gainer, and top loser
    for a specific user based on their holdings in the database.
    """
    portfolios = load_portfolios(username)
    if not portfolios:
        return {
            "username": username,
            "has_holdings": False,
            "holdings_count": 0,
            "net_return_pct": "+0.00%",
            "net_return_float": 0.0,
            "top_gainer_symbol": "N/A",
            "top_gainer_change": "+0.00%",
            "top_loser_symbol": "N/A",
            "top_loser_change": "-0.00%",
            "total_current_val": 0.0,
            "stock_details": []
        }

    total_curr = 0.0
    total_prev = 0.0
    stock_stats = []

    for pf_name, items in portfolios.items():
        if not isinstance(items, list):
            continue
        for item in items:
            sym = item.get("symbol", "").strip()
            if not sym:
                continue
            qty = float(item.get("quantity", 0) or 0)
            buy_p = float(item.get("buy_price", 0) or 0)

            # Fetch live market quote
            try:
                formatted_sym = format_financial_symbol(sym)
                q = fetcher.fetch_stock(formatted_sym)
                curr_p = float(q.get("price") or buy_p)
                chg_pct = float(q.get("change_pct") or 0.0)
            except Exception as e:
                logger.warning(f"Failed to fetch stock {sym}: {e}")
                curr_p = buy_p
                chg_pct = 0.0

            curr_val = qty * curr_p
            prev_val = curr_val / (1.0 + (chg_pct / 100.0)) if chg_pct != -100 else curr_val

            total_curr += curr_val
            total_prev += prev_val

            stock_stats.append({
                "symbol": sym,
                "portfolio": pf_name,
                "quantity": qty,
                "price": curr_p,
                "change_pct": chg_pct,
                "current_value": curr_val
            })

    net_return_float = ((total_curr - total_prev) / total_prev * 100.0) if total_prev > 0 else 0.0
    net_return_str = f"{net_return_float:+.2f}%"

    # Identify Top Gainer & Loser
    stock_stats.sort(key=lambda x: x["change_pct"], reverse=True)
    top_gainer = stock_stats[0] if stock_stats else None
    top_loser = stock_stats[-1] if stock_stats else None

    return {
        "username": username,
        "has_holdings": len(stock_stats) > 0,
        "holdings_count": len(stock_stats),
        "net_return_pct": net_return_str,
        "net_return_float": round(net_return_float, 2),
        "top_gainer_symbol": top_gainer["symbol"] if top_gainer else "N/A",
        "top_gainer_change": f"{top_gainer['change_pct']:+.2f}%" if top_gainer else "+0.00%",
        "top_loser_symbol": top_loser["symbol"] if top_loser else "N/A",
        "top_loser_change": f"{top_loser['change_pct']:+.2f}%" if top_loser else "-0.00%",
        "total_current_val": round(total_curr, 2),
        "stock_details": stock_stats
    }


def get_all_users_portfolio_summaries():
    """
    Returns an overview of all registered users and their computed portfolio performance today,
    showing exactly how many active device keys are registered per user.
    """
    users = load_users()
    summaries = []
    for uname in users.keys():
        perf = calculate_user_portfolio_performance(uname)
        user_keys = get_user_tokens(uname)
        perf["registered_devices"] = len(user_keys)
        summaries.append(perf)

    return summaries


def dispatch_unique_portfolio_notifications(base_url, static_root):
    """
    Iterates over EVERY user in the database, calculates their unique portfolio performance,
    generates their personalized card banner image, and dispatches a targeted notification
    only to that user's devices.
    """
    users = load_users()
    subs = load_subscriptions()

    # Map user to their tokens
    user_tokens = {}
    for token, s in subs.items():
        if not s.get("is_active", True):
            continue
        u = s.get("username", "guest")
        if u not in user_tokens:
            user_tokens[u] = []
        user_tokens[u].append(token)

    results = []
    total_dispatched = 0

    gen_dir = os.path.join(static_root, "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)

    for uname in users.keys():
        perf = calculate_user_portfolio_performance(uname)
        tokens = user_tokens.get(uname, [])

        # If user has no holdings and no tokens, skip
        if not perf["has_holdings"] and not tokens:
            continue

        # Personalized card generation
        perf_val = perf["net_return_pct"]
        g_sym = perf["top_gainer_symbol"]
        g_chg = perf["top_gainer_change"]
        l_sym = perf["top_loser_symbol"]
        l_chg = perf["top_loser_change"]

        card_filename = f"portfolio_{uname}.png"
        card_disk_path = os.path.join(gen_dir, card_filename)

        generate_portfolio_card(
            performance=perf_val,
            top_gainer_symbol=g_sym,
            top_gainer_change=g_chg,
            top_loser_symbol=l_sym,
            top_loser_change=l_chg,
            portfolio_name=f"{uname.capitalize()}'s Portfolio",
            date_str=today_ist_str(),
            output_path=card_disk_path
        )

        image_url = f"{base_url}/static/notifications/generated/{card_filename}"

        title = f"📈 {uname.capitalize()}'s EOD Portfolio: {perf_val}"
        body = f"Today's Net Return: {perf_val} • Top Gainer: {g_sym} ({g_chg}) • Top Loser: {l_sym} ({l_chg})"

        # If user has subscribed tokens, dispatch targeted
        if tokens:
            push_res = send_web_push(
                title=title,
                body=body,
                image_url=image_url,
                data_payload={
                    "url": "/portfolios",
                    "type": "portfolio_performance",
                    "username": uname,
                    "performance": perf_val,
                    "top_gainer": g_sym,
                    "top_loser": l_sym
                },
                target_topic=None,
                specific_tokens=tokens
            )
            dispatched_count = push_res.get("recipient_count", 0)
            if push_res.get("success"):
                status_text = push_res.get("status", "Sent")
            else:
                status_text = f"Failed ({push_res.get('error', push_res.get('message', 'Rejected by FCM'))[:80]})" 
        else:
            # Record audit log that card was prepared but user has not enabled push yet
            dispatched_count = 0
            status_text = "Calculated (No registered device)"
            log_notification_event(
                event_type="portfolio_performance",
                title=title,
                body=body,
                status=status_text,
                recipient_count=0,
                metadata={"username": uname, "image": image_url}
            )

        total_dispatched += dispatched_count
        results.append({
            "username": uname,
            "performance": perf_val,
            "top_gainer": f"{g_sym} ({g_chg})",
            "top_loser": f"{l_sym} ({l_chg})",
            "holdings_count": perf["holdings_count"],
            "devices_targeted": len(tokens),
            "status": status_text,
            "image_url": image_url
        })

    return {
        "success": True,
        "total_users_processed": len(users),
        "total_devices_targeted": total_dispatched,
        "user_breakdown": results
    }


def send_portfolio_digest_to_user(username, base_url=""):
    """Dispatches a personalized portfolio digest specifically to a single user."""
    from modules.notifications.card_generator import generate_portfolio_card
    from modules.notifications.fcm_service import get_user_tokens, send_web_push, log_notification_event
    from modules.common.data_paths import BASE_DATA_DIR

    tokens = get_user_tokens(username)
    perf = calculate_user_portfolio_performance(username)

    perf_val = perf["net_return_pct"]
    g_sym = perf["top_gainer_symbol"]
    g_chg = perf["top_gainer_change"]
    l_sym = perf["top_loser_symbol"]
    l_chg = perf["top_loser_change"]

    gen_dir = os.path.join(BASE_DATA_DIR, "static", "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)
    card_filename = f"portfolio_{username}.png"
    card_disk_path = os.path.join(gen_dir, card_filename)

    generate_portfolio_card(
        performance=perf_val,
        top_gainer_symbol=g_sym,
        top_gainer_change=g_chg,
        top_loser_symbol=l_sym,
        top_loser_change=l_chg,
        portfolio_name=f"{username.capitalize()}'s Portfolio",
        date_str=today_ist_str(),
        output_path=card_disk_path
    )

    image_url = f"{base_url.rstrip('/')}/static/notifications/generated/{card_filename}" if base_url else f"/static/notifications/generated/{card_filename}"
    title = f"📈 {username.capitalize()}'s EOD Portfolio: {perf_val}"
    body = f"Today's Net Return: {perf_val} • Top Gainer: {g_sym} ({g_chg}) • Top Loser: {l_sym} ({l_chg})"

    if not tokens:
        status_text = "Calculated (No registered device)"
        log_notification_event(
            event_type="portfolio_performance",
            title=title,
            body=body,
            status=status_text,
            recipient_count=0,
            metadata={"username": username, "image": image_url}
        )
        return {
            "success": False,
            "message": f"User '{username}' has no active registered devices. Please ask '{username}' to enable push notifications first.",
            "recipient_count": 0,
            "username": username,
            "status": status_text
        }

    res = send_web_push(
        title=title,
        body=body,
        image_url=image_url,
        data_payload={
            "url": "/portfolios",
            "type": "portfolio_performance",
            "username": username,
            "performance": perf_val,
            "top_gainer": g_sym,
            "top_loser": l_sym
        },
        specific_tokens=tokens
    )
    res["username"] = username
    return res

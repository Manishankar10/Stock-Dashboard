import os
import logging
from modules.common.auth_utils import load_users
from modules.portfolio.portfolio_routes import load_portfolios
from modules.notifications.card_generator import (
    generate_quarterly_results_card,
    clean_stock_symbol
)
from modules.notifications.fcm_service import (
    send_web_push,
    get_user_tokens,
    load_subscriptions
)
from modules.common.data_paths import BASE_DATA_DIR, APP_DATA_DIR

logger = logging.getLogger(__name__)


def extract_quarterly_stock_summary(record):
    """
    Normalizes a quarterly results database record into a clean dictionary
    with net profit, sales, ebidt, eps, and YoY percentages.
    """
    sym = clean_stock_symbol(record.get("symbol", ""))
    company = record.get("company", sym)
    exchange = record.get("exchange", "NSE")
    quarters = record.get("quarters", {})
    latest_q = quarters.get("latest") or record.get("latest_quarter") or "Latest Quarter"

    metrics = record.get("metrics", [])
    m_map = {}
    for m in metrics:
        name = str(m.get("name", "")).strip().lower()
        m_map[name] = m

    # Net profit / PAT
    pat_m = m_map.get("net profit") or m_map.get("pat") or {}
    pat_val = pat_m.get("latest") or "-"
    pat_yoy = pat_m.get("yoy_pct", 0.0)

    # Sales / Revenue
    sales_m = m_map.get("sales") or m_map.get("revenue") or {}
    sales_val = sales_m.get("latest") or "-"
    sales_yoy = sales_m.get("yoy_pct", 0.0)

    # EBIDT / Operating Profit
    ebidt_m = m_map.get("ebidt") or m_map.get("operating profit") or {}
    ebidt_val = ebidt_m.get("latest") or "-"
    ebidt_yoy = ebidt_m.get("yoy_pct", 0.0)

    # EPS
    eps_m = m_map.get("eps") or {}
    eps_val = eps_m.get("latest") or "-"
    eps_yoy = eps_m.get("yoy_pct", 0.0)

    return {
        "symbol": sym,
        "company": company,
        "exchange": exchange,
        "quarter": latest_q,
        "net_profit_val": str(pat_val),
        "net_profit_yoy": float(pat_yoy or 0.0),
        "sales_val": str(sales_val),
        "sales_yoy": float(sales_yoy or 0.0),
        "ebidt_val": str(ebidt_val),
        "ebidt_yoy": float(ebidt_yoy or 0.0),
        "eps_val": str(eps_val),
        "eps_yoy": float(eps_yoy or 0.0),
    }


def load_all_quarterly_records():
    """Fetches all latest quarterly results from provider cache or disk json."""
    try:
        from modules.quarterly_results import get_provider
        prov = get_provider()
        if prov and getattr(prov, "_cache_data", None):
            return prov._cache_data
    except Exception as e:
        logger.debug(f"Could not load from get_provider: {e}")

    # Fallback to local json file
    json_path = os.path.join(APP_DATA_DIR, "quarterly_results_live.json")
    if os.path.exists(json_path):
        try:
            import json
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                elif isinstance(data, list):
                    return data
        except Exception as e:
            logger.error(f"Failed to read {json_path}: {e}")
    return []


def get_portfolio_quarterly_results_for_user(username, synced_records=None):
    """
    Finds quarterly results specifically for stocks present in the user's portfolio.
    If synced_records is provided, matches only against those newly synced records.
    Otherwise, matches against all latest quarterly results in the database.
    """
    portfolios = load_portfolios(username)
    if not portfolios:
        return []

    held_symbols = set()
    for pf_name, items in portfolios.items():
        if not isinstance(items, list):
            continue
        for item in items:
            sym = str(item.get("symbol", "")).strip()
            if sym:
                cleaned = clean_stock_symbol(sym).upper()
                if cleaned and cleaned != "-":
                    held_symbols.add(cleaned)

    if not held_symbols:
        return []

    all_records = synced_records if synced_records is not None else load_all_quarterly_records()
    if not all_records:
        return []

    matched = []
    seen_syms = set()

    for r in all_records:
        r_sym = clean_stock_symbol(str(r.get("symbol", ""))).upper()
        if not r_sym or r_sym == "-":
            continue

        if r_sym in held_symbols and r_sym not in seen_syms:
            summary = extract_quarterly_stock_summary(r)
            matched.append(summary)
            seen_syms.add(r_sym)

    return matched


def get_sample_quarterly_results():
    """Returns sample quarterly results for preview or testing."""
    all_records = load_all_quarterly_records()
    if all_records:
        samples = []
        for sym in ["INFY", "TCS", "TMCV", "HDFCBANK", "RELIANCE"]:
            for r in all_records:
                if clean_stock_symbol(r.get("symbol", "")).upper() == sym:
                    samples.append(extract_quarterly_stock_summary(r))
                    break
        if samples:
            return samples
        # Fallback to first 3 records in store
        return [extract_quarterly_stock_summary(r) for r in all_records[:3]]

    # Hardcoded fallback benchmark
    return [
        {
            "symbol": "INFY",
            "company": "Infosys Ltd",
            "exchange": "NSE",
            "quarter": "Sep 2026",
            "net_profit_val": "7,838",
            "net_profit_yoy": 6.0,
            "sales_val": "49,244",
            "sales_yoy": 11.0,
            "ebidt_val": "11,689",
            "ebidt_yoy": 11.0,
            "eps_val": "19.28",
            "eps_yoy": 9.0
        },
        {
            "symbol": "TCS",
            "company": "Tata Consultancy Services",
            "exchange": "NSE",
            "quarter": "Sep 2026",
            "net_profit_val": "13,934",
            "net_profit_yoy": 0.0,
            "sales_val": "73,188",
            "sales_yoy": 11.0,
            "ebidt_val": "18,815",
            "ebidt_yoy": 5.0,
            "eps_val": "38.37",
            "eps_yoy": 15.0
        }
    ]


def send_quarterly_results_to_user(username, matched_results=None, base_url="", static_root=None):
    """
    Generates a consolidated quarterly results card and dispatches a single
    push notification to the specified user if they hold reporting stocks.
    """
    if matched_results is None:
        matched_results = get_portfolio_quarterly_results_for_user(username)

    if not matched_results:
        return {
            "success": False,
            "status": "No Matching Stocks",
            "message": f"User '{username}' does not hold any stocks that reported quarterly results.",
            "username": username,
            "matched_stocks_count": 0
        }

    tokens = get_user_tokens(username)

    # Prepare output card file
    if not static_root:
        static_root = os.path.join(BASE_DATA_DIR, "static")
    gen_dir = os.path.join(static_root, "notifications", "generated")
    os.makedirs(gen_dir, exist_ok=True)

    card_filename = f"quarterly_{username}.png"
    card_disk_path = os.path.join(gen_dir, card_filename)

    q_label = matched_results[0].get("quarter") or "Q2 Earnings Update"
    generate_quarterly_results_card(
        stocks=matched_results,
        username=username,
        quarter_label=q_label,
        output_path=card_disk_path
    )

    image_url = f"{base_url.rstrip('/')}/static/notifications/generated/{card_filename}" if base_url else f"/static/notifications/generated/{card_filename}"

    if not tokens:
        return {
            "success": False,
            "status": "No Registered Device",
            "message": f"User '{username}' has 0 active registered devices. Enable notifications on the user device first.",
            "username": username,
            "recipient_count": 0,
            "matched_stocks_count": len(matched_results),
            "card_image_url": image_url
        }

    # Consolidated Notification Content
    if len(matched_results) == 1:
        st = matched_results[0]
        sym = st["symbol"]
        pat_y = st.get("net_profit_yoy", 0.0)
        pat_sign = "+" if pat_y >= 0 else ""
        sales_y = st.get("sales_yoy", 0.0)
        sales_sign = "+" if sales_y >= 0 else ""

        title = f"📊 Q2 Results: {sym} ({pat_sign}{pat_y:.1f}% YoY PAT)"
        body = f"{st.get('company', sym)}: Net Profit ₹{st.get('net_profit_val', '-')} Cr ({pat_sign}{pat_y:.1f}%) • Sales ₹{st.get('sales_val', '-')} Cr ({sales_sign}{sales_y:.1f}%)"
    else:
        title = f"📊 Quarterly Results: {len(matched_results)} Portfolio Stocks Reported"
        parts = []
        for st in matched_results[:3]:
            pat_y = st.get("net_profit_yoy", 0.0)
            pat_sign = "+" if pat_y >= 0 else ""
            parts.append(f"{st['symbol']}: PAT ₹{st.get('net_profit_val', '-')} Cr ({pat_sign}{pat_y:.1f}%)")
        if len(matched_results) > 3:
            parts.append(f"+{len(matched_results) - 3} more")
        body = " • ".join(parts)

    push_res = send_web_push(
        title=title,
        body=body,
        image_url=image_url,
        data_payload={
            "url": "/quarterly-results",
            "type": "quarterly_results",
            "username": username,
            "stocks_count": len(matched_results),
            "symbols": [s["symbol"] for s in matched_results]
        },
        target_topic=None,
        specific_tokens=tokens
    )

    push_res["username"] = username
    push_res["matched_stocks_count"] = len(matched_results)
    push_res["image_url"] = image_url
    return push_res


def dispatch_quarterly_results_notifications(synced_records=None, base_url="", static_root=None):
    """
    DISPATCHES CONSOLIDATED QUARTERLY RESULTS NOTIFICATIONS TO APPROPRIATE PORTFOLIO USERS:
    1. Iterates over all registered users.
    2. Identifies which users hold 1 or more stocks that reported quarterly results.
    3. Strictly skips users with no matching portfolio stocks or no registered devices.
    4. Generates a personalized dark glassy card (single or multi-stock layout).
    5. Dispatches a single consolidated push notification per user.
    """
    users = load_users()
    if not users:
        return {
            "success": False,
            "message": "No registered users found in the system.",
            "total_users_matched": 0
        }

    subs = load_subscriptions()
    user_tokens = {}
    for token, data in subs.items():
        if not data.get("is_active", True):
            continue
        u = data.get("username")
        if not u or u == "guest" or u not in users:
            continue
        if u not in user_tokens:
            user_tokens[u] = []
        user_tokens[u].append(token)

    results = []
    total_dispatched = 0

    for uname in users.keys():
        tokens = user_tokens.get(uname, [])
        if not tokens:
            continue

        matched = get_portfolio_quarterly_results_for_user(uname, synced_records=synced_records)
        if not matched:
            continue

        res = send_quarterly_results_to_user(
            username=uname,
            matched_results=matched,
            base_url=base_url,
            static_root=static_root
        )

        recipient_count = res.get("recipient_count", 0)
        total_dispatched += recipient_count

        results.append({
            "username": uname,
            "matched_stocks_count": len(matched),
            "symbols": [s["symbol"] for s in matched],
            "devices_targeted": len(tokens),
            "status": res.get("status", "Sent") if res.get("success") else f"Failed ({res.get('message', res.get('error', 'Error'))[:60]})",
            "image_url": res.get("image_url", "")
        })

    logger.info(f"Quarterly results notification dispatch complete: {len(results)} users matched and targeted with {total_dispatched} push deliveries.")

    return {
        "success": True,
        "total_users_matched": len(results),
        "total_devices_targeted": total_dispatched,
        "user_breakdown": results
    }

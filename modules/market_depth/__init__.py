import os
import re
import time
import datetime
import threading
import requests
from flask import Blueprint, jsonify, request

from modules.common.auth_utils import login_required
from modules.common.market_fetcher import POPULAR_INDIAN_STOCKS, stock_cache, fetcher

market_depth_bp = Blueprint("market_depth", __name__)

_DEPTH_CACHE = {}
_DEPTH_LOCK = threading.RLock()
_CACHE_TTL = 3.0  # 3-second cache for high responsiveness without excessive upstream load

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9"
}


def _normalize_symbol(sym):
    if not sym:
        return ""
    clean = str(sym).strip().upper()
    clean = re.sub(r"\.(NS|BO|BS)$", "", clean, flags=re.IGNORECASE)
    return clean


def _get_company_name(clean_sym):
    if clean_sym in POPULAR_INDIAN_STOCKS:
        return POPULAR_INDIAN_STOCKS[clean_sym]
    for k, v in POPULAR_INDIAN_STOCKS.items():
        if _normalize_symbol(k) == clean_sym:
            return v
    return clean_sym


def fetch_live_market_depth(symbol):
    clean_sym = _normalize_symbol(symbol)
    if not clean_sym:
        return None

    now = time.time()
    with _DEPTH_LOCK:
        cached = _DEPTH_CACHE.get(clean_sym)
        if cached and (now - cached.get("cached_at", 0) < _CACHE_TTL):
            return cached.get("data")

    comp_name = _get_company_name(clean_sym)

    # 1. Fetch Order Book & Live Prices from NSE Cash segment
    url_book = f"https://groww.in/v1/api/stocks_data/v1/tr_live_book/exchange/NSE/segment/CASH/{clean_sym}/latest"
    url_price = f"https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/{clean_sym}/latest"

    book_data = None
    price_data = None

    try:
        r_book = requests.get(url_book, headers=HEADERS, timeout=4)
        if r_book.status_code == 200:
            book_data = r_book.json()
    except Exception as e:
        print(f"[Market Depth] Book fetch error for {clean_sym}: {e}")

    try:
        r_price = requests.get(url_price, headers=HEADERS, timeout=4)
        if r_price.status_code == 200:
            price_data = r_price.json()
    except Exception as e:
        print(f"[Market Depth] Price fetch error for {clean_sym}: {e}")

    # Fallback to local stock_cache or fetcher for OHLC / LTP if price_data failed
    fallback_info = stock_cache.get(f"{clean_sym}.NS") or stock_cache.get(clean_sym)
    if not fallback_info:
        try:
            fallback_info = fetcher.fetch_quote(f"{clean_sym}.NS") or {}
        except Exception:
            fallback_info = {}

    ltp = 0.0
    change = 0.0
    change_pct = 0.0
    open_val = 0.0
    high_val = 0.0
    low_val = 0.0
    close_val = 0.0
    tot_buy = 0
    tot_sell = 0

    if price_data:
        ltp = float(price_data.get("ltp") or 0.0)
        change = float(price_data.get("dayChange") or 0.0)
        change_pct = float(price_data.get("dayChangePerc") or 0.0)
        open_val = float(price_data.get("open") or 0.0)
        high_val = float(price_data.get("high") or 0.0)
        low_val = float(price_data.get("low") or 0.0)
        close_val = float(price_data.get("close") or 0.0)
        tot_buy = int(price_data.get("totalBuyQty") or price_data.get("cumulativeBuyQty") or 0)
        tot_sell = int(price_data.get("totalSellQty") or price_data.get("cumulativeSellQty") or 0)

    if ltp <= 0 and fallback_info:
        ltp = float(fallback_info.get("price") or fallback_info.get("ltp") or 0.0)
        change = float(fallback_info.get("change") or 0.0)
        change_pct = float(fallback_info.get("change_percent") or fallback_info.get("change_pct") or 0.0)
        open_val = float(fallback_info.get("open") or 0.0)
        high_val = float(fallback_info.get("high") or 0.0)
        low_val = float(fallback_info.get("low") or 0.0)
        close_val = float(fallback_info.get("previous_close") or fallback_info.get("prev_close") or 0.0)

    # Parse Bids (Buy Book)
    bids = []
    buy_book = (book_data and book_data.get("buyBook")) or {}
    for i in range(1, 6):
        entry = buy_book.get(str(i)) or {}
        bids.append({
            "level": i,
            "qty": int(entry.get("qty") or 0),
            "orders": int(entry.get("orderCount") or 0),
            "price": float(entry.get("price") or 0.0)
        })

    # Parse Asks (Sell Book)
    asks = []
    sell_book = (book_data and book_data.get("sellBook")) or {}
    for i in range(1, 6):
        entry = sell_book.get(str(i)) or {}
        asks.append({
            "level": i,
            "price": float(entry.get("price") or 0.0),
            "orders": int(entry.get("orderCount") or 0),
            "qty": int(entry.get("qty") or 0)
        })

    # Calculate Total Quantities from top 5 if cumulative total is 0
    top5_buy_qty = sum(b["qty"] for b in bids)
    top5_sell_qty = sum(a["qty"] for a in asks)
    if tot_buy <= 0 and top5_buy_qty > 0:
        tot_buy = top5_buy_qty
    if tot_sell <= 0 and top5_sell_qty > 0:
        tot_sell = top5_sell_qty

    # Calculate percentage imbalance
    grand_total = tot_buy + tot_sell
    buy_ratio_pct = round((tot_buy / grand_total * 100), 1) if grand_total > 0 else 50.0
    sell_ratio_pct = round(100.0 - buy_ratio_pct, 1)

    now_ist = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    time_str = now_ist.strftime("%I:%M:%S %p")

    result = {
        "success": True,
        "symbol": clean_sym,
        "company_name": comp_name,
        "ltp": round(ltp, 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "open": round(open_val, 2),
        "high": round(high_val, 2),
        "low": round(low_val, 2),
        "close": round(close_val, 2),
        "total_buy_qty": tot_buy,
        "total_sell_qty": tot_sell,
        "buy_ratio_pct": buy_ratio_pct,
        "sell_ratio_pct": sell_ratio_pct,
        "bids": bids,
        "asks": asks,
        "timestamp": time_str
    }

    with _DEPTH_LOCK:
        _DEPTH_CACHE[clean_sym] = {"cached_at": now, "data": result}

    return result


@market_depth_bp.route("/api/market-depth/<symbol>", methods=["GET"])
@login_required
def get_market_depth(symbol):
    clean_sym = _normalize_symbol(symbol)
    if not clean_sym:
        return jsonify({"success": False, "error": "Invalid symbol"}), 400

    depth = fetch_live_market_depth(clean_sym)
    if not depth:
        return jsonify({"success": False, "error": "Unable to fetch market depth"}), 502

    return jsonify(depth)

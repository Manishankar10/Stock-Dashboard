"""
Backfill Daily Stock Closing Prices (2013-01-01 to Present) for all Index Stocks.
Clears existing collection/table first, then populates clean, deduplicated closing prices
from 2013-01-01 to present date.

Features:
- Start date: 2013-01-01
- End date: Today (latest completed trading day)
- Strictly NO duplicates per stock (unique dates in ascending chronological order)
- Dual-write to SQLite (capital_desk.db) and MongoDB Atlas (stock_closing_prices)
- Thread-safe parallel fetching and chunked batch writing
"""

import sys
import os
import time
import json
import sqlite3
import datetime
import urllib.parse
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Any, Tuple

# Add project root to sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

import requests
import db_store
from modules.common.ist_datetime import (
    now_ist,
    format_ist_display,
    format_ist_iso
)
from modules.stock_closing_prices.stock_closing_prices_provider import stock_closing_prices_provider
from modules.momentum_smallcases.index_comparator import clear_comparison_cache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("backfill_2013")

START_DATE = "2013-01-01"
# 2013-01-01 00:00:00 UTC timestamp = 1356998400
START_TIMESTAMP = 1356998400

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def clear_stock_closing_prices_storage():
    """
    Clears all records from stock_closing_prices in both SQLite and MongoDB Atlas.
    """
    logger.info("Clearing all data from 'stock_closing_prices' collection / table...")

    # 1. MongoDB Atlas (if connected)
    if hasattr(db_store, "db") and db_store.db is not None:
        try:
            res = db_store.db["stock_closing_prices"].delete_many({})
            logger.info(f"  MongoDB: Deleted {res.deleted_count} documents from 'stock_closing_prices'.")
        except Exception as e:
            logger.warning(f"  MongoDB clear error: {e}")

    # 2. Local SQLite
    try:
        db_path = os.path.join(PROJECT_ROOT, "user_data", "capital_desk.db")
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM stock_closing_prices")
        count_before = cur.fetchone()[0]
        cur.execute("DELETE FROM stock_closing_prices")
        conn.commit()
        conn.close()
        logger.info(f"  SQLite: Deleted {count_before} records from 'stock_closing_prices' table.")
    except Exception as e:
        logger.error(f"  SQLite clear error: {e}")


def fetch_stock_from_yahoo(symbol: str, company_name: str) -> Optional[List[Dict[str, Any]]]:
    """
    Fetches raw daily bars from Yahoo Finance for a stock starting from START_TIMESTAMP (2013-01-01).
    """
    sym_clean = symbol.strip().upper()
    now_ts = int(time.time())
    suffixes = [".NS", ".BO"]

    for suffix in suffixes:
        encoded_sym = urllib.parse.quote(sym_clean + suffix)
        for host in HOSTS:
            url = f"https://{host}/v8/finance/chart/{encoded_sym}?interval=1d&period1={START_TIMESTAMP}&period2={now_ts}&includePrePost=false"
            try:
                r = requests.get(url, headers=HEADERS, timeout=12)
                if r.status_code == 200:
                    data = r.json()
                    chart = data.get("chart", {})
                    results = chart.get("result")
                    if results and len(results) > 0:
                        raw_res = results[0]
                        timestamps = raw_res.get("timestamp", []) or []
                        indicators = raw_res.get("indicators", {})
                        quote_list = indicators.get("quote", [{}])
                        quote = quote_list[0] if (quote_list and isinstance(quote_list, list)) else {}
                        closes = quote.get("close", []) or []

                        bars = []
                        for i, ts in enumerate(timestamps):
                            if i >= len(closes):
                                break
                            c_val = closes[i]
                            if c_val is not None:
                                try:
                                    c_float = float(c_val)
                                    if c_float > 0:
                                        dt_ist = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
                                        d_str = dt_ist.strftime("%Y-%m-%d")
                                        if d_str >= START_DATE:
                                            bars.append({"d": d_str, "c": round(c_float, 2)})
                                except (ValueError, TypeError):
                                    continue
                        if bars:
                            return bars
            except Exception:
                continue
    return None


def process_single_stock(
    symbol: str,
    company_name: str,
    cached_prices: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """
    Builds a clean 2013-onwards daily closing prices record for a single stock.
    Reuses existing prices (filtered for >= 2013-01-01) and falls back to / augments with Yahoo Finance.
    """
    sym_clean = symbol.strip().upper()
    price_dict: Dict[str, float] = {}

    # 1. Load cached prices filtered for >= START_DATE
    if cached_prices:
        for p in cached_prices:
            d = p.get("d", "")
            c = p.get("c")
            if d and d >= START_DATE and c is not None:
                try:
                    c_float = float(c)
                    if c_float > 0:
                        price_dict[d] = round(c_float, 2)
                except (ValueError, TypeError):
                    continue

    # 2. If cached prices are missing or very short (< 100 bars for a mature company), fetch from Yahoo
    if len(price_dict) < 50:
        yahoo_bars = fetch_stock_from_yahoo(sym_clean, company_name)
        if yahoo_bars:
            for b in yahoo_bars:
                d = b.get("d", "")
                c = b.get("c")
                if d and d >= START_DATE and c is not None and c > 0:
                    price_dict[d] = c

    if not price_dict:
        return None

    sorted_dates = sorted(price_dict.keys())
    merged_prices = [{"d": d, "c": price_dict[d]} for d in sorted_dates]

    # Explicit assertion: Zero duplicates
    assert len(merged_prices) == len(set(sorted_dates)), f"Duplicate dates detected for {sym_clean}!"

    start_date = merged_prices[0]["d"]
    latest_date = merged_prices[-1]["d"]
    latest_close = merged_prices[-1]["c"]
    prev_close = merged_prices[-2]["c"] if len(merged_prices) > 1 else latest_close
    change = round(latest_close - prev_close, 2)
    change_pct = round((change / prev_close * 100.0) if prev_close else 0.0, 2)
    now_display = format_ist_display()
    now_iso = format_ist_iso()

    return {
        "symbol": sym_clean,
        "company_name": company_name,
        "start_date": start_date,
        "latest_date": latest_date,
        "latest_close": latest_close,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "total_records": len(merged_prices),
        "prices": merged_prices,
        "last_synced": now_iso,
        "last_synced_display": now_display
    }


def run_backfill_2013(batch_size: int = 50, max_workers: int = 12):
    start_time = time.time()
    logger.info("=" * 70)
    logger.info(f"STARTING STOCK CLOSING PRICES PURGE & BACKFILL ({START_DATE} to Today)")
    logger.info("=" * 70)

    # 1. Load universe of constituent stocks
    stocks_map = stock_closing_prices_provider.get_unique_index_stocks()
    total_stocks = len(stocks_map)
    logger.info(f"Target index stocks universe: {total_stocks} stocks.")

    # 2. Extract existing prices into memory before clearing DB
    logger.info("Backing up / staging in-memory cached prices from current SQLite DB...")
    db_path = os.path.join(PROJECT_ROOT, "user_data", "capital_desk.db")
    cached_prices_map = {}
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT symbol, company_name, prices_json FROM stock_closing_prices")
        for sym, cname, p_json in cur.fetchall():
            try:
                cached_prices_map[sym.upper()] = json.loads(p_json)
            except Exception:
                pass
        conn.close()
        logger.info(f"Staged in-memory price history for {len(cached_prices_map)} stocks.")
    except Exception as e:
        logger.warning(f"Error reading existing SQLite prices: {e}")

    # 3. Clear all data from stock_closing_prices collection / table
    clear_stock_closing_prices_storage()

    # 4. Process all stocks in batches
    stock_items = list(stocks_map.items())
    processed_count = 0
    success_count = 0
    failed_stocks = []
    latest_date_seen = ""

    total_batches = (total_stocks + batch_size - 1) // batch_size
    for i in range(0, total_stocks, batch_size):
        chunk = stock_items[i : i + batch_size]
        chunk_records = []
        batch_num = (i // batch_size) + 1

        logger.info(f"--> Processing Batch {batch_num}/{total_batches} ({len(chunk)} stocks)...")

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for sym, cname in chunk:
                cached = cached_prices_map.get(sym.upper())
                future = executor.submit(process_single_stock, sym, cname, cached)
                futures[future] = (sym, cname)

            for future in as_completed(futures):
                sym, cname = futures[future]
                try:
                    res = future.result()
                    if res and res.get("prices"):
                        chunk_records.append(res)
                        d_latest = res.get("latest_date", "")
                        if d_latest > latest_date_seen:
                            latest_date_seen = d_latest
                    else:
                        failed_stocks.append(sym)
                        logger.warning(f"  [WARN] No price data returned for {sym}")
                except Exception as ex:
                    failed_stocks.append(sym)
                    logger.error(f"  [ERROR] {sym}: {ex}")

        # Save batch chunk to dual DB (SQLite + MongoDB Atlas)
        if chunk_records:
            db_store.save_stock_closing_prices_db(chunk_records)
            success_count += len(chunk_records)
            logger.info(f"  ==> Saved batch {batch_num} ({len(chunk_records)} stocks) to SQLite / Mongo.")

        processed_count += len(chunk)
        elapsed = time.time() - start_time
        pct = (processed_count / total_stocks) * 100.0
        logger.info(f"Progress: {processed_count}/{total_stocks} ({pct:.1f}%) | Elapsed: {elapsed:.1f}s")

    # 5. Save updated telemetry
    now_final = format_ist_display()
    now_iso = format_ist_iso()
    telemetry_data = {
        "is_syncing": False,
        "progress": f"Backfill (2013-Today) completed for {success_count}/{total_stocks} stocks.",
        "percent": 100,
        "total_stocks": success_count,
        "universe_size": total_stocks,
        "last_synced_display": now_final,
        "latest_trading_date": latest_date_seen,
        "last_error": f"Failed: {failed_stocks}" if failed_stocks else None,
        "updated_at": now_iso
    }
    db_store.save_stock_closing_prices_telemetry_db(telemetry_data)

    # 6. Clear in-memory comparison cache
    clear_comparison_cache()

    total_time = time.time() - start_time
    logger.info("=" * 70)
    logger.info(f"BACKFILL COMPLETE in {total_time:.1f}s ({total_time/60:.2f} mins)")
    logger.info(f"Successfully populated: {success_count}/{total_stocks} stocks (from {START_DATE})")
    logger.info(f"Latest trading date: {latest_date_seen}")
    if failed_stocks:
        logger.warning(f"Failed stocks ({len(failed_stocks)}): {failed_stocks}")
    logger.info("=" * 70)


if __name__ == "__main__":
    run_backfill_2013(batch_size=50, max_workers=12)

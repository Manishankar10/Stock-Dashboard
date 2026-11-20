"""
Backfill Daily Stock Closing Prices (2012-01-01 to Today) for all Index Stocks.
Strict Constraints:
- Start date: 2012-01-01
- End date: Today (latest available trading day)
- Strictly NO duplicates per stock (unique dates in ascending chronological order)
- Dual-write to SQLite (capital_desk.db) and MongoDB Atlas (stock_closing_prices)
- Thread-safe parallel fetching and chunked batch writing
"""

import sys
import os
import time
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("backfill_2012")

START_DATE = "2012-01-01"
# 2012-01-01 00:00:00 UTC timestamp = 1325376000
START_TIMESTAMP = 1325376000

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def fetch_stock_2012(symbol: str, company_name: str, existing_doc: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """
    Fetches full daily closing history from 2012-01-01 to present for a single stock.
    Merges with existing records, deduplicates by date, and returns the formatted record.
    """
    sym_clean = symbol.strip().upper()
    now_ts = int(time.time())

    # Try .NS first, then .BO fallback
    suffixes = [".NS", ".BO"]
    raw_res = None

    for suffix in suffixes:
        encoded_sym = urllib.parse.quote(sym_clean + suffix)
        for host in HOSTS:
            url = f"https://{host}/v8/finance/chart/{encoded_sym}?interval=1d&period1={START_TIMESTAMP}&period2={now_ts}&includePrePost=false"
            try:
                r = requests.get(url, headers=HEADERS, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    chart = data.get("chart", {})
                    results = chart.get("result")
                    if results and len(results) > 0:
                        raw_res = results[0]
                        break
            except Exception:
                continue
        if raw_res:
            break

    # If Yahoo failed to return data, check if we have existing records in DB
    existing_prices = existing_doc.get("prices", []) if existing_doc else []

    fetched_bars = []
    if raw_res:
        timestamps = raw_res.get("timestamp", []) or []
        indicators = raw_res.get("indicators", {})
        quote_list = indicators.get("quote", [{}])
        quote = quote_list[0] if (quote_list and isinstance(quote_list, list)) else {}
        closes = quote.get("close", []) or []

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
                            fetched_bars.append({"d": d_str, "c": round(c_float, 2)})
                except (ValueError, TypeError):
                    continue

    # STRICT DEDUPLICATION: Use dict keyed by date 'YYYY-MM-DD'
    price_dict = {}

    # 1. Existing DB prices
    for p in existing_prices:
        d = p.get("d", "")
        c = p.get("c")
        if d and d >= START_DATE and c is not None:
            try:
                c_float = float(c)
                if c_float > 0:
                    price_dict[d] = round(c_float, 2)
            except (ValueError, TypeError):
                continue

    # 2. Newly fetched bars (takes precedence / updates recent close)
    for b in fetched_bars:
        d = b.get("d", "")
        c = b.get("c")
        if d and d >= START_DATE and c is not None and c > 0:
            price_dict[d] = c

    if not price_dict:
        return None

    # Sort strictly chronologically
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


def run_backfill(batch_size: int = 25, max_workers: int = 10):
    start_time = time.time()
    logger.info("=" * 70)
    logger.info(f"STARTING STOCK CLOSING PRICES BACKFILL ({START_DATE} to Today)")
    logger.info("=" * 70)

    # 1. Get Universe of index constituent stocks
    stocks_map = stock_closing_prices_provider.get_unique_index_stocks()
    total_stocks = len(stocks_map)
    logger.info(f"Loaded {total_stocks} unique index stocks.")

    # 2. Load existing summary for quick lookup
    existing_summary = db_store.load_stock_closing_prices_db(summary_only=True) or {}
    logger.info(f"Found {len(existing_summary)} existing stocks in database.")

    # Convert to list of tuples
    stock_items = list(stocks_map.items())
    processed_count = 0
    success_count = 0
    failed_stocks = []
    latest_date_seen = ""

    # 3. Process in batches
    for i in range(0, total_stocks, batch_size):
        chunk = stock_items[i : i + batch_size]
        chunk_records = []
        batch_num = (i // batch_size) + 1
        total_batches = (total_stocks + batch_size - 1) // batch_size

        logger.info(f"--> Batch {batch_num}/{total_batches} ({len(chunk)} stocks)...")

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for sym, cname in chunk:
                # Load existing full doc if it exists to preserve any valid past days
                existing_doc = None
                if sym in existing_summary:
                    existing_doc = db_store.load_stock_closing_prices_db(sym)

                future = executor.submit(fetch_stock_2012, sym, cname, existing_doc)
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
                        logger.info(
                            f"  [OK] {sym}: {res['total_records']} bars ({res['start_date']} -> {res['latest_date']}) | No dups"
                        )
                    else:
                        failed_stocks.append(sym)
                        logger.warning(f"  [WARN] No price data returned for {sym}")
                except Exception as ex:
                    failed_stocks.append(sym)
                    logger.error(f"  [ERROR] {sym}: {ex}")

        # Save batch chunk to dual DB (SQLite + MongoDB Atlas)
        if chunk_records:
            save_res = db_store.save_stock_closing_prices_db(chunk_records)
            success_count += len(chunk_records)
            logger.info(f"  ==> Saved batch {batch_num} ({len(chunk_records)} records) to SQLite & Mongo Atlas.")

        processed_count += len(chunk)
        elapsed = time.time() - start_time
        pct = (processed_count / total_stocks) * 100.0
        logger.info(f"Progress: {processed_count}/{total_stocks} ({pct:.1f}%) | Elapsed: {elapsed:.1f}s")
        time.sleep(0.1)  # brief pacing

    # 4. Save updated telemetry
    now_final = format_ist_display()
    now_iso = format_ist_iso()
    telemetry_data = {
        "is_syncing": False,
        "progress": f"Backfill (2012-Today) completed for {success_count}/{total_stocks} stocks.",
        "percent": 100,
        "total_stocks": success_count,
        "universe_size": total_stocks,
        "last_synced_display": now_final,
        "latest_trading_date": latest_date_seen,
        "last_error": f"Failed: {failed_stocks}" if failed_stocks else None,
        "updated_at": now_iso
    }
    db_store.save_stock_closing_prices_telemetry_db(telemetry_data)

    total_time = time.time() - start_time
    logger.info("=" * 70)
    logger.info(f"BACKFILL COMPLETE in {total_time:.1f}s ({total_time/60:.2f} mins)")
    logger.info(f"Successfully backfilled: {success_count}/{total_stocks} stocks")
    logger.info(f"Latest trading date: {latest_date_seen}")
    if failed_stocks:
        logger.warning(f"Failed stocks ({len(failed_stocks)}): {failed_stocks}")
    logger.info("=" * 70)


if __name__ == "__main__":
    run_backfill(batch_size=25, max_workers=10)

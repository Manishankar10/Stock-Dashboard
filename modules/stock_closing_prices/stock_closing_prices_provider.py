"""
Stock Closing Prices Provider for Capital Desk.
Manages 2-year daily EOD historical closing prices and daily incremental synchronization
for all 750 benchmark index constituent stocks (Nifty 50, Next 50, Midcap 150, Smallcap 250, Microcap 250).

Persistence:
- MongoDB Atlas collection: 'stock_closing_prices' (Primary)
- SQLite database: 'capital_desk.db' table 'stock_closing_prices' (Local fallback / dual-write)
- Telemetry: 'stock_closing_prices_telemetry'

Constraints:
- Strictly stock-level EOD data (NO index details saved in this collection).
- Incremental EOD sync permitted strictly when Indian stock market is closed (post 03:30 PM IST / weekends / holidays).
"""

import os
import time
import json
import logging
import datetime
import urllib.parse
import threading
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import db_store
from modules.common.ist_datetime import (
    now_ist,
    today_ist_str,
    is_market_hours,
    format_ist_display,
    format_ist_date,
    format_ist_iso
)
from modules.common.data_paths import APP_DATA_DIR

logger = logging.getLogger("stock_closing_prices")

TELEMETRY_CACHE_FILE = os.path.join(APP_DATA_DIR, "stock_closing_prices_telemetry.json")

# Process start baseline date: all historical dates before Jan 2012 are strictly excluded.
START_DATE = "2012-01-01"


class StockClosingPricesProvider:
    def __init__(self):
        self._lock = threading.Lock()
        self._is_syncing: bool = False
        self._progress: str = "Ready"
        self._percent: int = 0
        self._total_stocks: int = 750
        self._synced_stocks_count: int = 0
        self._last_error: Optional[str] = None
        self._last_synced_display: str = "Never"
        self._latest_trading_date: str = ""
        self._status_cache: Dict[str, Any] = {}

        # Restore telemetry from DB / file if available
        self._load_telemetry_cache()

    def _load_telemetry_cache(self):
        """Loads cached sync telemetry from DB or disk."""
        try:
            cached = db_store.load_stock_closing_prices_telemetry_db()
            if not cached and os.path.exists(TELEMETRY_CACHE_FILE):
                with open(TELEMETRY_CACHE_FILE, "r", encoding="utf-8") as f:
                    cached = json.load(f)

            if cached and isinstance(cached, dict):
                self._last_synced_display = cached.get("last_synced_display", "Never")
                self._latest_trading_date = cached.get("latest_trading_date", "")
                self._synced_stocks_count = int(cached.get("total_stocks", 0))
                self._progress = cached.get("progress", "Ready")
        except Exception as e:
            logger.warning(f"Error loading stock closing prices telemetry: {e}")

    def _persist_telemetry(self, extra: Optional[Dict[str, Any]] = None):
        """Persists sync telemetry state to DB and local cache."""
        data = {
            "is_syncing": self._is_syncing,
            "progress": self._progress,
            "percent": self._percent,
            "total_stocks": self._synced_stocks_count,
            "universe_size": self._total_stocks,
            "last_synced_display": self._last_synced_display,
            "latest_trading_date": self._latest_trading_date,
            "last_error": self._last_error,
            "updated_at": format_ist_iso()
        }
        if extra:
            data.update(extra)

        try:
            db_store.save_stock_closing_prices_telemetry_db(data)
        except Exception as e:
            logger.warning(f"Failed to persist telemetry in db_store: {e}")

        try:
            with open(TELEMETRY_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"Failed to save local telemetry file: {e}")

    def get_unique_index_stocks(self) -> Dict[str, str]:
        """
        Extracts all unique stock symbols and company names from collection 'index_constituents'.
        STRICT REQUIREMENT: Extracts stock details only; does NOT attach or save any index details.
        Returns: { 'RELIANCE': 'Reliance Industries Ltd', ... }
        """
        stocks_map: Dict[str, str] = {}
        try:
            all_indices = db_store.load_index_constituents_db()
            if all_indices and isinstance(all_indices, dict):
                for idx_key, idx_doc in all_indices.items():
                    stocks_list = idx_doc.get("stocks", [])
                    for s in stocks_list:
                        if isinstance(s, dict):
                            sym = str(s.get("symbol", "")).strip().upper()
                            cname = str(s.get("company_name", "")).strip() or sym
                        else:
                            sym = str(s).strip().upper()
                            cname = sym
                        if sym and sym not in stocks_map:
                            stocks_map[sym] = cname
        except Exception as e:
            logger.warning(f"Error querying index_constituents: {e}")

        # Fallback to seed_index_stocks.json if database hasn't loaded indices yet
        if not stocks_map:
            seed_path = os.path.join(os.path.dirname(__file__), "..", "index_stocks", "seed_index_stocks.json")
            if os.path.exists(seed_path):
                try:
                    with open(seed_path, "r", encoding="utf-8") as f:
                        seed_data = json.load(f)
                    for idx_key, val in seed_data.items():
                        stocks_list = val.get("stocks", [])
                        for s in stocks_list:
                            if isinstance(s, dict):
                                sym = str(s.get("symbol", "")).strip().upper()
                                cname = str(s.get("company_name", "")).strip() or sym
                            else:
                                sym = str(s).strip().upper()
                                cname = sym
                            if sym and sym not in stocks_map:
                                stocks_map[sym] = cname
                except Exception as e:
                    logger.warning(f"Error reading seed_index_stocks.json: {e}")

        if stocks_map:
            self._total_stocks = len(stocks_map)
        return stocks_map

    def is_market_closed(self) -> Tuple[bool, str]:
        """
        Checks whether the Indian stock market (NSE/BSE) is closed.
        Daily EOD closing prices may only be taken / synced when the market is closed.
        Market hours: Monday to Friday, strictly 09:15 AM to 03:30 PM IST.
        """
        now = now_ist()
        # 1. Weekend check (Saturday = 5, Sunday = 6)
        if now.weekday() >= 5:
            day_name = "Saturday" if now.weekday() == 5 else "Sunday"
            return True, f"Market is CLOSED (Weekend - {day_name})."

        # 2. Official Trading Holiday check
        try:
            from modules.trading_holidays.trading_holidays_provider import trading_holidays_provider
            holiday_info = trading_holidays_provider.is_today_holiday()
            if holiday_info.get("is_holiday"):
                h_name = holiday_info.get("holiday_name", "Exchange Holiday")
                return True, f"Market is CLOSED today for {h_name}."
        except Exception as e:
            logger.debug(f"Holiday check exception: {e}")

        # 3. Market hours check (09:15 AM - 03:30 PM IST)
        if is_market_hours():
            return False, "Market is currently OPEN (Trading hours: 09:15 AM - 03:30 PM IST). Daily EOD closing prices can only be synced after market close (post 03:30 PM IST)."

        # 4. Pre-market or Post-market
        minutes = now.hour * 60 + now.minute
        if minutes < 555:
            return True, "Market is CLOSED (Pre-market hours before 09:15 AM IST)."
        return True, "Market is CLOSED (Post-market EOD hours after 03:30 PM IST)."

    def get_latest_market_trading_date(self) -> str:
        """
        Returns the latest completed market trading date (YYYY-MM-DD) in IST.
        - If today is a weekday post 03:30 PM IST and not a holiday, today is the latest trading date.
        - Otherwise returns the most recent past trading day (skipping weekends and trading holidays).
        """
        now = now_ist()
        today = now.date()
        minutes = now.hour * 60 + now.minute

        holidays_set = set()
        try:
            from modules.trading_holidays.trading_holidays_provider import trading_holidays_provider
            all_holidays = trading_holidays_provider.get_all_holidays(year=now.year)
            holidays_set = {h.get("date") for h in all_holidays if h.get("is_trading_holiday", 1)}
        except Exception:
            pass

        cand = today if (now.weekday() < 5 and minutes >= 930 and today.strftime("%Y-%m-%d") not in holidays_set) else (today - datetime.timedelta(days=1))

        for _ in range(15):
            d_str = cand.strftime("%Y-%m-%d")
            if cand.weekday() < 5 and d_str not in holidays_set:
                return d_str
            cand -= datetime.timedelta(days=1)
        return today.strftime("%Y-%m-%d")

    def get_sync_status(self) -> Dict[str, Any]:
        """Telemetry status for Admin Exchange Datasets & Feed Synchronization table."""
        market_closed, market_msg = self.is_market_closed()
        target_market_date = self.get_latest_market_trading_date()
        
        # Check current count from DB
        summary = db_store.load_stock_closing_prices_db(summary_only=True) or {}
        db_count = len(summary)
        
        # Calculate pending stocks count
        pending_count = 0
        latest_date = target_market_date or self._latest_trading_date
        best_synced_display = self._last_synced_display
        if summary:
            # find latest date present across stocks and latest synced timestamp
            for sym, rec in summary.items():
                d = rec.get("latest_date", "")
                if d and d > latest_date:
                    latest_date = d
                sd = rec.get("last_synced_display", "")
                if sd and sd != "Never" and (best_synced_display == "Never" or not best_synced_display):
                    best_synced_display = sd
            self._latest_trading_date = latest_date
            if best_synced_display and best_synced_display != "Never":
                self._last_synced_display = best_synced_display
            
            # Count stocks missing the target market trading date
            check_date = target_market_date or latest_date
            if check_date:
                pending_count = sum(1 for sym, rec in summary.items() if (rec.get("latest_date") or "") < check_date)

        return {
            "is_syncing": self._is_syncing,
            "progress": self._progress,
            "percent": self._percent,
            "total_stocks": db_count,
            "universe_size": self._total_stocks,
            "pending_count": pending_count,
            "start_date": START_DATE,
            "latest_trading_date": latest_date or "—",
            "last_synced_display": self._last_synced_display,
            "market_closed": market_closed,
            "market_status": "CLOSED" if market_closed else "OPEN",
            "market_message": market_msg,
            "can_sync": market_closed and not self._is_syncing
        }

    def start_background_sync(
        self,
        force: bool = False,
        full_resync: bool = False,
        on_init: bool = False
    ) -> Dict[str, Any]:
        """
        Starts asynchronous background synchronization of stock closing prices.
        Enforces 'take only when market closed' unless explicit administrative force is set.
        """
        market_closed, market_reason = self.is_market_closed()

        if not market_closed and not force:
            return {
                "success": False,
                "market_open": True,
                "message": f"Sync rejected: {market_reason}"
            }

        with self._lock:
            if self._is_syncing:
                return {
                    "success": False,
                    "is_syncing": True,
                    "message": "Stock closing prices synchronization is already running in background."
                }
            self._is_syncing = True
            self._percent = 0
            self._progress = "Initializing stock price sync..."

        thread = threading.Thread(
            target=self._run_sync,
            args=(force, full_resync, on_init),
            daemon=True
        )
        thread.start()

        return {
            "success": True,
            "message": "Stock closing prices synchronization started in background.",
            "market_status": "CLOSED" if market_closed else "OPEN (Forced)"
        }

    def _fetch_single_stock_history(
        self,
        symbol: str,
        company_name: str,
        existing_doc: Optional[Dict[str, Any]],
        full_resync: bool
    ) -> Optional[Dict[str, Any]]:
        """
        Fetches daily closing prices from Yahoo Finance for a single stock.
        - If existing document exists and not full_resync: fetches '5d' / '1mo' to append only pending dates.
        - If new or full_resync: fetches '2y' daily history (~500 candles).
        Maintains chronological sorting and caps history at a rolling 550 candles (~2.2 years).
        """
        sym_clean = symbol.strip().upper()
        # Encode symbol for URL (e.g. M&M.NS -> M%26M.NS)
        encoded_sym = urllib.parse.quote(sym_clean + ".NS")

        existing_prices = []
        latest_existing_date = ""
        if existing_doc and not full_resync:
            existing_prices = existing_doc.get("prices", [])
            latest_existing_date = existing_doc.get("latest_date", "")

        # Determine query parameters:
        # If stock already has historical data back to ~2012 (or >= 2500 bars), incremental fetch 5d or 1mo
        now_ts = int(time.time())
        if existing_prices and latest_existing_date and len(existing_prices) >= 2500:
            query_params = "interval=1d&range=5d&includePrePost=false"
        elif existing_prices and latest_existing_date and existing_doc.get("start_date", "") <= "2013-01-01":
            query_params = "interval=1d&range=1mo&includePrePost=false"
        else:
            # Full 2012 to present backfill
            # 1325376000 is 2012-01-01 00:00:00 UTC
            query_params = f"interval=1d&period1=1325376000&period2={now_ts}&includePrePost=false"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

        raw_res = None
        for host in hosts:
            url = f"https://{host}/v8/finance/chart/{encoded_sym}?{query_params}"
            try:
                r = requests.get(url, headers=headers, timeout=12)
                if r.status_code == 200:
                    data = r.json()
                    results = data.get("chart", {}).get("result")
                    if results and len(results) > 0:
                        raw_res = results[0]
                        break
            except Exception:
                continue

        if not raw_res:
            return None

        timestamps = raw_res.get("timestamp", []) or []
        indicators = raw_res.get("indicators", {})
        quote_list = indicators.get("quote", [{}])
        quote = quote_list[0] if (quote_list and isinstance(quote_list, list)) else {}
        closes = quote.get("close", []) or []

        fetched_bars = []
        for i, ts in enumerate(timestamps):
            if i >= len(closes):
                break
            c_val = closes[i]
            if c_val is not None:
                # Convert timestamp to YYYY-MM-DD in IST
                dt_ist = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
                d_str = dt_ist.strftime("%Y-%m-%d")
                fetched_bars.append({"d": d_str, "c": round(float(c_val), 2)})

        if not fetched_bars:
            return None

        # Merge fetched bars with existing prices (idempotent, deduplicated by date)
        # Strictly exclude any historical data prior to Jan 2012 (START_DATE)
        price_dict = {}
        for p in existing_prices:
            d = p.get("d", "")
            c = p.get("c")
            if d >= START_DATE and c is not None and float(c) > 0:
                price_dict[d] = round(float(c), 2)

        for b in fetched_bars:
            d = b.get("d", "")
            c = b.get("c")
            if d >= START_DATE and c is not None and float(c) > 0:
                price_dict[d] = round(float(c), 2)

        # Sort chronologically
        merged_dates = sorted(price_dict.keys())
        merged_prices = [{"d": d, "c": price_dict[d]} for d in merged_dates]

        if not merged_prices:
            return None

        start_date = merged_prices[0]["d"]
        latest_date = merged_prices[-1]["d"]
        latest_close = merged_prices[-1]["c"]
        prev_close = merged_prices[-2]["c"] if len(merged_prices) > 1 else latest_close
        change = round(latest_close - prev_close, 2)
        change_pct = round((change / prev_close * 100.0) if prev_close else 0.0, 2)
        now_display = format_ist_display()
        now_iso = now_ist().isoformat()

        # NOTE: Strictly stock metadata only; NO index details saved!
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

    def _run_sync(self, force: bool = False, full_resync: bool = False, on_init: bool = False):
        """Worker thread executing parallel stock fetching and batch database updates."""
        try:
            logger.info("Starting stock closing prices sync...")
            stocks_map = self.get_unique_index_stocks()
            if not stocks_map:
                with self._lock:
                    self._is_syncing = False
                    self._progress = "Sync error: No stocks found in index_constituents."
                return

            total_target = len(stocks_map)
            self._total_stocks = total_target

            # Load existing records (summary only for quick comparison)
            existing_summary = db_store.load_stock_closing_prices_db(summary_only=True) or {}
            target_market_date = self.get_latest_market_trading_date()

            # Prepare list of stocks to fetch
            if not full_resync:
                # Sync strictly ONLY pending stocks that do not have the latest market trading date
                stock_items = [
                    (sym, cname) for sym, cname in stocks_map.items()
                    if sym not in existing_summary or (existing_summary[sym].get("latest_date") or "") < target_market_date
                ]
                if not stock_items:
                    now_final = format_ist_display()
                    with self._lock:
                        self._is_syncing = False
                        self._percent = 100
                        self._last_synced_display = now_final
                        self._latest_trading_date = target_market_date
                        self._progress = f"All {len(existing_summary)} stocks are already up-to-date as of {target_market_date}. 0 pending dates to sync."
                    self._persist_telemetry()
                    logger.info(f"Sync check complete: 0 pending stocks. All stocks up-to-date as of {target_market_date}.")
                    return
                logger.info(f"Syncing pending dates for {len(stock_items)} stocks (Target date: {target_market_date})...")
            else:
                stock_items = list(stocks_map.items())

            total_target = len(stock_items)

            with self._lock:
                self._progress = f"Synchronizing pending dates for {total_target} stocks (Target: {target_market_date})..."
                self._percent = 5
            self._persist_telemetry()

            # We process in batches of 25 stocks with ThreadPoolExecutor
            batch_size = 25
            processed_count = 0
            success_count = 0
            latest_date_seen = ""

            for i in range(0, total_target, batch_size):
                chunk = stock_items[i : i + batch_size]
                chunk_records = []

                # Execute chunk in parallel
                with ThreadPoolExecutor(max_workers=10) as executor:
                    futures = {}
                    for sym, cname in chunk:
                        # If existing, fetch full doc only if we need to append
                        existing_doc = None
                        if sym in existing_summary and not full_resync:
                            existing_doc = db_store.load_stock_closing_prices_db(sym)

                        future = executor.submit(
                            self._fetch_single_stock_history,
                            sym,
                            cname,
                            existing_doc,
                            full_resync
                        )
                        futures[future] = sym

                    for future in as_completed(futures):
                        sym = futures[future]
                        try:
                            res = future.result()
                            if res:
                                chunk_records.append(res)
                                if res.get("latest_date", "") > latest_date_seen:
                                    latest_date_seen = res.get("latest_date", "")
                        except Exception as ex:
                            logger.debug(f"Error fetching {sym}: {ex}")

                # Save completed chunk batch to MongoDB and SQLite
                if chunk_records:
                    db_store.save_stock_closing_prices_db(chunk_records)
                    success_count += len(chunk_records)

                processed_count += len(chunk)
                pct = int((processed_count / total_target) * 90) + 5
                with self._lock:
                    self._percent = min(pct, 98)
                    self._synced_stocks_count = success_count
                    self._progress = f"Synced {processed_count}/{total_target} stocks ({success_count} updated)..."
                self._persist_telemetry()
                time.sleep(0.05)  # gentle pacing

            # Finalize
            now_final = format_ist_display()
            with self._lock:
                self._is_syncing = False
                self._percent = 100
                self._last_synced_display = now_final
                if latest_date_seen:
                    self._latest_trading_date = latest_date_seen
                self._progress = f"Successfully synced {success_count} stocks closing prices (Latest: {self._latest_trading_date})."

            self._persist_telemetry()
            logger.info(f"Completed stock closing prices sync: {success_count}/{total_target} stocks updated.")

        except Exception as e:
            logger.error(f"Error during stock closing prices sync: {e}", exc_info=True)
            with self._lock:
                self._is_syncing = False
                self._last_error = str(e)
                self._progress = f"Sync failed: {e}"
            self._persist_telemetry()

    def ensure_initialized(self):
        """
        Called on application initialization.
        Verifies existing stock closing prices dataset and loads telemetry.
        Automatic sync on boot is completely disabled — synchronization is purely manual
        via the Admin Settings "Sync Pending Closes" button.
        """
        try:
            summary = db_store.load_stock_closing_prices_db(summary_only=True)
            count = len(summary) if summary else 0
            logger.info(f"stock_closing_prices verified on init: {count} constituent stocks loaded in DB (Auto-sync disabled, manual sync only).")
        except Exception as e:
            logger.warning(f"Error in ensure_initialized: {e}")


# Singleton instance
stock_closing_prices_provider = StockClosingPricesProvider()

"""
Stock Closing Prices Provider for Capital Desk.
Manages daily EOD historical closing prices (from 2012-01-01 to Present) and incremental synchronization
for all 750 benchmark index constituent stocks (Nifty 50, Next 50, Midcap 150, Smallcap 250, Microcap 250).

Persistence:
- MongoDB Atlas collection: 'stock_closing_prices' (Pure MongoDB Atlas only; zero SQLite usage)
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

# Process start baseline dates: supports both Jan 2012 (01-01-2012) and Jan 2013 (01-01-2013).
DEFAULT_START_DATE = "2012-01-01"
START_DATE = "2012-01-01"
START_TIMESTAMP_2012 = 1325376000  # 2012-01-01 00:00:00 UTC
START_TIMESTAMP_2013 = 1356998400  # 2013-01-01 00:00:00 UTC


def compute_stock_monthly_prices(prices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Computes monthly average prices, close-to-close returns, and avg-to-avg returns
    from daily price series [{'d': 'YYYY-MM-DD', 'c': float}].
    Deduplicates and sorts daily prices first so duplicate daily bars or out-of-order rows
    cannot distort monthly averages, and returns one unique entry per month ('YYYY-MM')
    including the latest (even partial/ongoing) month.
    """
    clean_prices = db_store.normalize_and_deduplicate_prices(prices)
    if not clean_prices:
        return []

    months_dict: Dict[str, List[float]] = {}
    for p in clean_prices:
        d = p["d"]
        c_val = p["c"]
        m_key = d[:7]  # 'YYYY-MM'
        if m_key not in months_dict:
            months_dict[m_key] = []
        months_dict[m_key].append(c_val)

    sorted_months = sorted(months_dict.keys())
    monthly_prices = []
    prev_last_close = None
    prev_avg_close = None

    for m in sorted_months:
        closes = months_dict[m]
        avg_close = round(sum(closes) / len(closes), 2)
        first_close = round(closes[0], 2)
        last_close = round(closes[-1], 2)
        high = round(max(closes), 2)
        low = round(min(closes), 2)

        if prev_last_close is not None and prev_last_close > 0:
            return_pct = round(((last_close - prev_last_close) / prev_last_close) * 100.0, 2)
        else:
            return_pct = 0.0

        if prev_avg_close is not None and prev_avg_close > 0:
            avg_return_pct = round(((avg_close - prev_avg_close) / prev_avg_close) * 100.0, 2)
        else:
            avg_return_pct = 0.0

        monthly_prices.append({
            "m": m,
            "avg_close": avg_close,
            "return_pct": return_pct,
            "avg_return_pct": avg_return_pct,
            "first_close": first_close,
            "last_close": last_close,
            "high": high,
            "low": low,
            "count": len(closes)
        })

        prev_last_close = last_close
        prev_avg_close = avg_close

    return db_store.normalize_and_deduplicate_monthly_prices(monthly_prices)



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

    def _inspect_db_stock_states(self) -> Dict[str, Dict[str, Any]]:
        """
        Inspects each stock's actual latest price/date and duplicate status in MongoDB.
        Falls back to summary_only load if direct MongoDB aggregation is unavailable.
        """
        inspected = db_store.inspect_stock_closing_prices_latest_db()
        if inspected is not None:
            return inspected

        summary = db_store.load_stock_closing_prices_db(summary_only=True) or {}
        fallback: Dict[str, Dict[str, Any]] = {}
        for sym, rec in summary.items():
            clean_sym = str(rec.get("symbol") or sym or "").strip().upper()
            if not clean_sym:
                continue
            fallback[clean_sym] = {
                "symbol": clean_sym,
                "company_name": str(rec.get("company_name") or clean_sym).strip(),
                "start_date": str(rec.get("start_date") or "").strip()[:10],
                "latest_date": str(rec.get("latest_date") or "").strip()[:10],
                "latest_close": float(rec.get("latest_close") or 0.0),
                "total_records": int(rec.get("total_records") or 0),
                "unique_date_count": int(rec.get("total_records") or 0),
                "last_synced_display": str(rec.get("last_synced_display") or "Never"),
                "has_duplicates": False,
                "needs_repair": False,
            }
        return fallback

    def get_sync_status(self) -> Dict[str, Any]:
        """Telemetry status for Admin Exchange Datasets & Feed Synchronization table."""
        market_closed, market_msg = self.is_market_closed()
        target_market_date = self.get_latest_market_trading_date()
        
        # Inspect actual latest price/date per stock from DB
        summary = self._inspect_db_stock_states()
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
            
            # Count stocks missing latest completed trading date, empty prices, or needing duplicate repair
            check_date = target_market_date or latest_date
            if check_date:
                pending_count = sum(
                    1 for sym, rec in summary.items()
                    if (rec.get("latest_date") or "") < check_date
                    or int(rec.get("total_records") or 0) == 0
                    or bool(rec.get("needs_repair"))
                )
        if self._total_stocks > db_count:
            pending_count += (self._total_stocks - db_count)

        # Detect earliest historical date in DB
        min_start_date = "9999-99-99"
        if summary:
            for sym, rec in summary.items():
                s = rec.get("start_date", "")
                if s and s < min_start_date:
                    min_start_date = s
        if min_start_date == "9999-99-99":
            min_start_date = DEFAULT_START_DATE

        return {
            "is_syncing": self._is_syncing,
            "progress": self._progress,
            "percent": self._percent,
            "total_stocks": db_count,
            "universe_size": self._total_stocks,
            "pending_count": pending_count,
            "start_date": min_start_date,
            "latest_trading_date": latest_date or "—",
            "last_synced_display": self._last_synced_display,
            "market_closed": market_closed,
            "market_status": "CLOSED" if market_closed else "OPEN",
            "market_message": market_msg,
            "can_sync": market_closed and not self._is_syncing
        }

    def sync_monthly_averages_only(self) -> Dict[str, Any]:
        """
        Launches asynchronous background thread to recompute monthly average prices and monthly returns
        for all stocks stored in MongoDB Atlas, updating each document in-place.
        Returns immediately with HTTP 200 to prevent Gunicorn 30-second worker timeout on Render.
        """
        if db_store.db is None:
            return {"success": False, "error": "MongoDB Atlas is not connected."}
        
        with self._lock:
            if self._is_syncing:
                return {
                    "success": False,
                    "is_syncing": True,
                    "message": "Stock closing prices synchronization or monthly calculation is already running in background."
                }
            self._is_syncing = True
            self._percent = 0
            self._progress = "Starting monthly average prices & returns calculation in MongoDB..."

        self._persist_telemetry()

        thread = threading.Thread(
            target=self._run_monthly_sync,
            daemon=True
        )
        thread.start()

        return {
            "success": True,
            "message": "Monthly average prices and returns calculation started in background."
        }

    def _run_monthly_sync(self):
        """Worker thread executing streaming calculation of monthly average prices and updating MongoDB Atlas."""
        try:
            col = db_store.db["stock_closing_prices"]
            total_stocks = col.count_documents({})
            if total_stocks == 0:
                with self._lock:
                    self._is_syncing = False
                    self._progress = "No stocks found in stock_closing_prices collection."
                self._persist_telemetry()
                return

            logger.info(f"Computing monthly averages & returns for {total_stocks} stocks in MongoDB (overwriting through last month, zero duplicates)...")
            from pymongo import UpdateOne
            batch_size = 25
            updated_count = 0

            # Snapshot sorted document IDs up front to avoid cursor timeouts or skipped docs on concurrent updates
            doc_ids = sorted(
                doc["_id"] for doc in col.find({}, {"_id": 1}) if doc.get("_id") is not None
            )
            total_stocks = len(doc_ids)

            for i in range(0, total_stocks, batch_size):
                chunk_ids = doc_ids[i : i + batch_size]
                chunk_docs = list(col.find(
                    {"_id": {"$in": chunk_ids}},
                    {"_id": 1, "symbol": 1, "prices": 1, "latest_date": 1, "latest_close": 1, "total_records": 1}
                ))
                ops = []
                for d in chunk_docs:
                    sym = d.get("_id") or d.get("symbol")
                    raw_prices = d.get("prices") or []
                    prices = db_store.normalize_and_deduplicate_prices(raw_prices)
                    monthly_prices = compute_stock_monthly_prices(prices)
                    set_doc: Dict[str, Any] = {"monthly_prices": monthly_prices}

                    # Also heal duplicate/unsorted daily prices or stale summary fields if present
                    needs_price_repair = len(prices) != len(raw_prices)
                    if not needs_price_repair and prices:
                        needs_price_repair = any(
                            (str(p.get("d", "")).strip()[:10] != cp["d"] or round(float(p["c"]), 2) != cp["c"])
                            for p, cp in zip(raw_prices, prices)
                        )
                    if needs_price_repair or (prices and (
                        str(d.get("latest_date") or "").strip()[:10] != prices[-1]["d"]
                        or int(d.get("total_records") or 0) != len(prices)
                    )):
                        l_close = prices[-1]["c"] if prices else 0.0
                        p_close = prices[-2]["c"] if len(prices) > 1 else l_close
                        chg = round(l_close - p_close, 2)
                        chg_pct = round((chg / p_close * 100.0) if p_close else 0.0, 2)
                        set_doc.update({
                            "prices": prices,
                            "start_date": prices[0]["d"] if prices else "",
                            "latest_date": prices[-1]["d"] if prices else "",
                            "latest_close": l_close,
                            "prev_close": p_close,
                            "change": chg,
                            "change_pct": chg_pct,
                            "total_records": len(prices)
                        })

                    ops.append(UpdateOne(
                        {"_id": sym},
                        {"$set": set_doc}
                    ))

                if ops:
                    col.bulk_write(ops, ordered=False)
                    updated_count += len(ops)
                    with self._lock:
                        self._percent = int((updated_count / total_stocks) * 100) if total_stocks else 100
                        self._synced_stocks_count = updated_count
                        self._progress = f"Calculated & overwritten monthly averages for {updated_count}/{total_stocks} stocks..."
                    self._persist_telemetry()

            now_disp = format_ist_display()
            logger.info(f"Successfully updated monthly averages for {updated_count}/{total_stocks} stocks in MongoDB Atlas.")

            with self._lock:
                self._is_syncing = False
                self._last_error = None
                self._percent = 100
                self._progress = f"Monthly average prices & returns overwritten (including last month) for all {updated_count} stocks."
                self._last_synced_display = now_disp
            self._persist_telemetry()

            # Telemetry update in MongoDB Atlas
            try:
                db_store.db["stock_closing_prices_telemetry"].update_one(
                    {"_id": "global_telemetry"},
                    {"$set": {
                        "monthly_averages_synced": True,
                        "monthly_averages_updated_at": format_ist_iso(),
                        "progress": f"Monthly average prices & returns overwritten (including last month) for all {updated_count} stocks."
                    }},
                    upsert=True
                )
            except Exception:
                pass

            try:
                from modules.momentum_smallcases.index_comparator import clear_comparison_cache
                clear_comparison_cache()
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Error computing monthly averages: {e}", exc_info=True)
            with self._lock:
                self._is_syncing = False
                self._last_error = str(e)
                self._progress = f"Error computing monthly averages: {str(e)}"
            self._persist_telemetry()

    def start_background_sync(
        self,
        force: bool = False,
        full_resync: bool = False,
        start_date: str = "2012-01-01",
        on_init: bool = False
    ) -> Dict[str, Any]:
        """
        Starts asynchronous background synchronization of stock closing prices.
        Enforces 'take only when market closed' unless explicit administrative force is set.
        Supports full resync starting from 2012-01-01 or 2013-01-01.
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
            self._progress = f"Initializing stock price sync ({'Full from ' + start_date if full_resync else 'Pending closes'})..."

        thread = threading.Thread(
            target=self._run_sync,
            args=(force, full_resync, start_date, on_init),
            daemon=True
        )
        thread.start()

        return {
            "success": True,
            "message": f"Stock closing prices synchronization started in background ({'Full from ' + start_date if full_resync else 'Pending closes'}).",
            "market_status": "CLOSED" if market_closed else "OPEN (Forced)"
        }

    def _build_stock_closing_record(
        self,
        symbol: str,
        company_name: str,
        merged_prices: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """Builds a normalized, duplicate-free stock closing price document with monthly metrics."""
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

        monthly_prices = compute_stock_monthly_prices(merged_prices)

        # NOTE: Strictly stock metadata only; NO index details saved!
        return {
            "symbol": symbol,
            "company_name": company_name,
            "start_date": start_date,
            "latest_date": latest_date,
            "latest_close": latest_close,
            "prev_close": prev_close,
            "change": change,
            "change_pct": change_pct,
            "total_records": len(merged_prices),
            "prices": merged_prices,
            "monthly_prices": monthly_prices,
            "last_synced": now_iso,
            "last_synced_display": now_display
        }

    def _fetch_single_stock_history(
        self,
        symbol: str,
        company_name: str,
        existing_doc: Optional[Dict[str, Any]],
        full_resync: bool,
        target_market_date: str = "",
        start_date: str = "2012-01-01",
        force: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Fetches daily closing prices from Yahoo Finance for a single stock.
        - Incremental sync: inspects the stock's actual latest price/date in DB, deduplicates any
          pre-existing anomalies, and fetches only remaining dates strictly after that date.
        - Full resync: fetches complete historical daily prices from start_date to Present.
        Maintains chronological sorting with strictly zero duplicate dates.
        """
        sym_clean = symbol.strip().upper()
        tz_ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        now_dt = now_ist()
        now_ts = int(time.time())
        today_ist_str = now_dt.strftime("%Y-%m-%d")
        effective_start = start_date or DEFAULT_START_DATE
        max_allowed_date = today_ist_str if force else (target_market_date or today_ist_str)

        clean_existing: List[Dict[str, Any]] = []
        actual_latest_date = ""
        existing_needs_repair = False

        if existing_doc and not full_resync:
            raw_existing = existing_doc.get("prices") or []
            clean_existing = db_store.normalize_and_deduplicate_prices(raw_existing)
            if len(clean_existing) != len(raw_existing):
                existing_needs_repair = True
            elif any(
                (str(p.get("d", "")).strip()[:10] != cp["d"] or round(float(p["c"]), 2) != cp["c"])
                for p, cp in zip(raw_existing, clean_existing)
            ):
                existing_needs_repair = True

            if clean_existing:
                actual_latest_date = clean_existing[-1]["d"]
                actual_latest_close = clean_existing[-1]["c"]
                doc_latest_date = str(existing_doc.get("latest_date") or "").strip()[:10]
                doc_total = int(existing_doc.get("total_records") or 0)
                try:
                    doc_latest_close = round(float(existing_doc.get("latest_close") or 0.0), 2)
                except (TypeError, ValueError):
                    doc_latest_close = 0.0
                if (
                    doc_latest_date != actual_latest_date
                    or doc_total != len(clean_existing)
                    or doc_latest_close != actual_latest_close
                ):
                    existing_needs_repair = True

        try:
            s_dt = datetime.datetime.strptime(effective_start, "%Y-%m-%d").date()
            start_ts = int(datetime.datetime(s_dt.year, s_dt.month, s_dt.day, 0, 0, 0, tzinfo=tz_ist).timestamp())
        except Exception:
            start_ts = START_TIMESTAMP_2012

        # Determine query window strictly after this stock's actual latest price/date
        if clean_existing and actual_latest_date and not full_resync:
            if max_allowed_date and actual_latest_date >= max_allowed_date:
                return self._build_stock_closing_record(sym_clean, company_name, clean_existing) if existing_needs_repair else None
            try:
                last_dt = datetime.datetime.strptime(actual_latest_date, "%Y-%m-%d").date()
                next_dt = last_dt + datetime.timedelta(days=1)
                dt_next_ist = datetime.datetime(next_dt.year, next_dt.month, next_dt.day, 0, 0, 0, tzinfo=tz_ist)
                period1 = int(dt_next_ist.timestamp())

                if period1 >= now_ts:
                    return self._build_stock_closing_record(sym_clean, company_name, clean_existing) if existing_needs_repair else None

                query_params = f"interval=1d&period1={period1}&period2={now_ts}&includePrePost=false"
            except Exception as e:
                logger.warning(f"Error calculating next date for {sym_clean}: {e}")
                query_params = "interval=1d&range=5d&includePrePost=false"
        else:
            # Full backfill from start_date (e.g. 2012-01-01 or 2013-01-01)
            query_params = f"interval=1d&period1={start_ts}&period2={now_ts}&includePrePost=false"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
        suffixes = [".NS", ".BO"]

        raw_res = None
        for suffix in suffixes:
            encoded_sym = urllib.parse.quote(sym_clean + suffix)
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
            if raw_res:
                break

        if not raw_res:
            return self._build_stock_closing_record(sym_clean, company_name, clean_existing) if (existing_needs_repair and clean_existing and not full_resync) else None

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
                try:
                    c_float = float(c_val)
                    if c_float > 0:
                        dt_ist = datetime.datetime.fromtimestamp(ts, tz=tz_ist)
                        d_str = dt_ist.strftime("%Y-%m-%d")
                        if max_allowed_date and d_str > max_allowed_date:
                            continue
                        if not full_resync and actual_latest_date:
                            # Strictly sync remaining dates only; never duplicate or overwrite already stored dates
                            if d_str <= actual_latest_date:
                                continue
                        elif d_str < effective_start:
                            continue
                        fetched_bars.append({"d": d_str, "c": round(c_float, 2)})
                except (ValueError, TypeError):
                    continue

        clean_fetched = db_store.normalize_and_deduplicate_prices(fetched_bars)
        if not clean_fetched:
            return self._build_stock_closing_record(sym_clean, company_name, clean_existing) if (existing_needs_repair and clean_existing and not full_resync) else None

        if full_resync or not clean_existing:
            merged_prices = clean_fetched
        else:
            merged_prices = db_store.normalize_and_deduplicate_prices(clean_existing + clean_fetched)
            if not existing_needs_repair and len(merged_prices) == len(clean_existing):
                return None

        return self._build_stock_closing_record(sym_clean, company_name, merged_prices)

    def _run_sync(
        self,
        force: bool = False,
        full_resync: bool = False,
        start_date: str = "2012-01-01",
        on_init: bool = False
    ):
        """Worker thread executing parallel stock fetching and batch database updates."""
        try:
            logger.info(f"Starting stock closing prices sync (full_resync={full_resync}, start_date={start_date})...")
            stocks_map = self.get_unique_index_stocks()
            if not stocks_map:
                with self._lock:
                    self._is_syncing = False
                    self._progress = "Sync error: No stocks found in index_constituents."
                return

            total_target = len(stocks_map)
            self._total_stocks = total_target

            # Inspect each stock's actual latest price/date and duplicate status in DB
            existing_state = self._inspect_db_stock_states()
            target_market_date = self.get_latest_market_trading_date()
            check_date = now_ist().strftime("%Y-%m-%d") if force else target_market_date

            # Prepare list of stocks to fetch/repair
            if not full_resync:
                # Sync stocks missing from DB, missing latest closing dates, empty prices, or needing duplicate cleanup
                stock_items = [
                    (sym, cname) for sym, cname in stocks_map.items()
                    if sym not in existing_state
                    or (existing_state[sym].get("latest_date") or "") < check_date
                    or int(existing_state[sym].get("total_records") or 0) == 0
                    or bool(existing_state[sym].get("needs_repair"))
                ]
                if not stock_items:
                    now_final = format_ist_display()
                    with self._lock:
                        self._is_syncing = False
                        self._percent = 100
                        self._last_synced_display = now_final
                        self._latest_trading_date = target_market_date
                        self._progress = f"All {len(existing_state)} stocks are already up-to-date as of {target_market_date}. 0 pending dates to sync."
                    self._persist_telemetry()
                    logger.info(f"Sync check complete: 0 pending stocks. All stocks up-to-date as of {target_market_date}.")
                    return
                logger.info(f"Syncing remaining dates / cleanup for {len(stock_items)} stocks (Target date: {check_date})...")
            else:
                stock_items = list(stocks_map.items())

            total_target = len(stock_items)

            with self._lock:
                if full_resync:
                    self._progress = f"Full resynchronization from {start_date} for {total_target} stocks..."
                else:
                    self._progress = f"Checking latest prices & syncing remaining dates for {total_target} stocks (Target: {check_date})..."
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
                        # If existing, fetch full doc only if we need to append or repair duplicates
                        existing_doc = None
                        if sym in existing_state and not full_resync:
                            existing_doc = db_store.load_stock_closing_prices_db(sym)

                        future = executor.submit(
                            self._fetch_single_stock_history,
                            sym,
                            cname,
                            existing_doc,
                            full_resync,
                            target_market_date,
                            start_date,
                            force
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

                # Save completed chunk batch to MongoDB Atlas
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

            # Flush comparison cache so newly synced prices are immediately reflected
            try:
                from modules.momentum_smallcases.index_comparator import clear_comparison_cache
                clear_comparison_cache()
            except Exception:
                pass

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

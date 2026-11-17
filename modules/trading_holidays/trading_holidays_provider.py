"""
Trading Holidays Provider for Capital Desk.
Stores and synchronizes official NSE & BSE trading holidays for the last 10 years (2017 - 2026).
Supports dual persistence: MongoDB Atlas + SQLite via db_store.py.
Live ingestion from official NSE holiday-master feed.
"""

import os
import json
import time
import datetime
import logging
import threading
from typing import Dict, Any, List, Optional
import requests

from modules.common.ist_datetime import now_ist, format_ist_display, today_ist_str
from modules.common.data_paths import APP_DATA_DIR
import db_store

logger = logging.getLogger("trading_holidays")

SEED_FILE_PATH = os.path.join(os.path.dirname(__file__), "seed_trading_holidays.json")
TELEMETRY_FILE_PATH = os.path.join(APP_DATA_DIR, "trading_holidays_telemetry.json")

NSE_HOLIDAY_API = "https://www.nseindia.com/api/holiday-master?type=trading"
NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/"
}


class TradingHolidaysProvider:
    def __init__(self):
        self._lock = threading.Lock()
        self._is_syncing: bool = False
        self._progress: str = ""
        self._percent: int = 0
        self._error: Optional[str] = None
        self._last_result: Optional[Dict[str, Any]] = None
        self._last_synced_display: str = "Never"

        # Load persisted telemetry if available
        if os.path.exists(TELEMETRY_FILE_PATH):
            try:
                with open(TELEMETRY_FILE_PATH, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                    self._last_result = cached.get("last_result")
                    self._last_synced_display = cached.get("last_synced_display", "Never")
            except Exception:
                pass

        # Pre-seed DB with 10-year official holiday history if empty
        self._ensure_initial_db_seed()

    def _ensure_initial_db_seed(self):
        """Populates database with 10-year official holidays (2017-2026) if missing."""
        try:
            existing = db_store.load_trading_holidays_db()
            if not existing or len(existing) < 150:
                if os.path.exists(SEED_FILE_PATH):
                    with open(SEED_FILE_PATH, "r", encoding="utf-8") as f:
                        seed_data = json.load(f)
                    now_display = format_ist_display(datetime.datetime.now(datetime.timezone.utc).isoformat())
                    db_store.save_trading_holidays_db(seed_data, last_synced_display=now_display)
                    logger.info(f"Seeded {len(seed_data)} official trading holidays across 10 years (2017-2026) into DB.")
        except Exception as e:
            logger.warning(f"Error ensuring trading holidays DB seed: {e}")

    def get_all_holidays(self, year: Optional[int] = None) -> List[Dict[str, Any]]:
        """Returns list of official trading holidays sorted chronologically."""
        return db_store.load_trading_holidays_db(year=year) or []

    def get_next_holiday(self) -> Optional[Dict[str, Any]]:
        """Finds the next upcoming trading holiday from today IST."""
        today = today_ist_str()
        current_year = int(today[:4])
        holidays = self.get_all_holidays(year=current_year)
        # Also check next year if near end of year
        if not holidays or today > holidays[-1]["date"]:
            holidays = holidays + self.get_all_holidays(year=current_year + 1)

        for h in holidays:
            if h.get("date") >= today and h.get("is_trading_holiday", True):
                return h
        return None

    def is_today_holiday(self) -> Dict[str, Any]:
        """Checks whether today is an exchange trading holiday or weekend."""
        today = today_ist_str()
        now = datetime.datetime.now(datetime.timezone.utc)
        # Convert to IST weekday
        ist_weekday = (now + datetime.timedelta(hours=5, minutes=30)).weekday()
        if ist_weekday == 5:
            return {"is_holiday": True, "reason": "Saturday (Weekend)", "holiday": None}
        if ist_weekday == 6:
            return {"is_holiday": True, "reason": "Sunday (Weekend)", "holiday": None}

        current_year = int(today[:4])
        holidays = self.get_all_holidays(year=current_year)
        for h in holidays:
            if h.get("date") == today and h.get("is_trading_holiday", True):
                return {"is_holiday": True, "reason": h.get("holiday_name"), "holiday": h}

        return {"is_holiday": False, "reason": "Normal Trading Day", "holiday": None}

    def get_sync_status(self) -> Dict[str, Any]:
        """Telemetry status for Admin Exchange Datasets & Feed Synchronization table."""
        telemetry = db_store.get_trading_holidays_telemetry_db()
        next_h = self.get_next_holiday()

        last_sync = self._last_synced_display
        if last_sync == "Never" and telemetry.get("last_updated_display") != "Never":
            last_sync = telemetry.get("last_updated_display")

        return {
            "is_syncing": self._is_syncing,
            "progress": self._progress,
            "percent": self._percent,
            "error": self._error,
            "last_result": self._last_result,
            "total_holidays": telemetry["total_holidays"],
            "years": telemetry["years"],
            "counts_by_year": telemetry["counts_by_year"],
            "current_year": telemetry["current_year"],
            "current_year_count": telemetry["current_year_count"],
            "has_current_year": telemetry["has_current_year"],
            "last_synced_display": last_sync,
            "next_holiday": next_h
        }

    def start_background_sync(self, only_if_not_exists: bool = False, force: bool = False) -> Dict[str, Any]:
        """Triggers background sync for current year trading holidays."""
        with self._lock:
            if self._is_syncing:
                return {"success": False, "message": "Trading holiday sync is already in progress."}

            telemetry = db_store.get_trading_holidays_telemetry_db()
            curr_year = telemetry["current_year"]
            curr_count = telemetry["current_year_count"]

            # If only_if_not_exists is True and already exists and not force, short circuit
            if only_if_not_exists and not force and curr_count > 0:
                return {
                    "success": True,
                    "already_exists": True,
                    "message": f"Trading holidays for current year ({curr_year}) already exist ({curr_count} holidays in DB). Skipped sync.",
                    "count": curr_count,
                    "current_year": curr_year
                }

            self._is_syncing = True
            self._progress = f"Connecting to official NSE holiday calendar for current year {curr_year}..."
            self._percent = 10
            self._error = None

        thread = threading.Thread(target=self._run_sync, args=(curr_year, force), daemon=True)
        thread.start()
        return {"success": True, "message": f"Trading holiday synchronization for current year ({curr_year}) started."}

    def _run_sync(self, year: int, force: bool = False):
        start_time = time.time()
        try:
            with self._lock:
                self._percent = 30
                self._progress = f"Fetching official Capital Market (CM) holiday circulars from NSE for {year}..."

            holidays, err = self._fetch_live_nse_holidays(year)
            if err:
                raise Exception(err)

            with self._lock:
                self._percent = 70
                self._progress = f"Parsed {len(holidays)} official holidays for {year}. Persisting to MongoDB & SQLite..."

            # Save to DB
            now_display = format_ist_display(datetime.datetime.now(datetime.timezone.utc).isoformat())
            res = db_store.save_trading_holidays_db(holidays, year=year, last_synced_display=now_display)

            duration = round(time.time() - start_time, 2)
            self._last_synced_display = now_display

            with self._lock:
                self._percent = 100
                self._progress = f"Successfully synchronized {len(holidays)} official holidays for {year}."
                self._last_result = {
                    "success": True,
                    "year": year,
                    "holidays_count": len(holidays),
                    "duration_seconds": duration,
                    "holidays": [
                        {
                            "date": h["date"],
                            "holiday_name": h["holiday_name"],
                            "day": h["day"],
                            "notes": h.get("notes", "")
                        } for h in holidays
                    ]
                }
                self._is_syncing = False

            # Persist telemetry cache
            try:
                with open(TELEMETRY_FILE_PATH, "w", encoding="utf-8") as f:
                    json.dump({
                        "last_result": self._last_result,
                        "last_synced_display": now_display
                    }, f, indent=2)
            except Exception as pe:
                logger.warning(f"Failed to persist holiday telemetry: {pe}")

        except Exception as e:
            logger.error(f"Error during trading holiday sync: {e}", exc_info=True)
            with self._lock:
                self._is_syncing = False
                self._error = str(e)
                self._progress = f"Holiday sync failed: {e}"

    def _fetch_live_nse_holidays(self, target_year: int) -> (List[Dict[str, Any]], Optional[str]):
        """Fetches and parses live CM trading holidays from official NSE holiday API."""
        try:
            s = requests.Session()
            # Visit homepage for session cookie
            s.get("https://www.nseindia.com", headers=NSE_HEADERS, timeout=6)
            r = s.get(NSE_HOLIDAY_API, headers=NSE_HEADERS, timeout=8)

            if r.status_code == 200:
                data = r.json()
                cm_list = data.get("CM", [])
                parsed = []
                for item in cm_list:
                    raw_date = str(item.get("tradingDate", "")).strip()
                    weekday = str(item.get("weekDay", "")).strip()
                    desc = str(item.get("description", "")).strip()
                    m_sess = item.get("morning_session")
                    e_sess = item.get("evening_session")

                    # Parse date e.g. 26-Jan-2026 -> 2026-01-26
                    iso_date = ""
                    item_year = target_year
                    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d"):
                        try:
                            dt = datetime.datetime.strptime(raw_date, fmt)
                            iso_date = dt.strftime("%Y-%m-%d")
                            item_year = dt.year
                            break
                        except ValueError:
                            continue

                    if not iso_date:
                        continue

                    # Filter for target year if specified
                    if target_year and item_year != target_year:
                        continue

                    notes = ""
                    if "Diwali" in desc or "Muhurat" in desc or "Laxmi Pujan" in desc:
                        notes = "Muhurat Trading conducted in evening (exact timing notified by exchange)"
                    elif "Election" in desc:
                        notes = "Special official state/general election voting holiday"

                    hid = f"{iso_date}_{desc.upper().replace(' ', '_').replace('*', '').replace('/', '_')}"
                    parsed.append({
                        "holiday_id": hid,
                        "date": iso_date,
                        "year": item_year,
                        "holiday_name": desc,
                        "day": weekday,
                        "exchange": "NSE, BSE",
                        "segment": "Capital Market (Equities)",
                        "is_trading_holiday": True,
                        "is_clearing_holiday": False if "Muhurat Trading" in notes else True,
                        "morning_session": m_sess,
                        "evening_session": e_sess,
                        "notes": notes
                    })

                if parsed:
                    return parsed, None

            logger.warning(f"NSE live holiday API returned status {r.status_code}, falling back to seed data.")
        except Exception as e:
            logger.warning(f"Live fetch error from NSE holiday API: {e}, using seed data.")

        # Fallback to seed data for target year
        if os.path.exists(SEED_FILE_PATH):
            try:
                with open(SEED_FILE_PATH, "r", encoding="utf-8") as f:
                    all_seed = json.load(f)
                filtered = [h for h in all_seed if h.get("year") == target_year]
                if filtered:
                    return filtered, None
            except Exception as se:
                return [], f"Failed to load seed holiday data: {se}"

        return [], "No holiday data found for specified year."


# Global Singleton Provider Instance
trading_holidays_provider = TradingHolidaysProvider()

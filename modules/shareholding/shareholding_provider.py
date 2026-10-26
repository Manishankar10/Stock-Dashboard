"""Shareholding Patterns Provider
Collects and serves official quarterly shareholding pattern disclosures from NSE and BSE.
Extracts Promoter %, FII %, DII %, and Public % across current and previous quarters.
Calculates QoQ % changes for every category and allows sorting on all percentages.
Data is stored locally in `app_data/shareholding_patterns.json`.
Strictly fetches on manual user refresh with a 15-minute rate-limit window.
Cuts and stops parser immediately when existing records are reached.
"""

from __future__ import annotations

import ast
import hashlib
import collections
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import logging
import os
from pathlib import Path
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple
import xml.etree.ElementTree as ET

import requests
from modules.common.ist_datetime import format_ist_display, now_ist

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 900  # 15 minutes rate-limit interval
NSE_HOME = "https://www.nseindia.com"
NSE_MASTER_BASE = "https://www.nseindia.com/api/corporate-share-holdings-master"
NSE_MASTER_EQ = f"{NSE_MASTER_BASE}?index=equities"
NSE_MASTER_SME = f"{NSE_MASTER_BASE}?index=sme"

MONTH_MAP_NAME_TO_NUM = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def parse_quarter_date(date_val: Optional[str]) -> Optional[Tuple[int, int]]:
    """Parse Indian quarter-end date string into (year, month).
    Supports formats like '30-SEP-2026', '30-09-2026', '2026-09-30'.
    """
    if not date_val:
        return None
    s = str(date_val).strip().upper()
    # DD-MON-YYYY or DD-MM-YYYY
    m = re.match(r"^(\d{1,2})[-/]([A-Z]{3}|\d{1,2})[-/](\d{4})$", s)
    if m:
        mon_str = m.group(2)
        year = int(m.group(3))
        mon = MONTH_MAP_NAME_TO_NUM.get(mon_str, int(mon_str) if mon_str.isdigit() else 0)
        if 1 <= mon <= 12:
            return year, mon
    # YYYY-MM-DD
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", s)
    if m:
        year = int(m.group(1))
        mon = int(m.group(2))
        if 1 <= mon <= 12:
            return year, mon
    return None


def get_dynamic_quarter_windows(quarter_date_val: Optional[str] = None) -> Dict[str, str]:
    """Dynamically determine the current reporting quarter, comparative previous quarter,
    and exact filing submission window (from_date, to_date) to query the NSE API without hardcoded dates.

    Under SEBI LODR Regulation 31, listed companies file shareholding patterns within 21 days
    of quarter end. Filings for any quarter occur in the month immediately following the quarter end:
      - Q1 (30-JUN): Filings submitted 01-JUN through 15-08
      - Q2 (30-SEP): Filings submitted 01-09 through 15-11
      - Q3 (31-DEC): Filings submitted 01-12 through 15-02 (next yr)
      - Q4 (31-MAR): Filings submitted 01-03 through 15-05
    """
    parsed = parse_quarter_date(quarter_date_val) if quarter_date_val else None
    if parsed:
        year, mon = parsed
    else:
        # Fallback to current calendar date
        now = datetime.now()
        cur_m, cur_y = now.month, now.year
        if cur_m in (10, 11, 12):
            year, mon = cur_y, 9
        elif cur_m in (1, 2, 3):
            year, mon = cur_y - 1, 12
        elif cur_m in (4, 5, 6):
            year, mon = cur_y, 3
        else:
            year, mon = cur_y, 6

    # Determine quarter bucket
    if mon in (7, 8, 9):
        curr_q = f"30-SEP-{year}"
        prev_q = f"30-JUN-{year}"
        prev_from = f"01-06-{year}"
        prev_to = f"15-08-{year}"
        label = f"Sep {str(year)[-2:]} vs Jun {str(year)[-2:]}"
    elif mon in (10, 11, 12):
        curr_q = f"31-DEC-{year}"
        prev_q = f"30-SEP-{year}"
        prev_from = f"01-09-{year}"
        prev_to = f"15-11-{year}"
        label = f"Dec {str(year)[-2:]} vs Sep {str(year)[-2:]}"
    elif mon in (1, 2, 3):
        curr_q = f"31-MAR-{year}"
        prev_q = f"31-DEC-{year - 1}"
        prev_from = f"01-12-{year - 1}"
        prev_to = f"15-02-{year}"
        label = f"Mar {str(year)[-2:]} vs Dec {str(year - 1)[-2:]}"
    else:  # 4, 5, 6
        curr_q = f"30-JUN-{year}"
        prev_q = f"31-MAR-{year}"
        prev_from = f"01-03-{year}"
        prev_to = f"15-05-{year}"
        label = f"Jun {str(year)[-2:]} vs Mar {str(year)[-2:]}"

    eq_prev_url = f"{NSE_MASTER_BASE}?index=equities&from_date={prev_from}&to_date={prev_to}"
    sme_prev_url = f"{NSE_MASTER_BASE}?index=sme&from_date={prev_from}&to_date={prev_to}"

    return {
        "curr_quarter": curr_q,
        "prev_quarter": prev_q,
        "prev_from_date": prev_from,
        "prev_to_date": prev_to,
        "eq_prev_url": eq_prev_url,
        "sme_prev_url": sme_prev_url,
        "comparison_label": label,
    }

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern",
}


def clean_symbol(sym: Optional[str]) -> str:
    """Normalize Indian stock tickers (removes .NS, .BO, whitespace)."""
    if not sym:
        return ""
    return re.sub(r"\.(?:NS|BO|NSE|BSE)$", "", str(sym).strip(), flags=re.IGNORECASE).upper()


def parse_float(val: Any) -> Optional[float]:
    """Parse numeric float from strings."""
    if val is None or val == "" or val == "-":
        return None
    try:
        cleaned = str(val).replace(",", "").replace("%", "").strip()
        return float(cleaned)
    except Exception:
        return None


def parse_date_to_timestamp(date_str: Any) -> int:
    """Parse exchange date string to unix timestamp for sorting."""
    if not date_str:
        return 0
    s = str(date_str).strip()
    for fmt in (
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M",
        "%d-%b-%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return int(datetime.strptime(s, fmt).timestamp())
        except ValueError:
            continue
    return 0


def parse_xbrl_content(xml_bytes: bytes) -> Dict[str, float]:
    """Extract Promoter %, FII %, DII %, and Public % from official NSE XBRL XML."""
    if not xml_bytes:
        return {}
    try:
        root = ET.fromstring(xml_bytes)
        res = {}
        for elem in root.iter():
            ctx = elem.attrib.get("contextRef", "")
            if "ContextI" in ctx and "ShareholdingAsAPercentageOfTotalNumberOfShares" in elem.tag:
                try:
                    val = round(float(elem.text) * 100.0, 2)
                except Exception:
                    continue
                if ctx == "ShareholdingOfPromoterAndPromoterGroup_ContextI":
                    res["promoter"] = val
                elif ctx == "InstitutionsForeign_ContextI":
                    res["fii"] = val
                elif ctx == "InstitutionsDomestic_ContextI":
                    res["dii"] = val
                elif ctx == "NonInstitutions_ContextI":
                    res["public"] = val
                elif ctx == "PublicShareholding_ContextI":
                    res["total_public"] = val
        return res
    except Exception:
        return {}


def _parse_nse_json_safely(res: Optional[requests.Response]) -> List[Dict[str, Any]]:
    if res is None or res.status_code != 200:
        return []
    try:
        text = res.text.strip()
        if text.startswith("<") or text.startswith("<!DOCTYPE") or "<html" in text.lower()[:120]:
            logger.warning(f"NSE returned HTML (status {res.status_code}) instead of JSON: {text[:150]}")
            return []
        data = res.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            if "data" in data and isinstance(data["data"], list):
                return data["data"]
            return [data]
    except Exception as e:
        logger.warning(f"Error parsing JSON from NSE (status {res.status_code}): {e}")
    return []


class ShareholdingProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = Path(data_dir).resolve()
        self.app_data_dir = self.data_dir / "app_data"
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        self.json_file = self.app_data_dir / "shareholding_patterns.json"

        # Dedicated temporary & staging folder for resilient batch downloads
        self.temp_dir = self.app_data_dir / "temp_shareholding"
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.xbrl_cache_dir = self.temp_dir / "xbrl_cache"
        self.xbrl_cache_dir.mkdir(parents=True, exist_ok=True)
        self.batches_dir = self.temp_dir / "batches"
        self.batches_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._cache_records: List[Dict[str, Any]] = []
        self._last_synced: float = 0
        self._last_synced_display: str = ""
        self._is_refreshing: bool = False
        self._refresh_progress: str = ""
        self._refresh_percent: int = 0
        self._processed_count: int = 0
        self._total_to_process: int = 0
        self._current_batch: int = 0
        self._total_batches: int = 0
        self._refresh_error: Optional[str] = None
        self._last_refresh_result: Optional[Dict[str, Any]] = None

        # Load initial records from DB or disk if present
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        """Load stored shareholding patterns from DB (MongoDB/SQLite) or fallback JSON."""
        # 1. Try DB first (MongoDB Atlas & SQLite via db_store)
        try:
            import db_store
            db_res = db_store.load_shareholding_patterns_db(fallback_filepath=self.json_file)
            if db_res and db_res.get("records"):
                self._cache_records = db_res.get("records", [])
                self._last_synced = float(db_res.get("last_synced", 0))
                self._last_synced_display = db_res.get("last_synced_display", "")

                def get_rec_sort_key(r):
                    t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                    rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                    return (t, rec_id)

                self._cache_records.sort(key=get_rec_sort_key, reverse=True)
                logger.info(f"Loaded {len(self._cache_records)} shareholding records from database")
                return
        except Exception as e:
            logger.warning(f"Error loading shareholding patterns from DB, falling back to disk: {e}")

        # 2. Fallback to local JSON file
        if not self.json_file.exists():
            return
        try:
            with open(self.json_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
                if isinstance(payload, dict):
                    self._cache_records = payload.get("records", [])
                    self._last_synced = float(payload.get("last_synced", 0))
                    self._last_synced_display = payload.get("last_synced_display", "")
                elif isinstance(payload, list):
                    self._cache_records = payload
                    self._last_synced = self.json_file.stat().st_mtime
                    self._last_synced_display = format_ist_display(self._last_synced)

            def get_rec_sort_key(r):
                t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                return (t, rec_id)

            self._cache_records.sort(key=get_rec_sort_key, reverse=True)
        except Exception as e:
            logger.error(f"Error loading {self.json_file}: {e}")

    def _save_to_disk(self) -> None:
        """Save current shareholding patterns to DB and app_data/shareholding_patterns.json."""
        try:
            now = time.time()
            now_display = format_ist_display(now)
            self._last_synced = now
            self._last_synced_display = now_display

            def get_rec_sort_key(r):
                t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                return (t, rec_id)

            self._cache_records.sort(key=get_rec_sort_key, reverse=True)

            count_eq = sum(1 for r in self._cache_records if r.get("board", "").lower() != "sme")
            count_sme = sum(1 for r in self._cache_records if r.get("board", "").lower() == "sme")

            payload = {
                "last_synced": self._last_synced,
                "last_synced_display": self._last_synced_display,
                "total_records": len(self._cache_records),
                "count_equities": count_eq,
                "count_sme": count_sme,
                "records": self._cache_records,
            }

            # Save to MongoDB Atlas & SQLite
            try:
                import db_store
                db_store.save_shareholding_patterns_db(
                    shp_data=payload,
                    last_synced=self._last_synced,
                    last_synced_display=self._last_synced_display,
                    backup_filepath=str(self.json_file)
                )
            except Exception as e:
                logger.error(f"Error saving shareholding patterns to db_store: {e}")

            # Also ensure local disk JSON file backup is updated atomically
            tmp_file = self.json_file.with_suffix(".json.tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            os.replace(tmp_file, self.json_file)
            logger.info(f"Saved {len(self._cache_records)} shareholding records to DB and {self.json_file}")
        except Exception as e:
            logger.error(f"Error saving shareholding patterns to disk: {e}")

    def _get_xbrl_cache_path(self, url: str) -> Path:
        """Compute disk cache path for an XBRL URL in the temp staging folder."""
        h = hashlib.md5(url.strip().encode("utf-8")).hexdigest()
        base = os.path.basename(url.split("?")[0])
        safe_base = re.sub(r"[^a-zA-Z0-9_\-]", "_", base)[:30]
        return self.xbrl_cache_dir / f"{safe_base}_{h}.json"

    def _load_cached_xbrl(self, url: str) -> Optional[Dict[str, float]]:
        """Load parsed XBRL result from disk cache if present."""
        if not url:
            return None
        cache_path = self._get_xbrl_cache_path(url)
        if cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
        return None

    def _save_cached_xbrl(self, url: str, data: Dict[str, float]) -> None:
        """Persist parsed XBRL result to disk cache in the temp folder."""
        if not url:
            return
        try:
            cache_path = self._get_xbrl_cache_path(url)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(data if isinstance(data, dict) else {}, f)
        except Exception:
            pass

    def _save_sync_state(self, state_dict: Dict[str, Any]) -> None:
        """Record live sync progress and batch status in temp staging folder."""
        try:
            state_file = self.temp_dir / "sync_state.json"
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump(state_dict, f, indent=2)
        except Exception:
            pass

    def _fetch_master_feed(self, session: requests.Session, url: str, temp_filename: str) -> List[Dict[str, Any]]:
        """Fetch master feed with retries and cache raw payload in temp folder."""
        temp_file = self.temp_dir / temp_filename
        for attempt in range(3):
            try:
                res = session.get(url, timeout=15)
                data = _parse_nse_json_safely(res)
                if data:
                    try:
                        with open(temp_file, "w", encoding="utf-8") as tf:
                            json.dump(data, tf)
                    except Exception:
                        pass
                    return data
            except Exception as e:
                logger.warning(f"Attempt {attempt + 1} to fetch {url} failed: {e}")
                time.sleep(1.5)
                try:
                    session.get(NSE_HOME, timeout=6)
                except Exception:
                    pass

        # If network fails after retries, try loading from previous temp file
        if temp_file.exists():
            try:
                with open(temp_file, "r", encoding="utf-8") as tf:
                    data = json.load(tf)
                    if isinstance(data, list):
                        logger.info(f"Loaded {len(data)} records from temp cache {temp_filename}")
                        return data
            except Exception:
                pass
        return []

    def start_admin_background_refresh(self) -> Dict[str, Any]:
        """Triggered from Admin portal with force=True bypassing rate-limit."""
        res = self.start_background_refresh(force=True)
        res["success"] = res.get("status") in ("started", "in_progress")
        return res

    def get_status(self) -> Dict[str, Any]:
        """Return provider status including last synced time, batch progress, and count of records done."""
        now = time.time()
        elapsed = now - self._last_synced if self._last_synced > 0 else 999999
        remaining = max(0, int(CACHE_TTL_SECONDS - elapsed))
        can_refresh = remaining == 0

        count_eq = sum(1 for r in self._cache_records if r.get("board", "").lower() != "sme")
        count_sme = sum(1 for r in self._cache_records if r.get("board", "").lower() == "sme")

        synced_disp = format_ist_display(self._last_synced_display or self._last_synced) if (self._last_synced or self._last_synced_display) else "Not synced yet"
        
        is_ref = self._is_refreshing
        percent = getattr(self, "_refresh_percent", 0) if is_ref else 100
        prog = self._refresh_progress or ("Idle" if not is_ref else "Refreshing shareholding filings...")
        
        return {
            "last_synced": self._last_synced,
            "last_synced_display": synced_disp,
            "last_updated": self._last_synced,
            "last_updated_display": synced_disp,
            "total_records": len(self._cache_records),
            "count_equities": count_eq,
            "count_sme": count_sme,
            "can_refresh": can_refresh,
            "remaining_seconds": remaining,
            "rate_limit_minutes": 15,
            "is_refreshing": is_ref,
            "progress": prog,
            "percent": percent,
            "processed_count": getattr(self, "_processed_count", len(self._cache_records)),
            "total_to_process": getattr(self, "_total_to_process", len(self._cache_records)),
            "current_batch": getattr(self, "_current_batch", 0),
            "total_batches": getattr(self, "_total_batches", 0),
            "last_error": self._refresh_error,
            "last_result": self._last_refresh_result,
        }

    def start_background_refresh(self, force: bool = False) -> Dict[str, Any]:
        """Start refresh in an isolated background thread so HTTP client never times out (504/502)."""
        now = time.time()
        with self._lock:
            if self._is_refreshing:
                return {
                    "status": "in_progress",
                    "message": "Refresh is already in progress in the background.",
                    "added_count": 0,
                    **self.get_status(),
                }

            elapsed = now - self._last_synced if self._last_synced > 0 else 999999
            if not force and elapsed < CACHE_TTL_SECONDS:
                remaining_min = int((CACHE_TTL_SECONDS - elapsed) // 60) + 1
                return {
                    "status": "throttled",
                    "message": f"Data was refreshed recently ({self._last_synced_display}). Next refresh allowed in ~{remaining_min} mins.",
                    "added_count": 0,
                    **self.get_status(),
                }

            self._is_refreshing = True
            self._refresh_error = None
            self._refresh_percent = 2
            self._refresh_progress = "Connecting to NSE corporate shareholding master feeds..."

        thread = threading.Thread(target=self._run_background_refresh, daemon=True)
        thread.start()

        return {
            "status": "started",
            "message": "Shareholding refresh started in the background. Polling for updates...",
            "added_count": 0,
            **self.get_status(),
        }

    def _run_background_refresh(self) -> None:
        try:
            res = self.fetch_live_records(force=True, is_worker=True)
            with self._lock:
                self._last_refresh_result = res
                if res.get("status") == "error":
                    self._refresh_error = res.get("message")
                else:
                    self._refresh_error = None
        except Exception as e:
            with self._lock:
                self._refresh_error = str(e)
            logger.error(f"Error in background shareholding refresh: {e}")
        finally:
            with self._lock:
                self._is_refreshing = False
                self._refresh_progress = ""

    def fetch_live_records(self, force: bool = False, is_worker: bool = False) -> Dict[str, Any]:
        """Fetch latest records from NSE, split total records into batches,
        download XBRL files into temp folder, and incrementally update the DB after each batch.
        Tracks every count of records done with real-time progress.
        """
        now = time.time()
        with self._lock:
            if not is_worker:
                if self._is_refreshing:
                    return {
                        "status": "in_progress",
                        "message": "Refresh is already in progress.",
                        "added_count": 0,
                        **self.get_status(),
                    }

                elapsed = now - self._last_synced if self._last_synced > 0 else 999999
                if not force and elapsed < CACHE_TTL_SECONDS:
                    remaining_min = int((CACHE_TTL_SECONDS - elapsed) // 60) + 1
                    return {
                        "status": "throttled",
                        "message": f"Data was refreshed recently ({self._last_synced_display}). Next refresh allowed in ~{remaining_min} mins.",
                        "added_count": 0,
                        **self.get_status(),
                    }

                self._is_refreshing = True
            self._refresh_progress = "Connecting to NSE corporate feeds..."
            self._refresh_percent = 3
            self._refresh_error = None

        try:
            logger.info("Starting batch refresh of Shareholding Patterns from NSE...")
            session = requests.Session()
            session.headers.update(HEADERS)

            # Handshake
            try:
                session.get(NSE_HOME, timeout=8)
            except Exception:
                pass

            # 1. Fetch Current Quarter Equities & SME Master Feeds
            self._refresh_progress = "Fetching master Equities and SME corporate feeds from NSE..."
            raw_eq = self._fetch_master_feed(session, NSE_MASTER_EQ, "master_equities.json")
            raw_sme = self._fetch_master_feed(session, NSE_MASTER_SME, "master_sme.json")

            if not raw_eq and not raw_sme:
                raise Exception("NSE corporate shareholdings endpoint returned empty feed. Feed temporarily unavailable or restricted.")

            # Tag boards
            tagged_raw: List[Dict[str, Any]] = []
            for r in raw_eq:
                r["board"] = "Mainboard"
                tagged_raw.append(r)
            for r in raw_sme:
                r["board"] = "SME"
                tagged_raw.append(r)

            # Sort new incoming by broadcastDate / submissionDate / recordId descending
            def get_rec_sort_key(r):
                t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                return (t, rec_id)

            tagged_raw.sort(key=get_rec_sort_key, reverse=True)

            # Analyze incoming filings to dynamically detect current reporting quarter
            incoming_dates = [r.get("date") for r in tagged_raw if r.get("date")]
            detected_quarter = (
                collections.Counter(incoming_dates).most_common(1)[0][0]
                if incoming_dates
                else None
            )

            # Dynamically compute previous quarter and filing query URLs
            q_windows = get_dynamic_quarter_windows(detected_quarter)
            current_quarter_date = q_windows["curr_quarter"]
            prev_quarter_date = q_windows["prev_quarter"]
            prev_eq_url = q_windows["eq_prev_url"]
            prev_sme_url = q_windows["sme_prev_url"]

            # 2. Fetch Previous Quarter Filings Map dynamically
            self._refresh_progress = f"Fetching previous quarter ({prev_quarter_date}) filings map..."
            self._refresh_percent = 6
            raw_prev_eq = self._fetch_master_feed(session, prev_eq_url, "master_prev_eq.json")
            raw_prev_sme = self._fetch_master_feed(session, prev_sme_url, "master_prev_sme.json")

            q1_map: Dict[str, Dict[str, Any]] = {}
            for r in (raw_prev_eq + raw_prev_sme):
                s_key = clean_symbol(r.get("symbol"))
                if s_key and s_key not in q1_map:
                    q1_map[s_key] = r

            # Also seed q1_map with any existing cached records matching prev_quarter_date
            with self._lock:
                for r in self._cache_records:
                    if r.get("date") == prev_quarter_date:
                        s_key = clean_symbol(r.get("symbol"))
                        if s_key and s_key not in q1_map:
                            q1_map[s_key] = r

            # 3. Setup Batch Splitting & Accounting
            total_records_count = len(tagged_raw)
            BATCH_SIZE = 40  # Split into batches of 40 records
            batches = [tagged_raw[i:i + BATCH_SIZE] for i in range(0, total_records_count, BATCH_SIZE)]
            total_batches = len(batches)

            with self._lock:
                self._total_to_process = total_records_count
                self._processed_count = 0
                self._total_batches = total_batches
                self._current_batch = 0

            logger.info(f"Splitting {total_records_count} total records into {total_batches} batches of {BATCH_SIZE}...")

            # Save initial sync state to temp folder
            self._save_sync_state({
                "status": "running",
                "total_records": total_records_count,
                "completed_records": 0,
                "current_batch": 0,
                "total_batches": total_batches,
                "batch_size": BATCH_SIZE,
                "started_at": format_ist_display(time.time()),
            })

            # Map existing records so we can preserve already enriched records without re-downloading XBRL
            with self._lock:
                existing_records_map = {
                    (clean_symbol(r.get("symbol")), r.get("date")): r
                    for r in self._cache_records
                }

            def fetch_single_xbrl_url(u: str) -> Tuple[str, Dict[str, float]]:
                if not u:
                    return u, {}
                cached = self._load_cached_xbrl(u)
                if cached is not None:
                    return u, cached
                try:
                    r = session.get(u, timeout=3.5)
                    if r.status_code == 200:
                        parsed = parse_xbrl_content(r.content)
                        self._save_cached_xbrl(u, parsed or {})
                        return u, parsed or {}
                    else:
                        self._save_cached_xbrl(u, {})
                except Exception:
                    self._save_cached_xbrl(u, {})
                return u, {}

            # 4. Process Every Batch: Download into temp folder & Update DB progressively
            for batch_idx, batch_items in enumerate(batches, start=1):
                with self._lock:
                    self._current_batch = batch_idx
                    pct = max(8, int((self._processed_count / total_records_count) * 100))
                    self._refresh_percent = pct
                    self._refresh_progress = (
                        f"Downloading & saving Batch {batch_idx}/{total_batches} "
                        f"({self._processed_count}/{total_records_count} records done · {pct}%)..."
                    )

                # Collect XBRL URLs needed for this batch that aren't cached yet
                urls_to_download: Set[str] = set()
                for item in batch_items:
                    sym = clean_symbol(item.get("symbol"))
                    date_val = item.get("date") or current_quarter_date
                    existing_entry = existing_records_map.get((sym, date_val))

                    # If already enriched with valid FII/DII data, no need to re-download
                    if existing_entry and existing_entry.get("xbrl_status") == "ok" and (existing_entry.get("fii_pct") is not None or existing_entry.get("dii_pct") is not None):
                        continue

                    q2_xbrl = item.get("xbrl")
                    if q2_xbrl and self._load_cached_xbrl(q2_xbrl) is None:
                        urls_to_download.add(q2_xbrl)

                    q1_item = q1_map.get(sym, {})
                    q1_xbrl = q1_item.get("xbrl")
                    if q1_xbrl and self._load_cached_xbrl(q1_xbrl) is None:
                        urls_to_download.add(q1_xbrl)

                # Download missing XBRL URLs for this batch concurrently
                if urls_to_download:
                    with ThreadPoolExecutor(max_workers=8) as ex:
                        for u, _ in ex.map(fetch_single_xbrl_url, urls_to_download):
                            pass

                # Enrich every item in this batch
                batch_enriched: List[Dict[str, Any]] = []
                for item in batch_items:
                    sym = clean_symbol(item.get("symbol"))
                    date_val = item.get("date") or current_quarter_date
                    existing_entry = existing_records_map.get((sym, date_val))

                    # Reuse existing enriched record if already complete
                    if existing_entry and existing_entry.get("xbrl_status") == "ok" and (existing_entry.get("fii_pct") is not None or existing_entry.get("dii_pct") is not None):
                        batch_enriched.append(existing_entry)
                        continue

                    q2_xbrl_url = item.get("xbrl")
                    q2_xbrl_data = self._load_cached_xbrl(q2_xbrl_url) if q2_xbrl_url else {}
                    q2_xbrl_data = q2_xbrl_data or {}

                    q1_item = q1_map.get(sym, {})
                    q1_xbrl_url = q1_item.get("xbrl")
                    q1_xbrl_data = self._load_cached_xbrl(q1_xbrl_url) if q1_xbrl_url else {}
                    q1_xbrl_data = q1_xbrl_data or {}

                    # Current quarter values (fallback to official master percentages)
                    promoter = q2_xbrl_data.get("promoter", float(item.get("pr_and_prgrp") or 0))

                    has_q2_inst = bool(q2_xbrl_data and ("fii" in q2_xbrl_data or "dii" in q2_xbrl_data))
                    if has_q2_inst:
                        dii = q2_xbrl_data.get("dii", 0.0)
                        fii = q2_xbrl_data.get("fii", 0.0)
                        pub = q2_xbrl_data.get("public", round(max(0.0, 100.0 - promoter - dii - fii), 2))
                        xbrl_status = "ok"
                    else:
                        dii = None
                        fii = None
                        pub = float(item.get("public_val") or 0) if item.get("public_val") is not None else None
                        xbrl_status = "pending" if q2_xbrl_url else "none"

                    # Prev quarter values
                    has_prev = bool(q1_item or q1_xbrl_data)
                    prev_promoter = q1_xbrl_data.get("promoter", float(q1_item.get("pr_and_prgrp") or 0)) if has_prev else None

                    has_q1_inst = bool(q1_xbrl_data and ("fii" in q1_xbrl_data or "dii" in q1_xbrl_data))
                    if has_q1_inst:
                        prev_dii = q1_xbrl_data.get("dii", 0.0)
                        prev_fii = q1_xbrl_data.get("fii", 0.0)
                        prev_pub = q1_xbrl_data.get("public", round(max(0.0, 100.0 - (prev_promoter or 0) - prev_dii - prev_fii), 2))
                    else:
                        prev_dii = None
                        prev_fii = None
                        prev_pub = float(q1_item.get("public_val") or 0) if (has_prev and q1_item.get("public_val") is not None) else None

                    chg_promoter = round(promoter - prev_promoter, 2) if (prev_promoter is not None and promoter is not None) else None
                    chg_fii = round(fii - prev_fii, 2) if (fii is not None and prev_fii is not None) else None
                    chg_dii = round(dii - prev_dii, 2) if (dii is not None and prev_dii is not None) else None
                    chg_pub = round(pub - prev_pub, 2) if (pub is not None and prev_pub is not None) else None

                    rec = {
                        "recordId": str(item.get("recordId") or ""),
                        "symbol": sym,
                        "name": item.get("name") or sym,
                        "isin": item.get("isin") or "",
                        "board": item.get("board", "Mainboard"),
                        "date": date_val,
                        "prev_date": q1_item.get("date") or prev_quarter_date,
                        "submissionDate": item.get("submissionDate") or "",
                        "broadcastDate": item.get("broadcastDate") or item.get("submissionDate") or "",
                        "promoter_pct": promoter,
                        "fii_pct": fii,
                        "dii_pct": dii,
                        "public_pct": pub,
                        "prev_promoter_pct": prev_promoter,
                        "prev_fii_pct": prev_fii,
                        "prev_dii_pct": prev_dii,
                        "prev_public_pct": prev_pub,
                        "change_promoter_pct": chg_promoter,
                        "change_fii_pct": chg_fii,
                        "change_dii_pct": chg_dii,
                        "change_public_pct": chg_pub,
                        "xbrl_status": xbrl_status,
                        "remarksWeb": item.get("remarksWeb") or "N",
                        "xbrl": item.get("xbrl") or "",
                        "xbrlFileSize": item.get("xbrlFileSize") or "",
                    }
                    batch_enriched.append(rec)

                # Save batch file in temp folder
                try:
                    batch_file = self.batches_dir / f"batch_{batch_idx:03d}.json"
                    with open(batch_file, "w", encoding="utf-8") as bf:
                        json.dump(batch_enriched, bf)
                except Exception:
                    pass

                # Incrementally commit batch to in-memory cache and DB!
                with self._lock:
                    new_keys = {(r.get("symbol"), r.get("date")) for r in batch_enriched}
                    retained = [r for r in self._cache_records if (r.get("symbol"), r.get("date")) not in new_keys]
                    self._cache_records = batch_enriched + retained
                    self._processed_count += len(batch_items)
                    pct = min(99, int((self._processed_count / total_records_count) * 100))
                    self._refresh_percent = pct
                    self._refresh_progress = (
                        f"Saved {self._processed_count} of {total_records_count} records to DB "
                        f"(Batch {batch_idx}/{total_batches} · {pct}%)"
                    )
                    # Persist immediately to MongoDB Atlas, SQLite, and disk backup
                    self._save_to_disk()

                # Update sync state in temp folder
                self._save_sync_state({
                    "status": "running",
                    "total_records": total_records_count,
                    "completed_records": self._processed_count,
                    "current_batch": batch_idx,
                    "total_batches": total_batches,
                    "percent": pct,
                    "updated_at": format_ist_display(time.time()),
                })

                # Polite pause to ensure smooth background execution
                time.sleep(0.04)

            # 5. Finalize Completion and Ensure Exact Record Accounting
            with self._lock:
                self._refresh_percent = 100
                total_final = len(self._cache_records)
                count_eq = sum(1 for r in self._cache_records if r.get("board", "").lower() != "sme")
                count_sme = sum(1 for r in self._cache_records if r.get("board", "").lower() == "sme")
                self._refresh_progress = f"Complete: All {total_final} records synchronized to DB ({count_eq} Equities, {count_sme} SME)"
                self._last_synced = time.time()
                self._last_synced_display = format_ist_display(self._last_synced)
                self._save_to_disk()
                self._is_refreshing = False

            self._save_sync_state({
                "status": "completed",
                "total_records": total_final,
                "completed_records": total_final,
                "current_batch": total_batches,
                "total_batches": total_batches,
                "percent": 100,
                "completed_at": self._last_synced_display,
            })

            return {
                "status": "success",
                "message": f"Successfully updated all {total_final} shareholding records in {total_batches} batches.",
                "added_count": total_final,
                **self.get_status(),
            }
        except Exception as e:
            logger.error(f"Error during shareholding refresh: {e}", exc_info=True)
            with self._lock:
                self._is_refreshing = False
                self._refresh_error = str(e)
                self._refresh_progress = f"Refresh failed: {str(e)}"
            return {
                "status": "error",
                "message": f"Refresh failed: {str(e)}",
                "added_count": 0,
                **self.get_status(),
            }
        finally:
            with self._lock:
                self._is_refreshing = False

    @staticmethod
    def _has_pattern_change(r: Dict[str, Any]) -> bool:
        """Check if record has any QoQ change in Promoter, FII, DII, or Public holding."""
        for field in ("change_promoter_pct", "change_fii_pct", "change_dii_pct", "change_public_pct"):
            val = r.get(field)
            if val is not None:
                try:
                    if abs(float(val)) > 0.0001:
                        return True
                except (ValueError, TypeError):
                    pass

        # Fallback to level percentage diffs if change fields are missing or None
        for cur_k, prev_k in (
            ("promoter_pct", "prev_promoter_pct"),
            ("fii_pct", "prev_fii_pct"),
            ("dii_pct", "prev_dii_pct"),
            ("public_pct", "prev_public_pct"),
        ):
            cur_v = r.get(cur_k)
            prev_v = r.get(prev_k)
            if cur_v is not None and prev_v is not None:
                try:
                    if abs(float(cur_v) - float(prev_v)) > 0.0001:
                        return True
                except (ValueError, TypeError):
                    pass
        return False

    def get_two_quarters_info(self) -> Tuple[str, Tuple[str, str]]:
        """Determine the top two comparative quarters across cached records dynamically."""
        import collections
        q_pairs = collections.Counter()
        with self._lock:
            for r in self._cache_records:
                d = r.get("date")
                pd = r.get("prev_date")
                if d and pd:
                    q_pairs[(d, pd)] += 1
        if not q_pairs:
            q_info = get_dynamic_quarter_windows()
            return q_info["comparison_label"], (q_info["curr_quarter"], q_info["prev_quarter"])
        top_pair, _ = q_pairs.most_common(1)[0]
        lbl = f"{self._format_qtr_label(top_pair[0])} vs {self._format_qtr_label(top_pair[1])}"
        return lbl, top_pair

    @staticmethod
    def _format_qtr_label(date_str: str) -> str:
        if not date_str or not isinstance(date_str, str):
            return ""
        parts = date_str.split("-")
        if len(parts) == 3:
            mon = parts[1].upper()
            yr = parts[2][-2:]
            month_map = {
                "JAN": "Jan", "FEB": "Feb", "MAR": "Mar", "APR": "Apr",
                "MAY": "May", "JUN": "Jun", "JUL": "Jul", "AUG": "Aug",
                "SEP": "Sep", "OCT": "Oct", "NOV": "Nov", "DEC": "Dec"
            }
            m = month_map.get(mon, mon)
            return f"{m} {yr}"
        return date_str

    ALLOWED_AST_NODES = (
        ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp,
        ast.Compare, ast.Name, ast.Constant,
        ast.And, ast.Or, ast.Not,
        ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
        ast.USub, ast.UAdd, ast.Load,
    )

    QUERY_FIELD_MAP = {
        # QoQ percentage changes
        "promoter": "change_promoter_pct",
        "fii": "change_fii_pct",
        "dii": "change_dii_pct",
        "public": "change_public_pct",
        "promoter_change": "change_promoter_pct",
        "fii_change": "change_fii_pct",
        "dii_change": "change_dii_pct",
        "public_change": "change_public_pct",
        "promoter_chg": "change_promoter_pct",
        "fii_chg": "change_fii_pct",
        "dii_chg": "change_dii_pct",
        "public_chg": "change_public_pct",
        # Level percentage holdings
        "promoter_holding": "promoter_pct",
        "fii_holding": "fii_pct",
        "dii_holding": "dii_pct",
        "public_holding": "public_pct",
        "promoter_pct": "promoter_pct",
        "fii_pct": "fii_pct",
        "dii_pct": "dii_pct",
        "public_pct": "public_pct",
    }

    def sanitize_custom_query(self, query_str: str) -> str:
        """Sanitize query string to normalize operators and keywords for Python AST."""
        if not query_str:
            return ""
        s = query_str.strip()
        # Case-insensitive logic keywords
        s = re.sub(r"\band\b", "and", s, flags=re.IGNORECASE)
        s = re.sub(r"\bor\b", "or", s, flags=re.IGNORECASE)
        s = re.sub(r"\bnot\b", "not", s, flags=re.IGNORECASE)
        # Normalize single '=' to '==' without disturbing '<=', '>=', '!=', '=='
        s = re.sub(r"(?<![<>=!])=(?!=)", "==", s)
        return s

    def compile_custom_query(self, query_str: str) -> Tuple[Optional[ast.AST], Optional[str]]:
        """Compile and securely validate user-specified boolean shareholding query."""
        if not query_str or not query_str.strip():
            return None, "Query string is empty."
        sanitized = self.sanitize_custom_query(query_str)
        try:
            tree = ast.parse(sanitized, mode="eval")
        except Exception as e:
            return None, f"Query syntax error: {e}"

        for node in ast.walk(tree):
            if not isinstance(node, self.ALLOWED_AST_NODES):
                return None, f"Unsupported expression element: {type(node).__name__}"
            if isinstance(node, ast.Name):
                name_lower = node.id.lower()
                if name_lower not in self.QUERY_FIELD_MAP and name_lower not in ("true", "false"):
                    return (
                        None,
                        f"Unknown field '{node.id}'. Supported fields: promoter, fii, dii, public, "
                        "promoter_holding, fii_holding, dii_holding, public_holding",
                    )
        return tree, None

    def eval_custom_node(self, node: Any, record: Dict[str, Any]) -> Any:
        """Evaluate validated AST expression against a shareholding record."""
        if node is None:
            return None
        if isinstance(node, ast.Expression):
            return self.eval_custom_node(node.body, record)
        elif isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.Name):
            nid = node.id.lower()
            if nid == "true":
                return True
            if nid == "false":
                return False
            if nid in ("has_change", "has_changes", "only_changes", "changed"):
                return 1 if self._has_pattern_change(record) else 0
            field_attr = self.QUERY_FIELD_MAP.get(nid)
            val = record.get(field_attr)
            return float(val) if val is not None else None
        elif isinstance(node, ast.UnaryOp):
            operand = self.eval_custom_node(node.operand, record)
            if operand is None:
                return None
            if isinstance(node.op, ast.Not):
                return not bool(operand)
            elif isinstance(node.op, ast.USub):
                return -operand
            elif isinstance(node.op, ast.UAdd):
                return +operand
            return None
        elif isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for v in node.values:
                    res = self.eval_custom_node(v, record)
                    if not res:
                        return False
                return True
            elif isinstance(node.op, ast.Or):
                for v in node.values:
                    res = self.eval_custom_node(v, record)
                    if res:
                        return True
                return False
        elif isinstance(node, ast.Compare):
            left = self.eval_custom_node(node.left, record)
            if left is None:
                return False
            for op, comparator in zip(node.ops, node.comparators):
                right = self.eval_custom_node(comparator, record)
                if right is None:
                    return False
                matched = False
                if isinstance(op, ast.Eq):
                    matched = abs(left - right) < 0.001
                elif isinstance(op, ast.NotEq):
                    matched = abs(left - right) >= 0.001
                elif isinstance(op, ast.Lt):
                    matched = left < right
                elif isinstance(op, ast.LtE):
                    matched = left <= right
                elif isinstance(op, ast.Gt):
                    matched = left > right
                elif isinstance(op, ast.GtE):
                    matched = left >= right
                if not matched:
                    return False
                left = right
            return True
        return False

    def validate_custom_query(self, query_str: str) -> Dict[str, Any]:
        """Validate query and return live match count and preview."""
        if not query_str or not query_str.strip():
            return {
                "valid": False,
                "error": "Query cannot be empty.",
                "match_count": 0,
                "matches": [],
            }
        tree, err = self.compile_custom_query(query_str)
        if err or not tree:
            return {
                "valid": False,
                "error": err or "Invalid query expression.",
                "match_count": 0,
                "matches": [],
            }

        with self._lock:
            recs = list(self._cache_records)

        matched_symbols = []
        for r in recs:
            try:
                if self.eval_custom_node(tree, r):
                    matched_symbols.append({
                        "symbol": r.get("symbol"),
                        "name": r.get("name"),
                        "promoter_change": r.get("change_promoter_pct"),
                        "fii_change": r.get("change_fii_pct"),
                        "dii_change": r.get("change_dii_pct"),
                        "public_change": r.get("change_public_pct"),
                    })
            except Exception:
                pass

        return {
            "valid": True,
            "error": None,
            "match_count": len(matched_symbols),
            "matches": matched_symbols[:8],
        }

    def query_records(
        self,
        board: str = "all",
        category_filter: str = "all",
        custom_query: str = "",
        scope: str = "all",
        search: str = "",
        sort_key: str = "broadcastDate",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
        portfolio_symbols: Optional[Set[str]] = None,
        watchlist_symbols: Optional[Set[str]] = None,
    ) -> Dict[str, Any]:
        """Query, filter, and paginate shareholding records without hitting external networks."""
        with self._lock:
            records = list(self._cache_records)
            status_meta = self.get_status()

        # 1. Filter by Stock Scope (All Stocks / All Portfolio / All Watchlists)
        scope_clean = (scope or "all").lower().strip()
        if scope_clean in ("portfolio", "all_portfolio", "all_portfolios"):
            pf_set = {clean_symbol(s) for s in (portfolio_symbols or set())}
            records = [r for r in records if clean_symbol(r.get("symbol")) in pf_set]
        elif scope_clean in ("watchlist", "all_watchlist", "all_watchlists"):
            wl_set = {clean_symbol(s) for s in (watchlist_symbols or set())}
            records = [r for r in records if clean_symbol(r.get("symbol")) in wl_set]

        # Calculate board counts for the scoped records
        counts = {
            "all": len(records),
            "mainboard": sum(1 for r in records if r.get("board", "").lower() != "sme"),
            "sme": sum(1 for r in records if r.get("board", "").lower() == "sme"),
        }

        # 2. Filter by Board
        board_clean = board.lower().strip()
        if board_clean in ("mainboard", "eq", "equities"):
            records = [r for r in records if r.get("board", "").lower() != "sme"]
        elif board_clean in ("sme",):
            records = [r for r in records if r.get("board", "").lower() == "sme"]

        # 3. Filter by Category / Holding Range / Shifts
        cat_clean = category_filter.lower().strip()
        two_qtrs_label, top_pair = self.get_two_quarters_info()
        custom_query_clean = (custom_query or "").strip()
        custom_query_error = None

        if cat_clean == "custom" or (cat_clean == "all" and custom_query_clean):
            if custom_query_clean:
                tree, err = self.compile_custom_query(custom_query_clean)
                if tree:
                    records = [r for r in records if self.eval_custom_node(tree, r)]
                else:
                    custom_query_error = err
                    records = []
        elif cat_clean in ("only_changes", "changes_only", "two_qtrs", "changed"):
            # Filter out stocks with no change in shareholding pattern (only keep QoQ shifts)
            records = [r for r in records if self._has_pattern_change(r)]
        elif cat_clean == "fii_inc":
            # FII Increased QoQ
            records = [r for r in records if (r.get("change_fii_pct") or 0.0) > 0]
        elif cat_clean == "dii_inc":
            # DII Increased QoQ
            records = [r for r in records if (r.get("change_dii_pct") or 0.0) > 0]
        elif cat_clean == "promoter_inc":
            # Promoter Increased QoQ
            records = [r for r in records if (r.get("change_promoter_pct") or 0.0) > 0]
        elif cat_clean == "fii_dec":
            # FII Decreased QoQ
            records = [r for r in records if (r.get("change_fii_pct") or 0.0) < 0]
        elif cat_clean == "dii_dec":
            # DII Decreased QoQ
            records = [r for r in records if (r.get("change_dii_pct") or 0.0) < 0]
        elif cat_clean == "gt75":
            # Promoter > 75%
            records = [r for r in records if (r.get("promoter_pct") or 0) > 75.0]
        elif cat_clean == "50_75":
            # Promoter 50% - 75%
            records = [
                r for r in records
                if 50.0 <= (r.get("promoter_pct") or 0) <= 75.0
            ]
        elif cat_clean == "lt50":
            # Promoter < 50%
            records = [r for r in records if (r.get("promoter_pct") or 0) < 50.0]
        elif cat_clean == "public_gt50":
            # Public > 50%
            records = [r for r in records if (r.get("public_pct") or 0) > 50.0]
        elif cat_clean == "with_remarks":
            # Has remarks/notes
            records = [
                r for r in records
                if r.get("remarksWeb") and str(r.get("remarksWeb")).lower() not in ("n", "-", "")
            ]

        # 4. Search Filter
        if search:
            query = search.strip().lower()
            records = [
                r for r in records
                if query in str(r.get("symbol", "")).lower()
                or query in str(r.get("name", "")).lower()
                or query in str(r.get("isin", "")).lower()
                or query in str(r.get("remarksWeb", "")).lower()
            ]

        # 5. Sorting (Supports Every Percentage Metric & QoQ Changes)
        def sort_val(r):
            if sort_key == "promoter":
                val = r.get("promoter_pct")
                return (1 if val is not None else 0, val or 0.0)
            elif sort_key == "change_promoter":
                val = r.get("change_promoter_pct")
                return (1 if val is not None else 0, val if val is not None else -9999.0)
            elif sort_key == "fii":
                val = r.get("fii_pct")
                return (1 if val is not None else 0, val or 0.0)
            elif sort_key == "change_fii":
                val = r.get("change_fii_pct")
                return (1 if val is not None else 0, val if val is not None else -9999.0)
            elif sort_key == "dii":
                val = r.get("dii_pct")
                return (1 if val is not None else 0, val or 0.0)
            elif sort_key == "change_dii":
                val = r.get("change_dii_pct")
                return (1 if val is not None else 0, val if val is not None else -9999.0)
            elif sort_key == "public":
                val = r.get("public_pct")
                return (1 if val is not None else 0, val or 0.0)
            elif sort_key == "change_public":
                val = r.get("change_public_pct")
                return (1 if val is not None else 0, val if val is not None else -9999.0)
            elif sort_key == "name":
                return (1, str(r.get("name", "")).lower())
            elif sort_key == "symbol":
                return (1, str(r.get("symbol", "")).lower())
            elif sort_key == "quarter":
                return (1, parse_date_to_timestamp(r.get("date")))
            elif sort_key == "submissionDate":
                return (1, parse_date_to_timestamp(r.get("submissionDate")))
            else:  # broadcastDate (default)
                t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                return (1, t, rec_id)

        try:
            records.sort(key=sort_val, reverse=(sort_dir.lower() == "desc"))
        except Exception as e:
            logger.warning(f"Sort error on {sort_key}: {e}")

        # 6. Pagination
        total_filtered = len(records)
        page = max(1, int(page))
        page_size = max(10, min(200, int(page_size)))
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        page_records = records[start_idx:end_idx]

        return {
            "records": page_records,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_records": total_filtered,
                "total_pages": (total_filtered + page_size - 1) // page_size if total_filtered > 0 else 1,
                "has_next": end_idx < total_filtered,
                "has_prev": page > 1,
            },
            "counts": counts,
            "two_quarters_label": two_qtrs_label,
            "status": status_meta,
            "custom_query": custom_query_clean,
            "custom_query_error": custom_query_error,
        }

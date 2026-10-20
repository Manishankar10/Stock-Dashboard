"""Shareholding Patterns Provider
Collects and serves official quarterly shareholding pattern disclosures from NSE and BSE.
Data is stored locally in `app_data/shareholding_patterns.json`.
Strictly fetches ONLY on manual user refresh with a 15-minute rate-limit window.
Cuts and stops parser immediately when existing records are reached.
"""

from __future__ import annotations

from datetime import datetime
import json
import logging
import os
from pathlib import Path
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 900  # 15 minutes rate-limit interval
NSE_HOME = "https://www.nseindia.com"
NSE_MASTER_EQ = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities"
NSE_MASTER_SME = "https://www.nseindia.com/api/corporate-share-holdings-master?index=sme"

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
    # Try formats like '20-OCT-2026 08:11:22', '20-OCT-2026', '30-SEP-2026'
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


class ShareholdingProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = Path(data_dir).resolve()
        self.app_data_dir = self.data_dir / "app_data"
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        self.json_file = self.app_data_dir / "shareholding_patterns.json"

        self._lock = threading.Lock()
        self._cache_records: List[Dict[str, Any]] = []
        self._last_synced: float = 0
        self._last_synced_display: str = ""
        self._is_refreshing: bool = False

        # Load initial records from disk if present
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        """Load stored shareholding patterns from app_data/shareholding_patterns.json."""
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
                    self._last_synced_display = datetime.fromtimestamp(self._last_synced).strftime("%d %b %Y, %I:%M %p")
        except Exception as e:
            logger.error(f"Error loading {self.json_file}: {e}")

    def _save_to_disk(self) -> None:
        """Save current shareholding patterns to app_data/shareholding_patterns.json."""
        try:
            now = time.time()
            now_display = datetime.fromtimestamp(now).strftime("%d %b %Y, %I:%M %p")
            self._last_synced = now
            self._last_synced_display = now_display

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
            with open(self.json_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            logger.info(f"Saved {len(self._cache_records)} shareholding records to {self.json_file}")
        except Exception as e:
            logger.error(f"Error saving to {self.json_file}: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Return provider status including last synced time and next refresh allowed."""
        now = time.time()
        elapsed = now - self._last_synced if self._last_synced > 0 else 999999
        remaining = max(0, int(CACHE_TTL_SECONDS - elapsed))
        can_refresh = remaining == 0

        count_eq = sum(1 for r in self._cache_records if r.get("board", "").lower() != "sme")
        count_sme = sum(1 for r in self._cache_records if r.get("board", "").lower() == "sme")

        return {
            "last_synced": self._last_synced,
            "last_synced_display": self._last_synced_display or "Not synced yet",
            "total_records": len(self._cache_records),
            "count_equities": count_eq,
            "count_sme": count_sme,
            "can_refresh": can_refresh,
            "remaining_seconds": remaining,
            "rate_limit_minutes": 15,
            "is_refreshing": self._is_refreshing,
        }

    def fetch_live_records(self, force: bool = False) -> Dict[str, Any]:
        """Fetch latest records from NSE.
        Enforces 15-minute rate limit window.
        Cuts immediately when existing records are reached.
        """
        now = time.time()
        with self._lock:
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

        try:
            logger.info("Starting manual refresh of Shareholding Patterns from NSE...")
            session = requests.Session()
            session.headers.update(HEADERS)

            # Handshake
            session.get(NSE_HOME, timeout=8)

            # 1. Fetch Mainboard Equities
            eq_res = session.get(NSE_MASTER_EQ, timeout=15)
            raw_eq = eq_res.json() if eq_res.status_code == 200 else []

            # 2. Fetch SME Equities
            sme_res = session.get(NSE_MASTER_SME, timeout=15)
            raw_sme = sme_res.json() if sme_res.status_code == 200 else []

            # Tag boards
            tagged_raw: List[Dict[str, Any]] = []
            for r in raw_eq:
                r["board"] = "Mainboard"
                tagged_raw.append(r)
            for r in raw_sme:
                r["board"] = "SME"
                tagged_raw.append(r)

            # Sort new incoming by broadcastDate / recordId descending
            def get_rec_sort_key(r):
                t = parse_date_to_timestamp(r.get("broadcastDate") or r.get("submissionDate"))
                rec_id = int(r.get("recordId") or 0) if str(r.get("recordId") or "").isdigit() else 0
                return (t, rec_id)

            tagged_raw.sort(key=get_rec_sort_key, reverse=True)

            with self._lock:
                existing_record_ids = {
                    str(r.get("recordId"))
                    for r in self._cache_records
                    if r.get("recordId") is not None
                }
                existing_keys = {
                    (clean_symbol(r.get("symbol")), str(r.get("date") or "").strip().upper())
                    for r in self._cache_records
                }

                # Cut when reached existing records
                new_records: List[Dict[str, Any]] = []
                for item in tagged_raw:
                    rec_id = str(item.get("recordId") or "")
                    sym = clean_symbol(item.get("symbol"))
                    qtr_date = str(item.get("date") or "").strip().upper()

                    # CUT CRITERION: If recordId already exists, or symbol+date exists
                    if (rec_id and rec_id in existing_record_ids) or ((sym, qtr_date) in existing_keys):
                        # Reached existing records in chronological stream - stop / cut
                        logger.info(f"Existing record reached (recordId={rec_id}, {sym} {qtr_date}). Cutting incoming stream.")
                        break

                    new_records.append(item)

                if new_records:
                    logger.info(f"Collected {len(new_records)} new shareholding records. Prepending to store.")
                    self._cache_records = new_records + self._cache_records
                else:
                    logger.info("No new shareholding records found. Existing records are completely up-to-date.")

                self._save_to_disk()

            return {
                "status": "success",
                "message": f"Successfully updated shareholding records. Found {len(new_records)} new filing(s).",
                "added_count": len(new_records),
                **self.get_status(),
            }
        except Exception as e:
            logger.error(f"Error during shareholding refresh: {e}")
            return {
                "status": "error",
                "message": f"Refresh failed: {str(e)}",
                "added_count": 0,
                **self.get_status(),
            }
        finally:
            with self._lock:
                self._is_refreshing = False

    def query_records(
        self,
        board: str = "all",
        category_filter: str = "all",
        search: str = "",
        sort_key: str = "broadcastDate",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
    ) -> Dict[str, Any]:
        """Query, filter, and paginate shareholding records without hitting external networks."""
        with self._lock:
            records = list(self._cache_records)
            status_meta = self.get_status()

        # 1. Filter by Board
        board_clean = board.lower().strip()
        if board_clean in ("mainboard", "eq", "equities"):
            records = [r for r in records if r.get("board", "").lower() != "sme"]
        elif board_clean in ("sme",):
            records = [r for r in records if r.get("board", "").lower() == "sme"]

        # 2. Filter by Category / Holding Range
        cat_clean = category_filter.lower().strip()
        if cat_clean == "gt75":
            # Promoter > 75%
            records = [r for r in records if (parse_float(r.get("pr_and_prgrp")) or 0) > 75.0]
        elif cat_clean == "50_75":
            # Promoter 50% - 75%
            records = [
                r for r in records
                if 50.0 <= (parse_float(r.get("pr_and_prgrp")) or 0) <= 75.0
            ]
        elif cat_clean == "lt50":
            # Promoter < 50%
            records = [r for r in records if (parse_float(r.get("pr_and_prgrp")) or 0) < 50.0]
        elif cat_clean == "public_gt50":
            # Public > 50%
            records = [r for r in records if (parse_float(r.get("public_val")) or 0) > 50.0]
        elif cat_clean == "with_remarks":
            # Has remarks/notes
            records = [
                r for r in records
                if r.get("remarksWeb") and str(r.get("remarksWeb")).lower() not in ("n", "-", "")
            ]

        # 3. Search Filter
        if search:
            query = search.strip().lower()
            records = [
                r for r in records
                if query in str(r.get("symbol", "")).lower()
                or query in str(r.get("name", "")).lower()
                or query in str(r.get("isin", "")).lower()
                or query in str(r.get("remarksWeb", "")).lower()
            ]

        # 4. Sorting
        dir_mult = -1 if sort_dir.lower() == "desc" else 1

        def sort_val(r):
            if sort_key == "promoter":
                val = parse_float(r.get("pr_and_prgrp"))
                return (1 if val is not None else 0, val or 0.0)
            elif sort_key == "public":
                val = parse_float(r.get("public_val"))
                return (1 if val is not None else 0, val or 0.0)
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

        # 5. Pagination
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
            "status": status_meta,
        }

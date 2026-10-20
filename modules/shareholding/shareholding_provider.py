"""Shareholding Patterns Provider
Collects and serves official quarterly shareholding pattern disclosures from NSE and BSE.
Extracts Promoter %, FII %, DII %, and Public % across current and previous quarters.
Calculates QoQ % changes for every category and allows sorting on all percentages.
Data is stored locally in `app_data/shareholding_patterns.json`.
Strictly fetches on manual user refresh with a 15-minute rate-limit window.
Cuts and stops parser immediately when existing records are reached.
"""

from __future__ import annotations

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

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 900  # 15 minutes rate-limit interval
NSE_HOME = "https://www.nseindia.com"
NSE_MASTER_EQ = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities"
NSE_MASTER_SME = "https://www.nseindia.com/api/corporate-share-holdings-master?index=sme"
NSE_MASTER_EQ_PREV = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&from_date=01-06-2026&to_date=30-07-2026"
NSE_MASTER_SME_PREV = "https://www.nseindia.com/api/corporate-share-holdings-master?index=sme&from_date=01-06-2026&to_date=30-07-2026"

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
        """Fetch latest records from NSE, enrich with FII/DII and QoQ comparison.
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

            # 1. Fetch Current Quarter Equities & SME
            eq_res = session.get(NSE_MASTER_EQ, timeout=15)
            raw_eq = eq_res.json() if eq_res.status_code == 200 else []

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
                new_raw_items: List[Dict[str, Any]] = []
                for item in tagged_raw:
                    rec_id = str(item.get("recordId") or "")
                    sym = clean_symbol(item.get("symbol"))
                    qtr_date = str(item.get("date") or "").strip().upper()

                    # CUT CRITERION: If recordId already exists, or symbol+date exists
                    if (rec_id and rec_id in existing_record_ids) or ((sym, qtr_date) in existing_keys):
                        logger.info(f"Existing record reached (recordId={rec_id}, {sym} {qtr_date}). Cutting incoming stream.")
                        break

                    new_raw_items.append(item)

            if not new_raw_items:
                logger.info("No new shareholding records found. Existing records are completely up-to-date.")
                with self._lock:
                    self._last_synced = time.time()
                    self._last_synced_display = datetime.fromtimestamp(self._last_synced).strftime("%d %b %Y, %I:%M %p")
                    self._save_to_disk()
                return {
                    "status": "success",
                    "message": "All latest shareholding patterns are already up-to-date.",
                    "added_count": 0,
                    **self.get_status(),
                }

            # 2. Fetch Previous Quarter Filings Map
            logger.info("Fetching previous quarter filings for comparison...")
            prev_eq_res = session.get(NSE_MASTER_EQ_PREV, timeout=15)
            raw_prev_eq = prev_eq_res.json() if prev_eq_res.status_code == 200 else []

            prev_sme_res = session.get(NSE_MASTER_SME_PREV, timeout=15)
            raw_prev_sme = prev_sme_res.json() if prev_sme_res.status_code == 200 else []

            q1_map: Dict[str, Dict[str, Any]] = {}
            for r in (raw_prev_eq + raw_prev_sme):
                s_key = clean_symbol(r.get("symbol"))
                if s_key and s_key not in q1_map:
                    q1_map[s_key] = r

            # 3. Collect XBRL URLs to parse
            urls_to_fetch: Set[str] = set()
            for item in new_raw_items:
                if item.get("xbrl"):
                    urls_to_fetch.add(item.get("xbrl"))
                sym = clean_symbol(item.get("symbol"))
                if sym in q1_map and q1_map[sym].get("xbrl"):
                    urls_to_fetch.add(q1_map[sym].get("xbrl"))

            logger.info(f"Parsing {len(urls_to_fetch)} XBRL documents for FII, DII, Promoter, and Public...")
            xbrl_cache: Dict[str, Dict[str, float]] = {}

            def fetch_single_xbrl(u: str) -> Tuple[str, Dict[str, float]]:
                try:
                    r = session.get(u, timeout=7)
                    if r.status_code == 200:
                        return u, parse_xbrl_content(r.content)
                except Exception:
                    pass
                return u, {}

            with ThreadPoolExecutor(max_workers=30) as ex:
                for u, parsed_dict in ex.map(fetch_single_xbrl, urls_to_fetch):
                    xbrl_cache[u] = parsed_dict

            # 4. Enrich new records with FII, DII, and QoQ change metrics
            enriched_records: List[Dict[str, Any]] = []
            for item in new_raw_items:
                sym = clean_symbol(item.get("symbol"))
                q2_xbrl_data = xbrl_cache.get(item.get("xbrl"), {})

                q1_item = q1_map.get(sym, {})
                q1_xbrl_data = xbrl_cache.get(q1_item.get("xbrl"), {})

                # Current quarter values
                promoter = q2_xbrl_data.get("promoter", float(item.get("pr_and_prgrp") or 0))
                dii = q2_xbrl_data.get("dii", 0.0)
                fii = q2_xbrl_data.get("fii", 0.0)
                pub = q2_xbrl_data.get("public", round(max(0.0, 100.0 - promoter - dii - fii), 2))

                # Prev quarter values
                has_prev = bool(q1_item or q1_xbrl_data)
                prev_promoter = q1_xbrl_data.get("promoter", float(q1_item.get("pr_and_prgrp") or 0)) if has_prev else None
                prev_dii = q1_xbrl_data.get("dii", 0.0) if has_prev else None
                prev_fii = q1_xbrl_data.get("fii", 0.0) if has_prev else None
                prev_pub = q1_xbrl_data.get("public", round(max(0.0, 100.0 - (prev_promoter or 0) - (prev_dii or 0) - (prev_fii or 0)), 2)) if has_prev else None

                # Calculate QoQ changes
                chg_promoter = round(promoter - prev_promoter, 2) if prev_promoter is not None else None
                chg_fii = round(fii - prev_fii, 2) if prev_fii is not None else None
                chg_dii = round(dii - prev_dii, 2) if prev_dii is not None else None
                chg_pub = round(pub - prev_pub, 2) if prev_pub is not None else None

                rec = {
                    "recordId": str(item.get("recordId") or ""),
                    "symbol": sym,
                    "name": item.get("name") or sym,
                    "isin": item.get("isin") or "",
                    "board": item.get("board", "Mainboard"),
                    "date": item.get("date") or "30-SEP-2026",
                    "prev_date": q1_item.get("date") or "30-JUN-2026",
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
                    "remarksWeb": item.get("remarksWeb") or "N",
                    "xbrl": item.get("xbrl") or "",
                    "xbrlFileSize": item.get("xbrlFileSize") or "",
                }
                enriched_records.append(rec)

            with self._lock:
                self._cache_records = enriched_records + self._cache_records
                self._save_to_disk()

            return {
                "status": "success",
                "message": f"Successfully updated shareholding records. Found {len(enriched_records)} new filing(s).",
                "added_count": len(enriched_records),
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
            return "Sep 26 vs Jun 26", ("30-SEP-2026", "30-JUN-2026")
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

    def query_records(
        self,
        board: str = "all",
        category_filter: str = "all",
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

        if cat_clean == "two_qtrs":
            # Filter strictly by comparative two quarters
            records = [
                r for r in records
                if r.get("date") == top_pair[0] and (r.get("prev_date") == top_pair[1] or r.get("change_promoter_pct") is not None)
            ]
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
        }

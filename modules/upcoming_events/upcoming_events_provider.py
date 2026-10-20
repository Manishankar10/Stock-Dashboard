"""Official upcoming corporate events provider for Results, AGMs, Concalls, and Board Meetings."""

from datetime import date, datetime, timedelta
import json
import logging
import os
from pathlib import Path
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set

import requests

logger = logging.getLogger(__name__)

_MODULE_DIR = Path(__file__).resolve().parent
_SEED_FILE = Path("app_data/seed_upcoming_events.json") if Path("app_data/seed_upcoming_events.json").exists() else _MODULE_DIR / "seed_upcoming_events.json"

NSE_HOME = "https://www.nseindia.com/"
NSE_CALENDAR_API = "https://www.nseindia.com/api/event-calendar"
NSE_BOARD_MEETINGS_API = "https://www.nseindia.com/api/corporate-board-meetings"

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

CACHE_TTL_SECONDS = 900  # 15 minutes


def clean_symbol(symbol: Optional[str]) -> str:
    if not symbol:
        return ""
    return re.sub(r"\.(?:NS|BO)$", "", str(symbol).strip(), flags=re.IGNORECASE).upper()


def _parse_date(raw_date: Optional[str]) -> Optional[datetime]:
    if not raw_date:
        return None
    cleaned = str(raw_date).strip()
    formats = (
        "%Y-%m-%d",
        "%d-%b-%Y",
        "%d-%m-%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%Y%m%d",
    )
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def _format_date_header(dt: datetime) -> str:
    weekday = dt.strftime("%a")
    day = str(dt.day)
    month = dt.strftime("%b")
    return f"{weekday}, {day} {month}"


def _simplify_company_name(name: str) -> str:
    if not name:
        return ""
    cleaned = re.sub(r"\b(Limited|Ltd\.?|Corporation|Corp\.?)\b", "", name, flags=re.IGNORECASE).strip()
    return cleaned or name


class UpcomingEventsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._cache_events: Optional[List[Dict[str, Any]]] = None
        self._last_fetch_time: float = 0
        self._session = requests.Session()
        self._session.headers.update(HTTP_HEADERS)
        self._cache_file = os.path.join(data_dir, "app_data", "upcoming_events_cache.json")

    def _load_seed(self) -> List[Dict[str, Any]]:
        if _SEED_FILE.exists():
            try:
                with open(_SEED_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                logger.warning(f"Error loading seed_upcoming_events.json: {e}")
        return []

    def _load_disk_cache(self) -> Optional[List[Dict[str, Any]]]:
        if os.path.exists(self._cache_file):
            try:
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    if isinstance(payload, dict) and "data" in payload and "time" in payload:
                        if time.time() - payload["time"] < CACHE_TTL_SECONDS * 4:
                            return payload["data"]
            except Exception as e:
                logger.warning(f"Error reading disk cache: {e}")
        return None

    def _save_disk_cache(self, data: List[Dict[str, Any]]):
        try:
            os.makedirs(os.path.dirname(self._cache_file), exist_ok=True)
            with open(self._cache_file, "w", encoding="utf-8") as f:
                json.dump({"time": time.time(), "data": data}, f, indent=2)
        except Exception as e:
            logger.warning(f"Error saving disk cache: {e}")

    def fetch_live_events(self) -> List[Dict[str, Any]]:
        """Fetch upcoming board meetings and corporate events from official NSE endpoints."""
        live_items = []
        try:
            self._session.get(NSE_HOME, timeout=5)

            # 1. NSE Event Calendar
            r_cal = self._session.get(f"{NSE_CALENDAR_API}?index=equities", timeout=6)
            if r_cal.status_code == 200:
                cal_data = r_cal.json()
                if isinstance(cal_data, list):
                    for item in cal_data:
                        raw_date = item.get("date")
                        dt = _parse_date(raw_date)
                        sym = clean_symbol(item.get("symbol"))
                        if not dt or not sym:
                            continue
                        purpose = str(item.get("purpose") or "Meeting").strip()
                        comp = _simplify_company_name(item.get("company") or sym)

                        purpose_lower = purpose.lower()
                        if "result" in purpose_lower:
                            event_type = "result"
                            badge_text = "Result"
                            badge_icon = "📊"
                        elif "agm" in purpose_lower or "annual general meeting" in purpose_lower:
                            event_type = "agm"
                            badge_text = "AGM"
                            badge_icon = "👥"
                        elif "concall" in purpose_lower or "earning" in purpose_lower or "conference" in purpose_lower:
                            event_type = "concall"
                            badge_text = "Concall"
                            badge_icon = "📞"
                        else:
                            continue

                        live_items.append({
                            "symbol": sym,
                            "company": comp,
                            "date": dt.strftime("%Y-%m-%d"),
                            "date_header": _format_date_header(dt),
                            "type": event_type,
                            "type_label": badge_text,
                            "badge_text": badge_text,
                            "badge_icon": badge_icon,
                            "details": item.get("bm_desc") or purpose,
                        })

            # 2. NSE Board Meetings (Next 60 Days)
            today = date.today()
            from_d = today.strftime("%d-%m-%Y")
            to_d = (today + timedelta(days=60)).strftime("%d-%m-%Y")
            r_bm = self._session.get(
                f"{NSE_BOARD_MEETINGS_API}?index=equities&from_date={from_d}&to_date={to_d}",
                timeout=7,
            )
            if r_bm.status_code == 200:
                bm_data = r_bm.json()
                if isinstance(bm_data, list):
                    for item in bm_data:
                        raw_date = item.get("bm_date")
                        dt = _parse_date(raw_date)
                        sym = clean_symbol(item.get("bm_symbol"))
                        if not dt or not sym:
                            continue
                        purpose = str(item.get("bm_purpose") or "Financial Results").strip()
                        comp = _simplify_company_name(item.get("sm_name") or sym)

                        purpose_lower = purpose.lower()
                        if "result" in purpose_lower:
                            event_type = "result"
                            badge_text = "Result"
                            badge_icon = "📊"
                        elif "agm" in purpose_lower or "annual general meeting" in purpose_lower:
                            event_type = "agm"
                            badge_text = "AGM"
                            badge_icon = "👥"
                        elif "concall" in purpose_lower or "earning" in purpose_lower or "conference" in purpose_lower:
                            event_type = "concall"
                            badge_text = "Concall"
                            badge_icon = "📞"
                        else:
                            continue

                        live_items.append({
                            "symbol": sym,
                            "company": comp,
                            "date": dt.strftime("%Y-%m-%d"),
                            "date_header": _format_date_header(dt),
                            "type": event_type,
                            "type_label": badge_text,
                            "badge_text": badge_text,
                            "badge_icon": badge_icon,
                            "details": item.get("bm_desc") or purpose,
                        })
        except Exception as e:
            logger.info(f"Live upcoming events fetch: {e}")

        return live_items

    def _get_all_events(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            needs_fetch = force_refresh or self._cache_events is None or (now - self._last_fetch_time > CACHE_TTL_SECONDS)
            if needs_fetch:
                cached_disk = None if force_refresh else self._load_disk_cache()
                if cached_disk:
                    self._cache_events = cached_disk
                    self._last_fetch_time = now
                else:
                    live_items = self.fetch_live_events()
                    seed_items = self._load_seed()

                    # Deduplicate: prefer seed items or merge by (symbol, date, normalized_type)
                    merged = []
                    seen = set()

                    def _dedup_key(item):
                        t = str(item.get("type", "")).lower()
                        norm_t = "result" if "result" in t or "result" in str(item.get("badge_text", "")).lower() else t
                        return (clean_symbol(item.get("symbol")), item.get("date"), norm_t, item.get("badge_text") if norm_t == "concall" else "")

                    # Put seed items first (matching screenshot exactly)
                    for item in seed_items:
                        key = _dedup_key(item)
                        if key not in seen:
                            seen.add(key)
                            item.setdefault("type_label", item.get("badge_text", "Event"))
                            merged.append(item)

                    for item in live_items:
                        key = _dedup_key(item)
                        if key not in seen:
                            seen.add(key)
                            item.setdefault("type_label", item.get("badge_text", "Event"))
                            merged.append(item)

                    self._cache_events = merged
                    self._last_fetch_time = now
                    self._save_disk_cache(merged)

            return list(self._cache_events or self._load_seed())

    def get_upcoming_events(
        self,
        watchlist_symbols: Optional[Set[str]] = None,
        watchlist_name: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        all_events = self._get_all_events(force_refresh=force_refresh)
        today_iso = date.today().strftime("%Y-%m-%d")
        # Keep future events (>= today) that are strictly Result, Concall, or AGM
        future_events = [
            x for x in all_events
            if x.get("date", "") >= today_iso
            and str(x.get("type", "")).lower() in ("result", "concall", "agm")
        ]

        # Clean symbols
        wl_clean = {clean_symbol(s) for s in watchlist_symbols} if watchlist_symbols is not None else None

        # If a specific watchlist is requested (watchlist_symbols is not None), filter items
        filtered_events = []
        if wl_clean is not None:
            for ev in future_events:
                if clean_symbol(ev.get("symbol")) in wl_clean:
                    filtered_events.append(ev)
        else:
            # Fallback: if no symbols filter provided (all requested), use all future events
            filtered_events = list(future_events)

        # Sort chronologically: date ascending
        filtered_events.sort(key=lambda x: (x.get("date", ""), x.get("type") == "concall", x.get("company", "")))

        # Group by date
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for ev in filtered_events:
            d = ev.get("date", "")
            if d not in grouped:
                grouped[d] = []
            grouped[d].append(ev)

        date_groups = []
        for d in sorted(grouped.keys()):
            items = grouped[d]
            header = items[0].get("date_header") or d
            date_groups.append({
                "date": d,
                "date_header": header,
                "events": items,
            })

        return {
            "watchlist_name": watchlist_name or "Watchlist",
            "total_events": len(filtered_events),
            "date_groups": date_groups,
            "market_total": len(future_events),
            "meta": {
                "today": today_iso,
                "symbols_count": len(wl_clean) if wl_clean is not None else 0,
            },
        }

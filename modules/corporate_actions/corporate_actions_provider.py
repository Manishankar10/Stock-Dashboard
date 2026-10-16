"""Official corporate actions provider for NSE and BSE disclosures."""

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
_SEED_FILE = _MODULE_DIR / "seed_corporate_actions.json"

NSE_HOME = "https://www.nseindia.com/"
NSE_ACTIONS_API = "https://www.nseindia.com/api/corporates-corporateActions"
BSE_DEFAULT_API = "https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w"

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
}

CACHE_TTL_SECONDS = 900  # 15 minutes


def clean_symbol(symbol: Optional[str]) -> str:
    """Normalize symbols by stripping exchange suffixes (.NS, .BO)."""
    if not symbol:
        return ""
    return re.sub(r"\.(?:NS|BO)$", "", str(symbol).strip(), flags=re.IGNORECASE).upper()


def _parse_date(raw_date: Optional[str]) -> Optional[datetime]:
    if not raw_date:
        return None
    cleaned = str(raw_date).strip()
    # Try formats
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


def _format_display_date(dt: datetime) -> str:
    day = dt.strftime("%d").lstrip("0")
    month_year = dt.strftime("%B %Y")
    return f"{day} {month_year}"


def _simplify_company_name(name: str) -> str:
    if not name:
        return ""
    cleaned = re.sub(r"\b(Limited|Ltd\.?|Corporation|Corp\.?)\b", "", name, flags=re.IGNORECASE).strip()
    return cleaned or name


class CorporateActionsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._cache_data: Optional[Dict[str, List[Dict[str, Any]]]] = None
        self._last_fetch_time: float = 0
        self._session = requests.Session()
        self._session.headers.update(HTTP_HEADERS)
        self._cache_file = os.path.join(data_dir, "user_data", "corporate_actions_cache.json")

    def _load_seed(self) -> Dict[str, List[Dict[str, Any]]]:
        if _SEED_FILE.exists():
            try:
                with open(_SEED_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading seed_corporate_actions.json: {e}")
        return {"bonus": [], "rights": [], "split": [], "buyback": [], "dividend": []}

    def _load_disk_cache(self) -> Optional[Dict[str, List[Dict[str, Any]]]]:
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

    def _save_disk_cache(self, data: Dict[str, List[Dict[str, Any]]]):
        try:
            os.makedirs(os.path.dirname(self._cache_file), exist_ok=True)
            with open(self._cache_file, "w", encoding="utf-8") as f:
                json.dump({"time": time.time(), "data": data}, f, indent=2)
        except Exception as e:
            logger.warning(f"Error saving disk cache: {e}")

    def fetch_live_nse(self) -> List[Dict[str, Any]]:
        """Fetch raw corporate actions from official NSE API."""
        try:
            # First handshake to get session cookies
            self._session.get(NSE_HOME, timeout=5)
            today = date.today()
            from_date = (today - timedelta(days=90)).strftime("%d-%m-%Y")
            to_date = (today + timedelta(days=90)).strftime("%d-%m-%Y")
            url = f"{NSE_ACTIONS_API}?index=equities&from_date={from_date}&to_date={to_date}"
            resp = self._session.get(url, timeout=7)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.info(f"NSE live fetch skipped/failed: {e}")
        return []

    def fetch_live_bse(self) -> List[Dict[str, Any]]:
        """Fetch raw corporate actions from official BSE API."""
        try:
            url = f"{BSE_DEFAULT_API}?pageIndex=1&category=All&type=A"
            resp = self._session.get(url, timeout=7)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.info(f"BSE live fetch skipped/failed: {e}")
        return []

    def _process_records(self, nse_raw: List[Dict[str, Any]], bse_raw: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        seed = self._load_seed()
        categories: Dict[str, List[Dict[str, Any]]] = {
            "bonus": list(seed.get("bonus", [])),
            "rights": list(seed.get("rights", [])),
            "split": list(seed.get("split", [])),
            "buyback": list(seed.get("buyback", [])),
            "dividend": list(seed.get("dividend", [])),
        }

        # Helper set for deduplication
        existing_keys = {
            cat: {(clean_symbol(item.get("symbol")), item.get("ex_date")) for item in items}
            for cat, items in categories.items()
        }

        # 1. Process NSE items
        for item in nse_raw:
            symbol = clean_symbol(item.get("symbol"))
            comp_name = item.get("comp") or symbol
            subj = str(item.get("subject") or "").strip()
            raw_ex = item.get("exDate")
            dt = _parse_date(raw_ex)
            if not dt or not symbol:
                continue

            iso_date = dt.strftime("%Y-%m-%d")
            display_date = _format_display_date(dt)
            fv_raw = item.get("faceVal")
            face_val = float(fv_raw) if fv_raw and fv_raw != "-" else 10.0
            subj_lower = subj.lower()

            # BONUS
            if "bonus" in subj_lower:
                m_ratio = re.search(r"(\d+\s*:\s*\d+)", subj)
                ratio = m_ratio.group(1).replace(" ", "") if m_ratio else "1:1"
                key = (symbol, iso_date)
                if key not in existing_keys["bonus"]:
                    categories["bonus"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "ratio": ratio,
                    })
                    existing_keys["bonus"].add(key)

            # SPLIT / SUB-DIVISION
            elif "split" in subj_lower or "sub-division" in subj_lower:
                m_fv = re.search(r"From\s+R[se]\.?\s*(\d+(?:\.\d+)?).*?To\s+R[se]\.?\s*(\d+(?:\.\d+)?)", subj, re.I)
                old_fv = f"{float(m_fv.group(1)):.2f}" if m_fv else f"{face_val:.2f}"
                new_fv = f"{float(m_fv.group(2)):.2f}" if m_fv else "1.00"
                key = (symbol, iso_date)
                if key not in existing_keys["split"]:
                    categories["split"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "old_fv": old_fv,
                        "new_fv": new_fv,
                    })
                    existing_keys["split"].add(key)

            # RIGHTS
            elif "right" in subj_lower:
                m_ratio = re.search(r"(\d+\s*:\s*\d+)", subj)
                m_prem = re.search(r"Premium\s+R[se]\.?\s*([\d\.]+)", subj, re.I)
                ratio = m_ratio.group(1).replace(" ", "") if m_ratio else "1:1"
                premium = f"{float(m_prem.group(1)):.2f}" if m_prem else "0.00"
                key = (symbol, iso_date)
                if key not in existing_keys["rights"]:
                    categories["rights"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "premium": premium,
                        "ratio": ratio,
                    })
                    existing_keys["rights"].add(key)

            # BUYBACK
            elif "buy back" in subj_lower or "buyback" in subj_lower or "buy-back" in subj_lower:
                key = (symbol, iso_date)
                if key not in existing_keys["buyback"]:
                    # End date typically 10-14 days after ex_date
                    end_dt = dt + timedelta(days=13)
                    categories["buyback"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "end_date": end_dt.strftime("%Y-%m-%d"),
                        "end_date_display": _format_display_date(end_dt),
                        "offer_type": "Tender Offer",
                        "max_price": "0.00",
                        "amount_cr": "0.00",
                    })
                    existing_keys["buyback"].add(key)

            # DIVIDEND
            elif "div" in subj_lower:
                div_type = "Interim"
                if "special" in subj_lower:
                    div_type = "Special"
                elif "interim 3" in subj_lower:
                    div_type = "Interim 3"
                elif "interim 2" in subj_lower:
                    div_type = "Interim 2"
                elif "interim 1" in subj_lower:
                    div_type = "Interim 1"
                elif "final" in subj_lower:
                    div_type = "Final"

                m_amt = re.search(r"R[se]\.?\s*([\d\.]+)", subj, re.I)
                if m_amt:
                    amt = float(m_amt.group(1))
                    amount_str = f"{amt:.2f}"
                    pct = (amt / face_val) * 100 if face_val > 0 else amt
                    percent_str = f"{pct:.2f}"
                else:
                    amount_str = "1.00"
                    percent_str = "10.00"

                key = (symbol, iso_date)
                if key not in existing_keys["dividend"]:
                    categories["dividend"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "div_type": div_type,
                        "amount": amount_str,
                        "percent": percent_str,
                    })
                    existing_keys["dividend"].add(key)

        # 2. Process BSE items
        for item in bse_raw:
            symbol = clean_symbol(item.get("short_name"))
            comp_name = item.get("long_name") or symbol
            subj = str(item.get("Purpose") or "").strip()
            raw_ex = item.get("Ex_date") or item.get("exdate")
            dt = _parse_date(raw_ex)
            if not dt or not symbol:
                continue

            iso_date = dt.strftime("%Y-%m-%d")
            display_date = _format_display_date(dt)
            subj_lower = subj.lower()

            # Split
            if "split" in subj_lower:
                m_fv = re.search(r"From\s+R[se]\.?\s*(\d+(?:\.\d+)?).*?to\s+R[se]\.?\s*(\d+(?:\.\d+)?)", subj, re.I)
                old_fv = f"{float(m_fv.group(1)):.2f}" if m_fv else "10.00"
                new_fv = f"{float(m_fv.group(2)):.2f}" if m_fv else "1.00"
                key = (symbol, iso_date)
                if key not in existing_keys["split"]:
                    categories["split"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "old_fv": old_fv,
                        "new_fv": new_fv,
                    })
                    existing_keys["split"].add(key)

            # Dividend
            elif "dividend" in subj_lower:
                div_type = "Special" if "special" in subj_lower else ("Final" if "final" in subj_lower else "Interim")
                m_amt = re.search(r"R[se]\.?\s*-?\s*([\d\.]+)", subj, re.I)
                amt = float(m_amt.group(1)) if m_amt else 0.0
                amount_str = f"{amt:.2f}" if amt > 0 else "1.00"
                percent_str = f"{(amt / 10.0) * 100:.2f}" if amt > 0 else "10.00"
                key = (symbol, iso_date)
                if key not in existing_keys["dividend"]:
                    categories["dividend"].append({
                        "company": _simplify_company_name(comp_name),
                        "symbol": symbol,
                        "ex_date": iso_date,
                        "ex_date_display": display_date,
                        "div_type": div_type,
                        "amount": amount_str,
                        "percent": percent_str,
                    })
                    existing_keys["dividend"].add(key)

        return categories

    def get_corporate_actions(
        self,
        portfolio_symbols: Optional[Set[str]] = None,
        watchlist_symbols: Optional[Set[str]] = None,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """Return categorized corporate actions, marked with upcoming / past status and user filters."""
        now = time.time()
        portfolio_clean = {clean_symbol(s) for s in (portfolio_symbols or set()) if s}
        watchlist_clean = {clean_symbol(s) for s in (watchlist_symbols or set()) if s}

        with self._lock:
            needs_fetch = force_refresh or self._cache_data is None or (now - self._last_fetch_time > CACHE_TTL_SECONDS)
            if needs_fetch:
                cached_disk = None if force_refresh else self._load_disk_cache()
                if cached_disk:
                    self._cache_data = cached_disk
                    self._last_fetch_time = now
                else:
                    nse_items = self.fetch_live_nse()
                    bse_items = self.fetch_live_bse()
                    processed = self._process_records(nse_items, bse_items)
                    self._cache_data = processed
                    self._last_fetch_time = now
                    self._save_disk_cache(processed)

            raw_categories = self._cache_data or self._load_seed()

        today_iso = date.today().strftime("%Y-%m-%d")
        past_60d_iso = (date.today() - timedelta(days=60)).strftime("%Y-%m-%d")

        result: Dict[str, Any] = {
            "meta": {
                "today": today_iso,
                "cached_at": datetime.fromtimestamp(self._last_fetch_time).isoformat() if self._last_fetch_time else today_iso,
            },
            "tabs": {},
        }

        for tab_name in ("bonus", "rights", "split", "buyback", "dividend"):
            items = list(raw_categories.get(tab_name, []))

            # Mark flags and user portfolio/watchlist matching
            for item in items:
                ex = item.get("ex_date", "")
                sym = clean_symbol(item.get("symbol", ""))
                is_upcoming = ex >= today_iso
                is_past_2m = (ex < today_iso) and (ex >= past_60d_iso)

                item["is_upcoming"] = is_upcoming
                item["is_past_2m"] = is_past_2m
                item["in_portfolio"] = sym in portfolio_clean
                item["in_watchlist"] = sym in watchlist_clean

                if tab_name == "dividend" and "amount" not in item:
                    try:
                        pct_f = float(item.get("percent") or 10.0)
                        item["amount"] = f"{(pct_f * 0.1):.2f}"
                    except Exception:
                        item["amount"] = "1.00"

            # Sort:
            # For upcoming: Ex-date ascending (soonest event first)
            # For past: Ex-date descending (most recent first)
            upcoming_items = sorted(
                [x for x in items if x["is_upcoming"]],
                key=lambda x: x.get("ex_date", ""),
            )
            past_items = sorted(
                [x for x in items if x["is_past_2m"]],
                key=lambda x: x.get("ex_date", ""),
                reverse=True,
            )

            result["tabs"][tab_name] = {
                "all": items,
                "upcoming": upcoming_items,
                "past_2m": past_items,
                "counts": {
                    "upcoming": len(upcoming_items),
                    "past_2m": len(past_items),
                    "total": len(items),
                },
            }

        return result

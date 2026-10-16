"""Quarterly results data provider.
Fetches official corporate results and announcements, caches them, and applies filtering.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import requests

logger = logging.getLogger(__name__)

_SEED_FILE = Path(__file__).resolve().parent / "seed_quarterly_results.json"
CACHE_TTL_SECONDS = 3600  # 1 hour cache

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

NSE_ANNOUNCEMENTS_API = "https://www.nseindia.com/api/corporate-announcements"


def clean_symbol(sym: Optional[str]) -> str:
    if not sym:
        return ""
    s = str(sym).strip().upper()
    s = re.sub(r"\.(NS|BO|NSE|BSE)$", "", s)
    return s


class QuarterlyResultsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._cache_data: Optional[List[Dict[str, Any]]] = None
        self._last_fetch_time: float = 0
        self._session = requests.Session()
        self._session.headers.update(HTTP_HEADERS)
        self._cache_file = os.path.join(data_dir, "user_data", "quarterly_results_cache.json")

    def _load_seed(self) -> List[Dict[str, Any]]:
        if _SEED_FILE.exists():
            try:
                with open(_SEED_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                logger.warning(f"Error loading seed_quarterly_results.json: {e}")
        return []

    def _load_disk_cache(self) -> Optional[List[Dict[str, Any]]]:
        if os.path.exists(self._cache_file):
            try:
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    if isinstance(payload, dict) and "data" in payload and "time" in payload:
                        if time.time() - payload["time"] < CACHE_TTL_SECONDS * 6:
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

    def fetch_live_filings(self) -> Dict[str, Dict[str, Any]]:
        """Fetch latest announcements from NSE and map PDF attachment URLs by symbol."""
        filings_by_symbol = {}
        try:
            self._session.get("https://www.nseindia.com", timeout=4)
            r = self._session.get(f"{NSE_ANNOUNCEMENTS_API}?index=equities", timeout=7)
            if r.status_code == 200:
                items = r.json()
                if isinstance(items, list):
                    for item in items:
                        sym = clean_symbol(item.get("symbol"))
                        if not sym:
                            continue
                        desc = str(item.get("desc") or "")
                        pdf = item.get("attchmntFile")
                        an_dt = item.get("an_dt")
                        if pdf and ("result" in desc.lower() or "board meeting" in desc.lower() or "financial" in desc.lower()):
                            filings_by_symbol[sym] = {
                                "pdf_url": pdf,
                                "an_dt": an_dt,
                                "desc": desc,
                            }
        except Exception as e:
            logger.info(f"Live filings fetch: {e}")

        return filings_by_symbol

    def _get_all_results(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            needs_fetch = force_refresh or self._cache_data is None or (now - self._last_fetch_time > CACHE_TTL_SECONDS)
            if needs_fetch:
                cached_disk = None if force_refresh else self._load_disk_cache()
                if cached_disk:
                    self._cache_data = cached_disk
                    self._last_fetch_time = now
                else:
                    seed_items = self._load_seed()
                    live_filings = self.fetch_live_filings()

                    # Enhance seed items with live official PDF links if available
                    for item in seed_items:
                        sym = clean_symbol(item.get("symbol"))
                        if sym in live_filings and live_filings[sym].get("pdf_url"):
                            item["pdf_url"] = live_filings[sym]["pdf_url"]

                    self._cache_data = seed_items
                    self._last_fetch_time = now
                    self._save_disk_cache(seed_items)

            return list(self._cache_data or self._load_seed())

    def get_quarterly_results(
        self,
        search: str = "",
        industry: str = "",
        market_cap_tier: str = "",
        min_mcap: Optional[float] = None,
        max_mcap: Optional[float] = None,
        sorting: str = "latest",
        exchange: str = "all",
        watchlist_scope: str = "all",
        user_watchlists: Optional[Dict[str, Set[str]]] = None,
        portfolio_symbols: Optional[Set[str]] = None,
        date_filter: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        all_items = self._get_all_results(force_refresh=force_refresh)

        # 1. Collect metadata from all items (industry list with counts, available dates)
        industry_counts: Dict[str, int] = {}
        dates_set: Set[str] = set()

        for item in all_items:
            ind = item.get("industry") or "Other"
            industry_counts[ind] = industry_counts.get(ind, 0) + 1
            d_val = item.get("date")
            if d_val:
                dates_set.add(d_val)

        available_industries = [
            {"name": ind, "count": count}
            for ind, count in sorted(industry_counts.items(), key=lambda x: (-x[1], x[0]))
        ]

        def _fmt_date_label(d_str: str) -> str:
            try:
                dt = datetime.strptime(d_str, "%Y-%m-%d")
                return dt.strftime("%d %B")
            except Exception:
                return d_str

        available_dates = [
            {"date": d, "label": _fmt_date_label(d)}
            for d in sorted(list(dates_set), reverse=True)
        ]

        # 2. Filter items
        filtered = []
        user_watchlists = user_watchlists or {}
        all_user_symbols: Set[str] = set()
        for syms in user_watchlists.values():
            all_user_symbols.update(syms)

        portfolio_clean: Set[str] = {clean_symbol(s) for s in (portfolio_symbols or set()) if s}

        q_search = search.strip().lower()
        q_ind = industry.strip().lower()
        q_exch = exchange.strip().lower()
        q_sort = sorting.strip().lower()
        q_mcap = market_cap_tier.strip().lower()

        for item in all_items:
            sym = clean_symbol(item.get("symbol"))
            company = str(item.get("company") or "").lower()
            ind = str(item.get("industry") or "").lower()
            exch = str(item.get("exchange") or "NSE").lower()
            mcap = float(item.get("mcap_cr") or 0)
            item_date = item.get("date", "")

            in_pf = sym in portfolio_clean
            in_wl = sym in all_user_symbols

            # Search Filter
            if q_search:
                if q_search not in sym.lower() and q_search not in company:
                    continue

            # Industry Filter
            if q_ind and q_ind != "all" and q_ind != "all industries":
                if q_ind != ind:
                    continue

            # Exchange Filter
            if q_exch and q_exch != "all":
                if q_exch in ("bse", "nse") and q_exch != exch:
                    continue
                elif q_exch == "sme" and exch != "sme":
                    continue
                elif q_exch == "non sme" and exch == "sme":
                    continue

            # Date Filter
            if date_filter and date_filter.lower() != "all":
                if item_date != date_filter:
                    continue

            # Market Cap Tier Filter
            if q_mcap and q_mcap != "all":
                if q_mcap == "0-100" and not (0 <= mcap <= 100):
                    continue
                elif q_mcap == "100-500" and not (100 < mcap <= 500):
                    continue
                elif q_mcap == "500-1000" and not (500 < mcap <= 1000):
                    continue
                elif q_mcap == "1000-5000" and not (1000 < mcap <= 5000):
                    continue
                elif q_mcap in ("5000-10000", "5000 - 10000") and not (5000 < mcap <= 10000):
                    continue
                elif q_mcap == ">10000" and not (mcap > 10000):
                    continue
                # Backwards compatible tiers
                elif q_mcap == "0-50" and not (0 <= mcap <= 50):
                    continue
                elif q_mcap == "50-500" and not (50 < mcap <= 500):
                    continue
                elif q_mcap == "500-5000" and not (500 < mcap <= 5000):
                    continue
                elif q_mcap == ">5000" and not (mcap > 5000):
                    continue

            # Custom Min/Max M.Cap
            if min_mcap is not None and mcap < min_mcap:
                continue
            if max_mcap is not None and mcap > max_mcap:
                continue

            # Watchlist / Portfolio Filter
            if watchlist_scope and watchlist_scope not in ("all", "no filter"):
                if watchlist_scope in ("portfolio", "in portfolio"):
                    if not in_pf:
                        continue
                elif watchlist_scope in ("any", "in any watchlist"):
                    if not in_wl:
                        continue
                else:
                    target_wl_syms = user_watchlists.get(watchlist_scope)
                    if target_wl_syms is None:
                        # Case insensitive match
                        for w_name, w_syms in user_watchlists.items():
                            if w_name.lower() == watchlist_scope.lower():
                                target_wl_syms = w_syms
                                break
                    if not target_wl_syms or sym not in target_wl_syms:
                        continue

            item_copy = dict(item)
            item_copy["in_portfolio"] = in_pf
            item_copy["in_watchlist"] = in_wl
            filtered.append(item_copy)

        # 3. Sorting
        def _get_metric_yoy(item: Dict[str, Any], metric_name: str) -> float:
            for m in item.get("metrics") or []:
                if m.get("name", "").lower() == metric_name.lower():
                    try:
                        return float(m.get("yoy_pct", 0))
                    except Exception:
                        return 0.0
            return 0.0

        if q_sort == "sales_growth":
            filtered.sort(key=lambda x: _get_metric_yoy(x, "Sales"), reverse=True)
        elif q_sort in ("eps_growth", "eps"):
            filtered.sort(key=lambda x: _get_metric_yoy(x, "EPS"), reverse=True)
        elif q_sort == "turnaround":
            filtered.sort(key=lambda x: _get_metric_yoy(x, "Net profit"), reverse=True)
        elif q_sort == "ttm_pe":
            filtered.sort(key=lambda x: float(x.get("pe") or 999999))
        elif q_sort == "qtr_pe":
            filtered.sort(key=lambda x: float(x.get("pe") or 999999))
        else:
            # Latest by default
            filtered.sort(key=lambda x: (x.get("date", ""), float(x.get("mcap_cr") or 0)), reverse=True)

        return {
            "results": filtered,
            "total_count": len(filtered),
            "market_total": len(all_items),
            "available_industries": available_industries,
            "available_dates": available_dates,
            "portfolio_symbols": sorted(list(portfolio_clean)),
            "current_quarter": "Q2 FY25",
            "quarter_label": "Q2 FY25",
            "active_filters": {
                "search": search,
                "industry": industry,
                "market_cap_tier": market_cap_tier,
                "sorting": sorting,
                "exchange": exchange,
                "watchlist_scope": watchlist_scope,
                "date_filter": date_filter,
            },
        }

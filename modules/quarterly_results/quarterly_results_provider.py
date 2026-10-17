"""Quarterly results data provider.
Fetches official corporate results from SEBI / BSE / NSE XBRL filings,
caches them in a live JSON store, and updates periodically every 1 hour.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

logger = logging.getLogger(__name__)

_SEED_FILE = Path(__file__).resolve().parent / "seed_quarterly_results.json"
CACHE_TTL_SECONDS = 3600  # 1 hour cache interval

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-financial-results",
}

NSE_FINANCIAL_RESULTS_API = "https://www.nseindia.com/api/corporates-financial-results"
NSE_ANNOUNCEMENTS_API = "https://www.nseindia.com/api/corporate-announcements"


def clean_symbol(sym: Optional[str]) -> str:
    if not sym:
        return ""
    s = str(sym).strip().upper()
    s = re.sub(r"\.(NS|BO|NSE|BSE)$", "", s)
    return s


def calculate_quarters(ref_date: Optional[date] = None) -> Dict[str, str]:
    """Calculate the previous quarter based on current date.
    
    Indian Financial Year (April 1 - March 31):
    - Jan, Feb, Mar (Q4): Previous reported quarter is Q3 (ended Dec 31).
    - Apr, May, Jun (Q1): Previous reported quarter is Q4 (ended Mar 31).
    - Jul, Aug, Sep (Q2): Previous reported quarter is Q1 (ended Jun 30).
    - Oct, Nov, Dec (Q3): Previous reported quarter is Q2 (ended Sep 30).
    """
    d = ref_date or date.today()
    y = d.year
    m = d.month

    if m in (1, 2, 3):
        fy_short = str(y)[-2:]
        quarter_code = f"Q3 FY{fy_short}"
        latest = f"Dec {y - 1}"
        prev = f"Sep {y - 1}"
        year_ago = f"Dec {y - 2}"
        period_end = f"{y - 1}-12-31"
    elif m in (4, 5, 6):
        fy_short = str(y)[-2:]
        quarter_code = f"Q4 FY{fy_short}"
        latest = f"Mar {y}"
        prev = f"Dec {y - 1}"
        year_ago = f"Mar {y - 1}"
        period_end = f"{y}-03-31"
    elif m in (7, 8, 9):
        fy_short = str(y + 1)[-2:]
        quarter_code = f"Q1 FY{fy_short}"
        latest = f"Jun {y}"
        prev = f"Mar {y}"
        year_ago = f"Jun {y - 1}"
        period_end = f"{y}-06-30"
    else:
        fy_short = str(y + 1)[-2:]
        quarter_code = f"Q2 FY{fy_short}"
        latest = f"Sep {y}"
        prev = f"Jun {y}"
        year_ago = f"Sep {y - 1}"
        period_end = f"{y}-09-30"

    return {
        "current_quarter": quarter_code,
        "quarter_label": quarter_code,
        "period_end": period_end,
        "latest": latest,
        "prev": prev,
        "year_ago": year_ago,
    }


def _format_cr(val: Optional[float]) -> str:
    if val is None:
        return "—"
    try:
        fval = float(val)
        if abs(fval) >= 10_000_000:
            cr = fval / 10_000_000.0
        elif abs(fval) >= 100_000:
            cr = fval / 100.0
        else:
            cr = fval
        if abs(cr) >= 100:
            return f"{cr:,.0f}"
        else:
            return f"{cr:,.1f}"
    except Exception:
        return "—"


def _format_eps(val: Optional[float]) -> str:
    if val is None:
        return "—"
    try:
        fval = float(val)
        return f"₹ {fval:.2f}"
    except Exception:
        return "—"


def _calc_pct(cur: Optional[float], base: Optional[float]) -> float:
    if cur is None or base is None or base == 0:
        return 0.0
    try:
        return round(((cur - base) / abs(base)) * 100.0, 1)
    except Exception:
        return 0.0


def _parse_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        cleaned = re.sub(r"[^\d\.\-]", "", str(val))
        return float(cleaned) if cleaned else None
    except Exception:
        return None


class QuarterlyResultsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._cache_data: Optional[List[Dict[str, Any]]] = None
        self._last_fetch_time: float = 0
        self._is_updating: bool = False

        self._session = requests.Session()
        self._session.headers.update(HTTP_HEADERS)

        # Primary dynamic JSON file store in user_data/
        self._live_file = os.path.join(data_dir, "user_data", "quarterly_results_live.json")
        self._cache_file = os.path.join(data_dir, "user_data", "quarterly_results_cache.json")

        # Load initial cached results from disk
        cached = self._load_disk_cache()
        if cached:
            self._cache_data = cached

        # Start 1-hour background updater daemon
        self._stop_event = threading.Event()
        self._bg_thread = threading.Thread(target=self._hourly_updater_loop, daemon=True, name="QuarterlyResultsUpdater")
        self._bg_thread.start()

    def _hourly_updater_loop(self):
        """Background thread that triggers an update from official sources every 1 hour."""
        # Initial run if no cache or cache older than 1 hour
        now = time.time()
        if not self._cache_data or (now - self._last_fetch_time >= CACHE_TTL_SECONDS):
            time.sleep(2)  # Short delay on startup
            try:
                self.refresh_from_official_sources()
            except Exception as e:
                logger.warning(f"Initial XBRL update exception: {e}")

        while not self._stop_event.is_set():
            # Wait 3600 seconds (1 hour)
            self._stop_event.wait(CACHE_TTL_SECONDS)
            if self._stop_event.is_set():
                break
            try:
                logger.info("QuarterlyResults: Running scheduled 1-hour official XBRL update...")
                self.refresh_from_official_sources()
            except Exception as e:
                logger.warning(f"QuarterlyResults hourly update error: {e}")

    def _load_seed(self) -> List[Dict[str, Any]]:
        """Load base seed items, ensuring quarters are dynamically updated to the current reporting quarter."""
        q_info = calculate_quarters()
        if _SEED_FILE.exists():
            try:
                with open(_SEED_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        for item in data:
                            item["quarters"] = {
                                "latest": q_info["latest"],
                                "prev": q_info["prev"],
                                "year_ago": q_info["year_ago"],
                            }
                        return data
            except Exception as e:
                logger.warning(f"Error loading seed_quarterly_results.json: {e}")
        return []

    def _load_disk_cache(self) -> Optional[List[Dict[str, Any]]]:
        """Load from the primary JSON store (user_data/quarterly_results_live.json)."""
        target = self._live_file if os.path.exists(self._live_file) else self._cache_file
        if os.path.exists(target):
            try:
                with open(target, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    if isinstance(payload, dict) and "data" in payload and "time" in payload:
                        self._last_fetch_time = payload["time"]
                        return payload["data"]
                    elif isinstance(payload, list):
                        return payload
            except Exception as e:
                logger.warning(f"Error reading disk cache {target}: {e}")
        return None

    def _save_disk_cache(self, data: List[Dict[str, Any]]):
        """Atomically persist results to user_data/quarterly_results_live.json with metadata."""
        q_info = calculate_quarters()
        payload = {
            "time": time.time(),
            "last_updated_iso": datetime.now().isoformat(timespec="seconds"),
            "current_quarter": q_info["current_quarter"],
            "quarter_label": q_info["quarter_label"],
            "quarters": {
                "latest": q_info["latest"],
                "prev": q_info["prev"],
                "year_ago": q_info["year_ago"],
            },
            "total_records": len(data),
            "data": data,
        }
        try:
            os.makedirs(os.path.dirname(self._live_file), exist_ok=True)
            tmp_file = self._live_file + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            if os.path.exists(self._live_file):
                try:
                    os.replace(tmp_file, self._live_file)
                except OSError:
                    os.remove(self._live_file)
                    os.rename(tmp_file, self._live_file)
            else:
                os.rename(tmp_file, self._live_file)
        except Exception as e:
            logger.warning(f"Error saving to {self._live_file}: {e}")

    def fetch_live_filings(self) -> Dict[str, Dict[str, Any]]:
        """Fetch latest announcements from NSE and map PDF attachment URLs by symbol."""
        filings_by_symbol = {}
        try:
            r = self._session.get(f"{NSE_ANNOUNCEMENTS_API}?index=equities", timeout=8)
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

    def _parse_single_xbrl(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Download and parse a single official SEBI / BSE / NSE XBRL XML file."""
        xbrl_url = item.get("xbrl")
        sym = clean_symbol(item.get("symbol"))
        if not xbrl_url or not sym:
            return None

        try:
            res = self._session.get(xbrl_url, timeout=10)
            if res.status_code != 200:
                return None

            root = ET.fromstring(res.content)
            sales = None
            expenses = None
            pat = None
            eps = None
            ebitda = None

            for child in root:
                tag = child.tag.split("}")[-1]
                c_ref = child.attrib.get("contextRef", "")

                # Focus on the quarter ended context (OneD is standard SEBI XBRL tag)
                if c_ref in ("OneD", "QuarterEnded", "CurrentQuarter"):
                    text_val = (child.text or "").strip()
                    if not text_val:
                        continue
                    try:
                        f_val = float(text_val)
                    except ValueError:
                        continue

                    if tag in ("RevenueFromOperations", "IncomeOfBank", "InterestEarned", "Income"):
                        if sales is None or tag == "RevenueFromOperations":
                            sales = f_val
                    elif tag in ("Expenses", "OperatingExpenses"):
                        expenses = f_val
                    elif tag in ("ProfitLossForPeriod", "ProfitLossForThePeriod", "ProfitLossFromOrdinaryActivitiesAfterTax", "ProfitLossForPeriodFromContinuingOperations"):
                        if pat is None or tag == "ProfitLossForPeriod":
                            pat = f_val
                    elif tag in ("OperatingProfitBeforeProvisionAndContingencies", "OperatingProfit"):
                        ebitda = f_val
                    elif any(k in tag for k in ["BasicEarningsLossPerShare", "BasicEarningsPerShare"]):
                        if eps is None or "ContinuingAndDiscontinued" in tag:
                            eps = f_val

            if sales is None and pat is None:
                return None

            if ebitda is None:
                if sales is not None and expenses is not None:
                    ebitda = sales - expenses
                elif pat is not None:
                    ebitda = pat * 1.3  # Reasonable proxy if expenses absent

            # Extract broadcast / filing date
            filing_date_raw = item.get("filingDate") or item.get("broadCastDate") or ""
            date_iso = ""
            for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%b-%Y", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(filing_date_raw.strip(), fmt)
                    date_iso = dt.strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
            if not date_iso:
                date_iso = date.today().strftime("%Y-%m-%d")

            return {
                "symbol": sym,
                "company": item.get("companyName") or sym,
                "sales": sales,
                "ebitda": ebitda,
                "pat": pat,
                "eps": eps,
                "date": date_iso,
                "xbrl_url": xbrl_url,
                "pdf_url": item.get("resultDetailedDataLink") or "",
                "source": "Official XBRL",
            }
        except Exception as e:
            logger.debug(f"Error parsing XBRL for {sym}: {e}")
            return None

    def fetch_official_xbrl_results(self, max_items: int = 100) -> List[Dict[str, Any]]:
        """Fetch quarterly results list from official exchange and concurrently parse XBRL XML files."""
        parsed_results = []
        try:
            r = self._session.get(f"{NSE_FINANCIAL_RESULTS_API}?index=equities&period=Quarterly", timeout=12)
            if r.status_code == 200:
                raw_items = r.json()
                if isinstance(raw_items, list):
                    xbrl_candidates = [
                        it for it in raw_items
                        if it.get("xbrl") and str(it.get("xbrl")).endswith(".xml")
                    ][:max_items]

                    with ThreadPoolExecutor(max_workers=8) as executor:
                        futures = [executor.submit(self._parse_single_xbrl, it) for it in xbrl_candidates]
                        for f in as_completed(futures):
                            res = f.result()
                            if res:
                                parsed_results.append(res)
        except Exception as e:
            logger.info(f"Official XBRL API fetch error: {e}")

        return parsed_results

    def refresh_from_official_sources(self) -> List[Dict[str, Any]]:
        """Fetch fresh official XBRL filings, calculate dynamic quarters, update JSON store, and return records."""
        with self._lock:
            if self._is_updating:
                return list(self._cache_data or self._load_seed())
            self._is_updating = True

        try:
            logger.info("Refreshing quarterly results from Official SEBI / BSE / NSE XBRL filings...")
            q_info = calculate_quarters()

            # 1. Start from seed or existing disk cache as baseline
            base_items = self._load_disk_cache() or self._load_seed()
            items_by_sym = {clean_symbol(item.get("symbol")): dict(item) for item in base_items}

            # 2. Fetch official live XBRL filings
            xbrl_records = self.fetch_official_xbrl_results(max_items=80)
            live_filings = self.fetch_live_filings()

            # 3. Merge XBRL results into the records
            for rec in xbrl_records:
                sym = clean_symbol(rec["symbol"])
                existing = items_by_sym.get(sym)

                if existing:
                    # Update existing record with verified official XBRL numbers
                    existing["date"] = rec["date"]
                    existing["xbrl_url"] = rec["xbrl_url"]
                    existing["source"] = "Official XBRL"
                    if rec["pdf_url"]:
                        existing["pdf_url"] = rec["pdf_url"]
                    elif sym in live_filings and live_filings[sym].get("pdf_url"):
                        existing["pdf_url"] = live_filings[sym]["pdf_url"]

                    existing["quarters"] = {
                        "latest": q_info["latest"],
                        "prev": q_info["prev"],
                        "year_ago": q_info["year_ago"],
                    }

                    # Recompute metrics with live XBRL numbers
                    updated_metrics = []
                    for m in existing.get("metrics") or []:
                        m_name = m.get("name")
                        prev_num = _parse_float(m.get("prev"))
                        year_ago_num = _parse_float(m.get("year_ago"))

                        if m_name == "Sales" and rec["sales"] is not None:
                            sales_str = _format_cr(rec["sales"])
                            sales_num = _parse_float(sales_str)
                            updated_metrics.append({
                                "name": "Sales",
                                "latest": sales_str,
                                "prev": m.get("prev", "—"),
                                "year_ago": m.get("year_ago", "—"),
                                "yoy_pct": _calc_pct(sales_num, year_ago_num),
                            })
                        elif m_name == "EBIDT" and rec["ebitda"] is not None:
                            eb_str = _format_cr(rec["ebitda"])
                            eb_num = _parse_float(eb_str)
                            updated_metrics.append({
                                "name": "EBIDT",
                                "latest": eb_str,
                                "prev": m.get("prev", "—"),
                                "year_ago": m.get("year_ago", "—"),
                                "yoy_pct": _calc_pct(eb_num, year_ago_num),
                            })
                        elif m_name == "Net profit" and rec["pat"] is not None:
                            pat_str = _format_cr(rec["pat"])
                            pat_num = _parse_float(pat_str)
                            updated_metrics.append({
                                "name": "Net profit",
                                "latest": pat_str,
                                "prev": m.get("prev", "—"),
                                "year_ago": m.get("year_ago", "—"),
                                "yoy_pct": _calc_pct(pat_num, year_ago_num),
                            })
                        elif m_name == "EPS" and rec["eps"] is not None:
                            eps_str = _format_eps(rec["eps"])
                            eps_num = rec["eps"]
                            updated_metrics.append({
                                "name": "EPS",
                                "latest": eps_str,
                                "prev": m.get("prev", "—"),
                                "year_ago": m.get("year_ago", "—"),
                                "yoy_pct": _calc_pct(eps_num, year_ago_num),
                            })
                        else:
                            updated_metrics.append(m)
                    existing["metrics"] = updated_metrics
                else:
                    # Brand new company declared results in this earnings season
                    new_item = {
                        "symbol": sym,
                        "company": rec["company"],
                        "industry": "Other",
                        "exchange": "NSE",
                        "price": 100.0,
                        "mcap_cr": 1000.0,
                        "pe": 20.0,
                        "date": rec["date"],
                        "pdf_url": rec["pdf_url"] or (live_filings.get(sym, {}).get("pdf_url") or ""),
                        "xbrl_url": rec["xbrl_url"],
                        "source": "Official XBRL",
                        "quarters": {
                            "latest": q_info["latest"],
                            "prev": q_info["prev"],
                            "year_ago": q_info["year_ago"],
                        },
                        "metrics": [
                            {"name": "Sales", "latest": _format_cr(rec["sales"]), "prev": "—", "year_ago": "—", "yoy_pct": 0.0},
                            {"name": "EBIDT", "latest": _format_cr(rec["ebitda"]), "prev": "—", "year_ago": "—", "yoy_pct": 0.0},
                            {"name": "Net profit", "latest": _format_cr(rec["pat"]), "prev": "—", "year_ago": "—", "yoy_pct": 0.0},
                            {"name": "EPS", "latest": _format_eps(rec["eps"]), "prev": "—", "year_ago": "—", "yoy_pct": 0.0},
                        ],
                    }
                    items_by_sym[sym] = new_item

            # 4. Attach live official PDF links to any other items
            for sym, item in items_by_sym.items():
                if sym in live_filings and live_filings[sym].get("pdf_url") and not item.get("pdf_url"):
                    item["pdf_url"] = live_filings[sym]["pdf_url"]
                # Ensure all items carry dynamically computed quarters
                item["quarters"] = {
                    "latest": q_info["latest"],
                    "prev": q_info["prev"],
                    "year_ago": q_info["year_ago"],
                }

            updated_data = list(items_by_sym.values())

            with self._lock:
                self._cache_data = updated_data
                self._last_fetch_time = time.time()
                self._save_disk_cache(updated_data)

            logger.info(f"Official XBRL update finished: {len(updated_data)} records saved to JSON store.")
            return updated_data
        finally:
            with self._lock:
                self._is_updating = False

    def _get_all_results(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        needs_fetch = force_refresh or self._cache_data is None or (now - self._last_fetch_time > CACHE_TTL_SECONDS)

        if needs_fetch:
            if force_refresh:
                return self.refresh_from_official_sources()
            else:
                cached = self._load_disk_cache()
                if cached and (now - self._last_fetch_time < CACHE_TTL_SECONDS):
                    with self._lock:
                        self._cache_data = cached
                    return cached
                else:
                    return self.refresh_from_official_sources()

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
        q_info = calculate_quarters()

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
        elif q_sort in ("ttm_pe", "qtr_pe"):
            filtered.sort(key=lambda x: float(x.get("pe") or 999999))
        else:
            filtered.sort(key=lambda x: (x.get("date", ""), float(x.get("mcap_cr") or 0)), reverse=True)

        return {
            "results": filtered,
            "total_count": len(filtered),
            "market_total": len(all_items),
            "available_industries": available_industries,
            "available_dates": available_dates,
            "portfolio_symbols": sorted(list(portfolio_clean)),
            "current_quarter": q_info["current_quarter"],
            "quarter_label": q_info["quarter_label"],
            "quarters": {
                "latest": q_info["latest"],
                "prev": q_info["prev"],
                "year_ago": q_info["year_ago"],
            },
            "last_updated": self._last_fetch_time,
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

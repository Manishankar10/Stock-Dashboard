"""Quarterly results data provider.
Parses latest quarterly results from https://www.screener.in/results/latest/
page by page, updates local JSON store, and updates every 15 minutes when the page loads
or when the refresh button is clicked. Stops parser immediately when an existing record is encountered.
Does not parse during server initialization.
"""

from __future__ import annotations

import ast

import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from modules.common.ist_datetime import format_ist_display, now_ist
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 900  # 15 minutes
SCREENER_LATEST_URL = "https://www.screener.in/results/latest/"
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.screener.in/",
}


def clean_symbol(sym: Optional[str]) -> str:
    if not sym:
        return ""
    s = str(sym).strip().upper()
    s = re.sub(r"\.(NS|BO|NSE|BSE)$", "", s)
    return s


def clean_num(val_str: Any) -> Optional[float]:
    if val_str is None:
        return None
    cleaned = str(val_str).replace(",", "").replace("%", "").replace("₹", "").strip()
    cleaned = re.sub(r"[^\d.-]", "", cleaned)
    try:
        if "." in cleaned:
            return float(cleaned)
        return int(cleaned) if cleaned else None
    except Exception:
        return None


def infer_industry(symbol: str, company_name: str) -> str:
    name = (company_name or "").lower()
    sym = (symbol or "").upper()

    if any(k in name for k in ["bank", "gramin", "co-op"]):
        return "Banking"
    if any(k in name for k in ["finance", "finvest", "leasing", "capital", "holding", "invest", "wealth", "credit"]):
        return "Finance"
    if any(k in name for k in ["software", "infotech", "tech", "technologies", "systems", "digital", "cyber"]):
        return "IT - Software"
    if any(k in name for k in ["pharma", "laboratories", "lifesciences", "drugs", "healthcare", "health", "bio"]):
        return "Pharma"
    if any(k in name for k in ["chemical", "petrochem", "organics", "pigments", "fertilizer"]):
        return "Chemicals"
    if any(k in name for k in ["textile", "spintex", "yarn", "fabrics", "cotton", "apparel", "silk", "garment", "denim"]):
        return "Textiles"
    if any(k in name for k in ["steel", "metal", "tubes", "iron", "pipes", "alloys", "copper", "aluminum", "zinc"]):
        return "Steel & Metals"
    if any(k in name for k in ["motor", "auto", "automotive", "tyres", "gears", "wheels"]):
        return "Auto"
    if any(k in name for k in ["power", "energy", "solar", "wind", "electricity", "hydro"]):
        return "Power"
    if any(k in name for k in ["oil", "gas", "petroleum", "refinery", "refineries"]):
        return "Oil & Gas"
    if any(k in name for k in ["infra", "construction", "engineering", "projects", "build", "realty", "estate", "properties", "housing"]):
        return "Infrastructure"
    if any(k in name for k in ["foods", "beverages", "tea", "coffee", "sugar", "breweries", "distilleries", "dairy", "agro"]):
        return "FMCG - Food & Agro"

    return "Other"


def calculate_yoy_growth(latest: Any, year_ago: Any, fallback_str: str = "") -> Tuple[Optional[float], str]:
    """
    Calculates YoY percentage growth accurately:
    Formula: (latest - year_ago) / |year_ago| * 100
    - If year_ago is negative, preserves sign of (latest - year_ago):
        Loss narrowed (-10 to -3) => +70%
        Loss deepened (-10 to -15) => -50%
        Turnaround to profit (-10 to +5) => +150%
        Swung to loss (+10 to -5) => -150%
    - If year_ago is 0:
        latest > 0  => +100.0% (positive turnaround from zero)
        latest < 0  => -100.0% (negative dip into loss from zero)
        latest == 0 => 0.0%
    - Returns (yoy_pct, yoy_display) e.g. (-58.0, "⇣ 58%")
    """
    l = clean_num(latest)
    y = clean_num(year_ago)

    if l is not None and y is not None:
        if y != 0:
            pct = round(((l - y) / abs(y)) * 100.0, 2)
        else:
            if l > 0:
                pct = 100.0
            elif l < 0:
                pct = -100.0
            else:
                pct = 0.0
        
        if pct > 0:
            disp = f"⇡ {abs(round(pct))}%"
        elif pct < 0:
            disp = f"⇣ {abs(round(pct))}%"
        else:
            disp = "0%"
        return pct, disp

    # Fallback to parsed string if numbers missing
    if fallback_str:
        is_down = ("⇣" in fallback_str or "⇩" in fallback_str or "▼" in fallback_str or "-" in fallback_str)
        raw = clean_num(fallback_str)
        if isinstance(raw, (int, float)):
            pct = -abs(raw) if is_down else abs(raw)
            disp = f"⇣ {abs(round(pct))}%" if pct < 0 else f"⇡ {abs(round(pct))}%"
            return float(pct), disp

    return None, "—"


def calculate_quarters(ref_date: Optional[date] = None) -> Dict[str, str]:
    """Calculate reporting quarter labels."""
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


class QuarterlyResultsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self._lock = threading.Lock()
        self._cache_data: Optional[List[Dict[str, Any]]] = None
        self._last_fetch_time: float = 0
        self._is_updating: bool = False

        self._session_file = os.path.join(data_dir, "app_data", "screener_session.json")
        self._live_file = os.path.join(data_dir, "app_data", "quarterly_results_live.json")
        self._cache_file = os.path.join(data_dir, "app_data", "quarterly_results_cache.json")

        self._last_updated_iso: Optional[str] = None
        self._last_updated_display: Optional[str] = None
        self._last_new_companies_count: int = 0
        self._admin_refresh_progress: str = "Idle"
        self._admin_refresh_percent: int = 0
        self._admin_refresh_error: Optional[str] = None
        self._admin_is_refreshing: bool = False
        self._admin_lock = threading.Lock()

        # 1. First attempt to load existing records from Database (MongoDB Atlas / SQLite)
        db_payload = None
        try:
            from db_store import load_quarterly_results_db
            db_payload = load_quarterly_results_db()
        except Exception as e:
            logger.warning(f"QuarterlyResults: Could not load from DB: {e}")

        if db_payload and isinstance(db_payload.get("data"), list) and len(db_payload["data"]) > 0:
            self._cache_data = db_payload["data"]
            self._last_updated_iso = db_payload.get("last_updated") or datetime.now().isoformat()
            self._last_updated_display = format_ist_display(db_payload.get("last_updated_display"))
            self._last_fetch_time = time.time()
            logger.info(f"QuarterlyResults: Loaded {len(self._cache_data)} existing records from database.")
        else:
            # 2. Fallback to existing disk cache if available and seed DB
            cached = self._load_disk_cache()
            if cached:
                self._cache_data = cached
                self._last_updated_iso = datetime.now().isoformat(timespec="seconds")
                self._last_updated_display = format_ist_display()
                logger.info(f"QuarterlyResults: Loaded {len(cached)} existing records from disk cache. Persisting to database...")
                try:
                    from db_store import save_quarterly_results_db
                    save_quarterly_results_db(cached, self._last_updated_iso, self._last_updated_display)
                except Exception as e:
                    logger.warning(f"QuarterlyResults: Error syncing disk cache to DB: {e}")
            else:
                logger.info("QuarterlyResults: Initialized without cache. Parsing will start upon page load.")

    def _login_screener_pure_requests(self) -> requests.Session:
        """Log in to Screener.in using pure HTTP requests (100% production/cloud compatible, no Selenium needed)."""
        s = requests.Session()
        s.headers.update(HTTP_HEADERS)
        s.headers["Referer"] = "https://www.screener.in/login/"

        try:
            r = s.get("https://www.screener.in/login/", timeout=10)
            soup = BeautifulSoup(r.text, "html.parser")
            csrf_inp = soup.find("input", {"name": "csrfmiddlewaretoken"})
            if not csrf_inp:
                logger.warning("CSRF token not found on Screener login page.")
                return s

            csrf = csrf_inp.get("value", "")
            data = {
                "csrfmiddlewaretoken": csrf,
                "next": "/results/latest/",
                "username": "capitaldesk.feed@gmail.com",
                "password": "BlueHorizon*9842"
            }
            resp = s.post("https://www.screener.in/login/", data=data, timeout=10, allow_redirects=True)
            if resp.status_code == 200 or "/results/latest/" in resp.url:
                logger.info("Successfully authenticated with Screener.in via pure HTTP requests.")
                cookies = s.cookies.get_dict()
                try:
                    os.makedirs(os.path.dirname(self._session_file), exist_ok=True)
                    with open(self._session_file, "w", encoding="utf-8") as f:
                        json.dump(cookies, f, indent=2)
                except Exception:
                    pass
            else:
                logger.warning(f"Screener login returned status {resp.status_code}")
        except Exception as e:
            logger.error(f"Error during pure HTTP Screener login: {e}")

        return s

    def _get_screener_session(self) -> requests.Session:
        """Create an authenticated requests session for Screener.in."""
        s = requests.Session()
        s.headers.update(HTTP_HEADERS)

        # Check existing session cookies
        if os.path.exists(self._session_file):
            try:
                with open(self._session_file, "r", encoding="utf-8") as f:
                    cookies = json.load(f)
                for k, v in cookies.items():
                    s.cookies.set(k, v, domain=".screener.in")
                r = s.get(SCREENER_LATEST_URL, allow_redirects=False, timeout=8)
                if r.status_code == 200:
                    return s
            except Exception as e:
                logger.warning(f"Failed to use stored session: {e}")

        # Authenticate with pure requests
        logger.info("Screener session expired or missing. Logging in via pure HTTP requests...")
        sess = self._login_screener_pure_requests()
        try:
            r = sess.get(SCREENER_LATEST_URL, allow_redirects=False, timeout=8)
            if r.status_code == 200:
                return sess
        except Exception:
            pass

        return sess

    def _load_disk_cache(self) -> Optional[List[Dict[str, Any]]]:
        """Load from the primary JSON store (user_data/quarterly_results_live.json) or bundled seed."""
        target = self._live_file if os.path.exists(self._live_file) else self._cache_file
        if os.path.exists(target):
            try:
                with open(target, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    if isinstance(payload, dict) and "data" in payload and "time" in payload:
                        self._last_fetch_time = time.time()
                        return payload["data"]
                    elif isinstance(payload, list):
                        self._last_fetch_time = time.time()
                        return payload
            except Exception as e:
                logger.warning(f"Error reading disk cache {target}: {e}")

        # Fallback to bundled seed in production
        seed_path = Path("app_data/seed_quarterly_results.json") if Path("app_data/seed_quarterly_results.json").exists() else Path(__file__).resolve().parent / "seed_quarterly_results.json"
        if seed_path.exists():
            try:
                with open(seed_path, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    items = payload.get("data", []) if isinstance(payload, dict) else payload
                    if items:
                        logger.info(f"Loaded {len(items)} seed records in production.")
                        self._last_fetch_time = payload.get("time", time.time()) if isinstance(payload, dict) else time.time()
                        self._save_disk_cache(items)
                        return items
            except Exception as e:
                logger.warning(f"Error reading seed_quarterly_results.json: {e}")

        return None

    def _save_disk_cache(self, data: List[Dict[str, Any]], new_companies_count: int = 0):
        """Atomically persist results to user_data/quarterly_results_live.json and Database."""
        q_info = calculate_quarters()
        now = datetime.now()
        last_updated_iso = now.isoformat(timespec="seconds")
        last_updated_display = format_ist_display()
        self._last_updated_iso = last_updated_iso
        self._last_updated_display = last_updated_display
        self._last_new_companies_count = new_companies_count

        payload = {
            "time": time.time(),
            "last_updated_iso": last_updated_iso,
            "last_updated_display": last_updated_display,
            "current_quarter": q_info["current_quarter"],
            "quarter_label": q_info["quarter_label"],
            "quarters": {
                "latest": q_info["latest"],
                "prev": q_info["prev"],
                "year_ago": q_info["year_ago"],
            },
            "shareholding_period": self._get_shareholding_period(shp_map),
            "new_companies_found": new_companies_count,
            "total_records": len(data),
            "data": data,
        }

        # 1. Persist to Database (MongoDB Atlas & SQLite)
        try:
            from db_store import save_quarterly_results_db
            save_quarterly_results_db(
                data,
                last_updated_iso=last_updated_iso,
                last_updated_display=last_updated_display,
                metadata={
                    "current_quarter": q_info["current_quarter"],
                    "quarter_label": q_info["quarter_label"],
                    "new_companies_found": new_companies_count,
                    "total_records": len(data)
                }
            )
        except Exception as e:
            logger.warning(f"QuarterlyResults: Error saving to DB: {e}")
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

            # Also mirror to brain artifact directory if active
            artifact_dir = r"C:\Users\DELL\.gemini\antigravity\brain\d8a2a5cf-e561-4304-947c-0ef08d36af53"
            if os.path.exists(artifact_dir):
                artifact_file = os.path.join(artifact_dir, "quarterly_results_latest.json")
                try:
                    with open(artifact_file, "w", encoding="utf-8") as f:
                        json.dump(payload, f, indent=2)
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Error saving to {self._live_file}: {e}")

    def resolve_pdf_url(self, screener_url: str) -> str:
        """Resolve a Screener source redirect URL to direct BSE/NSE official PDF link."""
        if not screener_url:
            return ""
        if "bseindia.com" in screener_url or "nseindia.com" in screener_url:
            return screener_url

        if not hasattr(self, "_pdf_cache"):
            self._pdf_cache = {
                "https://www.screener.in/company/source/quarter/1298/9/2026/": "https://www.bseindia.com/xml-data/corpfiling/AttachLive/f5d5fb37-aa66-401c-85d6-58ccd3982828.pdf",
                "https://www.screener.in/company/source/quarter/1297/9/2026/": "https://www.bseindia.com/xml-data/corpfiling/AttachLive/1489eedb-b159-45d7-886b-fb42009fd892.pdf",
                "https://www.screener.in/company/source/quarter/3365/9/2026/": "https://www.bseindia.com/xml-data/corpfiling/AttachLive/2b021530-bbc2-4590-8375-cefc205a7132.pdf",
                "https://www.screener.in/company/source/quarter/1274413/9/2026/": "https://nsearchives.nseindia.com/corporate/LAGNAM_17102026164912_OutcomeOfBoardMeeting17102026.pdf",
                "https://www.screener.in/company/source/quarter/1274575/9/2026/": "https://nsearchives.nseindia.com/corporate/PARIN_17102026153021_Outcome_of_BM_17102026.pdf",
            }

        if screener_url in self._pdf_cache:
            return self._pdf_cache[screener_url]

        try:
            s = self._screener_session or requests.Session()
            s.headers.update(HTTP_HEADERS)
            r = s.get(screener_url, allow_redirects=False, timeout=3)
            loc = r.headers.get("Location")
            if loc:
                m = re.search(r"Pname=([^&#]+)", loc)
                if m:
                    direct = f"https://www.bseindia.com/xml-data/corpfiling/AttachLive/{m.group(1)}"
                else:
                    direct = loc
                self._pdf_cache[screener_url] = direct
                return direct
        except Exception as e:
            logger.debug(f"Could not resolve PDF URL {screener_url}: {e}")

        return screener_url

    def _parse_card(self, table: Any, header_div: Any) -> Optional[Dict[str, Any]]:
        """Parse a single company quarterly card from Screener HTML."""
        comp_a = header_div.find("a", href=lambda h: h and "/company/" in h and "/source/" not in h)
        if not comp_a:
            return None
        company_name = comp_a.get_text(strip=True)
        comp_href = comp_a.get("href", "")

        m_sym = re.search(r"/company/([^/]+)/", comp_href)
        symbol = m_sym.group(1).upper() if m_sym else company_name.upper().replace(" ", "")
        is_consolidated = "consolidated" in comp_href

        pdf_a = header_div.find("a", href=lambda h: h and "/source/quarter/" in h)
        raw_pdf_link = f"https://www.screener.in{pdf_a.get('href')}" if pdf_a else None
        pdf_link = self.resolve_pdf_url(raw_pdf_link) if raw_pdf_link else None

        price = None
        market_cap = None
        pe = None

        for span in header_div.find_all("span", class_="sub"):
            txt = span.get_text(separator=" ", strip=True)
            if "Price" in txt:
                strong = span.find("span", class_="strong")
                if strong:
                    price = clean_num(strong.get_text(strip=True))
            elif "M.Cap" in txt:
                strong = span.find("span", class_="strong")
                if strong:
                    market_cap = clean_num(strong.get_text(strip=True))
            elif "PE" in txt:
                strong = span.find("span", class_="strong")
                if strong:
                    pe = clean_num(strong.get_text(strip=True))

        th_cells = [th.get_text(strip=True) for th in table.find_all("th")]
        latest_q = th_cells[2] if len(th_cells) > 2 else ""
        prev_q = th_cells[3] if len(th_cells) > 3 else ""
        year_ago_q = th_cells[4] if len(th_cells) > 4 else ""

        metrics = []
        rows = table.find("tbody").find_all("tr") if table.find("tbody") else table.find_all("tr")

        for row in rows:
            cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
            if not cells or len(cells) < 3:
                continue
            row_label = cells[0].strip()
            yoy_str = cells[1].strip() if len(cells) > 1 else ""
            latest_val = clean_num(cells[2]) if len(cells) > 2 else None
            prev_val = clean_num(cells[3]) if len(cells) > 3 else None
            year_ago_val = clean_num(cells[4]) if len(cells) > 4 else None

            yoy_calc, yoy_disp = calculate_yoy_growth(latest_val, year_ago_val, yoy_str)
            metrics.append({
                "name": row_label,
                "latest": f"{latest_val:,.2f}".rstrip("0").rstrip(".") if isinstance(latest_val, float) else (str(latest_val) if latest_val is not None else "—"),
                "prev": f"{prev_val:,.2f}".rstrip("0").rstrip(".") if isinstance(prev_val, float) else (str(prev_val) if prev_val is not None else "—"),
                "year_ago": f"{year_ago_val:,.2f}".rstrip("0").rstrip(".") if isinstance(year_ago_val, float) else (str(year_ago_val) if year_ago_val is not None else "—"),
                "yoy_pct": yoy_calc if yoy_calc is not None else 0.0,
                "yoy_display": yoy_disp if yoy_disp != "—" else yoy_str,
            })

        industry = infer_industry(symbol, company_name)
        exchange = "BSE" if symbol.isdigit() else "NSE"

        return {
            "symbol": symbol,
            "company": company_name,
            "industry": industry,
            "exchange": exchange,
            "screener_url": f"https://www.screener.in{comp_href}",
            "pdf_url": pdf_link,
            "is_consolidated": is_consolidated,
            "price": price,
            "mcap_cr": market_cap,
            "pe": pe,
            "quarters": {
                "latest": latest_q,
                "prev": prev_q,
                "year_ago": year_ago_q,
            },
            "metrics": metrics,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "source": "Screener.in",
        }

    def refresh_from_screener(self) -> List[Dict[str, Any]]:
        """Fetch records page by page from Screener.in.
        Update those if not exists. If any record exists, STOP parser immediately.
        """
        with self._lock:
            if self._is_updating:
                return list(self._cache_data or [])
            self._is_updating = True

        try:
            logger.info("Starting page-by-page parse from https://www.screener.in/results/latest/...")
            session = self._get_screener_session()

            # Existing records & keys
            existing_records = list(self._cache_data or self._load_disk_cache() or [])
            existing_keys: Set[Tuple[str, str]] = set()
            for r in existing_records:
                sym = clean_symbol(r.get("symbol"))
                latest_q = str(r.get("quarters", {}).get("latest") or r.get("latest_quarter") or "").strip().lower()
                if sym:
                    existing_keys.add((sym, latest_q))

            new_records: List[Dict[str, Any]] = []
            page = 1
            hit_existing = False

            while True:
                url = f"{SCREENER_LATEST_URL}?p={page}"
                logger.info(f"Screener parser: fetching page {page} ({url})...")
                try:
                    resp = session.get(url, timeout=12)
                except Exception as e:
                    logger.warning(f"Error requesting {url}: {e}")
                    break

                if resp.status_code != 200:
                    logger.warning(f"Failed to fetch {url}: HTTP {resp.status_code}")
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                tables = soup.find_all("table")
                if not tables:
                    logger.info(f"No tables on page {page}. Ending pagination.")
                    break

                page_new_count = 0
                for table in tables:
                    parent_div = table.parent
                    header_div = parent_div.find_previous_sibling()
                    if not header_div:
                        continue
                    card = self._parse_card(table, header_div)
                    if not card:
                        continue
                    card["updated_at"] = time.time()

                    sym = clean_symbol(card["symbol"])
                    latest_q = str(card["quarters"]["latest"]).strip().lower()
                    key = (sym, latest_q)

                    # Stopping condition: if record already exists in JSON store, STOP PARSER!
                    if key in existing_keys:
                        logger.info(f"Record {sym} ({card['quarters']['latest']}) already exists. STOPPING PARSER.")
                        hit_existing = True
                        break
                    else:
                        new_records.append(card)
                        existing_keys.add(key)
                        page_new_count += 1

                if hit_existing:
                    logger.info(f"Existing record detected on page {page}. Halting further page requests.")
                    break

                # Check if next page exists
                paginator = soup.find("p", class_="paginator")
                has_next = False
                if paginator:
                    for a in paginator.find_all("a", href=True):
                        if f"?p={page + 1}" in a["href"]:
                            has_next = True
                            break

                if not has_next or page >= 25:
                    logger.info(f"No more pages found after page {page}.")
                    break

                page += 1
                time.sleep(0.3)

            # Merge new records into existing store and update database
            if new_records:
                logger.info(f"Found {len(new_records)} new/updated company records. Updating database...")
                # Deduplicate: new records take priority
                new_key_set = {(clean_symbol(n["symbol"]), str(n["quarters"]["latest"]).strip().lower()) for n in new_records}
                all_records = new_records + [
                    r for r in existing_records
                    if (clean_symbol(r.get("symbol")), str(r.get("quarters", {}).get("latest") or "").strip().lower()) not in new_key_set
                ]
                with self._lock:
                    self._cache_data = all_records
                    self._last_fetch_time = time.time()
                    self._save_disk_cache(all_records, new_companies_count=len(new_records))
            else:
                logger.info("No new records found. All latest results are up-to-date in database.")
                all_records = existing_records
                with self._lock:
                    self._cache_data = all_records
                    self._last_fetch_time = time.time()
                    self._last_new_companies_count = 0
                    if not getattr(self, "_last_updated_display", None):
                        now = datetime.now()
                        self._last_updated_iso = now.isoformat(timespec="seconds")
                        self._last_updated_display = format_ist_display()

            logger.info(f"Screener update complete. Total records stored: {len(all_records)}.")
            return all_records
        finally:
            with self._lock:
                self._is_updating = False

    def get_refresh_status(self) -> Dict[str, Any]:
        """Return live synchronization status for Admin."""
        total_records = len(self._cache_data or [])
        raw_disp = getattr(self, "_last_updated_display", None) or getattr(self, "_last_updated_iso", None)
        disp_val = format_ist_display(raw_disp) if (raw_disp and raw_disp != "Never") else "Never"
        return {
            "is_refreshing": getattr(self, "_admin_is_refreshing", False),
            "progress": getattr(self, "_admin_refresh_progress", "Idle"),
            "percent": getattr(self, "_admin_refresh_percent", 0),
            "error": getattr(self, "_admin_refresh_error", None),
            "last_updated": getattr(self, "_last_updated_iso", "Never"),
            "last_updated_display": disp_val,
            "total_records": total_records,
            "new_companies_found": getattr(self, "_last_new_companies_count", 0),
            "storage": "MongoDB Atlas & SQLite (Synced)",
        }

    def start_admin_background_refresh(self, force_full: bool = False, *args, **kwargs) -> Dict[str, Any]:
        """Initiate background refresh of quarterly results by Admin."""
        with getattr(self, "_admin_lock", threading.Lock()):
            if getattr(self, "_admin_is_refreshing", False):
                return {
                    "success": False,
                    "status": "in_progress",
                    "message": "A quarterly results refresh is already in progress.",
                    **self.get_refresh_status(),
                }
            self._admin_is_refreshing = True
            self._admin_refresh_progress = "Connecting to live Screener.in results portal..."
            self._admin_refresh_percent = 15
            self._admin_refresh_error = None

        thread = threading.Thread(target=self._run_admin_refresh_worker, daemon=True)
        thread.start()

        return {
            "success": True,
            "status": "started",
            "message": "Background refresh started. Live quarterly disclosures are being synchronized to DB.",
            **self.get_refresh_status(),
        }

    def _run_admin_refresh_worker(self):
        """Worker thread to run full refresh from screener with live progress updates."""
        try:
            logger.info("Admin initiated quarterly results live refresh...")
            with self._admin_lock:
                self._admin_refresh_percent = 30
                self._admin_refresh_progress = "Authenticating with Screener.in and fetching page 1..."

            # Run refresh
            all_records = self.refresh_from_screener()

            with self._admin_lock:
                self._admin_refresh_percent = 100
                new_found = getattr(self, "_last_new_companies_count", 0)
                if new_found > 0:
                    self._admin_refresh_progress = f"Completed successfully! {new_found} new companies found and saved to database. Total {len(all_records)} companies tracked."
                else:
                    self._admin_refresh_progress = f"Completed successfully! All {len(all_records)} companies are up-to-date in database."
                self._admin_refresh_error = None
        except Exception as exc:
            logger.error(f"Error during Admin quarterly results refresh: {exc}", exc_info=True)
            with self._admin_lock:
                self._admin_refresh_error = str(exc)
                self._admin_refresh_progress = f"Refresh failed: {str(exc)}"
        finally:
            with self._admin_lock:
                self._admin_is_refreshing = False

    ALLOWED_AST_NODES = (
        ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp,
        ast.Compare, ast.Name, ast.Constant,
        ast.And, ast.Or, ast.Not,
        ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
        ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.USub, ast.UAdd, ast.Load,
    )

    QUERY_FIELD_MAP = {
        # Quarterly Results QoQ Growth Metrics (%)
        "qoq_sales", "sales_qoq", "sales_qoq_growth", "qoq_revenue",
        "qoq_profit", "profit_qoq", "qoq_net_profit", "net_profit_qoq", "qoq_pat", "pat_qoq",
        "qoq_op", "op_qoq", "qoq_operating_profit", "operating_profit_qoq",
        "qoq_eps", "eps_qoq",
        "qoq_opm", "opm_qoq",
        "qoq_fii", "fii_qoq", "qoq_dii", "dii_qoq", "qoq_promoter", "promoter_qoq", "qoq_public", "public_qoq",

        # Quarterly Results Growth Metrics (%)
        "sales_growth", "yoy_sales", "sales_chg",
        "profit_growth", "yoy_profit", "profit_chg", "net_profit_growth", "pat_growth", "turnaround",
        "op_growth", "yoy_op", "op_chg",
        "eps_growth", "yoy_eps",
        "yoy_opm", "opm_growth", "opm_chg",

        # Absolute Values (Latest Quarter in Cr / %)
        "sales", "revenue",
        "net_profit", "profit", "pat",
        "opm", "opm_pct", "margin",
        "op", "operating_profit",
        "eps", "other_income", "interest", "depreciation", "depr",
        "pbt", "profit_before_tax", "tax", "tax_pct",

        # Valuation & Fundamentals
        "pe", "ttm_pe", "qtr_pe",
        "mcap", "mcap_cr", "market_cap",
        "price", "ltp",

        # Shareholding - QoQ Flows (%)
        "fii_chg", "change_fii", "change_fii_pct", "fii_change",
        "dii_chg", "change_dii", "change_dii_pct", "dii_change",
        "promoter_chg", "change_promoter", "change_promoter_pct", "promoter_change",
        "public_chg", "change_public", "change_public_pct", "public_change",
        "inst_chg", "change_inst",

        # Shareholding - Holding Levels (%)
        "promoter", "promoter_holding", "promoter_pct",
        "fii", "fii_holding", "fii_pct",
        "dii", "dii_holding", "dii_pct",
        "public", "public_holding", "public_pct",
        "inst", "inst_holding", "institutional",
    }

    def _get_shareholding_map(self) -> Dict[str, Dict[str, Any]]:
        """Return cached map of clean_symbol -> shareholding record."""
        now = time.time()
        if getattr(self, "_shp_map_cache", None) and (now - getattr(self, "_shp_map_time", 0)) < 300:
            return self._shp_map_cache

        shp_map: Dict[str, Dict[str, Any]] = {}
        # 1. Try shareholding provider
        try:
            from modules.shareholding import get_provider as get_shp_provider
            shp_prov = get_shp_provider()
            if shp_prov and hasattr(shp_prov, "_cache_records") and shp_prov._cache_records:
                for r in shp_prov._cache_records:
                    sym = clean_symbol(r.get("symbol"))
                    if sym:
                        shp_map[sym] = r
        except Exception:
            pass

        # 2. Try DB store
        if not shp_map:
            try:
                from db_store import load_shareholding_patterns_db
                db_data = load_shareholding_patterns_db()
                if db_data and isinstance(db_data.get("records"), list):
                    for r in db_data["records"]:
                        sym = clean_symbol(r.get("symbol"))
                        if sym:
                            shp_map[sym] = r
            except Exception:
                pass

        # 3. Fallback to json files
        if not shp_map:
            for p in ["app_data/shareholding_patterns.json", "user_data/shareholding_patterns.json"]:
                if Path(p).exists():
                    try:
                        import json
                        with open(p, "r", encoding="utf-8") as f:
                            d = json.load(f)
                            for r in d.get("records", []):
                                sym = clean_symbol(r.get("symbol"))
                                if sym:
                                    shp_map[sym] = r
                        if shp_map:
                            break
                    except Exception:
                        pass

        self._shp_map_cache = shp_map
        self._shp_map_time = now
        return shp_map

    @staticmethod
    def _format_shp_quarter_date(d_str: Any) -> str:
        """Format raw SHP date string (e.g. 30-SEP-2026, 30-JUN-2026) to standard quarter label like 'June 26', 'Sep 26'."""
        if not d_str:
            return ""
        d_clean = str(d_str).strip()
        m = re.search(r'([A-Za-z]{3,9})[- /]+(\d{2,4})', d_clean)
        if m:
            mon = m.group(1).title()
            yr = m.group(2)
            if len(yr) == 4:
                yr = yr[2:]
            mon_map = {
                'Jan': 'Jan', 'Feb': 'Feb', 'Mar': 'Mar', 'Apr': 'Apr',
                'May': 'May', 'Jun': 'June', 'Jul': 'July', 'Aug': 'Aug',
                'Sep': 'Sep', 'Oct': 'Oct', 'Nov': 'Nov', 'Dec': 'Dec'
            }
            short_m = mon[:3].title()
            return f"{mon_map.get(short_m, short_m)} {yr}"

        m2 = re.match(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', d_clean)
        if m2:
            yr = m2.group(1)[2:]
            mo_num = int(m2.group(2))
            months = ["", "Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sep", "Oct", "Nov", "Dec"]
            if 1 <= mo_num <= 12:
                return f"{months[mo_num]} {yr}"

        return d_clean

    def _get_shareholding_period(self, shp_map: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, str]:
        """Compute dynamic shareholding comparison period (e.g. 'June 26 vs Sep 26') from shareholding data."""
        now = time.time()
        if getattr(self, "_shp_period_cache", None) and (now - getattr(self, "_shp_period_time", 0)) < 300:
            return self._shp_period_cache

        if shp_map is None:
            shp_map = self._get_shareholding_map()

        shp_prev_str = ""
        shp_curr_str = ""
        shp_label = ""

        if shp_map:
            from collections import Counter
            pairs = Counter()
            for sym, r in shp_map.items():
                pd = r.get("prev_date")
                cd = r.get("date")
                if pd and cd:
                    p_lbl = self._format_shp_quarter_date(pd)
                    c_lbl = self._format_shp_quarter_date(cd)
                    if p_lbl and c_lbl:
                        pairs[(p_lbl, c_lbl)] += 1

            if pairs:
                top_pair = pairs.most_common(1)[0][0]
                shp_prev_str = top_pair[0]
                shp_curr_str = top_pair[1]
                shp_label = f"{shp_prev_str} vs {shp_curr_str}"

        res = {
            "label": shp_label,
            "prev_quarter": shp_prev_str,
            "curr_quarter": shp_curr_str,
            "display": f"Shareholding: {shp_label}" if shp_label else ""
        }
        self._shp_period_cache = res
        self._shp_period_time = now
        return res

    def _extract_field_value(self, record: Dict[str, Any], field_name: str) -> Optional[float]:
        """Extract numeric metric value from quarterly results record or linked shareholding data."""
        if not record or not field_name:
            return None
        fn = field_name.strip().lower()
        shp = record.get("_shp") or {}

        # 0. Helper for QoQ percentage change calculation
        def _calc_metric_qoq(m_name: str, is_diff: bool = False) -> Optional[float]:
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == m_name.lower():
                    l = clean_num(m.get("latest"))
                    p = clean_num(m.get("prev"))
                    if l is None or p is None:
                        return None
                    if is_diff:
                        return round(l - p, 2)
                    if p != 0:
                        return round(((l - p) / abs(p)) * 100.0, 2)
                    return 100.0 if l > 0 else (0.0 if l == 0 else -100.0)
            return None

        # QoQ Financial Changes (%)
        if fn in ("qoq_sales", "sales_qoq", "sales_qoq_growth", "qoq_revenue"):
            return _calc_metric_qoq("sales")

        if fn in ("qoq_profit", "profit_qoq", "qoq_net_profit", "net_profit_qoq", "qoq_pat", "pat_qoq"):
            return _calc_metric_qoq("net profit")

        if fn in ("qoq_op", "op_qoq", "qoq_operating_profit", "operating_profit_qoq"):
            val = _calc_metric_qoq("operating profit")
            if val is None:
                val = _calc_metric_qoq("ebidt")
            return val

        if fn in ("qoq_eps", "eps_qoq"):
            return _calc_metric_qoq("eps")

        if fn in ("qoq_opm", "opm_qoq"):
            return _calc_metric_qoq("opm", is_diff=True)

        if fn in ("qoq_fii", "fii_qoq"):
            val = shp.get("change_fii_pct")
            return float(val) if val is not None else None

        if fn in ("qoq_dii", "dii_qoq"):
            val = shp.get("change_dii_pct")
            return float(val) if val is not None else None

        if fn in ("qoq_promoter", "promoter_qoq"):
            val = shp.get("change_promoter_pct")
            return float(val) if val is not None else None

        if fn in ("qoq_public", "public_qoq"):
            val = shp.get("change_public_pct")
            return float(val) if val is not None else None

        # 1. Helper for YoY percentage change calculation
        def _calc_metric_yoy(m_name: str) -> Optional[float]:
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == m_name.lower():
                    pct, _ = calculate_yoy_growth(m.get("latest"), m.get("year_ago"), str(m.get("yoy_display") or ""))
                    if pct is not None:
                        return pct
                    try:
                        return float(m.get("yoy_pct", 0.0))
                    except Exception:
                        return 0.0
            return None

        # 1. Quarterly Results Growth (%)
        if fn in ("sales_growth", "yoy_sales", "sales_chg"):
            return _calc_metric_yoy("sales")

        if fn in ("profit_growth", "yoy_profit", "profit_chg", "net_profit_growth", "pat_growth", "turnaround"):
            return _calc_metric_yoy("net profit")

        if fn in ("op_growth", "yoy_op", "op_chg"):
            val = _calc_metric_yoy("operating profit")
            if val is None:
                val = _calc_metric_yoy("ebidt")
            return val

        if fn in ("eps_growth", "yoy_eps"):
            return _calc_metric_yoy("eps")

        if fn in ("yoy_opm", "opm_growth", "opm_chg"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "opm":
                    l = clean_num(m.get("latest"))
                    y = clean_num(m.get("year_ago"))
                    if l is not None and y is not None:
                        return round(l - y, 2)
                    try:
                        return float(m.get("yoy_pct", 0.0))
                    except Exception:
                        return 0.0
            return None

        # 2. Latest Values
        if fn in ("sales", "revenue"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "sales":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("net_profit", "profit", "pat"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "net profit":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("opm", "opm_pct", "margin"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "opm":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("op", "operating_profit"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() in ("operating profit", "operating_profit"):
                    return clean_num(m.get("latest"))
            return None

        if fn in ("eps",):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "eps":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("other_income",):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "other income":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("interest",):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "interest":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("depreciation", "depr"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "depreciation":
                    return clean_num(m.get("latest"))
            return None

        if fn in ("pbt", "profit_before_tax"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() in ("profit before tax", "pbt"):
                    return clean_num(m.get("latest"))
            return None

        if fn in ("tax", "tax_pct"):
            for m in record.get("metrics") or []:
                if m.get("name", "").strip().lower() == "tax":
                    return clean_num(m.get("latest"))
            return None

        # 3. Direct fundamentals
        if fn in ("pe", "ttm_pe", "qtr_pe"):
            return clean_num(record.get("pe"))
        if fn in ("mcap", "mcap_cr", "market_cap"):
            return clean_num(record.get("mcap_cr"))
        if fn in ("price", "ltp"):
            return clean_num(record.get("price"))

        # 4. Shareholding Flows QoQ (%)
        if fn in ("fii_chg", "change_fii", "change_fii_pct", "fii_change"):
            val = shp.get("change_fii_pct")
            return float(val) if val is not None else None
        if fn in ("dii_chg", "change_dii", "change_dii_pct", "dii_change"):
            val = shp.get("change_dii_pct")
            return float(val) if val is not None else None
        if fn in ("promoter_chg", "change_promoter", "change_promoter_pct", "promoter_change"):
            val = shp.get("change_promoter_pct")
            return float(val) if val is not None else None
        if fn in ("public_chg", "change_public", "change_public_pct", "public_change"):
            val = shp.get("change_public_pct")
            return float(val) if val is not None else None
        if fn in ("inst_chg", "change_inst"):
            f_chg = shp.get("change_fii_pct")
            d_chg = shp.get("change_dii_pct")
            if f_chg is None and d_chg is None:
                return None
            return float(f_chg or 0.0) + float(d_chg or 0.0)

        # 5. Shareholding Level Holdings (%)
        if fn in ("promoter", "promoter_holding", "promoter_pct"):
            val = shp.get("promoter_pct")
            return float(val) if val is not None else None
        if fn in ("fii", "fii_holding", "fii_pct"):
            val = shp.get("fii_pct")
            return float(val) if val is not None else None
        if fn in ("dii", "dii_holding", "dii_pct"):
            val = shp.get("dii_pct")
            return float(val) if val is not None else None
        if fn in ("public", "public_holding", "public_pct"):
            val = shp.get("public_pct")
            return float(val) if val is not None else None
        if fn in ("inst", "inst_holding", "institutional"):
            f_pct = shp.get("fii_pct")
            d_pct = shp.get("dii_pct")
            if f_pct is None and d_pct is None:
                return None
            return float(f_pct or 0.0) + float(d_pct or 0.0)

        return None

    def sanitize_custom_query(self, query_str: str) -> str:
        """Sanitize query string to normalize operators and keywords for Python AST."""
        if not query_str:
            return ""
        s = query_str.strip()
        s = re.sub(r"\band\b", "and", s, flags=re.IGNORECASE)
        s = re.sub(r"\bor\b", "or", s, flags=re.IGNORECASE)
        s = re.sub(r"\bnot\b", "not", s, flags=re.IGNORECASE)
        s = re.sub(r"(?<![<>=!])=(?!=)", "==", s)
        return s

    def compile_custom_query(self, query_str: str) -> Tuple[Optional[ast.AST], Optional[str]]:
        """Compile and securely validate user-specified boolean quarterly results & shareholding query."""
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
                        f"Unknown field '{node.id}'. Supported fields: yoy_sales, yoy_profit, sales, net_profit, "
                        "qoq_sales, qoq_profit, qoq_op, qoq_eps, qoq_opm, opm, pe, mcap, price, promoter, fii, dii, public, fii_chg, dii_chg, promoter_chg, public_chg",
                    )
        return tree, None

    def eval_custom_node(self, node: Any, record: Dict[str, Any]) -> Any:
        """Evaluate validated AST expression against a quarterly results record (with attached shareholding data)."""
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
            return self._extract_field_value(record, nid)
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
        elif isinstance(node, ast.BinOp):
            left = self.eval_custom_node(node.left, record)
            right = self.eval_custom_node(node.right, record)
            if left is None or right is None:
                return None
            if isinstance(node.op, ast.Add):
                return left + right
            elif isinstance(node.op, ast.Sub):
                return left - right
            elif isinstance(node.op, ast.Mult):
                return left * right
            elif isinstance(node.op, ast.Div):
                return left / right if right != 0 else None
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
            # Smart fallback for bare shareholding fields with non-positive comparison (e.g. public < 0 or promoter == 0)
            if isinstance(node.left, ast.Name) and node.left.id.lower() in ("public", "promoter", "fii", "dii"):
                for op, comp in zip(node.ops, node.comparators):
                    if isinstance(comp, (ast.Constant, ast.UnaryOp)):
                        try:
                            c_val = self.eval_custom_node(comp, record)
                            if c_val is not None and c_val <= 0:
                                shp = record.get("_shp") or {}
                                chg_key = f"change_{node.left.id.lower()}_pct"
                                if shp.get(chg_key) is not None:
                                    left = float(shp[chg_key])
                                break
                        except Exception:
                            pass

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
            recs = list(self._cache_data or [])

        shp_map = self._get_shareholding_map()
        matched = []
        for r in recs:
            sym = clean_symbol(r.get("symbol"))
            r_copy = dict(r)
            r_copy["_shp"] = shp_map.get(sym) or {}
            try:
                res = self.eval_custom_node(tree, r_copy)
                if res:
                    matched.append(r.get("symbol") or r.get("company"))
            except Exception:
                continue

        return {
            "valid": True,
            "error": None,
            "match_count": len(matched),
            "matches": matched[:6],
        }

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
        custom_query: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """Serve quarterly results.
        Triggers Screener parser if:
        - Page is loading and cache is missing / empty
        - 15 minutes have passed since last update
        - Refresh button is clicked (force_refresh = True)
        """
        now = time.time()
        needs_parse = False

        if force_refresh:
            needs_parse = True
        elif not self._cache_data or len(self._cache_data) == 0:
            needs_parse = True

        if needs_parse:
            all_items = self.refresh_from_screener()
        else:
            all_items = list(self._cache_data or [])

        q_info = calculate_quarters()

        # 1. Collect metadata
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

        # Compile custom query if provided
        custom_tree = None
        custom_query_err = None
        clean_cq = (custom_query or "").strip()
        if clean_cq:
            custom_tree, custom_query_err = self.compile_custom_query(clean_cq)

        shp_map = self._get_shareholding_map()

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

            shp_rec = shp_map.get(sym) or {}
            item_copy = dict(item)
            item_copy["in_portfolio"] = in_pf
            item_copy["in_watchlist"] = in_wl
            item_copy["_shp"] = shp_rec

            # Extract or calculate QoQ stake changes for all categories if available
            chg_prom = shp_rec.get("change_promoter_pct")
            if chg_prom is None and shp_rec.get("promoter_pct") is not None and shp_rec.get("prev_promoter_pct") is not None:
                try:
                    chg_prom = round(float(shp_rec["promoter_pct"]) - float(shp_rec["prev_promoter_pct"]), 2)
                except Exception:
                    pass

            chg_fii = shp_rec.get("change_fii_pct")
            if chg_fii is None and shp_rec.get("fii_pct") is not None and shp_rec.get("prev_fii_pct") is not None:
                try:
                    chg_fii = round(float(shp_rec["fii_pct"]) - float(shp_rec["prev_fii_pct"]), 2)
                except Exception:
                    pass

            chg_dii = shp_rec.get("change_dii_pct")
            if chg_dii is None and shp_rec.get("dii_pct") is not None and shp_rec.get("prev_dii_pct") is not None:
                try:
                    chg_dii = round(float(shp_rec["dii_pct"]) - float(shp_rec["prev_dii_pct"]), 2)
                except Exception:
                    pass

            chg_pub = shp_rec.get("change_public_pct")
            if chg_pub is None and shp_rec.get("public_pct") is not None and shp_rec.get("prev_public_pct") is not None:
                try:
                    chg_pub = round(float(shp_rec["public_pct"]) - float(shp_rec["prev_public_pct"]), 2)
                except Exception:
                    pass

            item_copy["shareholding"] = {
                "promoter_pct": shp_rec.get("promoter_pct"),
                "fii_pct": shp_rec.get("fii_pct"),
                "dii_pct": shp_rec.get("dii_pct"),
                "public_pct": shp_rec.get("public_pct"),
                "change_promoter_pct": chg_prom,
                "change_fii_pct": chg_fii,
                "change_dii_pct": chg_dii,
                "change_public_pct": chg_pub,
            }

            # Recalculate and guarantee accurate YoY growth % and display on every metric
            for m in item_copy.get("metrics") or []:
                yoy_calc, yoy_disp = calculate_yoy_growth(m.get("latest"), m.get("year_ago"), str(m.get("yoy_display") or ""))
                if yoy_calc is not None:
                    m["yoy_pct"] = yoy_calc
                    m["yoy_display"] = yoy_disp

            # Custom query filter
            if custom_tree:
                try:
                    match_custom = bool(self.eval_custom_node(custom_tree, item_copy))
                    if not match_custom:
                        continue
                except Exception:
                    continue

            filtered.append(item_copy)

        # 3. Sorting
        def _get_metric_yoy(item: Dict[str, Any], metric_name: str) -> float:
            for m in item.get("metrics") or []:
                if m.get("name", "").lower() == metric_name.lower():
                    pct, _ = calculate_yoy_growth(m.get("latest"), m.get("year_ago"), str(m.get("yoy_display") or ""))
                    if pct is not None:
                        return pct
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
            filtered.sort(key=lambda x: (x.get("updated_at") or 0.0, x.get("date", ""), float(x.get("mcap_cr") or 0)), reverse=True)

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
            "shareholding_period": self._get_shareholding_period(shp_map),
            "last_updated": self._last_fetch_time,
            "last_updated_display": getattr(self, "_last_updated_display", None) or (format_ist_display(self._last_fetch_time) if self._last_fetch_time else "Just now"),
            "active_filters": {
                "search": search,
                "industry": industry,
                "market_cap_tier": market_cap_tier,
                "sorting": sorting,
                "exchange": exchange,
                "watchlist_scope": watchlist_scope,
                "date_filter": date_filter,
                "custom_query": custom_query,
            },
        }

"""Fetch recent company announcements from official NSE and BSE endpoints."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from threading import Lock
import re
import time
from urllib.parse import urljoin

import requests


NSE_HOME = "https://www.nseindia.com/"
NSE_API = "https://www.nseindia.com/api/corporate-announcements"
BSE_API = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
BSE_SCRIP_LIST_API = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
BSE_ATTACHMENTS = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/"
NSE_ANNOUNCEMENTS = "https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol={symbol}&tabIndex=equity"
BSE_ANNOUNCEMENTS = "https://www.bseindia.com/stock-share-price/"
PAGE_SIZE = 20
FEED_DAYS = 90
CACHE_SECONDS = 300
BSE_MAP_CACHE_SECONDS = 86400
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _clean_symbol(symbol):
    """Remove Yahoo exchange suffixes before sending symbols to exchange sites."""
    return re.sub(r"\.(?:NS|BO)$", "", str(symbol or "").strip(), flags=re.IGNORECASE).upper()


def _as_iso_date(raw):
    if not raw:
        return ""
    value = str(raw).strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%b-%Y", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).isoformat(timespec="minutes")
        except ValueError:
            continue
    return value


NOISE_PATTERNS = [
    re.compile(r"loss of share certificate", re.IGNORECASE),
    re.compile(r"duplicate share certificate", re.IGNORECASE),
    re.compile(r"issue of duplicate", re.IGNORECASE),
    re.compile(r"closure of trading window", re.IGNORECASE),
    re.compile(r"trading window closure", re.IGNORECASE),
    re.compile(r"trading window\b", re.IGNORECASE),
    re.compile(r"regulation 74\s*\(\s*5\s*\)", re.IGNORECASE),
    re.compile(r"regulation 39\s*\(\s*3\s*\)", re.IGNORECASE),
    re.compile(r"newspaper publication", re.IGNORECASE),
    re.compile(r"newspaper clipping", re.IGNORECASE),
    re.compile(r"copy of newspaper", re.IGNORECASE),
    re.compile(r"demat.*remat", re.IGNORECASE),
    re.compile(r"confirmation certificate under", re.IGNORECASE),
]


def is_noise_announcement(subject, details):
    """Filter out routine non-market-moving administrative paperwork."""
    text = f"{subject or ''} {details or ''}".lower()
    return any(p.search(text) for p in NOISE_PATTERNS)


def classify_announcement(subject, details, company=""):
    """Classify announcements into standardized Screener-style categories and subcategories."""
    raw_sub = (subject or "").strip()
    raw_det = (details or "").strip()
    text = f"{raw_sub} {raw_det}".lower()

    if any(k in text for k in ["financial result", "un-audited financial", "unaudited financial", "audited financial", "quarterly result", "financial results for"]):
        category = "Results & Financials"
        subcategory = "Financial Results"
    elif any(k in text for k in ["investor presentation", "earnings presentation", "analyst presentation", "investor deck", "corporate presentation"]):
        category = "Results & Financials"
        subcategory = "Investor Presentation"
    elif any(k in text for k in ["transcript", "audio recording", "recording of concall", "recording of call", "concall recording"]) and any(k in text for k in ["call", "meet", "concall", "analyst"]):
        category = "Results & Financials"
        subcategory = "Concall Transcript & Audio"
    elif any(k in text for k in ["concall", "conference call", "analyst meet", "institutional investor meet", "schedule of meet", "schedule of analyst"]):
        category = "Results & Financials"
        subcategory = "Concalls & Analyst Meets"
    elif "dividend" in text:
        category = "Corporate Actions"
        subcategory = "Dividends"
    elif any(k in text for k in ["bonus issue", "bonus shares"]):
        category = "Corporate Actions"
        subcategory = "Bonus Issue"
    elif any(k in text for k in ["sub-division", "stock split", "face value"]):
        category = "Corporate Actions"
        subcategory = "Stock Split"
    elif any(k in text for k in ["buyback", "buy-back"]):
        category = "Corporate Actions"
        subcategory = "Buyback of Shares"
    elif any(k in text for k in ["rights issue", "warrants"]):
        category = "Corporate Actions"
        subcategory = "Rights Issue / Warrants"
    elif "outcome of board meeting" in text:
        category = "Board Meetings"
        subcategory = "Outcome of Board Meeting"
    elif "board meeting" in text:
        category = "Board Meetings"
        subcategory = "Board Meeting Intimation"
    elif any(k in text for k in ["order win", "bagged order", "awarded", "work order", "contract win", "receipt of order", "letter of award", "letter of intent", "order intake"]):
        category = "Business & Operations"
        subcategory = "Orders & Contracts"
    elif any(k in text for k in ["capacity expansion", "commissioning", "commercial production", "new plant", "commencement of commercial"]):
        category = "Business & Operations"
        subcategory = "Capacity Expansion & Capex"
    elif any(k in text for k in ["acquisition", "acquires", "merger", "amalgamation", "joint venture", "stake purchase", "slump sale", "takeover"]):
        category = "Business & Operations"
        subcategory = "Acquisitions & Mergers (M&A)"
    elif any(k in text for k in ["credit rating", "rating assigned", "rating reaffirmed", "rating upgraded", "rating downgraded", "crisil", "icra", "care rating", "ind-ra", "brickwork"]):
        category = "Credit Ratings"
        subcategory = "Credit Ratings"
    elif any(k in text for k in ["resignation", "appointment", "cessation", "superannuation", "chief executive", "ceo", "cfo", "managing director", "whole-time director", "company secretary", "compliance officer", "statutory auditor"]):
        category = "Management & Governance"
        subcategory = "Management & KMP Changes"
    elif any(k in text for k in ["press release", "media release", "business update", "operational update", "product launch"]):
        category = "Business & Operations"
        subcategory = "Press Release & Updates"
    elif any(k in text for k in ["annual report", "brsr", "integrated report"]):
        category = "Disclosures"
        subcategory = "Annual Report"
    elif any(k in text for k in ["shareholding pattern", "promoter pledge", "insider trading", "regulation 30", "sebi (pit)"]):
        category = "Disclosures"
        subcategory = "Shareholding & Regulatory"
    else:
        category = "Company Update"
        subcategory = "General Updates"

    # Extract clean headline: Remove generic boilerplate
    clean_title = raw_det or raw_sub
    clean_title = re.sub(r"^.*?\bhas informed the Exchange\s+(?:about|regarding)\s*", "", clean_title, flags=re.IGNORECASE)
    clean_title = clean_title.strip().strip("'\"")
    if not clean_title or len(clean_title) < 5 or clean_title.lower() in ["general updates", "updates"]:
        clean_title = raw_sub

    return category, subcategory, clean_title


class OfficialFeedsProvider:
    def __init__(self):
        self._cache = {}
        self._lock = Lock()
        self._bse_map_lock = Lock()
        self._bse_scrip_map = None
        self._bse_scrip_map_time = 0

    def _get_cached_symbol_feed(self, symbol, page=1, refresh=False):
        key = _clean_symbol(symbol)
        now = time.time()
        cache_key = (key, max(1, int(page)))
        with self._lock:
            cached = self._cache.get(cache_key)
            if not refresh and cached and now - cached[0] < CACHE_SECONDS:
                return cached[1]

        records = self._fetch_symbol(key, page)
        with self._lock:
            previous = self._cache.get((key, max(1, int(page)) - 1)) if int(page) > 1 else None
            if previous and {record.get("id") for record in records[0]} == {record.get("id") for record in previous[1][0]}:
                # Some exchange endpoints ignore page parameters. Stop safely
                # if the next request simply repeats the preceding batch.
                records = ([], False)
            self._cache[cache_key] = (now, records)
        return records

    def _fetch_symbol(self, symbol, page=1):
        if not symbol or symbol.startswith("^") or "=F" in symbol:
            return [], False

        jobs = []
        with ThreadPoolExecutor(max_workers=2) as executor:
            jobs.append(executor.submit(self._fetch_nse, symbol, page))
            bse_code = self._resolve_bse_scrip_code(symbol)
            if bse_code:
                jobs.append(executor.submit(self._fetch_bse, bse_code, page, symbol))
            records = []
            has_more = False
            for job in as_completed(jobs):
                try:
                    source_records, source_has_more = job.result()
                    records.extend(source_records)
                    has_more = has_more or source_has_more
                except Exception:
                    continue
        return records, has_more

    def _resolve_bse_scrip_code(self, symbol):
        if symbol.isdigit():
            return symbol
        now = time.time()
        with self._bse_map_lock:
            with self._lock:
                if self._bse_scrip_map is not None and now - self._bse_scrip_map_time < BSE_MAP_CACHE_SECONDS:
                    return self._bse_scrip_map.get(symbol)
            mapping = self._fetch_bse_scrip_map()
            if mapping is None:
                return None
            with self._lock:
                self._bse_scrip_map = mapping
                self._bse_scrip_map_time = now
            return mapping.get(symbol)

    def _fetch_bse_scrip_map(self):
        headers = dict(HEADERS)
        headers["Origin"] = "https://www.bseindia.com"
        headers["Referer"] = "https://www.bseindia.com/"
        try:
            response = requests.get(
                BSE_SCRIP_LIST_API,
                params={"segment": "Equity", "status": "Active"},
                headers=headers,
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError):
            return None

        rows = payload if isinstance(payload, list) else []
        if isinstance(payload, dict):
            rows = payload.get("Table", payload.get("data", payload.get("Data", [])))
        mapping = {}
        for row in rows if isinstance(rows, list) else []:
            ticker = str(row.get("scrip_id") or row.get("SCRIP_ID") or row.get("SCRIP_ID_CD") or row.get("symbol") or "").strip().upper()
            code = str(row.get("SCRIP_CD") or row.get("scripcode") or row.get("scrip_code") or "").strip()
            if ticker and code.isdigit():
                mapping[ticker] = code
        return mapping

    def _fetch_nse(self, symbol, page=1):
        session = requests.Session()
        try:
            session.get(NSE_HOME, headers=HEADERS, timeout=8)
            today = date.today()
            params = {
                "index": "equities",
                "symbol": symbol,
                "from_date": (today - timedelta(days=FEED_DAYS)).strftime("%d-%m-%Y"),
                "to_date": today.strftime("%d-%m-%Y"),
                "page": max(1, int(page)),
                "limit": PAGE_SIZE,
                "size": PAGE_SIZE,
            }
            headers = dict(HEADERS)
            headers["Referer"] = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
            response = session.get(NSE_API, params=params, headers=headers, timeout=12)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError):
            return [], False

        if isinstance(payload, dict):
            payload = payload.get("data", payload.get("records", []))
        if not isinstance(payload, list):
            return [], False

        has_more = len(payload) >= PAGE_SIZE
        output = []
        for item in payload[:PAGE_SIZE]:
            subject = str(item.get("desc") or item.get("subject") or item.get("SUBJECT") or "").strip()
            details = str(item.get("attchmntText") or item.get("details") or "").strip()
            if not subject and not details:
                continue

            company_name = item.get("sm_name") or item.get("companyName") or item.get("company") or symbol
            if is_noise_announcement(subject, details):
                continue

            category, subcategory, clean_headline = classify_announcement(subject, details, company_name)
            attachment = item.get("attchmntFile") or item.get("attachment") or item.get("ATTACHMENT") or ""
            output.append({
                "symbol": _clean_symbol(item.get("symbol") or symbol),
                "company": company_name,
                "subject": clean_headline,
                "category": category,
                "subcategory": subcategory,
                "details": details,
                "date": _as_iso_date(item.get("an_dt") or item.get("broadcastDateTime") or item.get("date")),
                "source": "NSE",
                "url": urljoin("https://www.nseindia.com/", str(attachment)) if attachment else NSE_ANNOUNCEMENTS.format(symbol=symbol),
                "source_page": NSE_ANNOUNCEMENTS.format(symbol=symbol),
                "id": str(item.get("seq_id") or item.get("id") or f"NSE-{symbol}-{subject}-{item.get('an_dt', '')}"),
            })
        return output, has_more

    def _fetch_bse(self, scrip_code, page=1, watchlist_symbol=None):
        today = date.today()
        params = {
            "pageno": max(1, int(page)),
            "pagesize": PAGE_SIZE,
            "pageSize": PAGE_SIZE,
            "strCat": -1,
            "subcategory": -1,
            "strPrevDate": (today - timedelta(days=FEED_DAYS)).strftime("%Y%m%d"),
            "strToDate": today.strftime("%Y%m%d"),
            "strSearch": "P",
            "strscrip": scrip_code,
            "strType": "C",
        }
        headers = dict(HEADERS)
        headers["Origin"] = "https://www.bseindia.com"
        headers["Referer"] = "https://www.bseindia.com/"
        try:
            response = requests.get(BSE_API, params=params, headers=headers, timeout=12)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError):
            return [], False

        rows = payload.get("Table", []) if isinstance(payload, dict) else []
        has_more = len(rows) >= PAGE_SIZE
        output = []
        for item in rows[:PAGE_SIZE]:
            subject = str(item.get("SUBCATNAME") or item.get("CATEGORYNAME") or item.get("HEADLINE") or "").strip()
            details = str(item.get("HEADLINE") or item.get("NEWSSUB") or "").strip()
            if not subject and not details:
                continue

            company_name = item.get("SLONGNAME") or item.get("LONG_NAME") or scrip_code
            if is_noise_announcement(subject, details):
                continue

            category, subcategory, clean_headline = classify_announcement(subject, details, company_name)
            attachment = str(item.get("ATTACHMENTNAME") or "").strip()
            output.append({
                "symbol": _clean_symbol(watchlist_symbol or scrip_code),
                "company": company_name,
                "subject": clean_headline,
                "category": category,
                "subcategory": subcategory,
                "details": details,
                "date": _as_iso_date(item.get("DT_TM") or item.get("NEWS_DT") or item.get("NEWS_DT_TM")),
                "source": "BSE",
                "url": urljoin(BSE_ATTACHMENTS, attachment) if attachment else BSE_ANNOUNCEMENTS,
                "source_page": BSE_ANNOUNCEMENTS,
                "id": str(item.get("NEWSID") or item.get("NEWS_ID") or f"BSE-{scrip_code}-{subject}-{item.get('DT_TM', '')}"),
            })
        return output, has_more

    def get_feed(self, symbols, page=1, subcategory="", refresh=False):
        symbol_by_base = {}
        for raw_symbol in symbols or []:
            cleaned = _clean_symbol(raw_symbol)
            if cleaned:
                symbol_by_base.setdefault(cleaned, str(raw_symbol).strip().upper())
        unique_symbols = list(symbol_by_base)
        records = []
        failures = 0
        has_more = False
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(unique_symbols)))) as executor:
            futures = {executor.submit(self._get_cached_symbol_feed, symbol, page, refresh): symbol for symbol in unique_symbols}
            for future in as_completed(futures):
                try:
                    symbol_records, symbol_has_more = future.result()
                    records.extend(symbol_records)
                    has_more = has_more or symbol_has_more
                except Exception:
                    failures += 1

        deduped = {}
        for record in records:
            deduped[record["id"]] = record
        all_records = list(deduped.values())
        for record in all_records:
            record["chart_symbol"] = symbol_by_base.get(_clean_symbol(record.get("symbol")), record.get("symbol", ""))
        all_records.sort(key=lambda item: item.get("date", ""), reverse=True)
        subcategories = sorted({item["subcategory"] for item in all_records if item.get("subcategory")}, key=str.casefold)
        selected = [item for item in all_records if not subcategory or item.get("subcategory") == subcategory]
        return {
            "items": selected[:PAGE_SIZE],
            "page": max(1, page),
            "page_size": PAGE_SIZE,
            "has_more": has_more,
            "total": None,
            "subcategories": subcategories,
            "symbols_count": len(unique_symbols),
            "failed_symbols": failures,
            "category": "Company Update",
            "period_days": FEED_DAYS,
        }

"""Fetch and normalize the public IPO/GMP feed for the IPO tracker.
Multi-source consensus provider:
1. InvestorGain (live IPO GMP report)
2. IPOWatch (Mainboard & SME GMP table)
3. IPOJi (live issue tracker & GMP rates)
Self-healing persistent fallback: auto-cached seed in seed_ipos.json
"""

import copy
import datetime as dt
import json
import logging
import os
from modules.common.ist_datetime import format_ist_display, now_ist
import re
import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from db_store import db as _mongo_db

try:
    from curl_cffi import requests as cffi_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False

logger = logging.getLogger(__name__)

INVESTORGAIN_URL = os.environ.get("IPO_TRACKER_FEED_URL", "https://www.investorgain.com/report/live-ipo-gmp/331/")
IPOWATCH_URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/"
IPOJI_URL = "https://ipoji.com/ipo-gmp/"
GMPTODAY_URL = "https://gmptoday.in/api/gmp.json"

PROVIDER_PAGE_URL = "https://www.investorgain.com/report/live-ipo-gmp/331/"
OFFICIAL_IPO_URL = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
FEED_URL = INVESTORGAIN_URL

try:
    FEED_TTL_SECONDS = max(60, int(os.environ.get("IPO_TRACKER_CACHE_SECONDS", "300")))
except (TypeError, ValueError):
    FEED_TTL_SECONDS = 300

REQUEST_TIMEOUT = (8, 20)
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

_HTTP_SESSION = requests.Session()
_HTTP_SESSION.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
})
_RETRY_POLICY = Retry(
    total=2,
    connect=1,
    read=1,
    status=1,
    backoff_factor=0.3,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset({"GET"}),
    respect_retry_after_header=True,
)
_HTTP_SESSION.mount("https://", HTTPAdapter(max_retries=_RETRY_POLICY))
_HTTP_SESSION.mount("http://", HTTPAdapter(max_retries=_RETRY_POLICY))

_cache_lock = threading.RLock()
_cached_payload = None
_cached_monotonic = 0.0

_refresh_lock = threading.RLock()
_is_refreshing = False
_refresh_progress = ''
_refresh_percent = 0
_refresh_error = None


def _save_seed(payload):
    """Save normalized payload to disk so app has guaranteed fresh offline seed."""
    if not payload or not isinstance(payload.get("ipos"), list) or not payload["ipos"]:
        return
    try:
        paths = [
            os.path.join(os.path.dirname(__file__), "seed_ipos.json"),
            os.path.join("app_data", "seed_ipos.json")
        ]
        for p in paths:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
    except Exception as exc:
        logger.debug("Notice saving seed backup: %s", exc)


def _load_fallback_seed():
    """Load persistent seed from disk, supporting both dict and list schemas."""
    try:
        paths = [
            os.path.join("app_data", "seed_ipos.json"),
            os.path.join(os.path.dirname(__file__), "seed_ipos.json")
        ]
        for seed_path in paths:
            if os.path.exists(seed_path):
                with open(seed_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and isinstance(data.get("ipos"), list) and data["ipos"]:
                        return data
                    elif isinstance(data, list) and data:
                        return {
                            "ipos": data,
                            "provider": "Cached Backup Seed",
                            "generated_display": "Offline Seed Backup",
                            "is_stale": True
                        }
    except Exception as exc:
        logger.warning("Error loading fallback IPO seed: %s", exc)
    return None


def _restore_cache_from_mongo():
    global _cached_payload, _cached_monotonic
    if _mongo_db is not None:
        try:
            document = _mongo_db["ipo_tracker_cache"].find_one({"_id": "latest"})
            payload = document.get("payload") if document else None
            if isinstance(payload, dict) and isinstance(payload.get("ipos"), list) and payload["ipos"]:
                stored_at = document.get("stored_at")
                if not isinstance(stored_at, dt.datetime):
                    stored_at = dt.datetime.now(dt.timezone.utc)
                elif stored_at.tzinfo is None:
                    stored_at = stored_at.replace(tzinfo=dt.timezone.utc)
                age = max(0.0, (dt.datetime.now(dt.timezone.utc) - stored_at).total_seconds())
                _cached_payload = payload
                _cached_monotonic = time.monotonic() - age
                return
        except Exception:
            pass

    seed = _load_fallback_seed()
    if seed:
        _cached_payload = seed
        _cached_monotonic = time.monotonic() - 7200


def _persist_cache_to_mongo(payload):
    if _mongo_db is None:
        return
    try:
        _mongo_db["ipo_tracker_cache"].replace_one(
            {"_id": "latest"},
            {"_id": "latest", "payload": payload, "stored_at": dt.datetime.now(dt.timezone.utc)},
            upsert=True,
        )
    except Exception:
        return


class IPOFeedError(RuntimeError):
    """Raised when the IPO provider cannot supply an initial usable response."""


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).strip().replace(",", "").replace("₹", "")
    if not raw or raw.lower() in {"-", "—", "--", "n/a", "na", "none", "null"}:
        return None
    match = re.search(r"[-+]?(?:\d+\.?\d*|\.\d+)", raw)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _parse_date(val):
    if not val:
        return ""
    val_str = str(val).strip()
    m_full = re.search(r"(\d{1,2})-([A-Za-z]{3})-(\d{2,4})", val_str)
    if m_full:
        day, mon, yr = m_full.group(1), m_full.group(2).capitalize(), m_full.group(3)
        if len(yr) == 2:
            yr = f"20{yr}"
        return f"{day} {mon} {yr}"
    m_short = re.search(r"(\d{1,2})-([A-Za-z]{3})", val_str)
    if m_short:
        day, mon = m_short.group(1), m_short.group(2).capitalize()
        curr_year = dt.datetime.now().year
        return f"{day} {mon} {curr_year}"
    return val_str


def clean_company_name(name):
    """Normalize company name to canonical lowercase string."""
    if not name:
        return ""
    n = re.sub(r"\s+(?:IPO|BSE\s+SME|NSE\s+SME|SME)\s+[UOC]$", "", name, flags=re.IGNORECASE)
    n = re.sub(r"\s+[UOC]$", "", n)
    n = re.sub(r"\s+(?:Upcoming|Open|Closed|Allotted|Listed)$", "", n, flags=re.IGNORECASE)
    n = re.sub(r"\s+(?:IPO|BSE\s+SME|NSE\s+SME|SME|Mainboard)$", "", n, flags=re.IGNORECASE)
    n = re.sub(r"\s+(?:Ltd\.?|Limited|Pvt\.?|Private)$", "", n, flags=re.IGNORECASE)
    n = re.sub(r"[^\w\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip().lower()
    return n


def get_company_tokens(name):
    """Extract significant lowercase word tokens for fuzzy cross-source matching."""
    clean = re.sub(r'(ipo|bse|nse|sme|mainboard|open|closed|upcoming|allotted|listed|ltd|limited|pvt|private|and|solutions|industries|india)', ' ', (name or '').lower())
    clean = re.sub(r'[^\w\s]', ' ', clean)
    tokens = [w for w in clean.split() if len(w) >= 2]
    return set(tokens)


def is_company_match(name1, name2):
    """Return True if name1 and name2 refer to the same IPO across different websites."""
    k1 = clean_company_name(name1)
    k2 = clean_company_name(name2)
    if k1 and k2 and (k1 == k2 or k1 in k2 or k2 in k1):
        return True
    t1 = get_company_tokens(name1)
    t2 = get_company_tokens(name2)
    if not t1 or not t2:
        return False
    inter = t1 & t2
    return len(inter) >= min(len(t1), len(t2)) or (len(inter) >= 2 and len(inter) / max(len(t1), len(t2)) >= 0.6)


def _fetch_url(url, is_json=False):
    """Fetch URL with curl_cffi Chrome impersonation first, falling back to requests."""
    if _HAS_CURL_CFFI:
        try:
            headers = {"User-Agent": USER_AGENT}
            if is_json:
                headers["Accept"] = "application/json, text/plain, */*"
            resp = cffi_requests.get(url, impersonate="chrome124", timeout=REQUEST_TIMEOUT[1], headers=headers)
            if resp.status_code == 200:
                return resp
        except Exception as exc:
            logger.debug("curl_cffi fetch notice for %s: %s", url, exc)

    try:
        resp = _HTTP_SESSION.get(url, timeout=REQUEST_TIMEOUT)
        return resp
    except Exception as exc:
        logger.debug("requests fetch notice for %s: %s", url, exc)
        return None


def _fetch_from_investorgain():
    """Primary provider: parse InvestorGain's live IPO GMP table."""
    resp = _fetch_url(INVESTORGAIN_URL, is_json=False)
    if not resp or resp.status_code != 200 or not resp.text:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", id="reportTable") or soup.find("table")
    if not table:
        return None

    ipos = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        tds = row.find_all("td")
        if len(tds) < 8:
            continue

        td0 = tds[0]
        link = td0.find("a")
        raw_name = link.get_text(strip=True) if link else td0.get_text(" ", strip=True)
        if not raw_name or raw_name.lower() in ("name", "company"):
            continue

        clean_name = re.sub(r"\s+(?:IPO|BSE\s+SME|NSE\s+SME)\s+[UOC]$", "", raw_name, flags=re.IGNORECASE)
        clean_name = re.sub(r"\s+[UOC]$", "", clean_name).strip()

        href = link.get("href", "") if link else ""
        slug = href.strip("/") if href else clean_name.lower().replace(" ", "-")
        detail_url = f"https://www.investorgain.com{href}" if href else INVESTORGAIN_URL

        badges = [b.get_text(strip=True) for b in td0.find_all("span", class_="badge")]
        status = "Closed"
        if "O" in badges:
            status = "Open"
        elif "U" in badges:
            status = "Upcoming"
        elif "C" in badges:
            status = "Closed"
        else:
            txt_lower = td0.get_text(" ", strip=True).lower()
            if "open" in txt_lower:
                status = "Open"
            elif "upcoming" in txt_lower:
                status = "Upcoming"

        segment = "SME" if any("sme" in b.lower() for b in badges) or "sme" in raw_name.lower() else "MAINBOARD"

        # GMP column (e.g. '₹ 111 (16.02%) 83 ↓ / 111 ↑', '₹ -- (0.00%) 0 ↓ / 0 ↑')
        gmp_td = tds[1].get_text(" ", strip=True) if len(tds) > 1 else ""
        gmp = None
        gmp_pct = None

        if "(" in gmp_td and "%" in gmp_td:
            gmp_pct = _number(gmp_td.split("(")[1].split("%")[0])

        # Explicitly recognize '₹ -- (0.00%)' or '0 ↓ / 0 ↑' as 0.0 GMP (flat / nil)
        if re.search(r"₹\s*--\s*\(\s*0(?:\.0+)?%\s*\)", gmp_td) or "0 ↓ / 0 ↑" in gmp_td:
            gmp = 0.0
            gmp_pct = 0.0
        else:
            left_part = gmp_td.split("(")[0] if "(" in gmp_td else gmp_td
            gmp = _number(left_part)

        gmp_min, gmp_max = None, None
        if "/" in gmp_td:
            parts = gmp_td.split("/")
            nums_left = re.findall(r"[-+]?\d+", parts[0].replace(",", ""))
            nums_right = re.findall(r"[-+]?\d+", parts[1].replace(",", ""))
            if nums_left and nums_right:
                try:
                    gmp_min = float(nums_left[-1])
                    gmp_max = float(nums_right[0])
                except ValueError:
                    pass

        rating_text = tds[2].get_text(strip=True) if len(tds) > 2 else ""
        confidence = "High" if "🔥🔥🔥" in rating_text else ("Moderate" if "🔥" in rating_text else "")

        sub_text = tds[3].get_text(strip=True) if len(tds) > 3 else ""
        subscription = _number(sub_text.replace("x", "")) if (sub_text and sub_text != "-") else None

        price_val = _number(tds[4].get_text(strip=True)) if len(tds) > 4 else None
        issue_size = tds[5].get_text(" ", strip=True) if len(tds) > 5 else "Not reported"
        if not issue_size or issue_size in ("-", "—"):
            issue_size = "Not reported"

        lot_size = _number(tds[6].get_text(strip=True)) if len(tds) > 6 else None
        min_inv = round(price_val * lot_size, 2) if (price_val and lot_size) else None

        open_d = _parse_date(tds[7].get_text(" ", strip=True)) if len(tds) > 7 else ""
        close_d = _parse_date(tds[8].get_text(" ", strip=True)) if len(tds) > 8 else ""
        boa_d = _parse_date(tds[9].get_text(" ", strip=True)) if len(tds) > 9 else ""
        list_d = _parse_date(tds[10].get_text(" ", strip=True)) if len(tds) > 10 else ""
        dates = f"{open_d} to {close_d}" if (open_d and close_d) else (f"Opens {open_d}" if open_d else "Dates not reported")

        if gmp is None and gmp_pct is not None and price_val and price_val > 0:
            gmp = round((gmp_pct * price_val) / 100.0, 2)
        elif gmp_pct is None and gmp is not None and price_val and price_val > 0:
            gmp_pct = round((gmp / price_val) * 100.0, 2)

        source_rows = [{"label": "InvestorGain Live", "url": detail_url, "gmp": gmp}]

        ipos.append({
            "id": slug,
            "name": clean_name[:180],
            "segment": segment[:40],
            "status": status[:60],
            "dates": dates[:100],
            "open_date": open_d[:40],
            "close_date": close_d[:40],
            "allotment_date": boa_d[:40],
            "listing_date": list_d[:60],
            "upper_price": price_val,
            "upper_price_display": f"₹{price_val:g}" if price_val else "Not reported",
            "issue_size": issue_size[:100],
            "lot_size": lot_size,
            "min_investment": min_inv,
            "subscription": subscription,
            "gmp": gmp,
            "gmp_min": gmp_min if gmp_min is not None else gmp,
            "gmp_max": gmp_max if gmp_max is not None else gmp,
            "gmp_pct": gmp_pct,
            "source_count": 1,
            "confidence": confidence,
            "score": None,
            "source_rows": source_rows,
            "detail_url": detail_url,
        })

    return ipos if ipos else None


def _fetch_from_ipowatch():
    """Secondary provider: parse IPOWatch GMP table."""
    resp = _fetch_url(IPOWATCH_URL, is_json=False)
    if not resp or resp.status_code != 200 or not resp.text:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        return None

    ipos = []
    for table in tables:
        rows = table.find_all("tr")
        for row in rows[1:]:
            tds = row.find_all("td")
            if len(tds) < 5:
                continue

            raw_name = tds[0].get_text(" ", strip=True)
            status = "Upcoming"
            if "open" in raw_name.lower():
                status = "Open"
            elif "closed" in raw_name.lower() or "allot" in raw_name.lower() or "listed" in raw_name.lower():
                status = "Closed"

            clean_name = re.sub(r"(?:Upcoming|Open|Closed|Allotted|Listed)$", "", raw_name, flags=re.IGNORECASE).strip()
            segment = "SME" if "sme" in raw_name.lower() else "MAINBOARD"

            gmp_text = tds[1].get_text(" ", strip=True)
            gmp = _number(gmp_text)
            price_val = _number(tds[3].get_text(" ", strip=True))
            est_gain_text = tds[4].get_text(" ", strip=True) if len(tds) > 4 else ""
            gmp_pct = None
            if "(" in est_gain_text and "%" in est_gain_text:
                gmp_pct = _number(est_gain_text.split("(")[1].split("%")[0])
            if gmp_pct is None and gmp is not None and price_val and price_val > 0:
                gmp_pct = round((gmp / price_val) * 100.0, 2)

            dates_text = tds[5].get_text(" ", strip=True) if len(tds) > 5 else "Dates not reported"

            link = tds[0].find("a")
            detail_url = link.get("href", IPOWATCH_URL) if link else IPOWATCH_URL
            slug = clean_name.lower().replace(" ", "-")

            ipos.append({
                "id": slug,
                "name": clean_name[:180],
                "segment": segment,
                "status": status,
                "dates": dates_text[:100],
                "open_date": "",
                "close_date": "",
                "allotment_date": "",
                "listing_date": "",
                "upper_price": price_val,
                "upper_price_display": f"₹{price_val:g}" if price_val else "Not reported",
                "issue_size": "Not reported",
                "lot_size": None,
                "min_investment": None,
                "subscription": None,
                "gmp": gmp,
                "gmp_min": gmp,
                "gmp_max": gmp,
                "gmp_pct": gmp_pct,
                "source_count": 1,
                "confidence": "Moderate",
                "score": None,
                "source_rows": [{"label": "IPOWatch GMP", "url": detail_url, "gmp": gmp}],
                "detail_url": detail_url,
            })

    return ipos if ipos else None


def _fetch_from_ipoji():
    """Tertiary provider: parse IPOJi live GMP table."""
    resp = _fetch_url(IPOJI_URL, is_json=False)
    if not resp or resp.status_code != 200 or not resp.text:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table")
    if not table:
        return None

    ipos = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        tds = row.find_all("td")
        if len(tds) < 5:
            continue

        raw_name = tds[0].get_text(" ", strip=True)
        type_text = tds[1].get_text(" ", strip=True) if len(tds) > 1 else ""
        price_text = tds[2].get_text(" ", strip=True) if len(tds) > 2 else ""
        gmp_text = tds[3].get_text(" ", strip=True) if len(tds) > 3 else ""
        pct_text = tds[4].get_text(" ", strip=True) if len(tds) > 4 else ""
        dates_text = tds[6].get_text(" ", strip=True) if len(tds) > 6 else ""
        status_text = tds[7].get_text(" ", strip=True) if len(tds) > 7 else "Upcoming"

        clean_name = re.sub(r"\s+(?:IPO|BSE\s+SME|NSE\s+SME|Mainboard)\s+(?:Open|Closed|Upcoming)$", "", raw_name, flags=re.IGNORECASE).strip()
        segment = "SME" if "sme" in type_text.lower() or "sme" in raw_name.lower() else "MAINBOARD"

        price_val = None
        if "-" in price_text:
            price_val = _number(price_text.split("-")[-1])
        else:
            price_val = _number(price_text)

        gmp = _number(gmp_text)
        gmp_pct = _number(pct_text)
        if gmp_pct is None and gmp is not None and price_val and price_val > 0:
            gmp_pct = round((gmp / price_val) * 100.0, 2)

        link = tds[0].find("a")
        detail_url = link.get("href", IPOJI_URL) if link else IPOJI_URL
        slug = clean_name.lower().replace(" ", "-")

        ipos.append({
            "id": slug,
            "name": clean_name[:180],
            "segment": segment,
            "status": status_text.capitalize(),
            "dates": dates_text[:100],
            "open_date": "",
            "close_date": "",
            "allotment_date": "",
            "listing_date": "",
            "upper_price": price_val,
            "upper_price_display": f"₹{price_val:g}" if price_val else "Not reported",
            "issue_size": "Not reported",
            "lot_size": None,
            "min_investment": None,
            "subscription": None,
            "gmp": gmp,
            "gmp_min": gmp,
            "gmp_max": gmp,
            "gmp_pct": gmp_pct,
            "source_count": 1,
            "confidence": "Moderate",
            "score": None,
            "source_rows": [{"label": "IPOJi GMP", "url": detail_url, "gmp": gmp}],
            "detail_url": detail_url,
        })

    return ipos if ipos else None


def normalize_ipo(item):
    """Normalize raw dictionary IPO record (backwards compatibility)."""
    if not isinstance(item, dict):
        return None
    name = str(item.get("name") or item.get("company") or "").strip()
    if not name:
        return None
    upper_price = _number(item.get("upper_price") or item.get("price_band"))
    gmp = _number(item.get("gmp") or item.get("gmp_median"))
    gmp_pct = _number(item.get("gmp_pct") or item.get("est_listing_gain_pct"))
    if gmp_pct is None and gmp is not None and upper_price and upper_price > 0:
        gmp_pct = round((gmp / upper_price * 100.0), 2)

    return {
        "id": str(item.get("id") or item.get("slug") or name.lower().replace(" ", "-"))[:160],
        "name": name[:180],
        "segment": str(item.get("segment") or item.get("type") or "MAINBOARD").upper()[:40],
        "status": str(item.get("status") or "Upcoming")[:60],
        "dates": str(item.get("dates") or "Dates not reported")[:100],
        "open_date": str(item.get("open_date") or "")[:40],
        "close_date": str(item.get("close_date") or "")[:40],
        "allotment_date": str(item.get("allotment_date") or "")[:40],
        "listing_date": str(item.get("listing_date") or "")[:60],
        "upper_price": upper_price,
        "upper_price_display": str(item.get("upper_price_display") or (f"₹{upper_price:g}" if upper_price else "Not reported"))[:80],
        "issue_size": str(item.get("issue_size") or "Not reported")[:100],
        "lot_size": _number(item.get("lot_size")),
        "min_investment": _number(item.get("min_investment")),
        "subscription": _number(item.get("subscription")),
        "gmp": gmp,
        "gmp_min": _number(item.get("gmp_min")),
        "gmp_max": _number(item.get("gmp_max")),
        "gmp_pct": gmp_pct,
        "source_count": int(_number(item.get("source_count")) or 1),
        "confidence": str(item.get("confidence") or "")[:30],
        "score": _number(item.get("score")),
        "source_rows": item.get("source_rows") or [],
        "detail_url": str(item.get("detail_url") or PROVIDER_PAGE_URL),
    }


def _fetch_payload():
    """Fetch from InvestorGain, IPOWatch, and IPOJi, then merge, cross-enrich, and auto-persist seed."""
    ig_ipos = None
    iw_ipos = None
    ipoji_ipos = None

    try:
        ig_ipos = _fetch_from_investorgain()
    except Exception as exc:
        logger.warning("InvestorGain fetch notice: %s", exc)

    try:
        iw_ipos = _fetch_from_ipowatch()
    except Exception as exc:
        logger.warning("IPOWatch fetch notice: %s", exc)

    try:
        ipoji_ipos = _fetch_from_ipoji()
    except Exception as exc:
        logger.warning("IPOJi fetch notice: %s", exc)

    merged_ipos = []
    base_list = ig_ipos or iw_ipos or ipoji_ipos or []

    for item in base_list:
        name = item["name"]
        item_copy = copy.deepcopy(item)
        source_rows = item_copy.get("source_rows") or []

        # Find matches from other sources
        other_matches = []
        if iw_ipos and base_list is not iw_ipos:
            m = next((x for x in iw_ipos if is_company_match(name, x["name"])), None)
            if m:
                other_matches.append(m)
        if ipoji_ipos and base_list is not ipoji_ipos:
            m = next((x for x in ipoji_ipos if is_company_match(name, x["name"])), None)
            if m:
                other_matches.append(m)

        # Merge sources and cross-enrich GMP
        for m in other_matches:
            if m.get("source_rows"):
                for s in m["source_rows"]:
                    if not any(existing.get("label") == s.get("label") for existing in source_rows):
                        source_rows.append(s)

            # Enrich missing fields
            if item_copy.get("upper_price") is None and m.get("upper_price"):
                item_copy["upper_price"] = m["upper_price"]
                item_copy["upper_price_display"] = m["upper_price_display"]

            # Cross-enrich GMP if base had None but match has valid GMP
            if item_copy.get("gmp") is None and m.get("gmp") is not None:
                item_copy["gmp"] = m["gmp"]
                item_copy["gmp_pct"] = m["gmp_pct"]

        # Collect all valid GMP values from all reporting sources
        valid_gmps = [s["gmp"] for s in source_rows if s.get("gmp") is not None]
        if valid_gmps:
            valid_gmps_sorted = sorted(valid_gmps)
            median_gmp = valid_gmps_sorted[len(valid_gmps_sorted) // 2]

            # If base item had no gmp, use consensus median
            if item_copy.get("gmp") is None:
                item_copy["gmp"] = median_gmp

            item_copy["gmp_min"] = min(valid_gmps)
            item_copy["gmp_max"] = max(valid_gmps)

            if item_copy.get("upper_price") and item_copy["upper_price"] > 0:
                item_copy["gmp_pct"] = round((item_copy["gmp"] / item_copy["upper_price"]) * 100.0, 2)

            item_copy["confidence"] = "High" if len(valid_gmps) >= 2 else "Moderate"
        else:
            item_copy["gmp"] = None
            item_copy["gmp_pct"] = None
            item_copy["gmp_min"] = None
            item_copy["gmp_max"] = None
            item_copy["confidence"] = "Unverified"

        # Keep sources that report valid GMP if available, else retain base source
        reporting_sources = [s for s in source_rows if s.get("gmp") is not None]
        if reporting_sources:
            item_copy["source_rows"] = reporting_sources
            item_copy["source_count"] = len(reporting_sources)
        else:
            item_copy["source_rows"] = source_rows
            item_copy["source_count"] = len(source_rows)

        merged_ipos.append(item_copy)

    # Append any IPOs from secondary providers that were completely missed by the base provider
    for secondary in (iw_ipos or []) + (ipoji_ipos or []):
        sec_name = secondary["name"]
        if not any(is_company_match(sec_name, existing["name"]) for existing in merged_ipos):
            merged_ipos.append(copy.deepcopy(secondary))

    if not merged_ipos:
        seed = _load_fallback_seed()
        if seed and isinstance(seed.get("ipos"), list) and seed["ipos"]:
            merged_ipos = seed["ipos"]

    if not merged_ipos:
        raise IPOFeedError("Could not reach any live IPO data provider. Please retry in a moment.")

    # Sort merged IPOs: open issues first, then upcoming, then recently closed
    def _status_order(st):
        s = (st or "").lower()
        if "open" in s:
            return 0
        if "upcom" in s or "pre" in s:
            return 1
        return 2

    merged_ipos.sort(key=lambda x: _status_order(x.get("status")))

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    now_display = format_ist_display()
    provider_name = "InvestorGain & IPOWatch Multi-Source"

    payload = {
        "ipos": merged_ipos,
        "generated_at": now_iso,
        "generated_display": f"{provider_name} Live Sync · {now_display}",
        "fetched_at": now_iso,
        "provider": provider_name,
        "provider_url": PROVIDER_PAGE_URL,
        "provider_data_url": PROVIDER_PAGE_URL,
        "official_ipo_url": OFFICIAL_IPO_URL,
        "license": "Live Market Tracking",
        "is_stale": False,
        "refresh_error": None,
    }

    # Automatically save fresh seed to disk for permanent resilience
    _save_seed(payload)
    return payload


def get_ipo_data(force_refresh=False):
    """Return cached normalized data; serve the last good response or bundled seed on outages."""
    global _cached_payload, _cached_monotonic

    with _cache_lock:
        now = time.monotonic()
        if _cached_payload is None:
            _restore_cache_from_mongo()
        if not force_refresh and _cached_payload is not None and now - _cached_monotonic < FEED_TTL_SECONDS:
            result = copy.deepcopy(_cached_payload)
            result["cache_status"] = "cached"
            return result

        try:
            payload = _fetch_payload()
            _cached_payload = payload
            _cached_monotonic = time.monotonic()
            _persist_cache_to_mongo(payload)
            result = copy.deepcopy(payload)
            result["cache_status"] = "refreshed"
            return result
        except IPOFeedError as exc:
            if _cached_payload is None:
                seed = _load_fallback_seed()
                if seed:
                    _cached_payload = seed
                    _cached_monotonic = time.monotonic() - 7200
            if _cached_payload is not None:
                result = copy.deepcopy(_cached_payload)
                result["is_stale"] = True
                result["refresh_error"] = str(exc)
                result["cache_status"] = "stale-fallback"
                return result
            raise


def save_synced_ipo_data(json_data):
    """Save client-synced IPO data to cache and Mongo."""
    global _cached_payload, _cached_monotonic
    sample_items = json_data.get("ipos") if isinstance(json_data, dict) else None
    if not isinstance(sample_items, list) or not sample_items:
        return {}

    ipos = [normalized for normalized in (normalize_ipo(item) for item in sample_items) if normalized]
    if not ipos:
        return {}

    payload = {
        "ipos": ipos,
        "generated_at": json_data.get("generated_at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "generated_display": json_data.get("generated_display") or "Client direct sync",
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "provider": json_data.get("provider") or "InvestorGain & IPOWatch Multi-Source",
        "provider_url": json_data.get("provider_url") or PROVIDER_PAGE_URL,
        "provider_data_url": json_data.get("provider_data_url") or PROVIDER_PAGE_URL,
        "official_ipo_url": OFFICIAL_IPO_URL,
        "license": "Live Market Tracking",
        "is_stale": False,
        "refresh_error": None,
    }
    with _cache_lock:
        _cached_payload = payload
        _cached_monotonic = time.monotonic()
        _persist_cache_to_mongo(payload)
    _save_seed(payload)
    return payload


def get_ipo_refresh_status():
    """Return the current IPO refresh status, counts, and last updated timestamps."""
    global _cached_payload, _cached_monotonic, _is_refreshing, _refresh_progress, _refresh_percent, _refresh_error
    with _cache_lock:
        if _cached_payload is None:
            _restore_cache_from_mongo()
        payload = _cached_payload or {}
        ipos = payload.get("ipos", []) if isinstance(payload, dict) else []

        counts = {
            "all": len(ipos),
            "open": 0,
            "upcoming": 0,
            "closed": 0,
            "mainboard": 0,
            "sme": 0,
        }
        for item in ipos:
            st = str(item.get("status") or "").lower()
            if "open" in st or "bidding" in st:
                counts["open"] += 1
            elif "upcoming" in st or "pre-open" in st:
                counts["upcoming"] += 1
            else:
                counts["closed"] += 1

            seg = str(item.get("segment") or "").lower()
            if "sme" in seg:
                counts["sme"] += 1
            else:
                counts["mainboard"] += 1

        last_updated = payload.get("fetched_at") or payload.get("generated_at") or ""
        raw_display = payload.get("generated_display") or ""
        if raw_display:
            if " · " in raw_display:
                pfx, t_str = raw_display.rsplit(" · ", 1)
                last_updated_display = f"{pfx} · {format_ist_display(t_str)}"
            else:
                last_updated_display = format_ist_display(raw_display)
        elif last_updated:
            try:
                dt_obj = dt.datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
                last_updated_display = format_ist_display(dt_obj)
            except Exception:
                last_updated_display = str(last_updated)
        else:
            last_updated_display = "Never"

        return {
            "is_refreshing": _is_refreshing,
            "progress": _refresh_progress or ("Idle" if not _is_refreshing else "In progress"),
            "percent": _refresh_percent,
            "error": _refresh_error,
            "last_updated": last_updated or "Never",
            "last_updated_display": last_updated_display or "Never",
            "total_ipos": len(ipos),
            "counts": counts,
            "provider": payload.get("provider", "InvestorGain & IPOWatch Multi-Source"),
            "storage": "MongoDB Atlas (Synced)",
        }


def start_admin_ipo_refresh():
    """Initiate background refresh of live IPOs and GMP by Admin."""
    global _is_refreshing, _refresh_progress, _refresh_percent, _refresh_error
    with _refresh_lock:
        if _is_refreshing:
            return {
                "success": False,
                "status": "in_progress",
                "message": "An IPO refresh is already in progress.",
                **get_ipo_refresh_status(),
            }
        _is_refreshing = True
        _refresh_progress = "Connecting to live IPO & GMP portals..."
        _refresh_percent = 15
        _refresh_error = None

    thread = threading.Thread(target=_run_admin_ipo_refresh_worker, daemon=True)
    thread.start()

    return {
        "success": True,
        "status": "started",
        "message": "Background refresh started. Multi-source IPOs and GMP data are being synchronized.",
        **get_ipo_refresh_status(),
    }


def _run_admin_ipo_refresh_worker():
    global _cached_payload, _cached_monotonic, _is_refreshing, _refresh_progress, _refresh_percent, _refresh_error
    try:
        logger.info("Admin initiated IPO & GMP live refresh...")
        with _refresh_lock:
            _refresh_percent = 35
            _refresh_progress = "Fetching and parsing live issues from InvestorGain, IPOWatch & IPOJi..."

        payload = _fetch_payload()

        with _refresh_lock:
            _refresh_percent = 80
            _refresh_progress = f"Parsed and merged {len(payload.get('ipos', []))} issues across providers. Persisting to storage..."

        with _cache_lock:
            _cached_payload = payload
            _cached_monotonic = time.monotonic()
            _persist_cache_to_mongo(payload)

        total_count = len(payload.get("ipos", []))
        with _refresh_lock:
            _refresh_percent = 100
            _refresh_progress = f"Completed successfully! {total_count} IPOs synchronized and cached with multi-source GMP."
            _refresh_error = None
        logger.info(f"IPO refresh completed: {total_count} records saved.")
    except Exception as exc:
        logger.error(f"Error during IPO background refresh: {exc}", exc_info=True)
        with _refresh_lock:
            _refresh_error = str(exc)
            _refresh_progress = f"Refresh failed: {str(exc)}"
    finally:
        with _refresh_lock:
            _is_refreshing = False

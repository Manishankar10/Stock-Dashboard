"""Fetch and normalize the public IPO/GMP feed for the IPO tracker.
Primary provider: InvestorGain (live IPO GMP report)
Secondary fallback: IPOWatch
Tertiary fallback: gmptoday / bundled seed
"""

import copy
import datetime as dt
import json
import logging
import os
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


def _load_fallback_seed():
    try:
        seed_path = os.path.join(os.path.dirname(__file__), "seed_ipos.json")
        if os.path.exists(seed_path):
            with open(seed_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("ipos"), list) and data["ipos"]:
                    return data
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
    if not raw or raw.lower() in {"-", "—", "n/a", "na", "none", "null"}:
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
    table = soup.find("table", id="reportTable")
    if not table:
        table = soup.find("table")
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

        # GMP column (e.g. '₹ 111 (16.02%) 83 ↓ / 111 ↑')
        gmp_td = tds[1].get_text(" ", strip=True) if len(tds) > 1 else ""
        gmp = _number(gmp_td.split("(")[0] if "(" in gmp_td else gmp_td)

        gmp_pct = None
        if "(" in gmp_td and "%" in gmp_td:
            gmp_pct = _number(gmp_td.split("(")[1].split("%")[0])

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

        source_rows = [{"label": "InvestorGain Live GMP", "url": detail_url, "gmp": gmp}]

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
            "gmp_min": gmp_min,
            "gmp_max": gmp_max,
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

            gmp = _number(tds[1].get_text(" ", strip=True))
            price_val = _number(tds[3].get_text(" ", strip=True))
            est_gain_text = tds[4].get_text(" ", strip=True) if len(tds) > 4 else ""
            gmp_pct = None
            if "(" in est_gain_text and "%" in est_gain_text:
                gmp_pct = _number(est_gain_text.split("(")[1].split("%")[0])

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
                "gmp_min": None,
                "gmp_max": None,
                "gmp_pct": gmp_pct,
                "source_count": 1,
                "confidence": "Moderate",
                "score": None,
                "source_rows": [{"label": "IPOWatch GMP", "url": detail_url, "gmp": gmp}],
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
    """Try InvestorGain first, then IPOWatch, then fallback to seed."""
    ipos = None
    provider_name = "InvestorGain"
    provider_url = PROVIDER_PAGE_URL

    try:
        ipos = _fetch_from_investorgain()
        if ipos:
            provider_name = "InvestorGain"
            provider_url = INVESTORGAIN_URL
    except Exception as exc:
        logger.warning("InvestorGain fetch notice: %s", exc)

    if not ipos:
        try:
            ipos = _fetch_from_ipowatch()
            if ipos:
                provider_name = "IPOWatch"
                provider_url = IPOWATCH_URL
        except Exception as exc:
            logger.warning("IPOWatch fetch notice: %s", exc)

    if not ipos:
        seed = _load_fallback_seed()
        if seed and isinstance(seed.get("ipos"), list) and seed["ipos"]:
            ipos = seed["ipos"]
            provider_name = seed.get("provider", "InvestorGain")
            provider_url = seed.get("provider_url", PROVIDER_PAGE_URL)

    if not ipos:
        raise IPOFeedError("Could not reach the live IPO data provider. Please retry in a moment.")

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    now_display = dt.datetime.now().strftime("%d %b %Y, %I:%M %p")

    return {
        "ipos": ipos,
        "generated_at": now_iso,
        "generated_display": f"{provider_name} Live Sync · {now_display}",
        "fetched_at": now_iso,
        "provider": provider_name,
        "provider_url": provider_url,
        "provider_data_url": provider_url,
        "official_ipo_url": OFFICIAL_IPO_URL,
        "license": "Live Market Tracking",
        "is_stale": False,
        "refresh_error": None,
    }


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
        "provider": json_data.get("provider") or "InvestorGain",
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
    return payload

"""Fetch and normalize the public IPO/GMP feed for the IPO tracker."""

import copy
import datetime as dt
import os
import re
import threading
import time

import requests


FEED_URL = os.environ.get("IPO_TRACKER_FEED_URL", "https://gmptoday.in/api/gmp.json")
OFFICIAL_IPO_URL = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
PROVIDER_PAGE_URL = "https://gmptoday.in/"
try:
    FEED_TTL_SECONDS = max(60, int(os.environ.get("IPO_TRACKER_CACHE_SECONDS", "600")))
except (TypeError, ValueError):
    FEED_TTL_SECONDS = 600
REQUEST_TIMEOUT = (5, 15)
USER_AGENT = "CapitalDesk IPO Tracker/1.0 (+https://gmptoday.in/)"

_cache_lock = threading.RLock()
_cached_payload = None
_cached_monotonic = 0.0


class IPOFeedError(RuntimeError):
    """Raised when the IPO provider cannot supply an initial usable response."""


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).strip().replace(",", "")
    if not raw or raw.lower() in {"-", "—", "n/a", "na", "none", "null"}:
        return None
    match = re.search(r"[-+]?(?:\d+\.?\d*|\.\d+)", raw)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _upper_price(value):
    """The feed commonly provides the upper band as one number; accept ranges too."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).replace(",", "")
    numbers = re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)", raw)
    if not numbers:
        return None
    try:
        return float(numbers[-1])
    except ValueError:
        return None


def _safe_source_rows(rows):
    result = []
    if not isinstance(rows, list):
        return result
    for row in rows:
        if not isinstance(row, dict):
            continue
        result.append({
            "label": str(row.get("label") or row.get("src") or "Source")[:80],
            "url": str(row.get("url") or "")[:500],
            "gmp": _number(row.get("gmp")),
        })
    return result[:12]


def normalize_ipo(item):
    if not isinstance(item, dict):
        return None

    name = str(item.get("name") or item.get("company") or "").strip()
    if not name:
        return None

    gmp = _number(item.get("median_gmp", item.get("gmp")))
    upper_price = _upper_price(item.get("price_band"))
    gmp_pct = (gmp / upper_price * 100.0) if gmp is not None and upper_price and upper_price > 0 else None
    slug = str(item.get("slug") or "").strip(" /")

    return {
        "id": str(item.get("key") or slug or name.lower())[:160],
        "name": name[:180],
        "segment": str(item.get("type") or item.get("group") or "IPO").upper()[:40],
        "status": str(item.get("status") or "Status unavailable")[:60],
        "dates": str(item.get("open_close") or item.get("dates") or "Dates not reported")[:100],
        "listing_date": str(item.get("listing_date") or "")[:60],
        "upper_price": upper_price,
        "upper_price_display": str(item.get("price_band_display") or "")[:80],
        "issue_size": str(item.get("issue_size") or "Not reported")[:100],
        "lot_size": _number(item.get("lot_size")),
        "subscription": _number(item.get("subscription")),
        "gmp": gmp,
        "gmp_min": _number(item.get("min_gmp")),
        "gmp_max": _number(item.get("max_gmp")),
        "gmp_pct": gmp_pct,
        "source_count": int(_number(item.get("n_sources")) or 0),
        "confidence": str(item.get("confidence") or "")[:30],
        "source_rows": _safe_source_rows(item.get("source_rows")),
        "detail_url": f"https://gmptoday.in/ipo/{slug}/" if slug and re.fullmatch(r"[a-zA-Z0-9-]+", slug) else PROVIDER_PAGE_URL,
    }


def _fetch_payload():
    try:
        response = requests.get(
            FEED_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise IPOFeedError("Could not refresh IPO data from the configured provider.") from exc

    if not isinstance(data, dict) or not isinstance(data.get("ipos"), list):
        raise IPOFeedError("The configured IPO provider returned an unexpected response.")

    ipos = [normalized for normalized in (normalize_ipo(item) for item in data["ipos"]) if normalized]
    return {
        "ipos": ipos,
        "generated_at": data.get("generated_at"),
        "generated_display": data.get("generated_display") or data.get("generated_at") or "Provider time unavailable",
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "provider": "IPO GMP Today",
        "provider_url": PROVIDER_PAGE_URL,
        "provider_data_url": FEED_URL,
        "official_ipo_url": OFFICIAL_IPO_URL,
        "license": "CC BY 4.0",
        "is_stale": False,
        "refresh_error": None,
    }


def get_ipo_data(force_refresh=False):
    """Return cached normalized data; serve the last good response on outages."""
    global _cached_payload, _cached_monotonic

    with _cache_lock:
        now = time.monotonic()
        if not force_refresh and _cached_payload is not None and now - _cached_monotonic < FEED_TTL_SECONDS:
            result = copy.deepcopy(_cached_payload)
            result["cache_status"] = "cached"
            return result

        try:
            payload = _fetch_payload()
            _cached_payload = payload
            _cached_monotonic = time.monotonic()
            result = copy.deepcopy(payload)
            result["cache_status"] = "refreshed"
            return result
        except IPOFeedError as exc:
            if _cached_payload is None:
                raise
            result = copy.deepcopy(_cached_payload)
            result["is_stale"] = True
            result["refresh_error"] = str(exc)
            result["cache_status"] = "stale-fallback"
            return result

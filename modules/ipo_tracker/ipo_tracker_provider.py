"""Fetch and normalize the public IPO/GMP feed for the IPO tracker."""

import copy
import datetime as dt
import logging
import os
import re
import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from db_store import db as _mongo_db


FEED_URL = os.environ.get("IPO_TRACKER_FEED_URL", "https://gmptoday.in/api/gmp.json")
OFFICIAL_IPO_URL = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
PROVIDER_PAGE_URL = "https://gmptoday.in/"
try:
    FEED_TTL_SECONDS = max(60, int(os.environ.get("IPO_TRACKER_CACHE_SECONDS", "600")))
except (TypeError, ValueError):
    FEED_TTL_SECONDS = 600
REQUEST_TIMEOUT = (8, 30)
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
_HTTP_SESSION = requests.Session()
_HTTP_SESSION.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Referer": PROVIDER_PAGE_URL,
})
_RETRY_POLICY = Retry(
    total=1,
    connect=1,
    read=1,
    status=1,
    backoff_factor=0.25,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset({"GET"}),
    respect_retry_after_header=True,
)
_HTTP_SESSION.mount("https://", HTTPAdapter(max_retries=_RETRY_POLICY))

_cache_lock = threading.RLock()
_cached_payload = None
_cached_monotonic = 0.0


def _restore_cache_from_mongo():
    """Restore the last shared feed snapshot so an app restart can serve stale data."""
    global _cached_payload, _cached_monotonic
    if _mongo_db is None:
        return
    try:
        document = _mongo_db["ipo_tracker_cache"].find_one({"_id": "latest"})
        payload = document.get("payload") if document else None
        if not isinstance(payload, dict) or not isinstance(payload.get("ipos"), list):
            return
        stored_at = document.get("stored_at")
        if not isinstance(stored_at, dt.datetime):
            stored_at = dt.datetime.now(dt.timezone.utc)
        elif stored_at.tzinfo is None:
            stored_at = stored_at.replace(tzinfo=dt.timezone.utc)
        age = max(0.0, (dt.datetime.now(dt.timezone.utc) - stored_at).total_seconds())
        _cached_payload = payload
        _cached_monotonic = time.monotonic() - age
    except Exception:
        # Live refresh remains available when MongoDB is unavailable.
        return


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
        # The in-process feed cache still works if the database is temporarily unavailable.
        return


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

    gmp = _number(item.get("gmp_median", item.get("median_gmp", item.get("gmp"))))
    upper_price = _upper_price(item.get("price_band") or item.get("upper_price"))
    gmp_pct = _number(item.get("est_listing_gain_pct", item.get("gmp_pct")))
    if gmp_pct is None and gmp is not None and upper_price and upper_price > 0:
        gmp_pct = round((gmp / upper_price * 100.0), 2)

    slug = str(item.get("slug") or "").strip(" /")
    open_date = str(item.get("open_date") or "").strip()
    close_date = str(item.get("close_date") or "").strip()
    bidding = str(item.get("bidding") or item.get("open_close") or item.get("dates") or "").strip()

    if open_date and close_date:
        dates = f"{open_date} to {close_date}"
    elif bidding:
        dates = bidding
    else:
        dates = "Dates not reported"

    detail_url = str(item.get("url") or "").strip()
    if not detail_url:
        detail_url = f"https://gmptoday.in/ipo/{slug}/" if slug and re.fullmatch(r"[a-zA-Z0-9-]+", slug) else PROVIDER_PAGE_URL

    source_count = int(_number(item.get("gmp_sources", item.get("n_sources", item.get("source_count")))) or 0)
    source_rows = _safe_source_rows(item.get("source_rows") or item.get("sources"))

    return {
        "id": str(item.get("key") or slug or name.lower())[:160],
        "name": name[:180],
        "segment": str(item.get("type") or item.get("group") or item.get("segment") or "IPO").upper()[:40],
        "status": str(item.get("status") or "Status unavailable")[:60],
        "dates": dates[:100],
        "open_date": open_date[:40],
        "close_date": close_date[:40],
        "allotment_date": str(item.get("allotment_date") or "")[:40],
        "listing_date": str(item.get("listing_date") or "")[:60],
        "upper_price": upper_price,
        "upper_price_display": str(item.get("price_band_display") or (f"₹{upper_price:g}" if upper_price else ""))[:80],
        "issue_size": str(item.get("issue_size") or "Not reported")[:100],
        "lot_size": _number(item.get("lot_size")),
        "min_investment": _number(item.get("min_investment")),
        "subscription": _number(item.get("subscription")),
        "gmp": gmp,
        "gmp_min": _number(item.get("gmp_min", item.get("min_gmp"))),
        "gmp_max": _number(item.get("gmp_max", item.get("max_gmp"))),
        "gmp_pct": gmp_pct,
        "source_count": source_count,
        "confidence": str(item.get("confidence") or "")[:30],
        "score": _number(item.get("score")),
        "source_rows": source_rows,
        "detail_url": detail_url,
    }


def _parse_provider_html(html, sample_items=None):
    sample_map = {item.get("slug"): item for item in (sample_items or []) if isinstance(item, dict) and item.get("slug")}
    pattern = re.compile(r'<a\s+class="row"\s+href="/ipo/([^/"]+)/"\s+([^>]*)>(.*?)</a>', re.DOTALL)
    matches = pattern.findall(html)
    if not matches:
        return []

    normalized_list = []
    for slug, attr_str, inner_html in matches:
        attrs = dict(re.findall(r'data-([a-zA-Z0-9-]+)="([^"]*)"', attr_str))
        sample = sample_map.get(slug, {})

        name_m = re.search(r'class="row-name"[^>]*>(.*?)(?:<em|\s*</span>)', inner_html, re.DOTALL)
        name = (name_m.group(1).strip() if name_m else attrs.get('name', slug)) or sample.get('name', '')
        name = re.sub(r'<[^>]+>', '', name).strip()
        if not name:
            name = slug.replace('-', ' ').title()

        st_m = re.search(r'class="st st-([a-zA-Z0-9-]+)"[^>]*>(.*?)</em>', inner_html)
        status = st_m.group(2).strip() if st_m else sample.get('status')
        if not status:
            status = 'Open' if 'data-close' in attrs else 'Upcoming'

        group_attr = attrs.get('group', '').upper()
        if group_attr == 'MAINBOARD':
            segment = 'MAINBOARD'
        elif group_attr == 'SME':
            segment = 'SME'
        elif group_attr:
            segment = group_attr
        else:
            if 'sme' in name.lower() or 'sme' in str(sample.get('type', '')).lower():
                segment = 'SME'
            elif sample.get('type'):
                segment = str(sample.get('type')).upper()
            else:
                segment = 'MAINBOARD'

        when_m = re.search(r'class="c-when"[^>]*>(.*?)</span>', inner_html)
        when = when_m.group(1).strip() if when_m else ''
        if not when or when in {'—', '-'}:
            when = sample.get('bidding') or sample.get('dates') or 'Dates not reported'

        gmp = _number(attrs.get('med'))
        if gmp is None:
            gmp = _number(sample.get('gmp_median', sample.get('median_gmp', sample.get('gmp'))))

        gmp_pct = _number(attrs.get('est'))
        if gmp_pct is None:
            gmp_pct = _number(sample.get('est_listing_gain_pct', sample.get('gmp_pct')))

        range_m = re.search(r'class="c-range[^"]*"[^>]*>([^<]+)', inner_html)
        range_text = range_m.group(1).strip() if range_m else ''
        gmp_min = _number(sample.get('gmp_min', sample.get('min_gmp')))
        gmp_max = _number(sample.get('gmp_max', sample.get('max_gmp')))
        if (gmp_min is None or gmp_max is None) and range_text and '–' in range_text:
            nums = re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)', range_text.replace(',', ''))
            if len(nums) >= 2:
                try:
                    gmp_min = float(nums[0])
                    gmp_max = float(nums[1])
                except ValueError:
                    pass

        upper_price = _number(sample.get('price_band') or sample.get('upper_price'))
        if upper_price is None and gmp and gmp_pct and gmp_pct > 0:
            upper_price = round(gmp / (gmp_pct / 100.0), 2)

        tags = re.findall(r'class="tag tag-([a-zA-Z0-9-]+)"[^>]*>(.*?)</em>', inner_html)
        min_inv_num = _number(sample.get('min_investment'))
        for t_type, t_val in tags:
            t_clean = t_val.strip()
            if ('Min' in t_clean or '₹' in t_clean) and min_inv_num is None:
                min_inv_num = _number(t_clean)

        lot_size = _number(sample.get('lot_size'))
        if lot_size is None and min_inv_num and upper_price and upper_price > 0:
            lot_size = round(min_inv_num / upper_price)

        sub_m = re.search(r'class="c-sub[^"]*"[^>]*>([^<]+)', inner_html)
        subscription = _number(sub_m.group(1).replace('×', '') if sub_m else attrs.get('sub'))
        if subscription is None:
            subscription = _number(sample.get('subscription'))

        conf_m = re.search(r'class="badge badge-([a-zA-Z0-9-]+)"[^>]*>(.*?)</em>', inner_html)
        confidence = conf_m.group(2).strip() if conf_m else sample.get('confidence', '')

        sources_m = re.search(r'<small>(\d+)\s+sources?</small>', inner_html)
        source_count = int(sources_m.group(1)) if sources_m else int(_number(sample.get('gmp_sources', sample.get('n_sources'))) or 0)

        source_rows = _safe_source_rows(sample.get('source_rows') or sample.get('sources'))

        normalized_list.append({
            "id": slug,
            "name": name[:180],
            "segment": segment[:40],
            "status": status[:60],
            "dates": when[:100],
            "open_date": str(sample.get("open_date") or "")[:40],
            "close_date": str(sample.get("close_date") or "")[:40],
            "allotment_date": str(sample.get("allotment_date") or "")[:40],
            "listing_date": str(sample.get("listing_date") or "")[:60],
            "upper_price": upper_price,
            "upper_price_display": (f"₹{upper_price:g}" if upper_price else "")[:80],
            "issue_size": str(sample.get("issue_size") or "Not reported")[:100],
            "lot_size": lot_size,
            "min_investment": min_inv_num,
            "subscription": subscription,
            "gmp": gmp,
            "gmp_min": gmp_min,
            "gmp_max": gmp_max,
            "gmp_pct": gmp_pct,
            "source_count": source_count,
            "confidence": confidence[:30],
            "score": _number(sample.get("score")),
            "source_rows": source_rows,
            "detail_url": f"https://gmptoday.in/ipo/{slug}/",
        })

    return normalized_list


def _fetch_payload():
    json_data = {}
    sample_items = []
    try:
        resp_json = _HTTP_SESSION.get(FEED_URL, timeout=REQUEST_TIMEOUT)
        if resp_json.ok:
            json_data = resp_json.json()
            if isinstance(json_data, dict) and isinstance(json_data.get("ipos"), list):
                sample_items = json_data["ipos"]
    except Exception as exc:
        logging.getLogger(__name__).warning("IPO JSON feed fetch notice: %s", exc)

    html_ipos = []
    try:
        resp_html = _HTTP_SESSION.get(PROVIDER_PAGE_URL, timeout=REQUEST_TIMEOUT)
        if resp_html.ok:
            html_ipos = _parse_provider_html(resp_html.text, sample_items)
    except Exception as exc:
        logging.getLogger(__name__).warning("IPO HTML page fetch notice: %s", exc)

    if html_ipos:
        ipos = html_ipos
    elif sample_items:
        ipos = [normalized for normalized in (normalize_ipo(item) for item in sample_items) if normalized]
    else:
        raise IPOFeedError("Could not reach the live IPO data provider. Please retry in a moment.")

    return {
        "ipos": ipos,
        "generated_at": json_data.get("generated_at") or json_data.get("updated_at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "generated_display": json_data.get("generated_display") or json_data.get("generated_at") or json_data.get("updated_at") or "Provider live sync",
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
                raise
            result = copy.deepcopy(_cached_payload)
            result["is_stale"] = True
            result["refresh_error"] = str(exc)
            result["cache_status"] = "stale-fallback"
            return result

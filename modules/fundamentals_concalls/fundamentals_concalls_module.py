"""Quarter-wise concall documents sourced from official NSE/BSE filings."""

from datetime import date, datetime
from threading import Lock
from urllib.parse import urljoin
import os
import re
import time

import requests
from flask import Blueprint, jsonify, request, send_from_directory

from modules.official_feeds.official_feeds_ai import (
    OfficialFeedSummaryError,
    summarize_official_concall,
)


fundamentals_concalls_bp = Blueprint(
    "fundamentals_concalls", __name__, url_prefix="/api/fundamentals/concalls"
)

NSE_HOME = "https://www.nseindia.com/"
NSE_API = "https://www.nseindia.com/api/corporate-announcements"
NSE_FILINGS = "https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol={symbol}&tabIndex=equity"
CACHE_TTL = 900
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}
_cache = {}
_cache_lock = Lock()


@fundamentals_concalls_bp.get("/assets/<path:filename>")
def fundamentals_concalls_asset(filename):
    return send_from_directory(os.path.dirname(__file__), filename)


def _clean_symbol(raw):
    return re.sub(r"\.(?:NS|BO)$", "", str(raw or "").strip(), flags=re.IGNORECASE).upper()


def _normalize_date(raw):
    value = str(raw or "").strip()
    for fmt in (
        "%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M", "%d-%b-%Y",
        "%d-%m-%Y %H:%M:%S", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(value, fmt).isoformat(timespec="minutes")
        except ValueError:
            continue
    return value


def _document_type(subject, details):
    text = re.sub(r"[^a-z0-9]+", " ", f"{subject} {details}".casefold())
    if re.search(r"\b(transcript|transcription)\b", text):
        return "transcript"
    if re.search(r"\b(presentation|ppt|investors? deck)\b", text):
        return "ppt"
    if re.search(r"\b(recording|webcast|audio|video)\b", text):
        return "recording"
    return None


def _is_concall(subject, details):
    # NSE separates the filing category (e.g. "Analysts/Institutional Investor
    # Meet/Con. Call Updates") from its description. Normalize punctuation so
    # category spellings such as "Con. Call" are recognized as "con call".
    text = re.sub(r"[^a-z0-9]+", " ", f"{subject} {details}".casefold())
    return bool(re.search(
        r"\b(concall|con call|conference call|investors? call|analysts? call|"
        r"investors? meet|analysts? meet|institutional investors? meet|earnings call|"
        r"investors? presentation|earnings presentation|presentation to analysts|call updates)\b",
        text,
    ))


def _quarter_dates(page):
    """Map each UI page to one calendar quarter; NSE ignores announcement paging."""
    today = date.today()
    start_month = ((today.month - 1) // 3) * 3 + 1
    quarter_index = today.year * 4 + (start_month - 1) // 3 - (page - 1)
    year, quarter_zero = divmod(quarter_index, 4)
    first_month = quarter_zero * 3 + 1
    from_date = date(year, first_month, 1)
    if first_month == 10:
        next_quarter = date(year + 1, 1, 1)
    else:
        next_quarter = date(year, first_month + 3, 1)
    to_date = min(today, date.fromordinal(next_quarter.toordinal() - 1))
    return from_date, to_date


def _fetch_nse_page(symbol, page, refresh=False):
    key = (symbol, page)
    now = time.time()
    with _cache_lock:
        cached = _cache.get(key)
        if not refresh and cached and now - cached[0] < CACHE_TTL:
            return cached[1]

    from_date, to_date = _quarter_dates(page)
    session = requests.Session()
    try:
        session.get(NSE_HOME, headers=HEADERS, timeout=8)
        params = {
            "index": "equities",
            "symbol": symbol,
            "from_date": from_date.strftime("%d-%m-%Y"),
            "to_date": to_date.strftime("%d-%m-%Y"),
        }
        headers = dict(HEADERS)
        headers["Referer"] = "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
        response = session.get(NSE_API, params=params, headers=headers, timeout=15)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None

    rows = payload.get("data", payload.get("records", [])) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return None

    items = []
    for row in rows:
        subject = str(row.get("desc") or row.get("subject") or row.get("SUBJECT") or "").strip()
        details = str(row.get("attchmntText") or row.get("details") or "").strip()
        doc_type = _document_type(subject, details)
        if not subject or not doc_type or not _is_concall(subject, details):
            continue
        attachment = str(row.get("attchmntFile") or row.get("attachment") or row.get("ATTACHMENT") or "").strip()
        url = urljoin(NSE_HOME, attachment) if attachment else NSE_FILINGS.format(symbol=symbol)
        raw_date = row.get("an_dt") or row.get("broadcastDateTime") or row.get("date")
        event_date = _normalize_date(raw_date)
        parsed_date = None
        try:
            parsed_date = datetime.fromisoformat(event_date.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass
        items.append({
            "id": str(row.get("seq_id") or row.get("id") or f"NSE-{symbol}-{event_date}-{doc_type}-{subject}"),
            "symbol": symbol,
            "company": str(row.get("sm_name") or row.get("companyName") or symbol),
            "subject": subject,
            "details": details,
            "type": doc_type,
            "date": event_date,
            "year": parsed_date.year if parsed_date else None,
            "quarter": ((parsed_date.month - 1) // 3 + 1) if parsed_date else None,
            "url": url,
            "source": "NSE",
        })
    result = {
        "items": items,
        "has_more": from_date > date(2000, 1, 1),
        "page": page,
        "period": {"from": from_date.isoformat(), "to": to_date.isoformat()},
    }
    with _cache_lock:
        _cache[key] = (now, result)
    return result


@fundamentals_concalls_bp.get("")
def get_concalls():
    raw_symbol = request.args.get("symbol", "")
    symbol = _clean_symbol(raw_symbol)
    if not symbol or symbol.startswith("^") or "=F" in symbol or not re.fullmatch(r"[A-Z0-9&._-]{1,30}", symbol):
        return jsonify({"error": "A valid Indian stock symbol is required."}), 400
    try:
        page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        page = 1
    page = min(page, 500)
    result = _fetch_nse_page(symbol, page, request.args.get("refresh") == "1")
    if result is None:
        return jsonify({
            "items": [], "has_more": False,
            "error": "Could not retrieve concall filings from NSE right now.",
            "source_url": NSE_FILINGS.format(symbol=symbol),
        }), 502
    result["source_url"] = NSE_FILINGS.format(symbol=symbol)
    return jsonify(result)


@fundamentals_concalls_bp.post("/summarize")
def summarize_concall_transcript():
    data = request.get_json(silent=True) or {}
    doc_type = str(data.get("type") or "").casefold()
    if doc_type != "transcript":
        return jsonify({"error": "AI summaries are available for transcript documents only."}), 400
    try:
        summary = summarize_official_concall(
            url=data.get("url"),
            company=data.get("company"),
            subject=data.get("subject"),
            details=data.get("details"),
        )
        return jsonify({"summary": summary})
    except OfficialFeedSummaryError as exc:
        message = str(exc)
        status = 503 if "GEMINI_API_KEY" in message else (429 if "rate limit" in message else 502)
        return jsonify({"error": message}), status

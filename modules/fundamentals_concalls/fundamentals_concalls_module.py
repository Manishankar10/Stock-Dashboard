from modules.common.ai_prompt_manager import format_prompt, GEMINI_MODELS
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


import base64
from hashlib import sha256
from modules.app_config import get_app_setting

SENIOR_EQUITY_RESEARCH_PROMPT_TEMPLATE = """# ROLE: Senior Equity Research Analyst — Earnings Concall Analysis

Act as a senior equity research analyst specializing in Indian listed companies, financial statement analysis, business strategy, industry trends, and long-term investment research.

Your task is to analyze the provided quarterly or annual earnings conference call transcript and prepare a **detailed, structured, fact-based concall summary in the style and presentation of Screener.in's Concall Summary**, with additional depth suitable for serious equity investors.

**Company:** {company}  
**Quarter/Period:** {quarter}  
**Industry:** {industry}  
**Transcript:** Use the provided earnings call transcript.

## 1. Core Instructions
1. Read the complete transcript before preparing the summary.
2. Organize the discussion topic-wise, not merely in the order of speakers.
3. Capture every material business development, financial update, management comment, analyst question, and management response.
4. Preserve important numbers, percentages, dates, timelines, targets, and management guidance.
5. Explain what management said in clear, professional, investor-friendly language.
6. Distinguish between:
   - Actual reported performance
   - Management guidance or targets
   - Management expectations and opinions
   - Analyst questions and concerns
   - Your own analytical interpretations
7. Never invent numbers, estimates, targets, explanations, or commitments. If not disclosed, state "Not disclosed in the concall."
8. If information is unclear or contradictory, explicitly mention the ambiguity.
9. Attribute important statements to the relevant management speaker wherever identified.
10. Avoid generic summaries. Include company-specific details, operational explanations, financial implications, and relevant context.
11. Do not omit important negative developments, risks, delays, cost pressures, or analyst concerns.
12. Do not treat management guidance as guaranteed future performance.

## 2. Executive Summary
- Overall business performance during the quarter
- Revenue growth and major growth drivers
- Profitability and margin movement
- Performance of individual business segments
- Demand environment and order-book position
- Capacity expansion and capital expenditure plans
- New products, technologies, customers, and markets
- Management's outlook for upcoming quarters and financial years
- Key concerns, risks, and uncertainties
- Conclude with the 5–10 most material investor takeaways

## 3. Financial Performance
- Disclose and explain all reported financial metrics (Revenue, EBITDA & margins, EBIT, PAT & margins, Gross margins, Other income, Finance costs, Working capital, Debt/Cash, Return ratios).
- Explain drivers of margin expansion or contraction (raw materials, mix, pricing, operating leverage, utilization, employee costs, FX).

## 4. Business Segment Analysis
- For every business segment, product category, or geography: products/services, revenue contribution/growth, profitability/margins, demand conditions, new products, competitive positioning, and guidance.

## 5. Management Guidance and Future Outlook (Structured Table)
Provide a structured table of forward-looking statements:
| Guidance Item | Target/Expectation | Applicable Period | Conditions/Assumptions | Classification |
Classify each statement as: Explicit numerical guidance, Qualitative outlook, or Aspirational long-term target.

## 6. Growth Drivers and Business Opportunities
- New products, customers, market share gains, geographic expansion, technology adoption, premiumization, capex.

## 7. Capital Expenditure and Capacity Expansion
- Announced capex, incurred capex, planned capex, new lines/plants, commissioning dates, funding sources.

## 8. Order Book and Customer Developments
- Order book value, new order inflows, major customer wins, delivery constraints, repeat orders.

## 9. Industry Trends and Competitive Positioning
- Total addressable market, demand cycles, competitor activity, market share changes, regulatory shifts.

## 10. Analyst Q&A — Detailed Topic-Wise Summary
Organize by topic:
- **Topic:** [e.g. Margin Outlook / US BFSI Demand / AI Initiatives]
- **Analyst's concern:** [Explain what the analyst wanted to understand]
- **Management's response:** [Accurately summarize answer, numbers, timelines, qualifications]
- **What it means:** [Key business implication, clearly labeled as analyst interpretation]

## 11. Risks, Concerns, and Negative Signals
- Demand risks, margin pressure, execution delays, debt/working capital, competitive pressures.

## 12. Changes in Management Commentary
- Changes in tone or expectations regarding revenue, margins, demand, capex, and guidance.

## 13. Financial and Operational KPI Table
| KPI | Current Period | Comparison Period | Change | Management Explanation | Source/Status |

## 14. Management Guidance Tracker
| Guidance Item | Target/Expectation | Applicable Period | Conditions/Assumptions | Classification |

## 15. Investor Interpretation
- **Positive indicators** (sustainable growth, margin strength, order visibility)
- **Negative indicators** (growth slowdown, margin headwinds, execution risks)
- **Key variables to monitor** (5–10 metrics for next quarter)

Format output in clean, professional GitHub Flavored Markdown with clear headings and Markdown tables.
"""

_DETAILED_SUMMARY_CACHE = {}
_DETAILED_SUMMARY_LOCK = Lock()


def generate_document_analysis(url, company="Company", quarter="Quarter", year="", symbol="", industry="", doc_type="concall"):
    url = str(url or "").strip()
    if not url.startswith("http"):
        raise RuntimeError("A valid document URL is required.")

    clean_type = str(doc_type or "concall").lower()
    if clean_type in ("ppt", "presentation", "deck", "investor presentation"):
        prompt_type = "ppt"
    elif clean_type in ("annual_report", "annual_reports", "ar", "brsr", "integrated_report"):
        prompt_type = "annual_reports"
    else:
        prompt_type = "concalls"

    cache_key = sha256(f"{prompt_type}|{url}|{company}|{quarter}|{year}".encode("utf-8")).hexdigest()
    now = time.time()
    with _DETAILED_SUMMARY_LOCK:
        cached = _DETAILED_SUMMARY_CACHE.get(cache_key)
        if cached and now - cached[0] < 86400:
            return cached[1]

    # Download document PDF
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/pdf,application/octet-stream,*/*",
    }
    try:
        r = requests.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        pdf_bytes = r.content
    except Exception as exc:
        raise RuntimeError(f"Could not download the official document: {exc}")

    if not pdf_bytes:
        raise RuntimeError("The document is empty.")

    b64_pdf = base64.b64encode(pdf_bytes).decode("ascii")

    # Format the prompt using our dynamic ai_prompt_manager
    prompt = format_prompt(prompt_type, {
        "company": company or symbol or "the Company",
        "symbol": symbol,
        "quarter": quarter or "Latest Quarter",
        "year": year or quarter or "Fiscal Year",
        "industry": industry or "Indian Equities",
        "source_url": url,
    })

    api_key = get_app_setting("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in the application environment.")

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "application/pdf", "data": b64_pdf}}
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 6000
        }
    }

    last_err = None
    for model_name in GEMINI_MODELS:
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=180)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates") or []
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    txt = "".join(p.get("text", "") for p in parts).strip()
                    if txt:
                        with _DETAILED_SUMMARY_LOCK:
                            _DETAILED_SUMMARY_CACHE[cache_key] = (now, txt)
                        return txt
            else:
                last_err = f"Gemini error ({resp.status_code}): {resp.text[:180]}"
        except Exception as e:
            last_err = str(e)

    raise RuntimeError(last_err or "Failed to generate document analysis with Gemini.")


def generate_senior_concall_analysis(url, company="Company", quarter="Quarter", symbol="", industry=""):
    return generate_document_analysis(url=url, company=company, quarter=quarter, symbol=symbol, industry=industry, doc_type="concall")


@fundamentals_concalls_bp.post("/summarize")
@fundamentals_concalls_bp.post("/documents/summarize")
@fundamentals_concalls_bp.post("/annual-reports/summarize")
@fundamentals_concalls_bp.post("/presentations/summarize")
def summarize_concall_transcript():
    data = request.get_json(silent=True) or {}
    url = data.get("url") or data.get("transcript") or data.get("presentation") or ""
    if not url:
        return jsonify({"error": "A document URL is required for AI summary."}), 400

    company = data.get("company") or data.get("companyName") or ""
    quarter = data.get("quarter") or ""
    year = data.get("year") or ""
    symbol = data.get("symbol") or ""
    industry = data.get("industry") or ""
    doc_type = data.get("doc_type") or data.get("type") or ("ppt" if "/presentations" in request.path else ("annual_reports" if "/annual-reports" in request.path else "concall"))

    try:
        report = generate_document_analysis(
            url=url,
            company=company,
            quarter=quarter,
            year=year,
            symbol=symbol,
            industry=industry,
            doc_type=doc_type,
        )
        return jsonify({
            "success": True,
            "analysis": report,
            "company": company,
            "quarter": quarter,
            "year": year,
            "symbol": symbol,
            "doc_type": doc_type,
            "url": url,
        })
    except Exception as exc:
        message = str(exc)
        status = 503 if "GEMINI_API_KEY" in message else (429 if "rate limit" in message else 502)
        return jsonify({"error": message}), status

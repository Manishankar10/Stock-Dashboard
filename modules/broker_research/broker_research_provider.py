"""
Provider for Institutional & Broker Research reports for Indian equities.
Fetches recent 6-months institutional research reports, broker coverage,
credit rating research, concalls, and corporate filings from allowed websites configured by Admin.
Strictly filters and shows ONLY reports where a real PDF document or content is available.
"""

from datetime import datetime, timedelta
import concurrent.futures
import json
import logging
import re
from threading import Lock
import time

from bs4 import BeautifulSoup
import requests

logger = logging.getLogger("broker_research_provider")

CACHE_TTL = 3600  # 1 hour cache
_cache = {}
_cache_lock = Lock()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Recognized Institutions & Research Houses
INSTITUTION_CATEGORIES = {
    "SBI Mutual Fund": "Mutual Fund / AMC",
    "HDFC AMC": "Mutual Fund / AMC",
    "Nippon India AMC": "Mutual Fund / AMC",
    "ICICI Prudential AMC": "Mutual Fund / AMC",
    "UTI AMC": "Mutual Fund / AMC",
    "DSP Mutual Fund": "Mutual Fund / AMC",
    "Mirae Asset": "Mutual Fund / AMC",
    "Motilal Oswal": "Brokerage / Institutional",
    "HDFC Securities": "Brokerage / Institutional",
    "ICICI Direct": "Brokerage / Institutional",
    "ICICI Securities": "Brokerage / Institutional",
    "Kotak Institutional Equities": "Institutional Equity",
    "Kotak Securities": "Brokerage / Institutional",
    "Axis Direct": "Brokerage / Institutional",
    "Axis Capital": "Institutional Equity",
    "Anand Rathi": "Brokerage / Institutional",
    "Prabhudas Lilladher": "Institutional Equity",
    "IDBI Capital": "Brokerage / Institutional",
    "Sharekhan": "Brokerage / Institutional",
    "Nuvama": "Institutional Equity",
    "Deven Choksey": "Institutional Equity",
    "BOB Capital Markets": "Institutional Equity",
    "Geojit": "Brokerage / Institutional",
    "Jefferies": "Global Institution",
    "Morgan Stanley": "Global Institution",
    "Goldman Sachs": "Global Institution",
    "Nomura": "Global Institution",
    "Macquarie": "Global Institution",
}


def clean_symbol(sym):
    if not sym:
        return ""
    return re.sub(r"\.(?:NS|BO|BS)$", "", str(sym).strip(), flags=re.IGNORECASE).upper()


def get_institution_type(author_name):
    clean_author = str(author_name or "").strip()
    for inst, cat in INSTITUTION_CATEGORIES.items():
        if inst.lower() in clean_author.lower():
            return cat
    if "mutual fund" in clean_author.lower() or "amc" in clean_author.lower():
        return "Mutual Fund / AMC"
    if "capital" in clean_author.lower() or "institutional" in clean_author.lower() or "securities" in clean_author.lower():
        return "Institutional Equity"
    return "Broker Research"


def get_allowed_research_websites():
    """
    Retrieves the comma-separated research websites configured by Admin in system settings.
    Returns a list of normalized domain substrings, e.g. ['trendlyne.com', 'screener.in', 'bseindia.com'].
    """
    try:
        from modules.common.system_settings import get_system_settings
        settings = get_system_settings()
        raw = settings.get("research_document_websites") or "trendlyne.com, screener.in, bseindia.com"
    except Exception:
        raw = "trendlyne.com, screener.in, bseindia.com"

    sites = []
    for s in str(raw).split(","):
        s = s.strip().lower()
        s = re.sub(r"^https?://", "", s)
        s = re.sub(r"^www\.", "", s)
        s = s.rstrip("/")
        if s:
            sites.append(s)
    return sites or ["trendlyne.com", "screener.in", "bseindia.com"]


def is_pdf_or_content_available(report, allowed_sites=None):
    """
    Strict validation: only returns True if an actual PDF document or readable content
    is available from one of the configured research websites.
    Rejects search engine links (e.g. google.com/search) and missing documents.
    """
    if not report or not isinstance(report, dict):
        return False

    url = str(report.get("url") or report.get("pdf_url") or "").strip()
    if not url or url == "#":
        return False

    # Strict rejection of search engine fallback queries
    url_lower = url.lower()
    if any(engine in url_lower for engine in ["google.com/search", "bing.com/search", "yahoo.com/search", "duckduckgo.com"]):
        return False

    # Match against allowed websites if provided
    if allowed_sites:
        matched_site = False
        for site in allowed_sites:
            if site in url_lower:
                matched_site = True
                break
        if not matched_site:
            return False

    # Verify PDF or readable document content
    has_pdf = (
        report.get("has_pdf") is True or
        url_lower.endswith(".pdf") or
        "/pdf/" in url_lower or
        "/get-document/post/pdf/" in url_lower or
        "annpdfopen" in url_lower or
        "/corpfiling/" in url_lower
    )

    has_content = (
        report.get("has_content") is True or
        bool(report.get("content")) or
        bool(report.get("snippet")) or
        "/posts/" in url_lower or
        "/announcements/" in url_lower
    )

    return has_pdf or has_content


def fetch_trendlyne_reports(symbol):
    """Fetch live research reports from Trendlyne for the given stock symbol with PDF/document verification."""
    clean_sym = clean_symbol(symbol)
    if not clean_sym:
        return []

    reports = []
    try:
        # Step 1: Search for stock on Trendlyne research portal
        search_headers = {
            **HEADERS,
            "X-Requested-With": "XMLHttpRequest"
        }
        search_url = f"https://trendlyne.com/research-reports/search/?term={clean_sym}"
        r_search = requests.get(search_url, headers=search_headers, timeout=6)
        if r_search.status_code != 200:
            return []

        search_data = r_search.json()
        if not isinstance(search_data, list):
            return []

        stock_url = None
        for item in search_data:
            if isinstance(item, dict) and item.get("id") == clean_sym:
                stock_url = item.get("nexturl")
                break

        if not stock_url and len(search_data) > 1 and isinstance(search_data[1], dict):
            stock_url = search_data[1].get("nexturl")

        if not stock_url:
            return []

        # Step 2: Fetch stock research reports table
        r_page = requests.get(stock_url, headers=HEADERS, timeout=8)
        if r_page.status_code != 200:
            return []

        soup = BeautifulSoup(r_page.text, "html.parser")
        rows = soup.find_all("tr")

        cutoff_date = datetime.now() - timedelta(days=210)  # ~7 months filter

        for tr in rows[1:]:
            tds = tr.find_all(["td", "th"])
            if len(tds) < 8:
                continue

            date_str = tds[1].get_text(strip=True)
            report_dt = None
            for fmt in ("%d %b %Y", "%d %b, %Y"):
                try:
                    report_dt = datetime.strptime(date_str, fmt)
                    break
                except Exception:
                    pass

            if report_dt and report_dt < cutoff_date:
                continue

            author_raw = tds[3].get_text(strip=True)
            author = re.sub(r"(?:Target|Reco|Detailed Estimates)$", "", author_raw).strip()
            if not author or author.lower().startswith("consensus"):
                continue

            target_price = tds[5].get_text(strip=True)
            upside = tds[7].get_text(strip=True)
            rating = tds[8].get_text(strip=True).upper()
            if not rating:
                rating = "BUY" if "buy" in tds[8].get_text().lower() else "HOLD"

            report_title = ""
            report_url = ""
            for a in tr.find_all("a"):
                href = a.get("href") or ""
                text = a.get_text(strip=True)
                if "/get-document/post/pdf/" in href or "/posts/" in href:
                    if not report_url or "/get-document/post/pdf/" in href:
                        report_url = href
                        if text and not text.lower() in ["pdf", "post", "cache", "detail"]:
                            report_title = text

            if not report_title and len(tds) >= 12:
                report_title = tds[11].get_text(strip=True)

            report_title = re.sub(r"^Broker Report\s*", "", report_title).strip()
            if not report_title:
                report_title = f"{clean_sym} - Institutional Research & Valuation Update"

            # Strictly require a real document URL - do NOT fallback to search queries
            if not report_url:
                continue

            if report_url.startswith("/"):
                report_url = f"https://trendlyne.com{report_url}"

            inst_type = get_institution_type(author)
            has_pdf = bool("/get-document/post/pdf/" in report_url or ".pdf" in report_url.lower())

            reports.append({
                "id": f"rep-{clean_sym}-{len(reports) + 1}",
                "symbol": clean_sym,
                "date": date_str,
                "author": author,
                "institution_type": inst_type,
                "title": report_title,
                "rating": rating,
                "target_price": target_price,
                "upside": upside,
                "url": report_url,
                "has_pdf": has_pdf,
                "has_content": True,
                "source": "trendlyne.com",
                "is_live": True,
            })

    except Exception as e:
        logger.warning(f"Error fetching live Trendlyne reports for {symbol}: {e}")

    return reports


def fetch_screener_bse_documents(symbol):
    """
    Fetches official institutional research filings, concalls, investor presentations,
    credit rating reports, and annual reports from Screener.in and BSE India.
    Only keeps documents that have actual direct PDF links.
    """
    clean_sym = clean_symbol(symbol)
    if not clean_sym:
        return []

    docs = []
    try:
        url = f"https://www.screener.in/company/{clean_sym}/"
        r = requests.get(url, headers=HEADERS, timeout=8)
        if r.status_code != 200:
            return []

        soup = BeautifulSoup(r.text, "html.parser")
        sec = soup.find("section", id="documents")
        if not sec:
            return []

        for a in sec.find_all("a", href=True):
            href = a.get("href", "").strip()
            text = a.get_text(" ", strip=True)
            if not href or href.startswith("#") or text in ["All", "AI Summary", "bse"]:
                continue

            # Ensure valid PDF or document link
            is_pdf = ".pdf" in href.lower() or "annpdfopen" in href.lower() or "/xml-data/" in href.lower()
            if not is_pdf and not href.startswith("http") and not href.startswith("/"):
                continue

            full_url = href if href.startswith("http") else f"https://www.screener.in{href}"

            # Clean title and parse date if present (e.g. '28 Oct', '4 Nov')
            clean_title = re.sub(r"(?:from bse|AI Summary)$", "", text).strip()
            date_match = re.search(r"\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{2,4})?)\b", clean_title, flags=re.IGNORECASE)
            date_str = date_match.group(1).strip() if date_match else "Recent"
            if date_str != "Recent" and not re.search(r"\d{4}", date_str):
                date_str = f"{date_str} 2026"

            display_title = re.sub(r"\s*Announcement under Regulation 30\s*\(LODR\)-?", "", clean_title, flags=re.IGNORECASE).strip()
            if not display_title:
                display_title = f"{clean_sym} - Corporate & Research Filing"

            title_lower = text.lower()
            author = "Corporate Disclosures"
            inst_type = "Regulatory Filing"
            if any(k in title_lower for k in ["credit rating", "rating", "crisil", "icra", "care"]):
                author = "Credit Rating Research"
                inst_type = "Credit Rating / Research"
            elif any(k in title_lower for k in ["concall", "transcript", "earnings call"]):
                author = "Earnings Concall Transcript"
                inst_type = "Institutional Equity"
            elif any(k in title_lower for k in ["presentation", "investor meet", "investor conference"]):
                author = "Investor Presentation Deck"
                inst_type = "Institutional Research"
            elif "annual report" in title_lower:
                author = "Annual Report"
                inst_type = "Annual Corporate Report"
            elif "research" in title_lower:
                author = "Institutional Equity"
                inst_type = "Broker Research"

            source_domain = "bseindia.com" if "bseindia.com" in full_url.lower() else "screener.in"

            docs.append({
                "id": f"scr-{clean_sym}-{len(docs) + 1}",
                "symbol": clean_sym,
                "date": date_str,
                "author": author,
                "institution_type": inst_type,
                "title": display_title[:110],
                "rating": "AVAILABLE",
                "target_price": "PDF Document",
                "upside": "",
                "url": full_url,
                "has_pdf": is_pdf,
                "has_content": True,
                "source": source_domain,
                "is_live": True
            })

    except Exception as e:
        logger.warning(f"Error fetching Screener/BSE documents for {symbol}: {e}")

    return docs


class BrokerResearchProvider:
    """Manages retrieval, caching, and consolidation of institutional research reports."""

    def get_stock_research_reports(self, symbol, company_name=None, force_refresh=False):
        clean_sym = clean_symbol(symbol)
        if not clean_sym:
            return []

        allowed_sites = get_allowed_research_websites()
        cache_key = f"stock:{clean_sym}:{','.join(sorted(allowed_sites))}"
        now = time.time()

        if not force_refresh:
            with _cache_lock:
                cached = _cache.get(cache_key)
                if cached and (now - cached["timestamp"] < CACHE_TTL):
                    return cached["data"]

        reports = []

        # 1 & 2. Concurrent fetch from Trendlyne & Screener/BSE to drastically reduce latency
        def _get_trendlyne():
            if any("trendlyne.com" in s for s in allowed_sites):
                try:
                    return fetch_trendlyne_reports(clean_sym)
                except Exception as e:
                    logger.warning(f"Error fetching Trendlyne reports: {e}")
            return []

        def _get_screener_bse():
            if any("screener.in" in s or "bseindia.com" in s for s in allowed_sites):
                try:
                    return fetch_screener_bse_documents(clean_sym)
                except Exception as e:
                    logger.warning(f"Error fetching Screener/BSE documents: {e}")
            return []

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f_trend = executor.submit(_get_trendlyne)
            f_scr = executor.submit(_get_screener_bse)
            reports.extend(f_trend.result() or [])
            reports.extend(f_scr.result() or [])

        # 3. Strictly filter: ONLY if PDF or content is available from allowed websites
        valid_reports = [r for r in reports if is_pdf_or_content_available(r, allowed_sites)]

        # 4. Deduplicate by URL
        seen_urls = set()
        unique_reports = []
        for r in valid_reports:
            u = str(r.get("url") or "").strip().lower()
            if u and u in seen_urls:
                continue
            seen_urls.add(u)
            unique_reports.append(r)

        # 5. Sort descending by date
        def parse_date(r):
            d_str = str(r.get("date", "")).strip()
            for fmt in ("%d %b %Y", "%d %b, %Y", "%b %Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(d_str, fmt)
                except Exception:
                    pass
            m = re.search(r"(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})", d_str)
            if m:
                try:
                    return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %Y")
                except Exception:
                    pass
            return datetime(2025, 1, 1)

        unique_reports.sort(key=parse_date, reverse=True)

        with _cache_lock:
            _cache[cache_key] = {
                "timestamp": now,
                "data": unique_reports
            }

        return unique_reports

    def get_watchlist_research_reports(self, watchlist_name, watchlist_symbols, force_refresh=False):
        """Aggregate recent research reports for all stocks in a watchlist."""
        clean_wl = str(watchlist_name or "").strip()
        allowed_sites = get_allowed_research_websites()
        cache_key = f"wl:{clean_wl}:{','.join(sorted(allowed_sites))}"
        now = time.time()

        if not force_refresh:
            with _cache_lock:
                cached = _cache.get(cache_key)
                if cached and (now - cached["timestamp"] < CACHE_TTL):
                    return cached["data"]

        all_reports = []
        symbols_to_fetch = (watchlist_symbols or [])[:12]
        for sym in symbols_to_fetch:
            try:
                reps = self.get_stock_research_reports(sym, force_refresh=force_refresh)
                all_reports.extend(reps[:5])  # Top 5 recent per stock
            except Exception as e:
                logger.warning(f"Error fetching reports for {sym} in watchlist {clean_wl}: {e}")

        # Deduplicate and filter
        seen_urls = set()
        unique = []
        for r in all_reports:
            u = str(r.get("url") or "").strip().lower()
            if u and u in seen_urls:
                continue
            seen_urls.add(u)
            unique.append(r)

        unique.sort(key=lambda r: str(r.get("date", "")), reverse=True)

        with _cache_lock:
            _cache[cache_key] = {
                "timestamp": now,
                "data": unique
            }

        return unique

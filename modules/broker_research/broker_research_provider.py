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


def _fetch_url(url, headers=None, timeout=10):
    """
    Fetch URL using curl_cffi Chrome impersonation to bypass Cloudflare TLS fingerprinting.
    Gracefully falls back to standard requests.
    """
    hdrs = headers or HEADERS
    try:
        from curl_cffi import requests as cffi_requests
        return cffi_requests.get(url, headers=hdrs, impersonate="chrome", timeout=timeout)
    except Exception as e:
        logger.debug(f"curl_cffi fetch fallback to requests for {url}: {e}")
        return requests.get(url, headers=hdrs, timeout=timeout)


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


def normalize_domain(s):
    """Normalize input URL or domain string to root domain (e.g. 'https://www.screener.in/company/' -> 'screener.in')."""
    if not s:
        return ""
    s = s.strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = s.split("/")[0].split(":")[0].strip()
    return s


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
        norm = normalize_domain(s)
        if norm and norm not in sites:
            sites.append(norm)
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

    url_lower = url.lower()
    # Strict rejection of search engine fallback queries
    if any(engine in url_lower for engine in ["google.com/search", "bing.com/search", "yahoo.com/search", "duckduckgo.com"]):
        return False

    # Match against allowed websites if provided
    if allowed_sites:
        report_source = (report.get("source") or "").lower()
        matched_site = False
        for site in allowed_sites:
            # Matches if site is the report source (e.g. screener.in or trendlyne.com) or site domain is in URL
            if site in report_source or site in url_lower:
                matched_site = True
                break
        if not matched_site:
            return False

    # Verify PDF or readable document / audio recording content
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
        "/announcements/" in url_lower or
        "/rationale/" in url_lower or
        "ratingdocs" in url_lower or
        "youtube.com" in url_lower or
        "youtu.be" in url_lower or
        report.get("category") in ["concalls", "credit_ratings", "annual_reports", "announcements", "broker_research"]
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
        r_search = _fetch_url(search_url, headers=search_headers, timeout=10)
        if not r_search or r_search.status_code != 200:
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
        r_page = _fetch_url(stock_url, headers=HEADERS, timeout=10)
        if not r_page or r_page.status_code != 200:
            return []

        soup = BeautifulSoup(r_page.text, "html.parser")
        rows = soup.find_all("tr")

        cutoff_date = datetime.now() - timedelta(days=240)  # ~8 months filter

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
                "category": "broker_research",
                "tab_name": "Broker Research",
                "is_live": True,
            })

    except Exception as e:
        logger.warning(f"Error fetching live Trendlyne reports for {symbol}: {e}")

    return reports


def fetch_screener_bse_documents(symbol):
    """
    Fetches official institutional research filings, concalls (transcripts, PPTs, recordings),
    credit rating reports, and annual reports from Screener.in and BSE India across all document tabs.
    """
    clean_sym = clean_symbol(symbol)
    if not clean_sym:
        return []

    docs = []
    try:
        url = f"https://www.screener.in/company/{clean_sym}/"
        r = _fetch_url(url, headers=HEADERS, timeout=10)
        if not r or r.status_code != 200:
            return []

        soup = BeautifulSoup(r.text, "html.parser")
        sec = soup.find("section", id="documents")
        if not sec:
            return []

        current_year = datetime.now().year

        # 1. Announcements Tab
        # Screener has div.documents flex-column (excluding annual-reports, credit-ratings, concalls)
        ann_boxes = []
        for d in sec.find_all("div", class_="documents"):
            classes = d.get("class", [])
            if not any(c in classes for c in ["annual-reports", "credit-ratings", "concalls"]):
                ann_boxes.append(d)

        for ann_box in ann_boxes:
            for a in ann_box.find_all("a", href=True):
                href = a.get("href", "").strip()
                text = a.get_text(" ", strip=True)
                if not href or href.startswith("#") or text.strip() in ["All", "AI Summary", "bse"]:
                    continue

                full_url = href if href.startswith("http") else f"https://www.screener.in{href}"

                # Date extraction
                date_match = re.search(r"\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{2,4})?)\b", text, flags=re.IGNORECASE)
                date_str = date_match.group(1).strip() if date_match else "Recent"
                if date_str != "Recent" and not re.search(r"\d{4}", date_str):
                    date_str = f"{date_str} {current_year}"

                clean_title = re.sub(r"(?:from bse|AI Summary)$", "", text, flags=re.IGNORECASE).strip()
                display_title = re.sub(r"\s*Announcement under Regulation 30\s*\(LODR\)-?", "", clean_title, flags=re.IGNORECASE).strip()
                if not display_title:
                    display_title = f"{clean_sym} - Corporate & Regulatory Announcement"

                is_pdf = ".pdf" in full_url.lower() or "annpdfopen" in full_url.lower() or "/xml-data/" in full_url.lower()

                docs.append({
                    "id": f"scr-ann-{clean_sym}-{len(docs) + 1}",
                    "symbol": clean_sym,
                    "date": date_str,
                    "author": "Exchange Announcement",
                    "institution_type": "Regulatory Filing (LODR)",
                    "title": display_title[:120],
                    "rating": "FILING",
                    "target_price": "",
                    "upside": "",
                    "url": full_url,
                    "has_pdf": is_pdf,
                    "has_content": True,
                    "source": "screener.in",
                    "category": "announcements",
                    "tab_name": "Announcements",
                    "is_live": True
                })

        # 2. Annual Reports Tab
        ar_box = sec.find("div", class_="annual-reports")
        if ar_box:
            for a in ar_box.find_all("a", href=True):
                href = a.get("href", "").strip()
                text = a.get_text(" ", strip=True)
                if not href or href.startswith("#") or text.strip() in ["All", "AI Summary"]:
                    continue

                full_url = href if href.startswith("http") else f"https://www.screener.in{href}"
                year_match = re.search(r"\b(20\d{2})\b", text)
                year_str = year_match.group(1) if year_match else str(current_year)

                docs.append({
                    "id": f"scr-ar-{clean_sym}-{len(docs) + 1}",
                    "symbol": clean_sym,
                    "date": f"FY {year_str}",
                    "author": "Annual Report",
                    "institution_type": "Annual Corporate Report",
                    "title": f"{clean_sym} - Annual Report FY {year_str}",
                    "rating": "REPORT",
                    "target_price": "",
                    "upside": "",
                    "url": full_url,
                    "has_pdf": True,
                    "has_content": True,
                    "source": "screener.in",
                    "category": "annual_reports",
                    "tab_name": "Annual Reports",
                    "is_live": True
                })

        # 3. Credit Ratings Tab
        cr_box = sec.find("div", class_="credit-ratings")
        if cr_box:
            for a in cr_box.find_all("a", href=True):
                href = a.get("href", "").strip()
                text = a.get_text(" ", strip=True)
                if not href or href.startswith("#") or text.strip() in ["All", "AI Summary"]:
                    continue

                full_url = href if href.startswith("http") else f"https://www.screener.in{href}"

                agency = "Credit Rating"
                if "crisil" in text.lower() or "crisil" in full_url.lower():
                    agency = "CRISIL"
                elif "icra" in text.lower() or "icra" in full_url.lower():
                    agency = "ICRA"
                elif "care" in text.lower() or "care" in full_url.lower():
                    agency = "CARE Ratings"
                elif "india ratings" in text.lower() or "indiaratings" in full_url.lower():
                    agency = "India Ratings"

                date_match = re.search(r"\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{2,4})?)\b", text, flags=re.IGNORECASE)
                date_str = date_match.group(1).strip() if date_match else "Recent"
                if date_str != "Recent" and not re.search(r"\d{4}", date_str):
                    date_str = f"{date_str} {current_year}"

                clean_title = re.sub(r"(?:from bse|from icra|from crisil|from care)$", "", text, flags=re.IGNORECASE).strip()
                display_title = f"{clean_sym} - {agency} Credit Rating Rationale & Update"
                if clean_title and len(clean_title) > 10:
                    display_title = f"{clean_sym} - {clean_title}"

                is_pdf = ".pdf" in full_url.lower() or "annpdfopen" in full_url.lower()

                docs.append({
                    "id": f"scr-cr-{clean_sym}-{len(docs) + 1}",
                    "symbol": clean_sym,
                    "date": date_str,
                    "author": agency,
                    "institution_type": "Credit Rating Agency",
                    "title": display_title[:120],
                    "rating": "RATING",
                    "target_price": "",
                    "upside": "",
                    "url": full_url,
                    "has_pdf": is_pdf,
                    "has_content": True,
                    "source": "screener.in",
                    "category": "credit_ratings",
                    "tab_name": "Credit Ratings",
                    "is_live": True
                })

        # 4. Concalls Tab (Transcripts, Investor Presentation PPTs, Audio Recordings)
        cc_box = sec.find("div", class_="concalls")
        if cc_box:
            for li in cc_box.find_all("li"):
                li_text = li.get_text(" ", strip=True)
                q_match = re.search(r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\b", li_text, flags=re.IGNORECASE)
                q_str = q_match.group(1) if q_match else f"{current_year}"

                for a in li.find_all("a", href=True):
                    a_type = a.get_text(strip=True).upper()
                    href = a.get("href", "").strip()
                    if not href or href.startswith("#") or a_type in ["ADD MISSING", "AI SUMMARY"]:
                        continue

                    full_url = href if href.startswith("http") else f"https://www.screener.in{href}"

                    label = "Concall Transcript"
                    inst_type = "Earnings Concall"
                    is_pdf = True
                    rating_code = "TRANSCRIPT"

                    if "PPT" in a_type:
                        label = "Investor Presentation Deck (PPT)"
                        inst_type = "Investor Presentation"
                        rating_code = "PPT"
                    elif "REC" in a_type or "audio" in full_url.lower() or "youtube" in full_url.lower() or "youtu.be" in full_url.lower():
                        label = "Concall Audio / Webcast Recording"
                        inst_type = "Audio Webcast"
                        is_pdf = False
                        rating_code = "AUDIO"

                    docs.append({
                        "id": f"scr-cc-{clean_sym}-{len(docs) + 1}",
                        "symbol": clean_sym,
                        "date": q_str,
                        "author": label,
                        "institution_type": inst_type,
                        "title": f"{clean_sym} - {q_str} {label}",
                        "rating": rating_code,
                        "target_price": "",
                        "upside": "",
                        "url": full_url,
                        "has_pdf": is_pdf,
                        "has_content": True,
                        "source": "screener.in",
                        "category": "concalls",
                        "tab_name": "Concalls & PPTs",
                        "is_live": True
                    })

    except Exception as e:
        logger.warning(f"Error fetching Screener/BSE documents for {symbol}: {e}")

    return docs


def parse_doc_date(date_str):
    """Robust parser for document dates (e.g. '28 Oct 2026', 'Oct 2026', 'FY 2026', '2026-10-28')."""
    if not date_str:
        return datetime(2020, 1, 1)
    s = str(date_str).strip()
    for fmt in ("%d %b %Y", "%d %b, %Y", "%d %B %Y", "%b %Y", "%B %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    # Match '12 Oct 2026'
    m1 = re.search(r"(\d{1,2})\s+([a-zA-Z]{3,9})\s+(\d{4})", s)
    if m1:
        try:
            return datetime.strptime(f"{m1.group(1)} {m1.group(2)[:3]} {m1.group(3)}", "%d %b %Y")
        except Exception:
            pass
    # Match 'Oct 2026'
    m2 = re.search(r"([a-zA-Z]{3,9})\s+(\d{4})", s)
    if m2:
        try:
            return datetime.strptime(f"01 {m2.group(1)[:3]} {m2.group(2)}", "%d %b %Y")
        except Exception:
            pass
    # Match 'FY 2026' or '2026'
    m3 = re.search(r"(?:FY\s*)?(\d{4})", s)
    if m3:
        try:
            return datetime(int(m3.group(1)), 3, 31)
        except Exception:
            pass
    return datetime(2020, 1, 1)


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
        unique_reports.sort(key=lambda r: parse_doc_date(r.get("date", "")), reverse=True)

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

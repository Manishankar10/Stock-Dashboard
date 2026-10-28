"""Capital Desk - Peoples (Superstar / Ace Investors, FII & DII) Data Provider.

Collects public shareholding data on-time directly from exchange disclosures
without saving to or requiring a database, using an in-memory TTL cache
for snappy, zero-latency user interactions.
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Standard browser headers to ensure smooth live requests
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# In-memory TTL caches (1 hour expiration)
_INVESTORS_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_PORTFOLIO_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour

_CATEGORY_URLS = {
    "ace": "https://trendlyne.com/portfolio/superstar-shareholders/index/individual/",
    "fii": "https://trendlyne.com/portfolio/superstar-shareholders/index/fii/",
    "dii": "https://trendlyne.com/portfolio/superstar-shareholders/index/institutional/",
}

_MONTHS_ORDER = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
}


def _parse_investor_index_table(html: str, category: str) -> List[Dict[str, Any]]:
    """Parse the directory table of superstar investors from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    tbl = soup.find("table")
    if not tbl:
        return []

    rows = tbl.find_all("tr")
    if not rows:
        return []

    investors: List[Dict[str, Any]] = []
    for r in rows[1:]:
        cols = [td.text.strip().replace("\n", " ") for td in r.find_all(["td", "th"])]
        if not cols or len(cols) < 3:
            continue

        a_tag = r.find("a")
        if not a_tag or not a_tag.get("href"):
            continue

        href = a_tag.get("href", "")
        # Expected pattern: /portfolio/superstar-shareholders/{ID}/latest/{SLUG}/
        m = re.search(r"/portfolio/superstar-shareholders/(\d+)/(?:latest/)?([^/]+)", href)
        if not m:
            continue

        inv_id = m.group(1)
        slug = m.group(2)
        name = a_tag.text.strip() or cols[0]

        # Clean portfolio value and change %
        raw_val = cols[1] if len(cols) > 1 else ""
        val_clean = re.sub(r"\s+", " ", raw_val).strip()
        change_pct = ""
        m_change = re.search(r"([+-]?\d+(?:\.\d+)?%)", val_clean)
        if m_change:
            change_pct = m_change.group(1)
            val_clean = val_clean.replace(change_pct, "").strip()

        stocks_count = ""
        if len(cols) > 2:
            m_cnt = re.search(r"\d+", cols[2])
            stocks_count = m_cnt.group(0) if m_cnt else cols[2]

        sector_pref = cols[3] if len(cols) > 3 else ""
        top_holdings = cols[5] if len(cols) > 5 else ""

        # Normalize whitespace in sector and top holdings
        sector_pref = re.sub(r"\s+", " ", sector_pref).strip()
        top_holdings = re.sub(r"\s+", " ", top_holdings).strip()

        numeric_val = 0.0
        m_num = re.search(r"([\d,]+(?:\.\d+)?)", val_clean)
        if m_num:
            try:
                numeric_val = float(m_num.group(1).replace(",", ""))
            except Exception:
                numeric_val = 0.0

        investors.append({
            "id": inv_id,
            "slug": slug,
            "name": name,
            "category": category,
            "portfolio_value": val_clean,
            "numeric_value": numeric_val,
            "change_pct": change_pct,
            "stocks_count": int(stocks_count) if stocks_count.isdigit() else 0,
            "sector_preference": sector_pref,
            "top_holdings": top_holdings,
            "url": href,
        })

    # Sort investors by portfolio value descending
    investors.sort(key=lambda x: x["numeric_value"], reverse=True)
    return investors


def fetch_investors_by_category(category: str) -> List[Dict[str, Any]]:
    """Fetch investor directory for a specific category (ace, fii, dii) on-time."""
    cat_key = category.lower()
    if cat_key not in _CATEGORY_URLS:
        cat_key = "ace"

    now = time.time()
    if cat_key in _INVESTORS_CACHE:
        cache_time, cached_data = _INVESTORS_CACHE[cat_key]
        if now - cache_time < _CACHE_TTL_SECONDS:
            return cached_data

    target_url = _CATEGORY_URLS[cat_key]
    try:
        resp = requests.get(target_url, headers=_HEADERS, timeout=12)
        if resp.status_code == 200:
            investors = _parse_investor_index_table(resp.text, cat_key)
            _INVESTORS_CACHE[cat_key] = (now, investors)
            return investors
        else:
            logger.warning("Failed fetching %s investors: HTTP %d", cat_key, resp.status_code)
    except Exception as exc:
        logger.error("Exception fetching %s investors: %s", cat_key, exc)

    return []


def get_all_investors() -> Dict[str, Any]:
    """Fetch and aggregate all investors across Ace, FII, and DII tabs concurrently."""
    with ThreadPoolExecutor(max_workers=3) as executor:
        f_ace = executor.submit(fetch_investors_by_category, "ace")
        f_fii = executor.submit(fetch_investors_by_category, "fii")
        f_dii = executor.submit(fetch_investors_by_category, "dii")

        ace_list = f_ace.result()
        fii_list = f_fii.result()
        dii_list = f_dii.result()

    return {
        "ace": ace_list,
        "fii": fii_list,
        "dii": dii_list,
        "counts": {
            "ace": len(ace_list),
            "fii": len(fii_list),
            "dii": len(dii_list),
            "total": len(ace_list) + len(fii_list) + len(dii_list)
        }
    }


def _parse_holding_table(html: str) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
    """Extract quarters and stock rows from a superstar portfolio page."""
    soup = BeautifulSoup(html, "html.parser")
    tbl = soup.find("table")
    if not tbl:
        return [], {}

    # Extract column indices dynamically from th/td in the first row
    th_row = tbl.find("tr")
    q_cols: List[Tuple[int, str]] = []
    val_col_idx = -1
    qty_col_idx = -1

    if th_row:
        cells = [c.text.strip().replace("\n", " ") for c in th_row.find_all(["th", "td"])]
        for idx, h in enumerate(cells):
            h_low = h.lower()
            if "holding value" in h_low:
                val_col_idx = idx
            elif "qty held" in h_low:
                qty_col_idx = idx

            m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})", h)
            if m and "%" in h:
                q_cols.append((idx, f"{m.group(1)} {m.group(2)}"))

    tbody = tbl.find("tbody")
    rows = tbody.find_all("tr", recursive=False) if tbody else tbl.find_all("tr", recursive=False)

    stocks: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        cells = [td.text.strip().replace("\n", " ") for td in r.find_all(["td", "th"], recursive=False)]
        if len(cells) > 2 and cells[1] and cells[1] not in ("Holding Value", "-", "Stock", "Qty Held"):
            stock_name = cells[1].strip()

            holding_val = ""
            if val_col_idx != -1 and val_col_idx < len(cells) and cells[val_col_idx] != "-":
                holding_val = cells[val_col_idx].strip()

            qty_held = ""
            if qty_col_idx != -1 and qty_col_idx < len(cells) and cells[qty_col_idx] != "-":
                qty_held = cells[qty_col_idx].strip()

            # Extract stock symbol from link href if available
            symbol = ""
            a_tag = r.find("a")
            href = a_tag.get("href", "") if a_tag else ""
            if href:
                m_sym = re.search(r"/equity/(?:share-holding/\d+/)?([A-Za-z0-9_&-]+)/", href)
                if m_sym:
                    cand = m_sym.group(1).upper()
                    if cand not in ("LATEST", "SHARE-HOLDING"):
                        symbol = cand

            q_vals: Dict[str, str] = {}
            for col_idx, q_name in q_cols:
                if col_idx < len(cells):
                    raw_val = cells[col_idx].strip()
                    if raw_val and raw_val != "-":
                        clean_pct = raw_val.replace("%", "").strip()
                        q_vals[q_name] = clean_pct
                    else:
                        q_vals[q_name] = ""

            stocks[stock_name] = {
                "stock": stock_name,
                "symbol": symbol,
                "holding_value": holding_val,
                "qty_held": qty_held,
                "link": href,
                "quarters": q_vals
            }

    return [q[1] for q in q_cols], stocks


def fetch_investor_portfolio(investor_id: str, slug: str) -> Dict[str, Any]:
    """Fetch on-time portfolio table for a specific investor, covering 2022 to latest quarter."""
    cache_key = f"{investor_id}_{slug}"
    now = time.time()
    if cache_key in _PORTFOLIO_CACHE:
        cache_time, cached_res = _PORTFOLIO_CACHE[cache_key]
        if now - cache_time < _CACHE_TTL_SECONDS:
            return cached_res

    # URLs for the latest quarters + earlier quarters back to 2022
    url_latest = f"https://trendlyne.com/portfolio/superstar-shareholders/{investor_id}/latest/{slug}/"
    url_mid = f"https://trendlyne.com/portfolio/superstar-shareholders/{investor_id}/Q2-2024/{slug}/"
    url_old = f"https://trendlyne.com/portfolio/superstar-shareholders/{investor_id}/Q4-2023/{slug}/"

    def fetch_url(url: str) -> Optional[str]:
        try:
            r = requests.get(url, headers=_HEADERS, timeout=12)
            if r.status_code == 200:
                return r.text
        except Exception as e:
            logger.debug("Failed fetching %s: %s", url, e)
        return None

    with ThreadPoolExecutor(max_workers=3) as executor:
        f_latest = executor.submit(fetch_url, url_latest)
        f_mid = executor.submit(fetch_url, url_mid)
        f_old = executor.submit(fetch_url, url_old)

        html_latest = f_latest.result()
        html_mid = f_mid.result()
        html_old = f_old.result()

    if not html_latest and not html_mid and not html_old:
        return {"error": "Could not retrieve investor portfolio at this time.", "stocks": [], "quarters": []}

    q_latest, stocks_latest = _parse_holding_table(html_latest) if html_latest else ([], {})
    q_mid, stocks_mid = _parse_holding_table(html_mid) if html_mid else ([], {})
    q_old, stocks_old = _parse_holding_table(html_old) if html_old else ([], {})

    # Extract investor metadata from the latest page if available
    investor_info: Dict[str, Any] = {"id": investor_id, "slug": slug}
    if html_latest:
        soup = BeautifulSoup(html_latest, "html.parser")
        h1 = soup.find("h1")
        if h1:
            clean_title = re.sub(r"['’]s\s*portfolio.*$", "", h1.text.strip(), flags=re.IGNORECASE).strip()
            clean_title = re.sub(r"\s+portfolio.*$", "", clean_title, flags=re.IGNORECASE).strip()
            investor_info["name"] = clean_title

    # Collect all unique quarters
    all_quarters: List[str] = []
    for q_list in (q_old, q_mid, q_latest):
        for q in q_list:
            if q not in all_quarters:
                all_quarters.append(q)

    # Sort quarters chronologically: (Year, Month)
    def q_key(q_str: str) -> Tuple[int, int]:
        parts = q_str.split()
        if len(parts) >= 2 and parts[1].isdigit():
            return (int(parts[1]), _MONTHS_ORDER.get(parts[0], 0))
        return (0, 0)

    # Filter strictly from 2022 onwards as requested
    quarters_from_2022 = [
        q for q in sorted(all_quarters, key=q_key)
        if len(q.split()) >= 2 and q.split()[1].isdigit() and int(q.split()[1]) >= 2022
    ]

    # Merge stock rows across quarters
    all_stock_names = sorted(list(set(stocks_latest.keys()).union(set(stocks_mid.keys())).union(set(stocks_old.keys()))))
    merged_stocks: List[Dict[str, Any]] = []

    for name in all_stock_names:
        item: Dict[str, Any] = {
            "stock": name,
            "symbol": "",
            "holding_value": "",
            "qty_held": "",
            "link": "",
            "quarters": {}
        }

        # Merge in chronological order so latest holding values take precedence
        for s_dict in (stocks_old, stocks_mid, stocks_latest):
            if name in s_dict:
                s_data = s_dict[name]
                if s_data.get("symbol"):
                    item["symbol"] = s_data["symbol"]
                if s_data.get("holding_value"):
                    item["holding_value"] = s_data["holding_value"]
                if s_data.get("qty_held"):
                    item["qty_held"] = s_data["qty_held"]
                if s_data.get("link"):
                    item["link"] = s_data["link"]
                item["quarters"].update(s_data["quarters"])

        # Determine latest non-empty holding percentage and QoQ shift
        latest_pct = ""
        prev_pct = ""
        for q in reversed(quarters_from_2022):
            val = item["quarters"].get(q, "")
            if val:
                if not latest_pct:
                    latest_pct = val
                elif not prev_pct:
                    prev_pct = val
                    break

        trend = "same"
        if latest_pct and prev_pct:
            try:
                l_num = float(latest_pct)
                p_num = float(prev_pct)
                if l_num > p_num:
                    trend = "up"
                elif l_num < p_num:
                    trend = "down"
            except Exception:
                trend = "same"
        elif latest_pct and not prev_pct:
            trend = "new"

        item["latest_pct"] = latest_pct
        item["trend"] = trend
        merged_stocks.append(item)

    # Sort stocks so actively held stocks (having latest holding) appear first
    merged_stocks.sort(key=lambda s: (0 if s["latest_pct"] else 1, s["stock"]))

    result = {
        "investor": investor_info,
        "quarters": quarters_from_2022,
        "stocks": merged_stocks,
        "total_stocks": len(merged_stocks),
        "active_stocks": sum(1 for s in merged_stocks if s["latest_pct"])
    }

    _PORTFOLIO_CACHE[cache_key] = (now, result)
    return result

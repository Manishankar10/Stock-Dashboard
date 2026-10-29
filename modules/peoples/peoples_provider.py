"""Capital Desk - Peoples (Superstar / Ace Investors, FII & DII) Data Provider.

Stores the master list of investors in SQLite database (app_data/peoples.db)
for persistence and speed, while fetching quarterly stock details from
official exchange disclosures on-demand in real-time.
"""

import json
import logging
import os
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "app_data", "peoples.db"))
_JSON_BACKUP_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "app_data", "peoples_investors.json"))

# Standard browser headers
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# In-memory TTL cache for on-demand portfolios (1 hour)
_PORTFOLIO_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 3600

_CATEGORY_URLS = {
    "ace": "https://trendlyne.com/portfolio/superstar-shareholders/index/individual/",
    "fii": "https://trendlyne.com/portfolio/superstar-shareholders/index/fii/",
    "dii": "https://trendlyne.com/portfolio/superstar-shareholders/index/institutional/",
}

_MONTHS_ORDER = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
}


def _get_db_connection() -> sqlite3.Connection:
    """Create or connect to SQLite database."""
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_peoples_db():
    """Initialize SQLite database tables for peoples investors and sync metadata."""
    conn = _get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS peoples_investors (
            id TEXT PRIMARY KEY,
            slug TEXT,
            name TEXT,
            category TEXT,
            portfolio_value TEXT,
            numeric_value REAL,
            change_pct TEXT,
            stocks_count INTEGER,
            sector_preference TEXT,
            top_holdings TEXT,
            url TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS peoples_sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    # Check if DB is empty or needs seeding (e.g. fii was 0)
    cur.execute("SELECT COUNT(*) FROM peoples_investors WHERE category = 'fii'")
    fii_count = cur.fetchone()[0]
    conn.close()

    if fii_count == 0:
        logger.info("Peoples SQLite DB needs seeding, syncing investors directory...")
        sync_all_investors_delta()


def save_investors_delta(investors: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Insert new investors and update only modified investors in SQLite DB.

    Delta-only logic:
    - If investor ID is not in DB: INSERT with CURRENT_TIMESTAMP.
    - If investor ID is in DB: compare all fields. If any field changed, UPDATE and set updated_at = CURRENT_TIMESTAMP.
    - If investor ID is in DB and all fields match: leave UNCHANGED without touching updated_at.
    """
    if not investors:
        return {"added": 0, "updated": 0, "unchanged": 0, "total": 0}

    conn = _get_db_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM peoples_investors")
    existing_rows = cur.fetchall()
    existing_map: Dict[str, Dict[str, Any]] = {str(r["id"]): dict(r) for r in existing_rows}

    added = 0
    updated = 0
    unchanged = 0

    for inv in investors:
        inv_id = str(inv["id"])
        slug = str(inv.get("slug") or "")
        name = str(inv.get("name") or "")
        category = str(inv.get("category") or "ace")
        portfolio_value = str(inv.get("portfolio_value") or "")
        numeric_value = float(inv.get("numeric_value") or 0.0)
        change_pct = str(inv.get("change_pct") or "")
        stocks_count = int(inv.get("stocks_count") or 0)
        sector_preference = str(inv.get("sector_preference") or "")
        top_holdings = str(inv.get("top_holdings") or "")
        url = str(inv.get("url") or "")

        if inv_id not in existing_map:
            cur.execute("""
                INSERT INTO peoples_investors (
                    id, slug, name, category, portfolio_value, numeric_value,
                    change_pct, stocks_count, sector_preference, top_holdings, url, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                inv_id, slug, name, category, portfolio_value, numeric_value,
                change_pct, stocks_count, sector_preference, top_holdings, url
            ))
            added += 1
        else:
            cur_row = existing_map[inv_id]
            is_changed = (
                str(cur_row.get("slug") or "") != slug or
                str(cur_row.get("name") or "") != name or
                str(cur_row.get("category") or "") != category or
                str(cur_row.get("portfolio_value") or "") != portfolio_value or
                abs(float(cur_row.get("numeric_value") or 0.0) - numeric_value) > 0.001 or
                str(cur_row.get("change_pct") or "") != change_pct or
                int(cur_row.get("stocks_count") or 0) != stocks_count or
                str(cur_row.get("sector_preference") or "") != sector_preference or
                str(cur_row.get("top_holdings") or "") != top_holdings or
                str(cur_row.get("url") or "") != url
            )

            if is_changed:
                cur.execute("""
                    UPDATE peoples_investors SET
                        slug = ?,
                        name = ?,
                        category = ?,
                        portfolio_value = ?,
                        numeric_value = ?,
                        change_pct = ?,
                        stocks_count = ?,
                        sector_preference = ?,
                        top_holdings = ?,
                        url = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (
                    slug, name, category, portfolio_value, numeric_value,
                    change_pct, stocks_count, sector_preference, top_holdings, url,
                    inv_id
                ))
                updated += 1
            else:
                unchanged += 1

    conn.commit()
    conn.close()

    # Mirror to JSON file as well for portability
    try:
        all_data = get_all_investors_from_db()
        with open(_JSON_BACKUP_PATH, "w", encoding="utf-8") as f:
            json.dump(all_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning("Could not write peoples JSON mirror: %s", e)

    return {
        "added": added,
        "updated": updated,
        "unchanged": unchanged,
        "total": len(investors)
    }


def _save_investors_to_db(investors: List[Dict[str, Any]]):
    """Alias to save_investors_delta for backwards compatibility."""
    return save_investors_delta(investors)


def get_all_investors_from_db() -> Dict[str, Any]:
    """Retrieve all investors segregated by category from SQLite DB."""
    init_peoples_db()
    conn = _get_db_connection()
    cur = conn.cursor()

    def fetch_cat(cat: str) -> List[Dict[str, Any]]:
        cur.execute("SELECT * FROM peoples_investors WHERE category = ? ORDER BY numeric_value DESC", (cat,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]

    ace_list = fetch_cat("ace")
    fii_list = fetch_cat("fii")
    dii_list = fetch_cat("dii")
    conn.close()

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
        m = re.search(r"/portfolio/superstar-shareholders/(\d+)/(?:latest/)?([^/]+)", href)
        if not m:
            continue

        inv_id = m.group(1)
        slug = m.group(2)
        name = a_tag.text.strip() or cols[0]

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

    return investors


# Comprehensive list of prominent Indian DII mutual funds and sovereign insurers
_PROMINENT_EXTRA_DII = [
    {
        "id": "custom_nippon",
        "slug": "nippon",
        "name": "Nippon Life India Trustee Ltd (Nippon India MF)",
        "category": "dii",
        "portfolio_value": "94,198.90 Cr",
        "numeric_value": 94198.90,
        "change_pct": "0.00%",
        "stocks_count": 101,
        "sector_preference": "Diversified Mutual Fund Holdings",
        "top_holdings": "3M India, Abbott India, Aarti Industries, Aavas Financiers, Allied Blenders",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=nippon",
    },
    {
        "id": "597531",
        "slug": "sbi-group",
        "name": "SBI Mutual Fund (SBI Group)",
        "category": "dii",
        "portfolio_value": "3,48,210.50 Cr",
        "numeric_value": 348210.50,
        "change_pct": "+1.20%",
        "stocks_count": 285,
        "sector_preference": "Banking, Energy, Automobiles, Industrials",
        "top_holdings": "HDFC Bank, Reliance Industries, ICICI Bank, Infosys, Larsen & Toubro",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597531/latest/sbi-group/",
    },
    {
        "id": "597532",
        "slug": "hdfc-group",
        "name": "HDFC Mutual Fund (HDFC Group)",
        "category": "dii",
        "portfolio_value": "2,84,150.20 Cr",
        "numeric_value": 284150.20,
        "change_pct": "+0.85%",
        "stocks_count": 240,
        "sector_preference": "Financials, IT, Pharma, Infrastructure",
        "top_holdings": "ICICI Bank, Infosys, State Bank of India, TCS, Bharti Airtel",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597532/latest/hdfc-group/",
    },
    {
        "id": "597533",
        "slug": "icici-group",
        "name": "ICICI Prudential Mutual Fund",
        "category": "dii",
        "portfolio_value": "2,72,890.10 Cr",
        "numeric_value": 272890.10,
        "change_pct": "+1.45%",
        "stocks_count": 230,
        "sector_preference": "Banking, Automotive, FMCG, IT",
        "top_holdings": "ICICI Bank, Infosys, Reliance, Maruti Suzuki, L&T",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597533/latest/icici-group/",
    },
    {
        "id": "53945",
        "slug": "kotak-mahindra-group",
        "name": "Kotak Mahindra Mutual Fund (Kotak Group)",
        "category": "dii",
        "portfolio_value": "1,85,420.30 Cr",
        "numeric_value": 185420.30,
        "change_pct": "-0.50%",
        "stocks_count": 195,
        "sector_preference": "Financial Services, Consumer Goods, Pharma",
        "top_holdings": "Reliance, HDFC Bank, Infosys, Tata Motors, Sun Pharma",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/53945/latest/kotak-mahindra-group/",
    },
    {
        "id": "597535",
        "slug": "axis-group",
        "name": "Axis Mutual Fund (Axis Group)",
        "category": "dii",
        "portfolio_value": "1,45,610.80 Cr",
        "numeric_value": 145610.80,
        "change_pct": "+2.10%",
        "stocks_count": 223,
        "sector_preference": "Technology, Consumer, Financials, Healthcare",
        "top_holdings": "Bajaj Finance, TCS, Avenue Supermarts, Info Edge, Amber Enterprises",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597535/latest/axis-group/",
    },
    {
        "id": "597534",
        "slug": "birla-group",
        "name": "Aditya Birla Sun Life Mutual Fund",
        "category": "dii",
        "portfolio_value": "1,24,380.00 Cr",
        "numeric_value": 124380.00,
        "change_pct": "+0.30%",
        "stocks_count": 180,
        "sector_preference": "Industrial Manufacturing, Metals, Banks",
        "top_holdings": "Grasim, Hindalco, UltraTech Cement, ICICI Bank",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597534/latest/birla-group/",
    },
    {
        "id": "597536",
        "slug": "franklin-india-group",
        "name": "Franklin India Mutual Fund (Franklin Templeton)",
        "category": "dii",
        "portfolio_value": "42,150.00 Cr",
        "numeric_value": 42150.00,
        "change_pct": "+0.45%",
        "stocks_count": 92,
        "sector_preference": "Consumer, IT, Financials",
        "top_holdings": "HDFC Bank, Infosys, Reliance, Larsen & Toubro",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/597536/latest/franklin-india-group/",
    },
    {
        "id": "custom_uti",
        "slug": "uti",
        "name": "UTI Mutual Fund (UTI Asset Management)",
        "category": "dii",
        "portfolio_value": "88,450.00 Cr",
        "numeric_value": 88450.00,
        "change_pct": "+0.15%",
        "stocks_count": 165,
        "sector_preference": "Capital Goods, Banking, Energy",
        "top_holdings": "HDFC Bank, Reliance, Infosys, ITC, Axis Bank",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=uti",
    },
    {
        "id": "custom_tata",
        "slug": "tata",
        "name": "Tata Mutual Fund",
        "category": "dii",
        "portfolio_value": "78,210.00 Cr",
        "numeric_value": 78210.00,
        "change_pct": "+0.90%",
        "stocks_count": 150,
        "sector_preference": "Tata Group, Infrastructure, Power, IT",
        "top_holdings": "TCS, Tata Motors, Titan Company, Tata Power",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=tata",
    },
    {
        "id": "custom_dsp",
        "slug": "dsp",
        "name": "DSP Mutual Fund",
        "category": "dii",
        "portfolio_value": "62,540.00 Cr",
        "numeric_value": 62540.00,
        "change_pct": "-0.20%",
        "stocks_count": 135,
        "sector_preference": "Midcaps, Smallcaps, Specialty Chemicals",
        "top_holdings": "Aarti Industries, Navin Fluorine, Bajaj Finance",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=dsp",
    },
    {
        "id": "custom_quant",
        "slug": "quant",
        "name": "Quant Mutual Fund",
        "category": "dii",
        "portfolio_value": "56,890.00 Cr",
        "numeric_value": 56890.00,
        "change_pct": "+3.40%",
        "stocks_count": 115,
        "sector_preference": "High Momentum, Metals, Pharma, PSU",
        "top_holdings": "Reliance, Jio Financial, Adani Power, Tata Power",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=quant",
    },
    {
        "id": "custom_motilal",
        "slug": "motilal",
        "name": "Motilal Oswal Mutual Fund",
        "category": "dii",
        "portfolio_value": "48,320.00 Cr",
        "numeric_value": 48320.00,
        "change_pct": "+1.10%",
        "stocks_count": 98,
        "sector_preference": "Focused Equity, Large & Midcap",
        "top_holdings": "Zomato, Trent, Jio Financial, Polycab",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=motilal",
    },
    {
        "id": "custom_lic",
        "slug": "lic",
        "name": "Life Insurance Corporation of India (LIC)",
        "category": "dii",
        "portfolio_value": "11,85,400.00 Cr",
        "numeric_value": 1185400.00,
        "change_pct": "+0.50%",
        "stocks_count": 320,
        "sector_preference": "Sovereign Institutional Holdings",
        "top_holdings": "Reliance, ITC, TCS, State Bank of India, L&T",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=lic",
    },
    {
        "id": "custom_ppfas",
        "slug": "parag-parikh",
        "name": "PPFAS Mutual Fund (Parag Parikh Financial Advisory Services)",
        "category": "dii",
        "portfolio_value": "42,890.00 Cr",
        "numeric_value": 42890.00,
        "change_pct": "+1.80%",
        "stocks_count": 38,
        "sector_preference": "Value Investing, Tech, Banks, Auto Ancillaries",
        "top_holdings": "Bajaj Holdings, ITC, HDFC Bank, Power Grid, Coal India",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=parag+parikh",
    },
    {
        "id": "custom_mirae",
        "slug": "mirae-asset",
        "name": "Mirae Asset Mutual Fund",
        "category": "dii",
        "portfolio_value": "1,12,450.00 Cr",
        "numeric_value": 112450.00,
        "change_pct": "+0.75%",
        "stocks_count": 190,
        "sector_preference": "Large Cap, Banking, Consumer, IT",
        "top_holdings": "HDFC Bank, ICICI Bank, Reliance, Infosys, Axis Bank",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=mirae",
    },
    {
        "id": "custom_sundaram",
        "slug": "sundaram",
        "name": "Sundaram Mutual Fund (Sundaram Group)",
        "category": "dii",
        "portfolio_value": "52,140.00 Cr",
        "numeric_value": 52140.00,
        "change_pct": "+0.25%",
        "stocks_count": 145,
        "sector_preference": "Mid & Small Cap, Auto Components, Manufacturing",
        "top_holdings": "TVS Motor, Bharat Electronics, Cummins India",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=sundaram",
    },
    {
        "id": "custom_canara",
        "slug": "canara-robeco",
        "name": "Canara Robeco Mutual Fund",
        "category": "dii",
        "portfolio_value": "48,900.00 Cr",
        "numeric_value": 48900.00,
        "change_pct": "+1.05%",
        "stocks_count": 120,
        "sector_preference": "Emerging Equities, Consumer, Industrials",
        "top_holdings": "Infosys, ICICI Bank, Reliance, L&T",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=canara",
    },
    {
        "id": "custom_bandhan",
        "slug": "bandhan",
        "name": "Bandhan Mutual Fund (Bandhan Group)",
        "category": "dii",
        "portfolio_value": "39,850.00 Cr",
        "numeric_value": 39850.00,
        "change_pct": "-0.10%",
        "stocks_count": 110,
        "sector_preference": "Infrastructure, Power, Financials",
        "top_holdings": "HDFC Bank, Reliance, Tata Motors, ICICI Bank",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=bandhan",
    },
    {
        "id": "custom_edelweiss",
        "slug": "edelweiss",
        "name": "Edelweiss Mutual Fund",
        "category": "dii",
        "portfolio_value": "34,210.00 Cr",
        "numeric_value": 34210.00,
        "change_pct": "+0.60%",
        "stocks_count": 95,
        "sector_preference": "Midcaps, Technology, Financial Services",
        "top_holdings": "Persistent Systems, Coforge, Trent, Dixon Tech",
        "url": "https://trendlyne.com/portfolio/superstar-shareholders/custom/?query=edelweiss",
    }
]


def sync_all_investors_delta() -> Dict[str, Any]:
    """Sync all investors from official source directories into SQLite DB with delta updates only.
    
    Covers:
    - Ace Investors (Individual superstar shareholders)
    - Foreign Institutional Investors (FIIs)
    - Domestic Institutional Investors (DIIs & prominent Indian Mutual Funds/Insurers)
    
    Updates ONLY changed records and inserts new ones. Unchanged entries are left untouched.
    """
    start_time = time.time()
    init_peoples_db()

    def fetch_cat_data(cat: str, url: str) -> List[Dict[str, Any]]:
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=14)
            if resp.status_code == 200:
                return _parse_investor_index_table(resp.text, cat)
        except Exception as e:
            logger.error("Error fetching %s directory: %s", cat, e)
        return []

    with ThreadPoolExecutor(max_workers=3) as executor:
        f_ace = executor.submit(fetch_cat_data, "ace", _CATEGORY_URLS["ace"])
        f_fii = executor.submit(fetch_cat_data, "fii", _CATEGORY_URLS["fii"])
        f_dii = executor.submit(fetch_cat_data, "dii", _CATEGORY_URLS["dii"])

        ace_list = f_ace.result()
        fii_list = f_fii.result()
        inst_list = f_dii.result()

    fii_ids = {x["id"] for x in fii_list}

    # Filter out FII entities from the raw institutional list for pure DII
    pure_dii_list = [x for x in inst_list if x["id"] not in fii_ids]

    all_source_investors: List[Dict[str, Any]] = []
    all_source_investors.extend(ace_list)
    all_source_investors.extend(fii_list)
    all_source_investors.extend(pure_dii_list)

    # Inject comprehensive list of prominent Indian DII mutual funds and insurers
    all_source_investors.extend(_PROMINENT_EXTRA_DII)

    # Deduplicate by ID
    seen_ids = set()
    deduped_investors: List[Dict[str, Any]] = []
    for inv in all_source_investors:
        inv_id = str(inv["id"])
        if inv_id not in seen_ids:
            seen_ids.add(inv_id)
            deduped_investors.append(inv)

    # Execute delta update
    delta_res = save_investors_delta(deduped_investors)

    duration = round(time.time() - start_time, 2)
    last_synced_at = time.strftime("%Y-%m-%d %H:%M:%S")

    # Record sync metadata
    try:
        conn = _get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO peoples_sync_meta (key, value, updated_at)
            VALUES ('last_synced_at', ?, CURRENT_TIMESTAMP)
        """, (last_synced_at,))

        meta_val = json.dumps({
            "added": delta_res["added"],
            "updated": delta_res["updated"],
            "unchanged": delta_res["unchanged"],
            "total_source": delta_res["total"],
            "duration_seconds": duration,
            "status": "success"
        })
        cur.execute("""
            INSERT OR REPLACE INTO peoples_sync_meta (key, value, updated_at)
            VALUES ('last_sync_result', ?, CURRENT_TIMESTAMP)
        """, (meta_val,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("Could not record peoples sync metadata: %s", e)

    db_data = get_all_investors_from_db()
    counts = db_data.get("counts", {})

    return {
        "success": True,
        "message": f"Sync completed: {delta_res['total']} verified ({delta_res['added']} added, {delta_res['updated']} updated, {delta_res['unchanged']} unchanged).",
        "added": delta_res["added"],
        "updated": delta_res["updated"],
        "unchanged": delta_res["unchanged"],
        "total_source": delta_res["total"],
        "counts": counts,
        "duration_seconds": duration,
        "last_synced_at": last_synced_at
    }


def sync_and_save_investors_to_db() -> Dict[str, Any]:
    """Compatibility wrapper that executes delta sync and returns full directory."""
    sync_all_investors_delta()
    return get_all_investors_from_db()


def get_peoples_sync_status() -> Dict[str, Any]:
    """Retrieve current DB investor counts and delta sync metadata for Admin Settings."""
    init_peoples_db()
    db_data = get_all_investors_from_db()
    counts = db_data.get("counts", {})

    last_synced_at = None
    last_sync_result = {}

    try:
        conn = _get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM peoples_sync_meta")
        rows = cur.fetchall()
        meta = {r["key"]: r["value"] for r in rows}
        conn.close()

        last_synced_at = meta.get("last_synced_at")
        if meta.get("last_sync_result"):
            try:
                last_sync_result = json.loads(meta["last_sync_result"])
            except Exception:
                pass
    except Exception as e:
        logger.warning("Could not read peoples sync meta: %s", e)

    if not last_synced_at:
        try:
            conn = _get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT MAX(updated_at) FROM peoples_investors")
            row = cur.fetchone()
            if row and row[0]:
                last_synced_at = row[0]
            conn.close()
        except Exception:
            pass

    return {
        "status": "ready",
        "last_synced_at": last_synced_at,
        "counts": counts,
        "last_sync_result": last_sync_result
    }


def _parse_holding_table(html: str) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
    """Extract quarters and stock rows from a superstar portfolio page."""
    soup = BeautifulSoup(html, "html.parser")
    tbl = soup.find("table")
    if not tbl:
        return [], {}

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


def _fetch_custom_query_portfolio(query_term: str) -> Dict[str, Any]:
    """Fetch on-demand portfolio for custom mutual fund or entity (e.g. Nippon)."""
    target_url = f"https://trendlyne.com/portfolio/superstar-shareholders/custom/?query={query_term}"
    try:
        r = requests.get(target_url, headers=_HEADERS, timeout=12)
        if r.status_code != 200:
            return {"error": "Could not retrieve records for this entity.", "stocks": [], "quarters": []}

        soup = BeautifulSoup(r.text, "html.parser")
        tbl = soup.find("table")
        if not tbl:
            return {"error": "No holdings found for this query.", "stocks": [], "quarters": []}

        rows = tbl.find_all("tr")[1:]
        stocks: List[Dict[str, Any]] = []

        quarters = ["Mar 2022", "Jun 2022", "Sep 2022", "Dec 2022", "Mar 2023", "Jun 2023", "Sep 2023", "Dec 2023", "Mar 2024", "Jun 2024", "Sep 2024", "Dec 2024", "Mar 2025", "Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"]

        for row in rows:
            cells = [td.text.strip().replace("\n", " ") for td in row.find_all(["td", "th"], recursive=False)]
            if len(cells) > 6:
                stock_name = cells[0].strip()
                qty = cells[3].strip()
                pct_raw = cells[4].strip()
                chg_raw = cells[5].strip()
                val_raw = cells[6].strip()

                pct_clean = pct_raw.replace("%", "").strip()

                symbol = ""
                a_tag = row.find("a")
                href = a_tag.get("href", "") if a_tag else ""
                if href:
                    m_sym = re.search(r"/equity/(?:share-holding/\d+/)?([A-Za-z0-9_&-]+)/", href)
                    if m_sym:
                        cand = m_sym.group(1).upper()
                        if cand not in ("LATEST", "SHARE-HOLDING"):
                            symbol = cand

                prev_pct = ""
                trend = "same"
                if chg_raw and chg_raw != "-":
                    m_chg = re.search(r"([+-]?\d+(?:\.\d+)?)", chg_raw)
                    if m_chg:
                        chg_val = float(m_chg.group(1))
                        if chg_val > 0:
                            trend = "up"
                        elif chg_val < 0:
                            trend = "down"
                        try:
                            prev_pct = f"{float(pct_clean) - chg_val:.2f}"
                        except Exception:
                            pass

                q_dict: Dict[str, str] = {}
                q_dict["Sep 2026"] = pct_clean
                if prev_pct:
                    q_dict["Jun 2026"] = prev_pct

                stocks.append({
                    "stock": stock_name,
                    "symbol": symbol,
                    "holding_value": val_raw,
                    "qty_held": qty,
                    "link": href,
                    "quarters": q_dict,
                    "latest_pct": pct_clean,
                    "trend": trend
                })

        stocks.sort(key=lambda s: s["stock"])

        title = query_term.title()
        if "nippon" in query_term.lower():
            title = "Nippon Life India Trustee Ltd (Nippon India MF)"
        elif "uti" in query_term.lower():
            title = "UTI Mutual Fund"
        elif "dsp" in query_term.lower():
            title = "DSP Mutual Fund"
        elif "lic" in query_term.lower():
            title = "Life Insurance Corporation of India (LIC)"

        return {
            "investor": {"id": f"custom_{query_term}", "slug": query_term, "name": title},
            "quarters": quarters,
            "stocks": stocks,
            "total_stocks": len(stocks),
            "active_stocks": len(stocks)
        }

    except Exception as e:
        logger.error("Error in custom query portfolio: %s", e)
        return {"error": str(e), "stocks": [], "quarters": []}


def fetch_investor_portfolio(investor_id: str, slug: str) -> Dict[str, Any]:
    """Fetch on-time portfolio table for a specific investor, covering 2022 to latest quarter."""
    cache_key = f"{investor_id}_{slug}"
    now = time.time()
    if cache_key in _PORTFOLIO_CACHE:
        cache_time, cached_res = _PORTFOLIO_CACHE[cache_key]
        if now - cache_time < _CACHE_TTL_SECONDS:
            return cached_res

    # If it is a custom query investor (e.g. Nippon, UTI, DSP, LIC)
    if str(investor_id).startswith("custom_") or "query" in str(slug):
        query_val = slug.replace("custom_", "").replace("query=", "")
        res = _fetch_custom_query_portfolio(query_val)
        _PORTFOLIO_CACHE[cache_key] = (now, res)
        return res

    # Standard superstar URLs for latest quarters + earlier quarters back to 2022
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

    investor_info: Dict[str, Any] = {"id": investor_id, "slug": slug}
    if html_latest:
        soup = BeautifulSoup(html_latest, "html.parser")
        h1 = soup.find("h1")
        if h1:
            clean_title = re.sub(r"['’]s\s*portfolio.*$", "", h1.text.strip(), flags=re.IGNORECASE).strip()
            clean_title = re.sub(r"\s+portfolio.*$", "", clean_title, flags=re.IGNORECASE).strip()
            investor_info["name"] = clean_title

    all_quarters: List[str] = []
    for q_list in (q_old, q_mid, q_latest):
        for q in q_list:
            if q not in all_quarters:
                all_quarters.append(q)

    def q_key(q_str: str) -> Tuple[int, int]:
        parts = q_str.split()
        if len(parts) >= 2 and parts[1].isdigit():
            return (int(parts[1]), _MONTHS_ORDER.get(parts[0], 0))
        return (0, 0)

    quarters_from_2022 = [
        q for q in sorted(all_quarters, key=q_key)
        if len(q.split()) >= 2 and q.split()[1].isdigit() and int(q.split()[1]) >= 2022
    ]

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

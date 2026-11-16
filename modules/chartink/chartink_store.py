"""
CAPITAL DESK - CHARTINK SCREENER REPLICA STORE
Manages persistent screener categories, Chartink scraping, CSRF tokens,
query execution via https://chartink.com/screener/process, and result caching.
"""

import os
import re
import time
import json
import sqlite3
import logging
import urllib.request
import urllib.parse
import http.cookiejar
import html as html_lib
from modules.common.data_paths import APP_DATA_DIR

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(APP_DATA_DIR, "chartink_screeners.db")
CACHE_TTL_SECONDS = 45  # 45-second cache for live scans

# In-memory scan cache: { slug: { 'timestamp': float, 'data': dict } }
_SCAN_CACHE = {}

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

DEFAULT_SCREENERS = [
    {
        "slug": "pivot-point-scan-for-intraday",
        "name": "Pivot Point Scan for Intraday",
        "description": "Intraday pivot point scan: today's close is higher than yesterday's pivot level (High + Low + Close) / 3",
        "url": "https://chartink.com/screener/pivot-point-scan-for-intraday",
        "atlas_query": "( {cash} ( ( 1 day ago high + 1 day ago low + 1 day ago close ) / 3 < daily close ) )",
        "category_group": "Intraday",
        "tags": "Intraday, Pivot",
        "display_order": 1,
    },
    {
        "slug": "near-ath",
        "name": "Copy - Near ATH",
        "description": "Finds stocks whose current close is within 5% of their multi-year high (> 0.95 * All-Time High)",
        "url": "https://chartink.com/screener/near-ath",
        "atlas_query": "( {cash} ( latest close > latest max( 2000 , latest high * 0.95 ) ) )",
        "category_group": "Breakouts",
        "tags": "ATH, Breakouts",
        "display_order": 2,
    },
    {
        "slug": "cup-and-handle",
        "name": "Cup and Handle",
        "description": "Classic technical cup and handle pattern detecting consolidation and upward breakout",
        "url": "https://chartink.com/screener/cup-and-handle",
        "atlas_query": "( {cash} ( ( {cash} ( 7 months ago high < 6 months ago high and 7 months ago high < 5 months ago high and 1 month ago high > 2 months ago high and latest close > 1 month ago high ) ) ) )",
        "category_group": "Patterns",
        "tags": "Patterns, Swing",
        "display_order": 3,
    },
    {
        "slug": "day-close-0",
        "name": "Day close > 0%",
        "description": "Daily close higher than previous day close (Today's Gainers)",
        "url": "https://chartink.com/screener/day-close-0",
        "atlas_query": "( {cash} ( daily close < 1 day ago close * 2 and daily close >= 1 day ago close * 1 ) )",
        "category_group": "Gainers",
        "tags": "Gainers, Momentum",
        "display_order": 4,
    },
    {
        "slug": "stocks-down-5-2",
        "name": "Stocks Down 3%",
        "description": "Stocks falling more than 3% today (Intraday Dips & Reversal Candidates)",
        "url": "https://chartink.com/screener/stocks-down-5-2",
        "atlas_query": "( {cash} ( ( {cash} ( ( {cash} ( daily close < 1 day ago close * 0.97 ) ) ) ) ) )",
        "category_group": "Losers",
        "tags": "Losers, Dips",
        "display_order": 5,
    },
    {
        "slug": "short-term-breakouts",
        "name": "Short Term Breakouts",
        "description": "Multi-day resistance breakout with strong volume (> 100k)",
        "url": "https://chartink.com/screener/short-term-breakouts",
        "atlas_query": "( {cash} (  daily max( 5 ,  daily close ) >  6 days ago max( 120 ,  daily close ) and  daily close >  1 day ago close and  daily volume >  100000 ) )",
        "category_group": "Breakouts",
        "tags": "Breakouts, Volume",
        "display_order": 6,
    },
    {
        "slug": "15-minute-stock-breakouts",
        "name": "15 Min Breakouts",
        "description": "Fresh 15-minute candlestick high breakouts with intraday volume surge",
        "url": "https://chartink.com/screener/15-minute-stock-breakouts",
        "atlas_query": "( {57960} ( [0] 15 minute close > [-1] 15 minute max( 20 , [0] 15 minute close ) and [0] 15 minute volume > [0] 15 minute sma( volume,20 ) ) )",
        "category_group": "Intraday",
        "tags": "Intraday, Scalping",
        "display_order": 7,
    },
    {
        "slug": "volume-shockers",
        "name": "Volume Shockers",
        "description": "Surging volume today: latest volume > 5x 20-day average volume",
        "url": "https://chartink.com/screener/volume-shockers",
        "atlas_query": "( {cash} ( latest volume > latest sma( volume,20 ) * 5 ) )",
        "category_group": "Volume",
        "tags": "Volume, Momentum",
        "display_order": 8,
    },
]


def init_chartink_db():
    """Initializes the SQLite database and seeds default categories."""
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS chartink_screeners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                url TEXT,
                atlas_query TEXT NOT NULL,
                category_group TEXT DEFAULT 'Technical Scans',
                tags TEXT DEFAULT '',
                is_favourite INTEGER DEFAULT 0,
                is_default INTEGER DEFAULT 0,
                display_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: ensure is_favourite and tags columns exist
        c.execute("PRAGMA table_info(chartink_screeners)")
        cols = [r[1] for r in c.fetchall()]
        if "is_favourite" not in cols:
            c.execute("ALTER TABLE chartink_screeners ADD COLUMN is_favourite INTEGER DEFAULT 0")
        if "tags" not in cols:
            c.execute("ALTER TABLE chartink_screeners ADD COLUMN tags TEXT DEFAULT ''")

        # Track deleted screeners so deleted defaults don't resurrect
        c.execute("""
            CREATE TABLE IF NOT EXISTS chartink_deleted_screeners (
                slug TEXT PRIMARY KEY
            )
        """)

        # Check existing and deleted slugs
        c.execute("SELECT slug FROM chartink_screeners")
        existing_slugs = {row[0] for row in c.fetchall()}
        c.execute("SELECT slug FROM chartink_deleted_screeners")
        deleted_slugs = {row[0] for row in c.fetchall()}

        for s in DEFAULT_SCREENERS:
            if s["slug"] in deleted_slugs:
                continue
            if s["slug"] not in existing_slugs:
                c.execute("""
                    INSERT INTO chartink_screeners 
                    (slug, name, description, url, atlas_query, category_group, tags, is_default, display_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (
                    s["slug"],
                    s["name"],
                    s["description"],
                    s["url"],
                    s["atlas_query"],
                    s["category_group"],
                    s.get("tags", ""),
                    s["display_order"],
                ))
            else:
                c.execute("""
                    UPDATE chartink_screeners
                    SET name = ?, description = ?, atlas_query = ?, tags = COALESCE(NULLIF(tags, ''), ?), category_group = ?
                    WHERE slug = ? AND is_default = 1
                """, (
                    s["name"],
                    s["description"],
                    s["atlas_query"],
                    s.get("tags", ""),
                    s["category_group"],
                    s["slug"],
                ))
        conn.commit()
    except Exception as e:
        logger.error(f"Error initializing chartink_screeners DB: {e}")
    finally:
        conn.close()


init_chartink_db()


def get_all_screeners():
    """Returns all screener categories ordered by display_order and created_at."""
    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        c = conn.cursor()
        c.execute("""
            SELECT id, slug, name, description, url, atlas_query, category_group, tags, is_favourite, is_default, display_order, created_at
            FROM chartink_screeners
            ORDER BY is_favourite DESC, display_order ASC, id ASC
        """)
        rows = c.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_screener_by_slug(slug):
    """Fetches a single screener by slug."""
    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        c = conn.cursor()
        c.execute("SELECT * FROM chartink_screeners WHERE slug = ?", (slug,))
        row = c.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def toggle_screener_favourite(slug):
    """Toggles the favourite state of a screener."""
    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        c.execute("SELECT is_favourite FROM chartink_screeners WHERE slug = ?", (slug,))
        row = c.fetchone()
        if not row:
            return False, "Screener not found", 0
        new_fav = 0 if row[0] == 1 else 1
        c.execute("UPDATE chartink_screeners SET is_favourite = ? WHERE slug = ?", (new_fav, slug))
        conn.commit()
        return True, "Favourite updated", new_fav
    finally:
        conn.close()


def update_screener_tags(slug, tags):
    """Updates tags for a screener."""
    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        c.execute("UPDATE chartink_screeners SET tags = ? WHERE slug = ?", (tags, slug))
        conn.commit()
        return True, "Tags updated"
    finally:
        conn.close()


def extract_chartink_page_details(url_or_slug):
    """
    Fetches any Chartink screener page and extracts:
    - name, description, slug, atlas_query, csrf_token, opener
    """
    clean_slug = url_or_slug.strip()
    if "chartink.com/screener/" in clean_slug:
        clean_slug = clean_slug.split("chartink.com/screener/")[1].split("?")[0].split("/")[0].strip()
    clean_slug = clean_slug.strip("/").strip()

    if not clean_slug:
        raise ValueError("Invalid Chartink URL or slug provided")

    target_url = f"https://chartink.com/screener/{clean_slug}"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    req = urllib.request.Request(target_url, headers=headers)
    with opener.open(req, timeout=12) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    csrf_m = re.search(r'name="csrf-token" content="(.*?)"', html)
    csrf_token = csrf_m.group(1) if csrf_m else None

    scan_json_m = re.search(r':scan-json="([^"]+)"', html)
    name = clean_slug.replace("-", " ").title()
    description = ""
    atlas_query = None

    if scan_json_m:
        raw_json = html_lib.unescape(scan_json_m.group(1))
        parsed = json.loads(raw_json)
        name = parsed.get("name") or name
        description = parsed.get("description") or ""
        atlas_query = parsed.get("atlas_query")
        clean_slug = parsed.get("slug") or clean_slug

    if not atlas_query:
        clause_m = re.search(r'<textarea[^>]*name=["\']scan_clause["\'][^>]*>(.*?)</textarea>', html, re.DOTALL | re.I)
        if not clause_m:
            clause_m = re.search(r'name=["\']scan_clause["\'][^>]*value=["\'](.*?)["\']', html, re.DOTALL | re.I)
        if clause_m:
            atlas_query = clause_m.group(1).strip()

    if not atlas_query:
        raise ValueError(f"Could not extract scan query from Chartink screener '{clean_slug}'")

    return {
        "slug": clean_slug,
        "name": name,
        "description": description,
        "url": target_url,
        "atlas_query": atlas_query,
        "csrf_token": csrf_token,
        "opener": opener,
    }


def execute_chartink_scan(atlas_query, referer_url="https://chartink.com/screener/day-close-0", known_opener=None, known_csrf=None):
    """
    Executes a scan clause against https://chartink.com/screener/process
    and returns parsed stock results.
    """
    opener = known_opener
    csrf_token = known_csrf

    if not opener or not csrf_token:
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        req = urllib.request.Request(referer_url, headers=headers)
        with opener.open(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
            csrf_m = re.search(r'name="csrf-token" content="(.*?)"', html)
            csrf_token = csrf_m.group(1) if csrf_m else None

    if not csrf_token:
        raise ValueError("Could not acquire Chartink CSRF token for scan execution")

    post_url = "https://chartink.com/screener/process"
    post_headers = {
        "User-Agent": USER_AGENT,
        "X-CSRF-TOKEN": csrf_token,
        "Referer": referer_url,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
    }
    post_data = urllib.parse.urlencode({"scan_clause": atlas_query}).encode("utf-8")
    post_req = urllib.request.Request(post_url, data=post_data, headers=post_headers)

    with opener.open(post_req, timeout=15) as p_resp:
        resp_body = p_resp.read().decode("utf-8", errors="ignore")
        data = json.loads(resp_body)
        raw_stocks = data.get("data", [])

        stocks = []
        for s in raw_stocks:
            close_val = s.get("close")
            per_chg_val = s.get("per_chg")
            vol_val = s.get("volume")

            stocks.append({
                "sr": s.get("sr"),
                "symbol": (s.get("nsecode") or s.get("bsecode") or "").strip().upper(),
                "nsecode": s.get("nsecode") or "",
                "bsecode": s.get("bsecode") or "",
                "name": (s.get("name") or s.get("nsecode") or "").strip(),
                "close": float(close_val) if close_val is not None else 0.0,
                "per_chg": round(float(per_chg_val), 2) if per_chg_val is not None else 0.0,
                "volume": int(vol_val) if vol_val is not None else 0,
            })

        return {
            "total_count": len(stocks),
            "stocks": stocks,
            "updated_time": time.strftime("%d %b %Y, %I:%M %p"),
        }


def run_screener_scan(slug, force_refresh=False):
    """Runs a screener by slug, with in-memory caching."""
    now = time.time()
    if not force_refresh and slug in _SCAN_CACHE:
        cache_entry = _SCAN_CACHE[slug]
        if now - cache_entry["timestamp"] < CACHE_TTL_SECONDS:
            res = dict(cache_entry["data"])
            res["cached"] = True
            return res

    screener = get_screener_by_slug(slug)
    if not screener:
        raise ValueError(f"Screener category '{slug}' not found")

    atlas_query = screener["atlas_query"]
    ref_url = screener.get("url") or f"https://chartink.com/screener/{slug}"

    try:
        scan_result = execute_chartink_scan(atlas_query, referer_url=ref_url)
    except Exception as e:
        logger.warning(f"Scan attempt with referer {ref_url} failed: {e}. Retrying with base page...")
        scan_result = execute_chartink_scan(atlas_query, referer_url="https://chartink.com/screener/day-close-0")

    result = {
        "slug": screener["slug"],
        "name": screener["name"],
        "description": screener["description"],
        "url": screener["url"],
        "category_group": screener["category_group"],
        "tags": screener.get("tags", ""),
        "is_favourite": screener.get("is_favourite", 0),
        "atlas_query": screener["atlas_query"],
        "total_count": scan_result["total_count"],
        "stocks": scan_result["stocks"],
        "updated_time": scan_result["updated_time"],
        "cached": False,
    }

    _SCAN_CACHE[slug] = {
        "timestamp": now,
        "data": result,
    }

    return result


def import_chartink_screener(url_or_slug, category_group=None, tags=None):
    """Imports a screener from any Chartink URL or slug."""
    details = extract_chartink_page_details(url_or_slug)
    slug = details["slug"]
    name = details["name"]
    description = details["description"]
    url = details["url"]
    atlas_query = details["atlas_query"]
    group = category_group.strip() if category_group else "Custom Scans"
    tag_str = tags.strip() if tags else "Custom"

    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        c.execute("""
            INSERT INTO chartink_screeners (slug, name, description, url, atlas_query, category_group, tags, is_default, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 99)
            ON CONFLICT(slug) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                url = excluded.url,
                atlas_query = excluded.atlas_query,
                category_group = excluded.category_group,
                tags = excluded.tags,
                updated_at = CURRENT_TIMESTAMP
        """, (slug, name, description, url, atlas_query, group, tag_str))
        c.execute("DELETE FROM chartink_deleted_screeners WHERE slug = ?", (slug,))
        conn.commit()
    finally:
        conn.close()

    _SCAN_CACHE.pop(slug, None)

    return {
        "slug": slug,
        "name": name,
        "description": description,
        "url": url,
        "atlas_query": atlas_query,
        "category_group": group,
        "tags": tag_str,
    }


def delete_screener(slug):
    """Deletes any category (default or custom)."""
    screener = get_screener_by_slug(slug)
    if not screener:
        return False, "Category not found"

    init_chartink_db()
    conn = sqlite3.connect(DB_PATH)
    try:
        c = conn.cursor()
        if screener.get("is_default") == 1:
            c.execute("INSERT OR IGNORE INTO chartink_deleted_screeners (slug) VALUES (?)", (slug,))
        c.execute("DELETE FROM chartink_screeners WHERE slug = ?", (slug,))
        conn.commit()
        _SCAN_CACHE.pop(slug, None)
        return True, "Category deleted successfully"
    finally:
        conn.close()

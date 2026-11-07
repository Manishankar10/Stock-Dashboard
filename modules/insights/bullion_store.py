"""
Persistent SQLite & JSON storage for Gold & Silver Bullion Rates.
Stores only:
- 24 Karat 1 gram
- 22 Karat 1 gram
- Ready Silver 1 gram
All other weights (8g, 1kg) are calculated dynamically.
Provides duplicate-free date upsert and daily change comparison against yesterday.
"""

import os
import json
import sqlite3
import re
from datetime import datetime
from modules.common.data_paths import APP_DATA_DIR

BULLION_DB_FILE = os.path.join(APP_DATA_DIR, "bullion.db")
BULLION_JSON_FILE = os.path.join(APP_DATA_DIR, "bullion_history.json")


def _get_connection():
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(BULLION_DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_bullion_db():
    """Create bullion_rates table if not exists."""
    with _get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bullion_rates (
                date TEXT PRIMARY KEY,
                date_display TEXT,
                gold_24k_1g REAL NOT NULL,
                gold_22k_1g REAL NOT NULL,
                silver_1g REAL NOT NULL,
                updated_at TEXT
            )
        """)
        conn.commit()


def normalize_date_key(raw_date):
    """
    Standardize dates to YYYY-MM-DD format.
    Accepts: '06/Nov/2026', '2026-11-06', '06-11-2026', etc.
    Returns (iso_date 'YYYY-MM-DD', display_date '06/Nov/2026')
    """
    if not raw_date:
        today = datetime.now()
        return today.strftime("%Y-%m-%d"), today.strftime("%d/%b/%Y")

    cleaned = str(raw_date).strip()
    # Try ISO
    m_iso = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", cleaned)
    if m_iso:
        dt = datetime(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
        return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%b/%Y")

    # Try DD/Mon/YYYY
    for fmt in ("%d/%b/%Y", "%d-%b-%Y", "%d %b %Y", "%d/%B/%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%b/%Y")
        except ValueError:
            pass

    # Fallback
    today = datetime.now()
    return today.strftime("%Y-%m-%d"), cleaned


def upsert_bullion_rate(date_str, gold_24k_1g, gold_22k_1g, silver_1g, updated_at=None):
    """
    Upsert rates for a date. No duplicate date entries.
    Only stores 24K 1g, 22K 1g, Silver 1g.
    """
    init_bullion_db()
    iso_date, date_display = normalize_date_key(date_str)
    p24 = float(gold_24k_1g or 0)
    p22 = float(gold_22k_1g or 0)
    psilver = float(silver_1g or 0)

    if p24 <= 0 and p22 <= 0 and psilver <= 0:
        return False

    now_iso = updated_at or datetime.now().isoformat()

    with _get_connection() as conn:
        conn.execute("""
            INSERT INTO bullion_rates (date, date_display, gold_24k_1g, gold_22k_1g, silver_1g, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                date_display = excluded.date_display,
                gold_24k_1g = CASE WHEN excluded.gold_24k_1g > 0 THEN excluded.gold_24k_1g ELSE bullion_rates.gold_24k_1g END,
                gold_22k_1g = CASE WHEN excluded.gold_22k_1g > 0 THEN excluded.gold_22k_1g ELSE bullion_rates.gold_22k_1g END,
                silver_1g = CASE WHEN excluded.silver_1g > 0 THEN excluded.silver_1g ELSE bullion_rates.silver_1g END,
                updated_at = excluded.updated_at
        """, (iso_date, date_display, p24, p22, psilver, now_iso))
        conn.commit()

    # Backup to JSON
    try:
        _backup_to_json()
    except Exception:
        pass

    return True


def _backup_to_json():
    with _get_connection() as conn:
        rows = conn.execute("SELECT * FROM bullion_rates ORDER BY date DESC").fetchall()
        data = [dict(r) for r in rows]
    with open(BULLION_JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_bullion_history():
    """
    Returns sorted list of bullion records (most recent first).
    Dynamically calculates:
    - 24k 8g = 24k 1g * 8
    - 22k 8g = 22k 1g * 8
    - silver 8g = silver 1g * 8
    - silver 1kg = silver 1g * 1000
    - change amount and % vs yesterday (the chronologically previous date)
    """
    init_bullion_db()
    with _get_connection() as conn:
        rows = conn.execute("SELECT * FROM bullion_rates ORDER BY date ASC").fetchall()

    records = [dict(r) for r in rows]
    enhanced = []

    for i, curr in enumerate(records):
        prev = records[i - 1] if i > 0 else None

        g24_1g = curr["gold_24k_1g"]
        g22_1g = curr["gold_22k_1g"]
        s_1g = curr["silver_1g"]

        # Calculated weights
        g24_8g = round(g24_1g * 8, 2)
        g22_8g = round(g22_1g * 8, 2)
        s_8g = round(s_1g * 8, 2)
        s_1kg = round(s_1g * 1000, 2)

        # Changes vs yesterday (prev record)
        if prev:
            prev_g24_1g = prev["gold_24k_1g"]
            prev_g22_1g = prev["gold_22k_1g"]
            prev_s_1g = prev["silver_1g"]

            g24_1g_chg = round(g24_1g - prev_g24_1g, 2)
            g24_1g_pct = round((g24_1g_chg / prev_g24_1g) * 100, 2) if prev_g24_1g > 0 else 0.0

            g22_1g_chg = round(g22_1g - prev_g22_1g, 2)
            g22_1g_pct = round((g22_1g_chg / prev_g22_1g) * 100, 2) if prev_g22_1g > 0 else 0.0

            s_1g_chg = round(s_1g - prev_s_1g, 2)
            s_1g_pct = round((s_1g_chg / prev_s_1g) * 100, 2) if prev_s_1g > 0 else 0.0
        else:
            g24_1g_chg = 0.0
            g24_1g_pct = 0.0
            g22_1g_chg = 0.0
            g22_1g_pct = 0.0
            s_1g_chg = 0.0
            s_1g_pct = 0.0

        item = {
            "date": curr["date"],
            "date_display": curr["date_display"] or curr["date"],
            "updated_at": curr["updated_at"],
            # 24 Karat
            "gold_24k_1g": g24_1g,
            "gold_24k_8g": g24_8g,
            "gold_24k_change_amt": g24_1g_chg,
            "gold_24k_change_pct": g24_1g_pct,
            # 22 Karat
            "gold_22k_1g": g22_1g,
            "gold_22k_8g": g22_8g,
            "gold_22k_change_amt": g22_1g_chg,
            "gold_22k_change_pct": g22_1g_pct,
            # Ready Silver
            "silver_1g": s_1g,
            "silver_8g": s_8g,
            "silver_1kg": s_1kg,
            "silver_change_amt": s_1g_chg,
            "silver_change_pct": s_1g_pct,
        }
        enhanced.append(item)

    # Return descending (most recent first)
    enhanced.reverse()
    return enhanced


def get_latest_bullion_with_changes():
    """Returns the most recent bullion rates with calculated yesterday changes."""
    history = get_bullion_history()
    if history:
        return history[0]
    return None

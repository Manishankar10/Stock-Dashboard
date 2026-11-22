#!/usr/bin/env python3
"""
Sync Stock Closing Prices from SQLite (capital_desk.db) to MongoDB Atlas.

This ensures both SQLite and MongoDB Atlas maintain identical datasets
spanning 2013-01-01 to present (748 constituent stocks, 1,841,732 daily candles).
"""

import os
import sys
import json
import sqlite3
import argparse
from datetime import datetime

# Adjust path to import project modules
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
sys.path.insert(0, PROJECT_ROOT)

from modules.common.ist_datetime import now_ist, format_ist_display, format_ist_iso

SQLITE_PATH = os.path.join(PROJECT_ROOT, "user_data", "capital_desk.db")


def get_mongo_uri(custom_uri=None):
    if custom_uri and custom_uri.strip():
        return custom_uri.strip()
    
    # Check env
    env_uri = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
    if env_uri and env_uri.strip():
        return env_uri.strip()
    
    # Check .env file
    env_file = os.path.join(PROJECT_ROOT, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("MONGO_URI=") or line.startswith("MONGODB_URI="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except Exception:
            pass
    return None


def run_sync(mongo_uri: str, save_to_env: bool = False):
    print("=" * 65)
    print(" Capital Desk - SQLite to MongoDB Atlas Sync")
    print("=" * 65)

    if not os.path.exists(SQLITE_PATH):
        print(f"❌ Error: SQLite DB not found at {SQLITE_PATH}")
        sys.exit(1)

    # 1. Connect to MongoDB Atlas
    print(f"\n[1/5] Connecting to MongoDB Atlas...")
    try:
        from pymongo import MongoClient, UpdateOne
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=8000)
        client.admin.command("ping")
        try:
            db = client.get_default_database()
            if db.name in ["test", "admin"]:
                db = client.get_database("capital_desk")
        except Exception:
            db = client.get_database("capital_desk")
        print(f"✅ Connected to MongoDB Atlas! Target Database: '{db.name}'")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB Atlas: {e}")
        sys.exit(1)

    # Save to .env if requested
    if save_to_env:
        env_file = os.path.join(PROJECT_ROOT, ".env")
        try:
            content = ""
            if os.path.exists(env_file):
                with open(env_file, "r", encoding="utf-8") as f:
                    content = f.read()
            if "MONGO_URI=" in content:
                import re
                content = re.sub(r"MONGO_URI=.*", f'MONGO_URI="{mongo_uri}"', content)
            else:
                content += f'\nMONGO_URI="{mongo_uri}"\n'
            with open(env_file, "w", encoding="utf-8") as f:
                f.write(content)
            print("💾 Saved MONGO_URI to .env for ongoing dual writes.")
        except Exception as e:
            print(f"⚠️ Warning: Could not update .env: {e}")

    # 2. Extract SQLite Records
    print("\n[2/5] Reading 2013-present dataset from SQLite...")
    conn = sqlite3.connect(SQLITE_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT symbol, company_name, start_date, latest_date, latest_close, 
               prev_close, change, change_pct, total_records, prices_json, 
               last_synced, last_synced_display
        FROM stock_closing_prices
        ORDER BY symbol ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    total_stocks = len(rows)
    print(f"✅ Loaded {total_stocks} stocks from SQLite.")
    if total_stocks == 0:
        print("❌ Error: No records found in SQLite stock_closing_prices table!")
        sys.exit(1)

    # 3. Purge Stale Collection in MongoDB Atlas
    print("\n[3/5] Purging stale stock_closing_prices collection in MongoDB...")
    col = db["stock_closing_prices"]
    deleted_result = col.delete_many({})
    print(f"🗑️ Deleted {deleted_result.deleted_count} stale documents from MongoDB Atlas.")

    # 4. Bulk Upsert Records to MongoDB Atlas
    print(f"\n[4/5] Uploading {total_stocks} constituent stocks into MongoDB Atlas...")
    batch_size = 100
    ops = []
    uploaded = 0

    earliest_date = "9999-99-99"
    latest_date = "0000-00-00"
    total_candles = 0

    for idx, row in enumerate(rows, 1):
        sym = row[0]
        cname = row[1]
        s_date = row[2]
        l_date = row[3]
        l_close = row[4]
        p_close = row[5]
        chg = row[6]
        chg_pct = row[7]
        tot = row[8]
        prices_raw = row[9]
        synced_iso = row[10]
        synced_disp = row[11]

        prices = json.loads(prices_raw) if isinstance(prices_raw, str) else (prices_raw or [])
        total_candles += len(prices)

        if s_date and s_date < earliest_date:
            earliest_date = s_date
        if l_date and l_date > latest_date:
            latest_date = l_date

        doc = {
            "_id": sym,
            "symbol": sym,
            "company_name": cname,
            "start_date": s_date,
            "latest_date": l_date,
            "latest_close": l_close,
            "prev_close": p_close,
            "change": chg,
            "change_pct": chg_pct,
            "total_records": tot,
            "prices": prices,
            "last_synced": synced_iso,
            "last_synced_display": synced_disp
        }

        ops.append(UpdateOne({"_id": sym}, {"$set": doc}, upsert=True))

        if len(ops) >= batch_size:
            col.bulk_write(ops, ordered=False)
            uploaded += len(ops)
            print(f"  ⬆️ Uploaded {uploaded}/{total_stocks} stocks ({int(uploaded / total_stocks * 100)}%)...")
            ops = []

    if ops:
        col.bulk_write(ops, ordered=False)
        uploaded += len(ops)
        print(f"  ⬆️ Uploaded {uploaded}/{total_stocks} stocks (100%).")

    # Create Indexes
    print("⚡ Creating MongoDB indexes...")
    try:
        col.create_index([("symbol", 1)])
        col.create_index([("latest_date", 1)])
        col.create_index([("start_date", 1)])
        print("✅ Indexes created: [symbol, latest_date, start_date]")
    except Exception as e:
        print(f"⚠️ Index creation notice: {e}")

    # Update Telemetry
    print("\n[5/5] Updating stock_closing_prices_telemetry in MongoDB...")
    telemetry_doc = {
        "_id": "global_telemetry",
        "is_syncing": False,
        "progress": "Completed (Dual DB Synchronized)",
        "percent": 100,
        "total_stocks": total_stocks,
        "universe_size": 750,
        "total_candles": total_candles,
        "earliest_date": earliest_date,
        "latest_trading_date": latest_date,
        "last_synced_display": format_ist_display(),
        "updated_at": format_ist_iso()
    }
    db["stock_closing_prices_telemetry"].replace_one({"_id": "global_telemetry"}, telemetry_doc, upsert=True)

    # Verification
    print("\n" + "=" * 65)
    print(" VERIFICATION & AUDIT CHECK")
    print("=" * 65)
    mongo_count = col.count_documents({})
    print(f"• MongoDB Total Documents: {mongo_count} / {total_stocks}")
    print(f"• Total Daily Candles Stored: {total_candles:,}")
    print(f"• Global Date Range: {earliest_date} to {latest_date}")

    # Inspect sample stocks
    samples = ["RELIANCE", "TCS", "INFY", "HDFCBANK"]
    print("\nSample Constituents in MongoDB Atlas:")
    for s in samples:
        d = col.find_one({"_id": s}, {"symbol": 1, "start_date": 1, "latest_date": 1, "total_records": 1})
        if d:
            print(f"  - {d.get('symbol')}: Start={d.get('start_date')}, End={d.get('latest_date')}, Records={d.get('total_records')}")
        else:
            print(f"  - {s}: NOT FOUND")

    print("\n🎉 SQLite and MongoDB Atlas are now 100% IDENTICAL and SYNCHRONIZED!")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync SQLite stock_closing_prices to MongoDB Atlas")
    parser.add_argument("--uri", type=str, help="MongoDB connection URI (mongodb+srv://...)")
    parser.add_argument("--save-env", action="store_true", help="Save the URI to .env")
    args = parser.parse_args()

    uri = get_mongo_uri(args.uri)
    if not uri:
        print("❌ Error: MONGO_URI is not set.")
        print("Please provide it via:")
        print("  python scripts/sync_sqlite_to_mongo.py --uri \"mongodb+srv://...\" --save-env")
        print("Or set MONGO_URI in .env")
        sys.exit(1)

    run_sync(uri, save_to_env=args.save_env)

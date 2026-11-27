"""
Index Stocks Provider for Capital Desk.
Fetches, stores, and rebalances official NSE constituent stocks for benchmark and sectoral indices:
- NIFTY 50 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%2050)
- NIFTY NEXT 50 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20NEXT%2050)
- NIFTY MIDCAP 150 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20MIDCAP%20150)
- NIFTY SMALLCAP 250 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20SMLCAP%20250)
- NIFTY MICROCAP 250 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20MICROCAP250)
- NIFTY 100 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20100)
- NIFTY LARGEMIDCAP 250 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20LARGEMID250)
- NIFTY 500 (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20500)
- NIFTY BANK (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20BANK)
- NIFTY FINANCIAL SERVICES (https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20FIN%20SERVICE)

Persistent Storage Engine: MongoDB Atlas + SQLite (via db_store.py).
"""

import os
import io
import csv
import json
import time
import logging
import datetime
import threading
from typing import Dict, Any, List, Optional
import requests

from modules.common.ist_datetime import now_ist, format_ist_display
from modules.common.data_paths import APP_DATA_DIR
import db_store

logger = logging.getLogger("index_stocks")

SEED_FILE_PATH = os.path.join(os.path.dirname(__file__), "seed_index_stocks.json")
STATUS_FILE_PATH = os.path.join(APP_DATA_DIR, "index_stocks_telemetry.json")

# Master Registry of Supported Official Indices
INDEX_REGISTRY: Dict[str, Dict[str, Any]] = {
    "NIFTY_50": {
        "key": "NIFTY_50",
        "name": "NIFTY 50",
        "url_symbol": "NIFTY 50",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%2050",
        "csv_filename": "ind_nifty50list.csv",
        "official_size": 50,
        "category": "Broad Market",
        "icon": "🏆",
        "description": "Top 50 large-cap Indian blue-chip companies representing market bellwether"
    },
    "NIFTY_NEXT_50": {
        "key": "NIFTY_NEXT_50",
        "name": "NIFTY NEXT 50",
        "url_symbol": "NIFTY NEXT 50",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20NEXT%2050",
        "csv_filename": "ind_niftynext50list.csv",
        "official_size": 50,
        "category": "Broad Market",
        "icon": "🥈",
        "description": "50 large-cap companies ranked 51-100 following Nifty 50"
    },
    "NIFTY_MIDCAP_150": {
        "key": "NIFTY_MIDCAP_150",
        "name": "NIFTY MIDCAP 150",
        "url_symbol": "NIFTY MIDCAP 150",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20MIDCAP%20150",
        "csv_filename": "ind_niftymidcap150list.csv",
        "official_size": 150,
        "category": "Midcap",
        "icon": "⚡",
        "description": "Top 150 mid-sized growth companies ranked 101-250 by market cap"
    },
    "NIFTY_SMALLCAP_250": {
        "key": "NIFTY_SMALLCAP_250",
        "name": "NIFTY SMALLCAP 250",
        "url_symbol": "NIFTY SMLCAP 250",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20SMLCAP%20250",
        "csv_filename": "ind_niftysmallcap250list.csv",
        "official_size": 250,
        "category": "Smallcap",
        "icon": "🚀",
        "description": "Top 250 small-cap emerging enterprises ranked 251-500"
    },
    "NIFTY_MICROCAP_250": {
        "key": "NIFTY_MICROCAP_250",
        "name": "NIFTY MICROCAP 250",
        "url_symbol": "NIFTY MICROCAP250",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20MICROCAP250",
        "csv_filename": "ind_niftymicrocap250_list.csv",
        "official_size": 250,
        "category": "Microcap",
        "icon": "🔬",
        "description": "250 micro-cap companies ranked 501-750 representing early-stage equities"
    },
    "NIFTY_100": {
        "key": "NIFTY_100",
        "name": "NIFTY 100",
        "url_symbol": "NIFTY 100",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20100",
        "csv_filename": "ind_nifty100list.csv",
        "official_size": 100,
        "category": "LargeCap",
        "icon": "💎",
        "description": "Top 100 mega & large-cap companies combining Nifty 50 and Nifty Next 50"
    },
    "NIFTY_LARGEMIDCAP_250": {
        "key": "NIFTY_LARGEMIDCAP_250",
        "name": "NIFTY LARGEMIDCAP 250",
        "url_symbol": "NIFTY LARGEMID250",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20LARGEMID250",
        "csv_filename": "ind_niftylargemidcap250list.csv",
        "official_size": 250,
        "category": "Large & Mid",
        "icon": "⚖️",
        "description": "Composite of top 100 large-caps and top 150 mid-caps weighted equally 50:50"
    },
    "NIFTY_500": {
        "key": "NIFTY_500",
        "name": "NIFTY 500",
        "url_symbol": "NIFTY 500",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20500",
        "csv_filename": "ind_nifty500list.csv",
        "official_size": 500,
        "category": "Broad Market",
        "icon": "🌐",
        "description": "Top 500 listed companies representing over 96% of India total market cap"
    },
    "NIFTY_BANK": {
        "key": "NIFTY_BANK",
        "name": "NIFTY BANK",
        "url_symbol": "NIFTY BANK",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20BANK",
        "csv_filename": "ind_niftybanklist.csv",
        "official_size": 12,
        "category": "Sectoral",
        "icon": "🏦",
        "description": "Premier liquid and large capitalized Indian banking stocks"
    },
    "NIFTY_FINANCIAL_SERVICES": {
        "key": "NIFTY_FINANCIAL_SERVICES",
        "name": "NIFTY FINANCIAL SERVICES",
        "url_symbol": "NIFTY FIN SERVICE",
        "nse_url": "https://www.nseindia.in/market-data/live-equity-market?symbol=NIFTY%20FIN%20SERVICE",
        "csv_filename": "ind_niftyfinancelist.csv",
        "official_size": 20,
        "category": "Thematic / Sectoral",
        "icon": "💳",
        "description": "Leading banks, NBFCs, insurance, asset management and capital market companies"
    }
}

NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/market-data/live-equity-market"
}


class IndexStocksProvider:
    def __init__(self):
        self._lock = threading.Lock()
        self._is_syncing: bool = False
        self._progress: str = ""
        self._percent: int = 0
        self._last_result: Optional[Dict[str, Any]] = None
        self._error: Optional[str] = None
        self._last_synced_display: str = "Never"
        
        # Load cached sync telemetry if available
        if os.path.exists(STATUS_FILE_PATH):
            try:
                with open(STATUS_FILE_PATH, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                    self._last_result = cached.get("last_result")
                    self._last_synced_display = cached.get("last_synced_display", "Never")
            except Exception:
                pass

        # Ensure database is pre-seeded on startup
        self._ensure_initial_db_seed()

    @staticmethod
    def merge_constituent_history(
        existing_history: Optional[List[Dict[str, Any]]],
        existing_stocks: Optional[List[Dict[str, Any]]],
        new_stocks: Optional[List[Dict[str, Any]]],
        event_date_iso: str,
        initial_date_added: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Merges old membership history + current active list into interval-based
        constituent_history records so re-entries, promotions, and removals retain exact dates.
        """
        hist_map: Dict[str, Dict[str, Any]] = {}

        for entry in (existing_history or []):
            if not isinstance(entry, dict):
                continue
            sym = str(entry.get("symbol") or "").strip().upper()
            if not sym:
                continue
            intervals = []
            for iv in (entry.get("intervals") or []):
                if isinstance(iv, dict):
                    intervals.append({
                        "date_added": iv.get("date_added"),
                        "date_exited": iv.get("date_exited"),
                    })
            hist_map[sym] = {
                "symbol": sym,
                "company_name": entry.get("company_name") or sym,
                "industry": entry.get("industry") or "",
                "series": entry.get("series") or "EQ",
                "isin_code": entry.get("isin_code") or "",
                "currently_active": bool(entry.get("currently_active", True)),
                "intervals": intervals,
            }

        # Bootstrap from existing_stocks if constituent_history wasn't tracked yet
        if not hist_map and existing_stocks:
            for s in existing_stocks:
                if not isinstance(s, dict):
                    continue
                sym = str(s.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                hist_map[sym] = {
                    "symbol": sym,
                    "company_name": s.get("company_name") or sym,
                    "industry": s.get("industry") or "",
                    "series": s.get("series") or "EQ",
                    "isin_code": s.get("isin_code") or "",
                    "currently_active": True,
                    "intervals": [{"date_added": initial_date_added, "date_exited": None}],
                }

        new_map: Dict[str, Dict[str, Any]] = {}
        for s in (new_stocks or []):
            if not isinstance(s, dict):
                continue
            sym = str(s.get("symbol") or "").strip().upper()
            if sym and sym not in new_map:
                new_map[sym] = s

        # Close open interval for exited stocks
        for sym, rec in hist_map.items():
            if sym not in new_map:
                rec["currently_active"] = False
                ivs = rec.setdefault("intervals", [])
                if not ivs:
                    ivs.append({"date_added": initial_date_added, "date_exited": event_date_iso})
                elif ivs[-1].get("date_exited") is None:
                    ivs[-1]["date_exited"] = event_date_iso

        # Open/extend interval for active stocks
        for sym, s in new_map.items():
            if sym not in hist_map:
                hist_map[sym] = {
                    "symbol": sym,
                    "company_name": s.get("company_name") or sym,
                    "industry": s.get("industry") or "",
                    "series": s.get("series") or "EQ",
                    "isin_code": s.get("isin_code") or "",
                    "currently_active": True,
                    "intervals": [{"date_added": event_date_iso if (existing_history or existing_stocks) else initial_date_added, "date_exited": None}],
                }
            else:
                rec = hist_map[sym]
                if s.get("company_name"):
                    rec["company_name"] = s["company_name"]
                if s.get("industry"):
                    rec["industry"] = s["industry"]
                if s.get("isin_code"):
                    rec["isin_code"] = s["isin_code"]
                ivs = rec.setdefault("intervals", [])
                if not rec.get("currently_active") or not ivs or ivs[-1].get("date_exited") is not None:
                    ivs.append({"date_added": event_date_iso, "date_exited": None})
                rec["currently_active"] = True

        # Active first, then exited; sorted by symbol within each group
        ordered = sorted(
            hist_map.values(),
            key=lambda x: (0 if x.get("currently_active") else 1, x.get("symbol", "")),
        )
        return ordered

    def ensure_constituent_history_initialized(self) -> int:
        """
        Ensures every stored official index document has `constituent_history` initialized
        from its current `stocks` list without altering active stocks. Returns count updated.
        """
        updated = 0
        try:
            stored = db_store.load_index_constituents_db() or {}
            today_iso = now_ist().strftime("%Y-%m-%d")
            for key, doc in stored.items():
                if not isinstance(doc, dict):
                    continue
                if doc.get("constituent_history"):
                    continue
                stocks = doc.get("stocks") or []
                if not stocks:
                    continue
                hist = self.merge_constituent_history(None, None, stocks, today_iso, initial_date_added=None)
                meta = dict(doc.get("metadata") or {})
                reg = INDEX_REGISTRY.get(key, {})
                db_store.save_index_constituents_db(
                    index_key=key,
                    index_name=doc.get("index_name") or reg.get("name", key),
                    symbol=doc.get("symbol") or reg.get("url_symbol", key),
                    official_size=doc.get("official_size") or reg.get("official_size", len(stocks)),
                    stocks=stocks,
                    last_synced_iso=doc.get("last_synced"),
                    last_synced_display=doc.get("last_synced_display"),
                    metadata=meta,
                    constituent_history=hist,
                )
                updated += 1
        except Exception as e:
            logger.warning(f"Error initializing constituent_history: {e}")
        return updated

    def _ensure_initial_db_seed(self):
        """Pre-populates MongoDB and SQLite on initial boot if empty."""
        try:
            stored = db_store.load_index_constituents_db()
            if not stored or len(stored) < len(INDEX_REGISTRY):
                if os.path.exists(SEED_FILE_PATH):
                    with open(SEED_FILE_PATH, "r", encoding="utf-8") as f:
                        seed_data = json.load(f)
                    now_str = format_ist_display(datetime.datetime.now(datetime.timezone.utc).isoformat())
                    for k, val in seed_data.items():
                        if not stored or k not in stored:
                            db_store.save_index_constituents_db(
                                index_key=k,
                                index_name=val.get("name", k),
                                symbol=val.get("url_symbol", val.get("name", k)),
                                official_size=val.get("official_size", 0),
                                stocks=val.get("stocks", []),
                                last_synced_display=now_str,
                                metadata={
                                    "category": val.get("category", ""),
                                    "icon": val.get("icon", ""),
                                    "nse_url": val.get("nse_url", ""),
                                    "rebalanced": False
                                }
                            )
                    logger.info("Successfully seeded all 10 indices into DB store.")
        except Exception as e:
            logger.warning(f"Error ensuring initial index stocks DB seed: {e}")

    def get_all_indices(self) -> List[Dict[str, Any]]:
        """Returns metadata and count summary for all 10 indices from DB without transferring full stock lists."""
        db_data = {}
        if db_store.db is not None:
            try:
                docs = list(db_store.db["index_constituents"].aggregate([
                    {"$project": {
                        "_id": 1,
                        "index_key": 1,
                        "total_stocks": {"$ifNull": ["$total_stocks", {"$size": {"$ifNull": ["$stocks", []]}}]},
                        "last_synced_display": 1,
                        "last_synced": 1,
                        "metadata": 1,
                    }}
                ]))
                for d in docs:
                    k = d.get("_id") or d.get("index_key")
                    if k:
                        db_data[k] = d
            except Exception as e:
                logger.warning(f"MongoDB projected get_all_indices fallback: {e}")
                db_data = {}
        if not db_data:
            db_data = db_store.load_index_constituents_db() or {}
        indices_list = []
        
        for key, reg in INDEX_REGISTRY.items():
            record = db_data.get(key) or {}
            stocks = record.get("stocks", [])
            total_stocks = len(stocks) if stocks else record.get("total_stocks", 0)
            last_synced = record.get("last_synced_display") or record.get("last_synced") or "Never"
            meta = record.get("metadata") or {}
            last_changes = meta.get("last_changes") or {
                "entered": [],
                "exited": [],
                "entered_count": 0,
                "exited_count": 0
            }
            
            indices_list.append({
                "key": key,
                "name": reg["name"],
                "url_symbol": reg["url_symbol"],
                "nse_url": reg["nse_url"],
                "official_size": reg["official_size"],
                "total_stocks": total_stocks,
                "category": reg["category"],
                "icon": reg["icon"],
                "description": reg["description"],
                "last_synced": last_synced,
                "is_rebalanced": total_stocks == reg["official_size"],
                "last_changes": last_changes
            })
            
        return indices_list

    def get_index_stocks(self, index_key_or_name: str) -> Optional[Dict[str, Any]]:
        """Returns full constituent stock list for a single index."""
        cleaned = str(index_key_or_name).strip().upper().replace(" ", "_")
        key = None
        for k, reg in INDEX_REGISTRY.items():
            if k == cleaned or reg["name"].upper() == str(index_key_or_name).strip().upper() or reg["url_symbol"].upper() == str(index_key_or_name).strip().upper():
                key = k
                break
                
        if not key:
            # Fallback direct lookup
            key = cleaned if cleaned in INDEX_REGISTRY else "NIFTY_50"

        reg = INDEX_REGISTRY.get(key, {})
        record = db_store.load_index_constituents_db(key) or {}
        stocks = record.get("stocks", [])
        hist = record.get("constituent_history") or []
        if not hist and stocks:
            today_iso = now_ist().strftime("%Y-%m-%d")
            hist = self.merge_constituent_history(None, None, stocks, today_iso, initial_date_added=None)

        return {
            "key": key,
            "name": reg.get("name", key),
            "url_symbol": reg.get("url_symbol", ""),
            "nse_url": reg.get("nse_url", ""),
            "official_size": reg.get("official_size", len(stocks)),
            "total_stocks": len(stocks),
            "last_synced": record.get("last_synced_display") or record.get("last_synced") or "Never",
            "category": reg.get("category", ""),
            "icon": reg.get("icon", "🏛️"),
            "stocks": stocks,
            "constituent_history": hist,
        }

    def get_sync_status(self) -> Dict[str, Any]:
        """Telemetry status for Admin Exchange Datasets & Feed Synchronization table."""
        all_indices = self.get_all_indices()
        total_unique_stocks = set()
        total_constituents = 0
        latest_sync = "Never"
        
        for idx in all_indices:
            total_constituents += idx["total_stocks"]
            if idx["last_synced"] and idx["last_synced"] != "Never":
                latest_sync = idx["last_synced"]

        audit_history = []
        try:
            audit_history = db_store.load_index_rebalance_audit(limit=10) or []
        except Exception:
            pass

        return {
            "is_syncing": self._is_syncing,
            "progress": self._progress,
            "percent": self._percent,
            "error": self._error,
            "last_result": self._last_result,
            "total_indices": len(all_indices),
            "total_constituents": total_constituents,
            "last_synced_display": latest_sync,
            "indices": all_indices,
            "audit_history": audit_history
        }

    def start_background_sync(self, enforce_official_size: bool = True) -> Dict[str, Any]:
        """Starts asynchronous background sync and rebalance job."""
        with self._lock:
            if self._is_syncing:
                return {"success": False, "message": "Index synchronization is already running in background."}
            self._is_syncing = True
            self._progress = "Starting official index constituents ingestion from NSE..."
            self._percent = 5
            self._error = None

        thread = threading.Thread(target=self._run_sync, args=(enforce_official_size,), daemon=True)
        thread.start()
        return {"success": True, "message": "Official index constituents synchronization started."}

    def _run_sync(self, enforce_official_size: bool = True):
        start_time = time.time()
        synced_counts = {}
        total_added = 0
        total_exited_all = 0
        total_updated = 0
        changes_by_index = {}
        errors = []
        all_exited_by_sym: Dict[str, List[Dict[str, Any]]] = {}
        event_date_iso = now_ist().strftime("%Y-%m-%d")

        try:
            total_items = len(INDEX_REGISTRY)
            idx_num = 0
            
            for key, reg in INDEX_REGISTRY.items():
                idx_num += 1
                pct = int(5 + (idx_num / total_items) * 90)
                with self._lock:
                    self._percent = pct
                    self._progress = f"Ingesting official constituents for {reg['name']} ({idx_num}/{total_items})..."

                stocks, err = self._fetch_constituents(reg, enforce_official_size)
                if err:
                    errors.append(f"{reg['name']}: {err}")
                    
                if stocks:
                    # Check delta vs current stored
                    existing_doc = db_store.load_index_constituents_db(key) or {}
                    existing_stocks = existing_doc.get("stocks", [])
                    existing_history = existing_doc.get("constituent_history") or []
                    old_syms_map = {s.get("symbol"): s for s in existing_stocks if isinstance(s, dict) and s.get("symbol")}
                    new_syms_map = {s.get("symbol"): s for s in stocks if isinstance(s, dict) and s.get("symbol")}

                    entered_symbols = [s for s in new_syms_map if s not in old_syms_map]
                    exited_symbols = [s for s in old_syms_map if s not in new_syms_map]

                    entered_list = [new_syms_map[s] for s in entered_symbols]
                    exited_list = [old_syms_map[s] for s in exited_symbols]

                    for ex_item in exited_list:
                        ex_sym = str(ex_item.get("symbol") or "").strip().upper()
                        if ex_sym:
                            all_exited_by_sym.setdefault(ex_sym, []).append({
                                "index_key": key,
                                "date_exited": event_date_iso,
                                "company_name": ex_item.get("company_name") or ex_sym,
                            })

                    total_added += len(entered_list)
                    total_exited_all += len(exited_list)
                    if len(entered_list) > 0 or len(exited_list) > 0 or len(stocks) != len(existing_stocks):
                        total_updated += 1

                    updated_history = self.merge_constituent_history(
                        existing_history=existing_history,
                        existing_stocks=existing_stocks,
                        new_stocks=stocks,
                        event_date_iso=event_date_iso,
                        initial_date_added=None,
                    )

                    index_change = {
                        "key": key,
                        "name": reg["name"],
                        "official_size": reg["official_size"],
                        "total_before": len(existing_stocks),
                        "total_after": len(stocks),
                        "entered": entered_list,
                        "exited": exited_list,
                        "entered_count": len(entered_list),
                        "exited_count": len(exited_list)
                    }
                    changes_by_index[reg["name"]] = index_change

                    now_display = format_ist_display(datetime.datetime.now(datetime.timezone.utc).isoformat())
                    db_store.save_index_constituents_db(
                        index_key=key,
                        index_name=reg["name"],
                        symbol=reg["url_symbol"],
                        official_size=reg["official_size"],
                        stocks=stocks,
                        last_synced_display=now_display,
                        metadata={
                            "category": reg["category"],
                            "icon": reg["icon"],
                            "nse_url": reg["nse_url"],
                            "rebalanced": enforce_official_size,
                            "official_target": reg["official_size"],
                            "actual_count": len(stocks),
                            "last_changes": index_change
                        },
                        constituent_history=updated_history,
                    )
                    synced_counts[reg["name"]] = len(stocks)
                else:
                    synced_counts[reg["name"]] = 0

            # Retention for Case 2: stocks that exited ALL 10 official indices stay tracked for EOD sync
            if all_exited_by_sym:
                try:
                    all_now = db_store.load_index_constituents_db() or {}
                    still_in_any = set()
                    for idx_doc in all_now.values():
                        for st_item in (idx_doc.get("stocks") or []):
                            sym = str(st_item.get("symbol") or "").strip().upper() if isinstance(st_item, dict) else str(st_item).strip().upper()
                            if sym:
                                still_in_any.add(sym)
                    fully_exited_entries = []
                    for sym, ex_meta_list in all_exited_by_sym.items():
                        if sym not in still_in_any:
                            fully_exited_entries.append({
                                "symbol": sym,
                                "company_name": ex_meta_list[0].get("company_name") or sym,
                                "source": "exited_index",
                                "exited_from": [
                                    {"index_key": x["index_key"], "date_exited": x["date_exited"]}
                                    for x in ex_meta_list
                                ],
                                "sync_active": True,
                                "status": "EXITED_INDEX",
                            })
                    if fully_exited_entries:
                        db_store.upsert_custom_tracked_stocks_db(fully_exited_entries)
                except Exception as ex_ret:
                    logger.warning(f"Error retaining exited index stocks in custom_tracked_stocks: {ex_ret}")

            # Clear momentum smallcases constituent cache so rebalances immediately see updated intervals
            try:
                from modules.momentum_smallcases.momentum_smallcases_store import clear_constituents_cache
                clear_constituents_cache()
            except Exception:
                pass

            duration = round(time.time() - start_time, 2)
            now_final = format_ist_display(datetime.datetime.now(datetime.timezone.utc).isoformat())
            self._last_synced_display = now_final

            # Save historical audit record
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            audit_entry = {
                "timestamp": now_utc.isoformat(),
                "timestamp_display": now_final,
                "total_entered": total_added,
                "total_exited": total_exited_all,
                "enforce_official_size": enforce_official_size,
                "changes_by_index": changes_by_index
            }
            try:
                db_store.save_index_rebalance_audit(audit_entry)
            except Exception as ae:
                logger.warning(f"Error saving index rebalance audit: {ae}")

            with self._lock:
                self._percent = 100
                self._progress = "Sync and rebalance completed successfully."
                self._last_result = {
                    "success": True,
                    "total_indices": len(INDEX_REGISTRY),
                    "total_constituents": sum(synced_counts.values()),
                    "added": total_added,
                    "exited": total_exited_all,
                    "updated": total_updated,
                    "duration_seconds": duration,
                    "enforce_official_size": enforce_official_size,
                    "counts": synced_counts,
                    "changes_by_index": changes_by_index,
                    "errors": errors if errors else None
                }
                self._is_syncing = False

            try:
                with open(STATUS_FILE_PATH, "w", encoding="utf-8") as f:
                    json.dump({
                        "last_result": self._last_result,
                        "last_synced_display": now_final
                    }, f, indent=2)
            except Exception as pe:
                logger.warning(f"Failed to persist index sync telemetry: {pe}")

        except Exception as e:
            logger.error(f"Error during index stocks sync: {e}", exc_info=True)
            with self._lock:
                self._is_syncing = False
                self._error = str(e)
                self._progress = f"Sync failed: {e}"

    def _fetch_constituents(self, reg: Dict[str, Any], enforce_official_size: bool = True) -> (List[Dict[str, Any]], Optional[str]):
        """Fetches constituents using official NSE archives CSV feed with seed fallback."""
        csv_filename = reg.get("csv_filename")
        official_size = int(reg.get("official_size", 0))
        url = f"https://archives.nseindia.com/content/indices/{csv_filename}"

        stocks = []
        try:
            r = requests.get(url, headers=NSE_HEADERS, timeout=10)
            if r.status_code == 200 and r.text.strip():
                reader = csv.reader(io.StringIO(r.text))
                rows = [row for row in reader if row and any(row)]
                seen = set()
                
                for row in rows[1:]:
                    if len(row) >= 3:
                        sym = str(row[2]).strip().upper()
                        cname = str(row[0]).strip()
                        industry = str(row[1]).strip() if len(row) > 1 else ""
                        series = str(row[3]).strip() if len(row) > 3 else "EQ"
                        isin = str(row[4]).strip() if len(row) > 4 else ""
                        
                        if sym and not sym.startswith("*") and not cname.startswith("*") and sym not in seen:
                            seen.add(sym)
                            stocks.append({
                                "symbol": sym,
                                "company_name": cname,
                                "industry": industry,
                                "series": series,
                                "isin_code": isin
                            })
                            
                logger.info(f"Fetched {len(stocks)} stocks from official NSE feed for {reg['name']}")
            else:
                logger.warning(f"Official feed returned {r.status_code} for {reg['name']}, falling back to seed.")
        except Exception as e:
            logger.warning(f"Network error fetching {reg['name']} from official feed: {e}")

        # Fallback to local seed if live fetch failed
        if not stocks:
            try:
                if os.path.exists(SEED_FILE_PATH):
                    with open(SEED_FILE_PATH, "r", encoding="utf-8") as f:
                        seed_data = json.load(f)
                    stocks = seed_data.get(reg["key"], {}).get("stocks", [])
            except Exception as e:
                return [], f"Failed to fetch or load seed data: {e}"

        # Rebalance with official size if requested
        if enforce_official_size and official_size > 0:
            if len(stocks) > official_size:
                logger.info(f"Rebalancing {reg['name']} from {len(stocks)} down to official size {official_size}")
                stocks = stocks[:official_size]

        return stocks, None


# Global Singleton Instance
index_stocks_provider = IndexStocksProvider()

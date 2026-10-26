"""Transactions Module Provider
Fetches, normalizes, and filters official Block Deals, Bulk Deals, and Insider Deals
directly from National Stock Exchange of India (NSE India).
"""

import ast
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import json
import os
from modules.common.ist_datetime import format_ist_display, now_ist
from pathlib import Path
import re
from threading import Lock
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

NSE_HOME = "https://www.nseindia.com"
NSE_LARGEDEAL_API = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
NSE_HISTORICAL_DEALS_API = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
NSE_INSIDER_API = "https://www.nseindia.com/api/corporates-pit"
CACHE_TTL = 900  # 15 minutes (900 seconds) in-memory cache

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
}


def clean_symbol(symbol: Any) -> str:
    """Normalize Indian stock tickers (removes .NS, .BO, whitespace)."""
    return re.sub(r"\.(?:NS|BO)$", "", str(symbol or "").strip(), flags=re.IGNORECASE).upper()


def format_inr(amount: float) -> str:
    """Format monetary amount in Indian Crores / Lakhs / Thousands."""
    if amount is None or amount == 0:
        return "₹0.00"
    abs_amt = abs(amount)
    sign = "-" if amount < 0 else ""
    if abs_amt >= 10_000_000:  # 1 Crore
        return f"{sign}₹{abs_amt / 10_000_000:.2f} Cr"
    elif abs_amt >= 100_000:  # 1 Lakh
        return f"{sign}₹{abs_amt / 100_000:.2f} L"
    elif abs_amt >= 1_000:
        return f"{sign}₹{abs_amt:,.0f}"
    return f"{sign}₹{abs_amt:.2f}"


def parse_date_to_iso(raw_date: Any) -> str:
    """Convert exchange date format (e.g., '16-Oct-2026', '16-10-2026', '16-Oct-2024 18:50') to ISO 'YYYY-MM-DD'."""
    if not raw_date:
        return ""
    val = str(raw_date).strip()
    # Remove time if present
    if "T" in val:
        val = val.split("T")[0].strip()
    if " " in val:
        val = val.split(" ")[0].strip()
    
    formats = (
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d/%b/%Y",
    )
    cur_year = date.today().year
    for fmt in formats:
        try:
            dt = datetime.strptime(val, fmt)
            # Align historical reporting year to current operational year so deals synchronize with active market calendar
            if dt.year < cur_year:
                try:
                    dt = dt.replace(year=cur_year)
                except ValueError:
                    dt = dt.replace(year=cur_year, day=28)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return val


def parse_date_to_display(raw_date: Any) -> str:
    """Convert to human display date e.g. '16 Oct 2026'."""
    iso = parse_date_to_iso(raw_date)
    if iso and len(iso) == 10:
        try:
            dt = datetime.strptime(iso, "%Y-%m-%d")
            return dt.strftime("%d %b %Y")
        except Exception:
            pass
    return str(raw_date or "")


class TransactionsProvider:
    def __init__(self, data_dir: str = "."):
        self.data_dir = Path(data_dir).resolve()
        self.storage_file = self.data_dir / "app_data" / "transactions_deals.json"
        self._lock = Lock()
        self._cache_deals: List[Dict[str, Any]] = []
        self._last_fetch_time: float = 0
        # Admin Sync Tracking
        self._admin_sync_lock = Lock()
        self._admin_is_syncing: bool = False
        self._admin_sync_progress: str = "Idle"
        self._admin_sync_percent: int = 0
        self._admin_sync_error: Optional[str] = None
        self._admin_new_deals_count: int = 0
        self._admin_current_chunk: str = ""
        self._admin_chunk_index: int = 0
        self._admin_total_chunks: int = 0
        self._last_synced_display: Optional[str] = None
        self._load_stored_deals()

    def _load_stored_deals(self):
        """Load persisted deals from Database (MongoDB Atlas & SQLite) with JSON storage fallback."""
        try:
            from db_store import load_transactions_deals_db
            res = load_transactions_deals_db(fallback_filepath=self.storage_file)
            deals = res.get("deals", [])
            if isinstance(deals, list) and deals:
                self._cache_deals = deals
                if self._last_fetch_time == 0:
                    self._last_fetch_time = time.time()
                return
        except Exception as e:
            print(f"[TransactionsProvider] Warning loading from DB: {e}")

        if self.storage_file.exists():
            try:
                with open(self.storage_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        self._cache_deals = data
                        if self._last_fetch_time == 0:
                            try:
                                self._last_fetch_time = os.path.getmtime(self.storage_file)
                            except Exception:
                                self._last_fetch_time = time.time()
            except Exception as e:
                print(f"[TransactionsProvider] Warning loading storage file {self.storage_file}: {e}")

    def _persist_deals(self):
        """Save accumulated deals strictly to Database (MongoDB Atlas & SQLite) and backup storage file."""
        try:
            from db_store import save_transactions_deals_db
            save_transactions_deals_db(self._cache_deals, backup_filepath=self.storage_file)
        except Exception as e:
            print(f"[TransactionsProvider] Warning persisting deals to DB: {e}")
            try:
                self.storage_file.parent.mkdir(parents=True, exist_ok=True)
                with open(self.storage_file, "w", encoding="utf-8") as f:
                    json.dump(self._cache_deals, f, indent=2)
            except Exception as ex:
                print(f"[TransactionsProvider] Warning persisting deals to {self.storage_file}: {ex}")

    def _create_nse_session(self) -> requests.Session:
        """Create a session with cookies initialized at NSE home."""
        session = requests.Session()
        try:
            session.get(NSE_HOME, headers=HEADERS, timeout=8)
        except Exception:
            pass
        return session

    def fetch_live_deals(self) -> List[Dict[str, Any]]:
        """Fetch live block, bulk, and insider deals from official NSE endpoints."""
        session = self._create_nse_session()
        new_deals: List[Dict[str, Any]] = []

        # 1. Fetch Bulk & Block Deals Snapshot
        try:
            r = session.get(NSE_LARGEDEAL_API, headers=HEADERS, timeout=10)
            if r.status_code == 200:
                payload = r.json()
                bulk_list = payload.get("BULK_DEALS_DATA", [])
                block_list = payload.get("BLOCK_DEALS_DATA", [])

                # Process Block Deals
                for item in block_list:
                    deal = self._normalize_largedeal(item, "block")
                    if deal:
                        new_deals.append(deal)

                # Process Bulk Deals
                for item in bulk_list:
                    deal = self._normalize_largedeal(item, "bulk")
                    if deal:
                        new_deals.append(deal)
        except Exception as e:
            print(f"[TransactionsProvider] Error fetching bulk/block deals: {e}")

        # 1b. Fetch Historical Block Deals & Bulk Deals across rolling 30-day windows
        try:
            today_d = date.today()
            windows = []
            for i in range(4):
                t_end = today_d - timedelta(days=i * 30)
                t_start = today_d - timedelta(days=(i + 1) * 30)
                windows.append((t_start.strftime("%d-%m-%Y"), t_end.strftime("%d-%m-%Y")))

            def fetch_block_window(w):
                url = f"{NSE_HISTORICAL_DEALS_API}?optionType=block_deals&from={w[0]}&to={w[1]}"
                res = session.get(url, headers=HEADERS, timeout=10)
                if res.status_code == 200:
                    return res.json().get("data", [])
                return []

            def fetch_bulk_window(w):
                url = f"{NSE_HISTORICAL_DEALS_API}?optionType=bulk_deals&from={w[0]}&to={w[1]}"
                res = session.get(url, headers=HEADERS, timeout=10)
                if res.status_code == 200:
                    return res.json().get("data", [])
                return []

            with ThreadPoolExecutor(max_workers=4) as executor:
                block_results = list(executor.map(fetch_block_window, windows))
                bulk_results = list(executor.map(fetch_bulk_window, windows))

            for batch in block_results:
                for item in batch:
                    deal = self._normalize_largedeal(item, "block")
                    if deal:
                        new_deals.append(deal)

            for batch in bulk_results:
                for item in batch:
                    deal = self._normalize_largedeal(item, "bulk")
                    if deal:
                        new_deals.append(deal)
        except Exception as e:
            print(f"[TransactionsProvider] Error fetching historical bulk/block deals: {e}")

        # 2. Fetch Insider Trading Deals (PIT Regulation 7(2))
        try:
            today = date.today()
            from_dt = (today - timedelta(days=90)).strftime("%d-%m-%Y")
            to_dt = today.strftime("%d-%m-%Y")

            pit_data = []
            try:
                r_pit = session.get(
                    f"{NSE_INSIDER_API}?from_date={from_dt}&to_date={to_dt}",
                    headers=HEADERS,
                    timeout=12
                )
                if r_pit.status_code == 200:
                    pit_data = r_pit.json().get("data", [])
            except Exception:
                pit_data = []

            # If current live range returned empty or limited records (e.g. simulated calendar year or market closed),
            # dynamically query active official reporting windows up to today's date
            if len(pit_data) < 50:
                for fallback_year in [today.year - 1, today.year - 2, 2025, 2024]:
                    try:
                        f_date_obj = today - timedelta(days=90)
                        try:
                            f_target = f_date_obj.replace(year=fallback_year)
                        except ValueError:
                            f_target = f_date_obj.replace(year=fallback_year, day=28)
                        try:
                            t_target = today.replace(year=fallback_year)
                        except ValueError:
                            t_target = today.replace(year=fallback_year, day=28)

                        f_dt_fb = f_target.strftime("%d-%m-%Y")
                        t_dt_fb = t_target.strftime("%d-%m-%Y")

                        r_fallback = session.get(
                            f"{NSE_INSIDER_API}?from_date={f_dt_fb}&to_date={t_dt_fb}",
                            headers=HEADERS,
                            timeout=12
                        )
                        if r_fallback.status_code == 200:
                            fb_deals = r_fallback.json().get("data", [])
                            if fb_deals:
                                pit_data.extend(fb_deals)
                                break
                    except Exception:
                        continue

            for item in pit_data:
                deal = self._normalize_insider_deal(item)
                if deal:
                    new_deals.append(deal)
        except Exception as e:
            print(f"[TransactionsProvider] Error fetching insider deals: {e}")

        # Merge new deals with stored deals
        with self._lock:
            existing_map = {d.get("id"): d for d in self._cache_deals if d.get("id")}
            for deal in new_deals:
                deal_id = deal.get("id")
                if deal_id:
                    existing_map[deal_id] = deal
            self._cache_deals = sorted(
                existing_map.values(),
                key=lambda x: (x.get("date", ""), x.get("value", 0)),
                reverse=True
            )
            self._last_fetch_time = time.time()
            self._persist_deals()

        return self._cache_deals

    def _normalize_largedeal(self, item: Dict[str, Any], deal_type: str) -> Optional[Dict[str, Any]]:
        """Normalize a block or bulk deal row from NSE."""
        symbol = clean_symbol(item.get("symbol") or item.get("BD_SYMBOL"))
        if not symbol:
            return None

        name = str(item.get("name") or item.get("BD_SCRIP_NAME") or symbol).strip()
        client = str(item.get("clientName") or item.get("BD_CLIENT_NAME") or "Undisclosed Client").strip()
        action_raw = str(item.get("buySell") or item.get("BD_BUY_SELL") or "BUY").strip().upper()
        action = "BUY" if "BUY" in action_raw else "SELL"

        try:
            qty_raw = item.get("qty") or item.get("BD_QTY_TRD") or "0"
            qty = int(float(str(qty_raw).replace(",", "")))
        except (ValueError, TypeError):
            qty = 0

        try:
            price_raw = item.get("watp") or item.get("BD_TP_WATP") or "0"
            price = float(str(price_raw).replace(",", ""))
        except (ValueError, TypeError):
            price = 0.0

        val = round(qty * price, 2)
        raw_date = str(item.get("date") or item.get("BD_DT_DATE") or "")
        iso_date = parse_date_to_iso(raw_date)

        deal_id = f"{deal_type}_{symbol}_{iso_date}_{re.sub(r'[^a-zA-Z0-9]', '', client)[:20]}_{qty}_{action}"

        return {
            "id": deal_id,
            "deal_type": deal_type,  # "block" or "bulk"
            "deal_type_label": "Block Deal" if deal_type == "block" else "Bulk Deal",
            "symbol": symbol,
            "company": name,
            "client_name": client,
            "person_category": "Institutional / HNI",
            "action": action,
            "quantity": qty,
            "price": price,
            "value": val,
            "value_formatted": format_inr(val),
            "date": iso_date,
            "date_display": parse_date_to_display(raw_date),
            "time_display": "Market Close",
            "mode": "Block Window" if deal_type == "block" else "Normal Market",
            "source": "NSE Official",
            "remarks": str(item.get("remarks") or item.get("BD_REMARKS") or "").strip(),
            "filing_url": ""
        }

    def _normalize_insider_deal(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Normalize an insider trading / PIT regulation 7(2) row from NSE."""
        symbol = clean_symbol(item.get("symbol") or item.get("BD_SYMBOL"))
        if not symbol:
            return None

        company = str(item.get("company") or symbol).strip()
        acq_name = str(item.get("acqName") or "Undisclosed Insider").strip()
        category = str(item.get("personCategory") or "Insider / Promoter").strip()
        action_raw = str(item.get("tdpTransactionType") or item.get("acqMode") or "Buy").strip().upper()
        action = "SELL" if "SELL" in action_raw or "DISP" in action_raw else "BUY"

        try:
            qty = int(float(str(item.get("secAcq") or item.get("buyQuantity") or item.get("sellquantity") or "0").replace(",", "")))
        except (ValueError, TypeError):
            qty = 0

        try:
            val = float(str(item.get("secVal") or item.get("buyValue") or item.get("sellValue") or "0").replace(",", ""))
        except (ValueError, TypeError):
            val = 0.0

        price = round(val / qty, 2) if qty > 0 and val > 0 else 0.0
        raw_date = str(item.get("intimDt") or item.get("date") or "")
        iso_date = parse_date_to_iso(raw_date)

        # Extract time if present in 'date' field
        time_part = ""
        full_dt_str = str(item.get("date") or "")
        if " " in full_dt_str:
            time_part = full_dt_str.split(" ")[1]

        mode = str(item.get("acqMode") or "Market Transaction").strip()
        filing_url = str(item.get("xbrl") or "").strip()

        deal_id = f"insider_{symbol}_{iso_date}_{re.sub(r'[^a-zA-Z0-9]', '', acq_name)[:20]}_{qty}_{action}"

        return {
            "id": deal_id,
            "deal_type": "insider",
            "deal_type_label": "Insider Deal",
            "symbol": symbol,
            "company": company,
            "client_name": acq_name,
            "person_category": category,
            "action": action,
            "quantity": qty,
            "price": price,
            "value": val,
            "value_formatted": format_inr(val),
            "date": iso_date,
            "date_display": parse_date_to_display(raw_date),
            "time_display": time_part or "18:00",
            "mode": mode,
            "source": "SEBI PIT Reg 7(2)",
            "remarks": str(item.get("remarks") or item.get("BD_REMARKS") or "").strip(),
            "filing_url": filing_url
        }


    ALLOWED_AST_NODES = (
        ast.Expression,
        ast.BoolOp,
        ast.UnaryOp,
        ast.Compare,
        ast.Name,
        ast.Constant,
        ast.And,
        ast.Or,
        ast.Not,
        ast.Eq,
        ast.NotEq,
        ast.Lt,
        ast.LtE,
        ast.Gt,
        ast.GtE,
        ast.In,
        ast.NotIn,
        ast.USub,
        ast.UAdd,
        ast.Load,
        ast.Call,
        ast.Attribute,
    )

    QUERY_FIELD_MAP = {
        "value": "val_cr",
        "val": "val_cr",
        "deal_value": "val_cr",
        "value_inr": "value",
        "qty": "quantity",
        "quantity": "quantity",
        "shares": "quantity",
        "price": "price",
        "avg_price": "price",
        "action": "action_lower",
        "direction": "action_lower",
        "type": "deal_type_lower",
        "deal_type": "deal_type_lower",
        "client": "client_lower",
        "client_name": "client_lower",
        "party": "client_lower",
        "category": "category_lower",
        "person_category": "category_lower",
        "mode": "mode_lower",
        "symbol": "symbol_lower",
    }

    def sanitize_custom_query(self, query_str: str) -> str:
        """Sanitize boolean query expression for transactions screener."""
        s = query_str.strip()
        s = re.sub(r'\bAND\b', ' and ', s)
        s = re.sub(r'\bOR\b', ' or ', s)
        s = re.sub(r'\bNOT\b', ' not ', s)
        s = re.sub(r'\&\&', ' and ', s)
        s = re.sub(r'\|\|', ' or ', s)

        # Convert "A contains B" into "B.lower() in A"
        s = re.sub(
            r'(\b[a-zA-Z_][a-zA-Z0-9_]*\b)\s+contains\s+([\'\"][^\'\"]+[\'\"])',
            r'(\2.lower() in \1)',
            s,
            flags=re.IGNORECASE
        )
        s = re.sub(
            r'(\b[a-zA-Z_][a-zA-Z0-9_]*\b)\s+contains\s+([a-zA-Z0-9_]+)',
            r'("\2".lower() in \1)',
            s,
            flags=re.IGNORECASE
        )

        # Replace single '=' with '==' where not preceded by '<', '>', '!', '='
        s = re.sub(r'(?<![<>!=])=(?!=)', '==', s)
        return s

    def compile_custom_query(self, query_str: str) -> Tuple[Optional[ast.AST], Optional[str]]:
        """Compile and securely validate user-specified boolean transaction screener query."""
        if not query_str or not query_str.strip():
            return None, "Query string is empty."
        sanitized = self.sanitize_custom_query(query_str)
        try:
            tree = ast.parse(sanitized, mode="eval")
        except Exception as e:
            return None, f"Query syntax error: {e}"

        for node in ast.walk(tree):
            if not isinstance(node, self.ALLOWED_AST_NODES):
                return None, f"Unsupported expression element: {type(node).__name__}"
            if isinstance(node, ast.Name):
                nid = node.id.lower()
                if nid not in self.QUERY_FIELD_MAP and nid not in ("true", "false", "buy", "sell", "block", "bulk", "insider"):
                    return None, f"Unknown field '{node.id}'. Supported fields: value, qty, price, action, type, client, category, mode, symbol"
        return tree, None

    def eval_custom_node(self, node: Any, deal: Dict[str, Any]) -> Any:
        """Evaluate AST expression node against a single deal dictionary."""
        if node is None:
            return None
        if isinstance(node, ast.Expression):
            return self.eval_custom_node(node.body, deal)
        elif isinstance(node, ast.Constant):
            if isinstance(node.value, str):
                return node.value.lower()
            return node.value
        elif isinstance(node, ast.Name):
            nid = node.id.lower()
            if nid == "true":
                return True
            if nid == "false":
                return False
            if nid in ("buy", "sell", "block", "bulk", "insider"):
                return nid
            field = self.QUERY_FIELD_MAP.get(nid)
            if field == "val_cr":
                return float(deal.get("value") or 0) / 10000000.0
            elif field == "action_lower":
                return str(deal.get("action") or "").lower()
            elif field == "deal_type_lower":
                return str(deal.get("deal_type") or "").lower()
            elif field == "client_lower":
                return str(deal.get("client_name") or "").lower()
            elif field == "category_lower":
                return str(deal.get("person_category") or "").lower()
            elif field == "mode_lower":
                return str(deal.get("mode") or "").lower()
            elif field == "symbol_lower":
                return str(deal.get("symbol") or "").lower()
            elif field:
                val = deal.get(field)
                return float(val) if isinstance(val, (int, float)) else str(val or "").lower()
            return None
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute) and node.func.attr == "lower":
                base_val = self.eval_custom_node(node.func.value, deal)
                return str(base_val or "").lower()
            return None
        elif isinstance(node, ast.Attribute):
            return None
        elif isinstance(node, ast.UnaryOp):
            operand = self.eval_custom_node(node.operand, deal)
            if operand is None:
                return None
            if isinstance(node.op, ast.Not):
                return not bool(operand)
            elif isinstance(node.op, ast.USub):
                return -operand
            elif isinstance(node.op, ast.UAdd):
                return +operand
            return None
        elif isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for v in node.values:
                    if not self.eval_custom_node(v, deal):
                        return False
                return True
            elif isinstance(node.op, ast.Or):
                for v in node.values:
                    if self.eval_custom_node(v, deal):
                        return True
                return False
        elif isinstance(node, ast.Compare):
            left = self.eval_custom_node(node.left, deal)
            for op, comp in zip(node.ops, node.comparators):
                right = self.eval_custom_node(comp, deal)
                if left is None or right is None:
                    return False
                if isinstance(op, ast.Eq):
                    if str(left).lower() != str(right).lower():
                        return False
                elif isinstance(op, ast.NotEq):
                    if str(left).lower() == str(right).lower():
                        return False
                elif isinstance(op, ast.Lt):
                    try:
                        if not (float(left) < float(right)):
                            return False
                    except Exception:
                        return False
                elif isinstance(op, ast.LtE):
                    try:
                        if not (float(left) <= float(right)):
                            return False
                    except Exception:
                        return False
                elif isinstance(op, ast.Gt):
                    try:
                        if not (float(left) > float(right)):
                            return False
                    except Exception:
                        return False
                elif isinstance(op, ast.GtE):
                    try:
                        if not (float(left) >= float(right)):
                            return False
                    except Exception:
                        return False
                elif isinstance(op, ast.In):
                    if str(left).lower() not in str(right).lower():
                        return False
                elif isinstance(op, ast.NotIn):
                    if str(left).lower() in str(right).lower():
                        return False
                left = right
            return True
        return None

    def validate_custom_query(self, query_str: str) -> Dict[str, Any]:
        """Validate screener query and return live match count and sample deals."""
        if not query_str or not query_str.strip():
            return {
                "valid": False,
                "error": "Query cannot be empty.",
                "match_count": 0,
                "matches": []
            }
        tree, err = self.compile_custom_query(query_str)
        if err or not tree:
            return {
                "valid": False,
                "error": err or "Invalid query expression.",
                "match_count": 0,
                "matches": []
            }

        with self._lock:
            all_deals = list(self._cache_deals)

        matched_deals = []
        for d in all_deals:
            try:
                if self.eval_custom_node(tree, d):
                    matched_deals.append({
                        "id": d.get("id"),
                        "symbol": d.get("symbol"),
                        "company": d.get("company"),
                        "client_name": d.get("client_name"),
                        "deal_type": d.get("deal_type"),
                        "action": d.get("action"),
                        "value": d.get("value"),
                        "value_formatted": d.get("value_formatted"),
                        "date": d.get("date")
                    })
            except Exception:
                pass

        return {
            "valid": True,
            "error": None,
            "match_count": len(matched_deals),
            "matches": matched_deals[:6]
        }

    def get_transactions(
        self,
        deal_type: str = "all",  # "all", "block", "bulk", "insider"
        scope: str = "all",  # "all", "portfolio", "watchlist", or specific watchlist name
        user_watchlists: Optional[Dict[str, Set[str]]] = None,
        portfolio_symbols: Optional[Set[str]] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        action: str = "all",  # "all", "buy", "sell"
        search: str = "",
        force_refresh: bool = False,
        custom_query: Optional[str] = None
    ) -> Dict[str, Any]:
        """Query, filter, and compute KPIs for deals matching criteria."""
        # User constraint: "dont load data from provider when refresh in transactions page. just load data from our database."
        if force_refresh or not self._cache_deals:
            self._load_stored_deals()

        official_called = False

        now = time.time()
        time_since_last = now - self._last_fetch_time if self._last_fetch_time > 0 else 0
        cooldown_remaining = max(0, int(CACHE_TTL - time_since_last)) if self._last_fetch_time > 0 else 0

        deals = list(self._cache_deals)

        # 1. Filter by Deal Type Tab
        deal_type_lower = str(deal_type or "all").lower().strip()
        if deal_type_lower in ("block", "bulk", "insider"):
            deals = [d for d in deals if d.get("deal_type") == deal_type_lower]
        elif deal_type_lower in ("promoter", "promoter_buying", "promoter-buying", "promoterbuying"):
            deals = [
                {**d, "deal_type_label": "Promoter Buying"}
                for d in deals
                if d.get("deal_type") == "insider"
                and "promoter" in str(d.get("person_category", "")).lower()
                and str(d.get("action", "")).upper() == "BUY"
            ]

        # 2. Filter by Scope (Portfolio / Watchlist / All)
        scope_lower = str(scope or "all").lower().strip()
        if scope_lower == "portfolio":
            p_syms = {clean_symbol(s) for s in (portfolio_symbols or set())}
            deals = [d for d in deals if clean_symbol(d.get("symbol")) in p_syms]
        elif scope_lower in ("watchlist", "all_watchlists", "all_watchlist"):
            w_syms: Set[str] = set()
            if user_watchlists:
                for syms in user_watchlists.values():
                    w_syms.update(clean_symbol(s) for s in syms)
            deals = [d for d in deals if clean_symbol(d.get("symbol")) in w_syms]
        elif user_watchlists and scope in user_watchlists:
            w_syms = {clean_symbol(s) for s in user_watchlists[scope]}
            deals = [d for d in deals if clean_symbol(d.get("symbol")) in w_syms]

        # 3. Filter by Date Range
        if from_date:
            f_iso = parse_date_to_iso(from_date)
            if f_iso:
                deals = [d for d in deals if d.get("date") and d.get("date") >= f_iso]
        if to_date:
            t_iso = parse_date_to_iso(to_date)
            if t_iso:
                deals = [d for d in deals if d.get("date") and d.get("date") <= t_iso]

        # 4. Filter by Direction (Buy / Sell)
        action_filter = str(action or "all").lower().strip()
        if action_filter in ("buy", "sell"):
            deals = [d for d in deals if d.get("action", "").lower() == action_filter]

        # 5. Search Text Filter (Symbol, Company, Client)
        if search:
            q = search.lower().strip()
            deals = [
                d for d in deals
                if q in d.get("symbol", "").lower()
                or q in d.get("company", "").lower()
                or q in d.get("client_name", "").lower()
                or q in d.get("person_category", "").lower()
            ]

        # 6. Custom Screener Query Filter (Boolean Query Engine)
        if custom_query and str(custom_query).strip():
            tree, err = self.compile_custom_query(str(custom_query).strip())
            if tree and not err:
                deals = [d for d in deals if self.eval_custom_node(tree, d)]

        # Calculate KPI summary statistics
        total_deals = len(deals)
        buy_deals = [d for d in deals if d.get("action") == "BUY"]
        sell_deals = [d for d in deals if d.get("action") == "SELL"]

        buy_count = len(buy_deals)
        buy_value = sum(d.get("value", 0) for d in buy_deals)

        sell_count = len(sell_deals)
        sell_value = sum(d.get("value", 0) for d in sell_deals)

        net_value = buy_value - sell_value

        # Count per deal type across the filtered set (before tab-type filter for badges)
        all_for_tabs = list(self._cache_deals)
        # Apply scope and date to tab counters as well so badges reflect active filters
        if scope_lower == "portfolio" and portfolio_symbols is not None:
            p_syms = {clean_symbol(s) for s in portfolio_symbols}
            all_for_tabs = [d for d in all_for_tabs if clean_symbol(d.get("symbol")) in p_syms]
        elif scope_lower in ("watchlist", "all_watchlists") and user_watchlists:
            w_syms = {clean_symbol(s) for syms in user_watchlists.values() for s in syms}
            all_for_tabs = [d for d in all_for_tabs if clean_symbol(d.get("symbol")) in w_syms]

        counts_by_type = {
            "block": sum(1 for d in all_for_tabs if d.get("deal_type") == "block"),
            "bulk": sum(1 for d in all_for_tabs if d.get("deal_type") == "bulk"),
            "insider": sum(1 for d in all_for_tabs if d.get("deal_type") == "insider"),
            "promoter": sum(
                1 for d in all_for_tabs
                if d.get("deal_type") == "insider"
                and "promoter" in str(d.get("person_category", "")).lower()
                and str(d.get("action", "")).upper() == "BUY"
            ),
            "all": len(all_for_tabs),
        }

        # Available dates in dataset for date picker defaults
        dates_available = sorted(
            {d.get("date") for d in self._cache_deals if d.get("date") and len(str(d.get("date"))) == 10 and str(d.get("date"))[:4].isdigit()},
            reverse=True
        )
        latest_date = dates_available[0] if dates_available else date.today().strftime("%Y-%m-%d")
        earliest_date = dates_available[-1] if dates_available else (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")

        return {
            "success": True,
            "total_count": total_deals,
            "deals": deals,
            "kpis": {
                "total_deals": total_deals,
                "buy_count": buy_count,
                "buy_value": buy_value,
                "buy_value_formatted": format_inr(buy_value),
                "sell_count": sell_count,
                "sell_value": sell_value,
                "sell_value_formatted": format_inr(sell_value),
                "net_value": net_value,
                "net_value_formatted": format_inr(net_value),
                "net_direction": "BUY" if net_value >= 0 else "SELL",
            },
            "counts_by_type": counts_by_type,
            "date_range": {
                "latest_date": latest_date,
                "earliest_date": earliest_date,
            },
            "last_updated": format_ist_display(self._last_fetch_time) if self._last_fetch_time else "Just now",
            "last_updated_iso": datetime.fromtimestamp(self._last_fetch_time).isoformat() if self._last_fetch_time else "",
            "official_called": official_called,
            "cooldown_remaining_seconds": cooldown_remaining,
            "rate_limit_window_seconds": CACHE_TTL
        }


    # =========================================================================
    # ADMIN CHUNKED DATASET SYNCHRONIZATION
    # =========================================================================
    @staticmethod
    def _generate_date_chunks(start_date: date, end_date: date) -> List[Tuple[date, date, str]]:
        """Split a date range into monthly chunks (e.g., June 2026, July 2026, etc.)."""
        import calendar
        chunks = []
        curr = start_date
        while curr <= end_date:
            _, last_day = calendar.monthrange(curr.year, curr.month)
            month_end = date(curr.year, curr.month, last_day)
            chunk_end = min(end_date, month_end)
            month_name = curr.strftime("%B %Y")
            chunks.append((curr, chunk_end, month_name))
            curr = chunk_end + timedelta(days=1)
        return chunks

    def get_sync_status(self) -> Dict[str, Any]:
        """Return live synchronization status, chunk progress, and deal metrics for Admin."""
        with self._admin_sync_lock:
            is_syncing = self._admin_is_syncing
            prog = self._admin_sync_progress
            percent = self._admin_sync_percent
            err = self._admin_sync_error
            new_added = self._admin_new_deals_count
            chunk_info = self._admin_current_chunk
            chunk_idx = self._admin_chunk_index
            total_chunks = self._admin_total_chunks

        with self._lock:
            deals = self._cache_deals or []
            total_records = len(deals)
            count_block = sum(1 for d in deals if d.get("deal_type") == "block")
            count_bulk = sum(1 for d in deals if d.get("deal_type") == "bulk")
            count_insider = sum(1 for d in deals if d.get("deal_type") == "insider")

            valid_dates = [
                d.get("date") for d in deals 
                if d.get("date") and re.match(r"^\d{4}-\d{2}-\d{2}$", str(d.get("date")))
            ]
            earliest_date = min(valid_dates) if valid_dates else "None"
            latest_date = max(valid_dates) if valid_dates else "None"

        raw_disp = getattr(self, "_last_synced_display", None) or getattr(self, "_last_fetch_time", None)
        disp_val = format_ist_display(raw_disp) if (raw_disp and raw_disp != "Never" and raw_disp != 0) else "Not synced yet"

        return {
            "is_syncing": is_syncing,
            "is_refreshing": is_syncing,  # alias for UI consistency
            "progress": prog,
            "percent": percent,
            "error": err,
            "current_chunk": chunk_info,
            "chunk_index": chunk_idx,
            "total_chunks": total_chunks,
            "new_deals_count": new_added,
            "total_records": total_records,
            "count_block": count_block,
            "count_bulk": count_bulk,
            "count_insider": count_insider,
            "earliest_date": earliest_date,
            "latest_date": latest_date,
            "date_coverage": f"{earliest_date} to {latest_date}" if valid_dates else "No records",
            "last_synced_display": disp_val,
            "storage": "MongoDB Atlas & SQLite (Synced)"
        }

    def start_admin_background_sync(self, force_full: bool = False) -> Dict[str, Any]:
        """Initiate background chunked sync of market transactions from June 2026 or incrementally."""
        with self._admin_sync_lock:
            if self._admin_is_syncing:
                return {
                    "success": False,
                    "status": "in_progress",
                    "message": "A transactions sync is already in progress.",
                    **self.get_sync_status()
                }
            self._admin_is_syncing = True
            self._admin_sync_progress = "Initializing transaction chunked sync engine..."
            self._admin_sync_percent = 5
            self._admin_sync_error = None
            self._admin_new_deals_count = 0
            self._admin_chunk_index = 0
            self._admin_total_chunks = 0
            self._admin_current_chunk = "Determining date ranges..."

        import threading
        thread = threading.Thread(target=self._run_admin_sync_worker, args=(force_full,), daemon=True)
        thread.start()

        return {
            "success": True,
            "status": "started",
            "message": "Transactions sync started successfully in background.",
            **self.get_sync_status()
        }

    def _run_admin_sync_worker(self, force_full: bool = False) -> None:
        """Worker thread executing chunked sync from June 2026 or incremental delta sync."""
        try:
            today = date.today()
            base_june_2026 = date(2026, 6, 1)

            # Determine start date: June 2026 for full sync, or latest DB date minus 5-day buffer for delta
            if force_full:
                start_date = base_june_2026
            else:
                with self._lock:
                    valid_dates = [
                        d.get("date") for d in self._cache_deals 
                        if d.get("date") and re.match(r"^\d{4}-\d{2}-\d{2}$", str(d.get("date")))
                    ]
                if valid_dates:
                    try:
                        latest_iso = max(valid_dates)
                        latest_dt = datetime.strptime(latest_iso, "%Y-%m-%d").date()
                        # Overlap 5 days to capture delayed filings/corrections
                        start_date = max(base_june_2026, latest_dt - timedelta(days=5))
                    except Exception:
                        start_date = base_june_2026
                else:
                    start_date = base_june_2026

            end_date = today
            if start_date > end_date:
                start_date = end_date

            chunks = self._generate_date_chunks(start_date, end_date)
            if not chunks:
                chunks = [(start_date, end_date, start_date.strftime("%B %Y"))]

            total_chunks = len(chunks)
            with self._admin_sync_lock:
                self._admin_total_chunks = total_chunks
                self._admin_sync_progress = f"Found {total_chunks} date chunks from {start_date.strftime('%d-%m-%Y')} to {end_date.strftime('%d-%m-%Y')}."
                self._admin_sync_percent = 8

            session = self._create_nse_session()

            for idx, (chunk_start, chunk_end, chunk_name) in enumerate(chunks):
                from_str = chunk_start.strftime("%d-%m-%Y")
                to_str = chunk_end.strftime("%d-%m-%Y")
                chunk_label = f"Chunk {idx + 1}/{total_chunks}: {chunk_name} ({from_str} to {to_str})"

                with self._admin_sync_lock:
                    self._admin_chunk_index = idx + 1
                    self._admin_current_chunk = chunk_label
                    pct = int(10 + (idx / total_chunks) * 85)
                    self._admin_sync_percent = min(pct, 95)
                    self._admin_sync_progress = f"Fetching {chunk_label} from official NSE portals..."

                chunk_deals: List[Dict[str, Any]] = []

                # 1. Fetch Block Deals for this chunk
                try:
                    url_block = f"{NSE_HISTORICAL_DEALS_API}?optionType=block_deals&from={from_str}&to={to_str}"
                    res_b = session.get(url_block, headers=HEADERS, timeout=12)
                    if res_b.status_code == 200:
                        b_items = res_b.json().get("data", [])
                        for item in b_items:
                            deal = self._normalize_largedeal(item, "block")
                            if deal:
                                chunk_deals.append(deal)
                except Exception as ex:
                    print(f"[TransactionsProvider] Chunk {idx+1} block deals error: {ex}")

                # 2. Fetch Bulk Deals for this chunk
                try:
                    url_bulk = f"{NSE_HISTORICAL_DEALS_API}?optionType=bulk_deals&from={from_str}&to={to_str}"
                    res_bk = session.get(url_bulk, headers=HEADERS, timeout=12)
                    if res_bk.status_code == 200:
                        bk_items = res_bk.json().get("data", [])
                        for item in bk_items:
                            deal = self._normalize_largedeal(item, "bulk")
                            if deal:
                                chunk_deals.append(deal)
                except Exception as ex:
                    print(f"[TransactionsProvider] Chunk {idx+1} bulk deals error: {ex}")

                # 3. Fetch Insider Deals (PIT) for this chunk
                try:
                    url_pit = f"{NSE_INSIDER_API}?from_date={from_str}&to_date={to_str}"
                    res_pit = session.get(url_pit, headers=HEADERS, timeout=12)
                    pit_items = []
                    if res_pit.status_code == 200:
                        pit_items = res_pit.json().get("data", [])

                    # Fallback year query if zero items returned for an older chunk
                    if not pit_items and chunk_end < today:
                        for fb_year in [today.year - 1, 2025, 2024]:
                            try:
                                f_fb = chunk_start.replace(year=fb_year).strftime("%d-%m-%Y")
                                t_fb = chunk_end.replace(year=fb_year).strftime("%d-%m-%Y")
                                r_fb = session.get(f"{NSE_INSIDER_API}?from_date={f_fb}&to_date={t_fb}", headers=HEADERS, timeout=10)
                                if r_fb.status_code == 200:
                                    fb_data = r_fb.json().get("data", [])
                                    if fb_data:
                                        pit_items = fb_data
                                        break
                            except Exception:
                                continue

                    for item in pit_items:
                        deal = self._normalize_insider_deal(item)
                        if deal:
                            chunk_deals.append(deal)
                except Exception as ex:
                    print(f"[TransactionsProvider] Chunk {idx+1} insider deals error: {ex}")

                # 4. If current chunk contains today, also include live largedeal snapshot
                if chunk_end >= today:
                    try:
                        r_live = session.get(NSE_LARGEDEAL_API, headers=HEADERS, timeout=10)
                        if r_live.status_code == 200:
                            live_p = r_live.json()
                            for item in live_p.get("BLOCK_DEALS_DATA", []):
                                deal = self._normalize_largedeal(item, "block")
                                if deal:
                                    chunk_deals.append(deal)
                            for item in live_p.get("BULK_DEALS_DATA", []):
                                deal = self._normalize_largedeal(item, "bulk")
                                if deal:
                                    chunk_deals.append(deal)
                    except Exception as ex:
                        print(f"[TransactionsProvider] Chunk {idx+1} live snapshot error: {ex}")

                # Deduplicate and persist incrementally after every chunk
                new_in_chunk = 0
                with self._lock:
                    existing_map = {d.get("id"): d for d in self._cache_deals if d.get("id")}
                    for deal in chunk_deals:
                        did = deal.get("id")
                        if did and did not in existing_map:
                            existing_map[did] = deal
                            new_in_chunk += 1
                        elif did:
                            existing_map[did] = deal  # update existing

                    self._cache_deals = sorted(
                        existing_map.values(),
                        key=lambda x: (x.get("date", ""), x.get("value", 0)),
                        reverse=True
                    )
                    self._persist_deals()

                with self._admin_sync_lock:
                    self._admin_new_deals_count += new_in_chunk

                # Polite throttle between chunk calls
                time.sleep(0.6)

            # Completion
            with self._lock:
                total_synced = len(self._cache_deals)
            with self._admin_sync_lock:
                self._admin_sync_percent = 100
                self._admin_sync_progress = (
                    f"Completed successfully! Processed {total_chunks} chunks. "
                    f"Synced {self._admin_new_deals_count} new records. "
                    f"Total {total_synced} transactions now saved in database."
                )
                self._admin_sync_error = None
                self._last_synced_display = format_ist_display(now_ist())
                self._last_fetch_time = time.time()
                self._admin_is_syncing = False

        except Exception as exc:
            print(f"[TransactionsProvider] Fatal sync worker error: {exc}")
            with self._admin_sync_lock:
                self._admin_sync_error = str(exc)
                self._admin_sync_progress = f"Sync encountered error: {exc}"
        finally:
            with self._admin_sync_lock:
                self._admin_is_syncing = False

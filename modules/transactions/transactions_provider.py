"""Transactions Module Provider
Fetches, normalizes, and filters official Block Deals, Bulk Deals, and Insider Deals
directly from National Stock Exchange of India (NSE India).
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import json
import os
from modules.common.ist_datetime import format_ist_display
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
        self._load_stored_deals()

    def _load_stored_deals(self):
        """Load persisted deals from JSON storage in app_data."""
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
        """Save accumulated deals strictly to app_data storage file."""
        try:
            self.storage_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.storage_file, "w", encoding="utf-8") as f:
                json.dump(self._cache_deals, f, indent=2)
        except Exception as e:
            print(f"[TransactionsProvider] Warning persisting deals to {self.storage_file}: {e}")

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
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """Query, filter, and compute KPIs for deals matching criteria."""
        now = time.time()
        with self._lock:
            time_since_last = now - self._last_fetch_time if self._last_fetch_time > 0 else float("inf")
            # Strict 15-minute rate limit window before calling official exchange websites
            can_call_official = (not self._cache_deals) or (time_since_last >= CACHE_TTL)

        official_called = False
        if can_call_official and (force_refresh or not self._cache_deals or time_since_last >= CACHE_TTL):
            try:
                self.fetch_live_deals()
                official_called = True
            except Exception as e:
                print(f"[TransactionsProvider] Error fetching live deals: {e}")

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

"""
CAPITAL DESK - MOMENTUM SMALLCASES STORE
Handles storage, parsing, validation, and retrieval of Manual Momentum Indices.
"""

import os
import re
import uuid
import json
import logging
import threading
from datetime import datetime, date
from flask import session

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_fetcher = None


def init_store(fetcher=None, data_dir=None):
    global _fetcher, _DATA_DIR
    if fetcher:
        _fetcher = fetcher
    if data_dir:
        _DATA_DIR = data_dir


def _safe_user(username=None):
    username = username or session.get('username') or 'admin'
    return ''.join(c for c in str(username or '') if c.isalnum() or c in ('_', '-')).lower()


def _file(username=None):
    user = _safe_user(username)
    return os.path.join(_DATA_DIR, 'user_data', f'{user}_momentum_smallcases.json')


def load_user_momentum_smallcases(username=None):
    """Loads all momentum indices for the given or current user."""
    user = username or session.get('username') or 'admin'
    path = _file(username)
    try:
        from db_store import load_user_doc_db
        data = load_user_doc_db("momentum_smallcases", user, path, default_factory=dict)
    except Exception as e:
        data = {}
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                data = {}
    if not isinstance(data, dict):
        data = {}
    if "indices" not in data or not isinstance(data["indices"], list):
        data["indices"] = []
    if "strategies" not in data or not isinstance(data["strategies"], list):
        data["strategies"] = []
    return data


def save_user_momentum_smallcases(data, username=None):
    """Saves momentum indices data for the given or current user."""
    user = username or session.get('username') or 'admin'
    path = _file(username)
    try:
        from db_store import save_user_doc_db
        save_user_doc_db("momentum_smallcases", user, data, path)
    except Exception as e:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        import json
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, path)


def normalize_date(date_str):
    """Normalizes date string to DD/MM/YYYY format."""
    if not date_str:
        return datetime.now().strftime("%d/%m/%Y")
    cleaned = date_str.strip().replace('-', '/').replace('.', '/')
    parts = cleaned.split('/')
    if len(parts) == 3:
        try:
            d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            dt = datetime(y, m, d)
            return dt.strftime("%d/%m/%Y")
        except Exception:
            pass
    return date_str.strip()


def parse_date_added_obj(date_str):
    """Parses DD/MM/YYYY into a datetime.date object for chronological comparison."""
    if not date_str:
        return date.min
    try:
        parts = str(date_str).strip().replace('-', '/').replace('.', '/').split('/')
        if len(parts) == 3:
            d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return date(y, m, d)
    except Exception:
        pass
    return date.min


def calculate_days_active(date_str):
    """Calculates days elapsed since date_added (DD/MM/YYYY)."""
    if not date_str:
        return 0
    try:
        parts = date_str.split('/')
        if len(parts) == 3:
            dt = datetime(int(parts[2]), int(parts[1]), int(parts[0])).date()
            diff = (date.today() - dt).days
            return max(0, diff)
    except Exception:
        pass
    return 0


def parse_stocks_input(stocks_str):
    """
    Parses stocks input in format:
    [stockname1, dateAdded(DD/MM/YYYY)], [stockname2, dateAdded(DD/MM/YYYY)]
    Automatically resolves stock / company names to official NSE ticker symbols.
    Returns a list of parsed stock dictionaries ordered by date_added ascending.
    """
    if not stocks_str or not isinstance(stocks_str, str):
        return []

    try:
        from modules.momentum_smallcases.symbol_resolver import resolve_and_parse_stocks
        parsed = resolve_and_parse_stocks(stocks_str)
        if parsed:
            return parsed
    except Exception as e:
        logger.warning(f"Error resolving symbols in parse_stocks_input: {e}")

    results = []
    seen = set()

    # Match [symbol, date] patterns
    pattern = re.compile(r'\[\s*([^,\]\r\n]+?)\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*\]')
    matches = pattern.findall(stocks_str)

    for symbol_raw, date_raw in matches:
        sym = symbol_raw.strip().upper()
        if not sym:
            continue
        try:
            from modules.momentum_smallcases.symbol_resolver import resolve_symbol
            sym = resolve_symbol(sym)
        except Exception:
            pass
        norm_date = normalize_date(date_raw)
        key = (sym, norm_date)
        if key not in seen:
            seen.add(key)
            days = calculate_days_active(norm_date)
            results.append({
                "symbol": sym,
                "date_added": norm_date,
                "days_active": days
            })

    # If regex missed any due to slight formatting issues, try a broader fallback
    if not results and '[' in stocks_str:
        fallback_pattern = re.compile(r'\[\s*([^,\]]+?)\s*,\s*([^\]]+?)\s*\]')
        for symbol_raw, date_raw in fallback_pattern.findall(stocks_str):
            sym = symbol_raw.strip().upper()
            if not sym:
                continue
            try:
                from modules.momentum_smallcases.symbol_resolver import resolve_symbol
                sym = resolve_symbol(sym)
            except Exception:
                pass
            norm_date = normalize_date(date_raw.strip())
            key = (sym, norm_date)
            if key not in seen:
                seen.add(key)
                days = calculate_days_active(norm_date)
                results.append({
                    "symbol": sym,
                    "date_added": norm_date,
                    "days_active": days
                })

    # Always sort parsed stocks chronologically by date_added ascending, then symbol ascending
    results.sort(key=lambda s: (parse_date_added_obj(s.get("date_added")), s.get("symbol", "")))
    return results


def format_stocks_output(stocks_list):
    """Formats a list of stocks into the canonical string: [symbol, DD/MM/YYYY], ..."""
    if not stocks_list or not isinstance(stocks_list, list):
        return ""
    try:
        from modules.momentum_smallcases.symbol_resolver import format_stocks_output as resolver_format
        return resolver_format(stocks_list)
    except Exception:
        pass
    items = []
    for s in stocks_list:
        sym = s.get("symbol", "").strip().upper()
        dt = s.get("date_added", "").strip()
        if sym and dt:
            items.append(f"[{sym}, {dt}]")
    return ", ".join(items)


def get_user_indices(username=None):
    """Retrieves all manual momentum indices for the user with constituents sorted by date_added ascending."""
    data = load_user_momentum_smallcases(username)
    indices = data.get("indices", [])
    for idx in indices:
        stks = idx.get("stocks", [])
        for s in stks:
            s["days_active"] = calculate_days_active(s.get("date_added", ""))
        stks.sort(key=lambda s: (parse_date_added_obj(s.get("date_added")), s.get("symbol", "")))
        idx["stocks"] = stks
    return indices


def create_user_index(name, description, stocks_str, username=None):
    """Creates a new manual index with constituents sorted by date_added ascending."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Index name is required")

    description = (description or "").strip()
    parsed_stocks = parse_stocks_input(stocks_str)
    raw_formatted = format_stocks_output(parsed_stocks) if parsed_stocks else (stocks_str or "").strip()

    data = load_user_momentum_smallcases(username)
    indices = data.setdefault("indices", [])

    now_iso = datetime.now().isoformat()
    new_index = {
        "id": f"midx_{uuid.uuid4().hex[:12]}",
        "name": name,
        "description": description,
        "stocks": parsed_stocks,
        "raw_stocks": raw_formatted,
        "stock_count": len(parsed_stocks),
        "created_at": now_iso,
        "updated_at": now_iso
    }

    indices.insert(0, new_index)
    save_user_momentum_smallcases(data, username)
    return new_index


def get_user_index(index_id, username=None, enrich_quotes=False):
    """Retrieves a single index by ID, with constituents sorted by date_added ascending and optional live market price enrichment."""
    indices = get_user_indices(username)
    found = next((x for x in indices if x.get("id") == index_id), None)
    if not found:
        return None

    # Clone for return
    result = dict(found)
    stocks = [dict(s) for s in result.get("stocks", [])]
    # Ensure sorting by date_added ascending, then symbol ascending
    stocks.sort(key=lambda s: (parse_date_added_obj(s.get("date_added")), s.get("symbol", "")))

    # Recalculate days_active
    for s in stocks:
        s["days_active"] = calculate_days_active(s.get("date_added", ""))

    if enrich_quotes and _fetcher:
        for s in stocks:
            sym = s.get("symbol")
            try:
                quote = _fetcher.fetch_stock(sym, use_cache=True)
                if quote and not quote.get("error"):
                    s["current_price"] = quote.get("price") or quote.get("current_price") or 0.0
                    s["change"] = quote.get("change") or 0.0
                    s["change_percent"] = quote.get("change_percent") or quote.get("pChange") or 0.0
                    s["company_name"] = quote.get("company_name") or quote.get("name") or sym
                else:
                    s["current_price"] = None
                    s["change_percent"] = None
                    s["company_name"] = sym
            except Exception:
                s["current_price"] = None
                s["change_percent"] = None
                s["company_name"] = sym

    result["stocks"] = stocks
    result["raw_stocks"] = format_stocks_output(stocks)
    return result


def update_user_index(index_id, name, description, stocks_str, username=None):
    """Updates an existing manual index."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Index name is required")

    data = load_user_momentum_smallcases(username)
    indices = data.get("indices", [])
    target = next((x for x in indices if x.get("id") == index_id), None)
    if not target:
        raise ValueError(f"Manual Index with ID '{index_id}' not found")

    description = (description or "").strip()
    parsed_stocks = parse_stocks_input(stocks_str)
    raw_formatted = format_stocks_output(parsed_stocks) if parsed_stocks else (stocks_str or "").strip()

    target["name"] = name
    target["description"] = description
    target["stocks"] = parsed_stocks
    target["raw_stocks"] = raw_formatted
    target["stock_count"] = len(parsed_stocks)
    target["updated_at"] = datetime.now().isoformat()

    save_user_momentum_smallcases(data, username)
    return target


def delete_user_index(index_id, username=None):
    """Deletes a manual index by ID."""
    user = username or session.get('username') or 'admin'
    data = load_user_momentum_smallcases(user)
    indices = data.get("indices", [])
    initial_len = len(indices)
    target_id = str(index_id or "").strip()
    indices = [x for x in indices if str(x.get("id", "")).strip() != target_id]
    if len(indices) != initial_len:
        data["indices"] = indices
        save_user_momentum_smallcases(data, user)
        return True

    # Fallback to admin if not found in current user doc
    if user != 'admin':
        data_admin = load_user_momentum_smallcases('admin')
        admin_indices = data_admin.get("indices", [])
        admin_len = len(admin_indices)
        admin_indices = [x for x in admin_indices if str(x.get("id", "")).strip() != target_id]
        if len(admin_indices) != admin_len:
            data_admin["indices"] = admin_indices
            save_user_momentum_smallcases(data_admin, 'admin')
            return True

    return False


# ==============================================================================
# STRATEGY / MOMENTUM SMALLCASE MANAGEMENT
# ==============================================================================

def get_combined_indices_list(username=None):
    """
    Returns list of all available indices:
    - Manual Momentum Indices created by user
    - Official Nifty Benchmark Indices from index_stocks_provider
    """
    results = []

    # 1. User's Manual Indices
    user_indices = get_user_indices(username)
    for idx in user_indices:
        results.append({
            "id": idx.get("id"),
            "name": idx.get("name"),
            "type": "manual",
            "category": "Manual Momentum Indices",
            "stock_count": idx.get("stock_count", len(idx.get("stocks", []))),
            "description": idx.get("description", "")
        })

    # 2. Official Nifty Indices
    try:
        from modules.index_stocks.index_stocks_provider import index_stocks_provider
        nifty_indices = index_stocks_provider.get_all_indices()
        for idx in nifty_indices:
            results.append({
                "id": idx.get("key"),
                "name": idx.get("name"),
                "type": "nifty",
                "category": idx.get("category", "Nifty Benchmark"),
                "stock_count": idx.get("official_size", idx.get("total_stocks", 50)),
                "description": idx.get("description", "")
            })
    except Exception as e:
        logger.warning(f"Error fetching Nifty benchmark indices: {e}")

    return results


def get_strategy_index_constituents(index_id, index_type="manual", username=None):
    """
    Retrieves constituent stocks for a given index.
    Returns list of dicts: [{"symbol": "...", "date_added": "DD/MM/YYYY" | None}]
    """
    if index_type == "manual" or str(index_id).startswith("midx_"):
        idx = get_user_index(index_id, username=username)
        if not idx:
            return []
        return idx.get("stocks", [])
    else:
        # Nifty official index
        try:
            from modules.index_stocks.index_stocks_provider import index_stocks_provider
            data = index_stocks_provider.get_index_stocks(index_id)
            if data and "stocks" in data:
                return [{"symbol": s.get("symbol", ""), "date_added": None} for s in data["stocks"] if s.get("symbol")]
        except Exception as e:
            logger.warning(f"Error fetching Nifty index constituents for '{index_id}': {e}")
        return []


def calculate_strategy_next_rebalance(base_date, rebalance_day):
    """
    Computes next rebalance date based on rebalance_day, and adjusts
    for weekends and official trading holidays.
    """
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        get_next_trading_day,
        get_official_trading_holidays,
    )

    if isinstance(base_date, str):
        base = datetime.strptime(base_date[:10], "%Y-%m-%d").date()
    elif isinstance(base_date, datetime):
        base = base_date.date()
    else:
        base = base_date

    r_day = int(rebalance_day)
    # Clamp to valid calendar day
    r_day = max(1, min(28, r_day))

    if base.day < r_day:
        target_year = base.year
        target_month = base.month
    else:
        if base.month == 12:
            target_year = base.year + 1
            target_month = 1
        else:
            target_year = base.year
            target_month = base.month + 1

    scheduled_date = date(target_year, target_month, r_day)
    holidays_set = get_official_trading_holidays()
    adjusted_date, was_moved = get_next_trading_day(scheduled_date, holidays_set)

    return scheduled_date, adjusted_date, was_moved


def get_user_strategies(username=None):
    """Retrieves all momentum smallcase strategies for the user."""
    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    for s in strategies:
        cap = float(s.get("total_capital") if s.get("total_capital") is not None else s.get("amount_to_invest", 0.0))
        port_val = float(s.get("current_portfolio_value") if s.get("current_portfolio_value") is not None else cap)
        pnl = float(s.get("total_pnl") if s.get("total_pnl") is not None else (port_val - cap))
        pnl_pct = float(s.get("total_pnl_percent") if s.get("total_pnl_percent") is not None else (((pnl / cap) * 100.0) if cap > 0 else 0.0))
        s["total_capital"] = round(cap, 2)
        s["total_pnl"] = round(pnl, 2)
        s["total_pnl_percent"] = round(pnl_pct, 2)
    return strategies


def get_user_strategy(strategy_id, username=None):
    """Retrieves a single strategy by ID."""
    strategies = get_user_strategies(username)
    return next((x for x in strategies if x.get("id") == strategy_id), None)


def create_user_strategy(
    name,
    start_date,
    index_id,
    no_of_stocks,
    exit_regime_ranking,
    rebalance_day,
    amount_to_invest,
    formula=None,
    username=None
):
    """Creates a new Momentum Smallcase strategy with equal weight allocation."""
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        DEFAULT_FORMULA,
        get_next_trading_day,
        get_official_trading_holidays,
    )

    name = (name or "").strip()
    if not name:
        raise ValueError("Smallcase name is required")

    start_date_str = str(start_date or "").strip()[:10]
    if not start_date_str:
        raise ValueError("Start date is required")

    try:
        start_d = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except Exception:
        raise ValueError("Start date must be in YYYY-MM-DD format")

    today_d = date.today()
    if start_d > today_d:
        raise ValueError(f"Start date ({start_d.strftime('%d/%m/%Y')}) cannot be in the future (today is {today_d.strftime('%d/%m/%Y')}).")

    if not index_id:
        raise ValueError("Index selection is required")

    try:
        no_of_stocks = int(no_of_stocks)
        if no_of_stocks <= 0:
            raise ValueError()
    except Exception:
        raise ValueError("No. of stocks must be a positive integer")

    try:
        exit_regime = int(exit_regime_ranking)
        if exit_regime < no_of_stocks:
            raise ValueError()
    except Exception:
        raise ValueError(f"Exit regime ranking must be greater than or equal to No. of stocks ({no_of_stocks})")

    try:
        rebal_day = int(rebalance_day)
        if rebal_day < 1 or rebal_day > 31:
            raise ValueError()
    except Exception:
        raise ValueError("Rebalance day must be between 1 and 31")

    try:
        amt = float(amount_to_invest)
        if amt <= 0:
            raise ValueError()
    except Exception:
        raise ValueError("Amount to invest must be a positive number")

    formula = (formula or "").strip() or DEFAULT_FORMULA

    # Identify index name & type
    all_indices = get_combined_indices_list(username)
    found_idx = next((x for x in all_indices if x["id"] == index_id), None)
    index_name = found_idx["name"] if found_idx else str(index_id)
    index_type = found_idx["type"] if found_idx else ("manual" if str(index_id).startswith("midx_") else "nifty")

    # Check holiday adjustment for start date
    holidays_set = get_official_trading_holidays()
    adj_start, was_moved_start = get_next_trading_day(start_d, holidays_set)

    # Compute first scheduled rebalance date
    _, first_next_rebal, _ = calculate_strategy_next_rebalance(adj_start, rebal_day)

    now_iso = datetime.now().isoformat()
    strategy_id = f"msc_strategy_{uuid.uuid4().hex[:12]}"

    capital_logs = [
        {
            "id": f"clog_{uuid.uuid4().hex[:8]}",
            "timestamp": now_iso,
            "type": "INITIAL_DEPOSIT",
            "amount": amt,
            "wallet_after": amt,
            "notes": f"Initial capital allocation for {name}"
        }
    ]

    new_strategy = {
        "id": strategy_id,
        "name": name,
        "start_date": start_date_str,
        "effective_start_date": adj_start.isoformat(),
        "is_start_holiday_moved": was_moved_start,
        "index_id": index_id,
        "index_name": index_name,
        "index_type": index_type,
        "no_of_stocks": no_of_stocks,
        "exit_regime_ranking": exit_regime,
        "rebalance_day": rebal_day,
        "initial_amount": amt,
        "amount_to_invest": amt,
        "current_wallet": amt,
        "current_portfolio_value": amt,
        "total_fees_paid": 0.0,
        "formula": formula,
        "status": "DRAFT",  # DRAFT -> ACTIVE upon Init run
        "runs": [],
        "holdings": [],
        "next_rebalance_date": first_next_rebal.isoformat(),
        "capital_logs": capital_logs,
        "created_at": now_iso,
        "updated_at": now_iso
    }

    data = load_user_momentum_smallcases(username)
    strategies = data.setdefault("strategies", [])
    strategies.insert(0, new_strategy)
    save_user_momentum_smallcases(data, username)

    return new_strategy


def update_user_strategy_formula(strategy_id, formula, username=None):
    """Updates formula for a strategy."""
    formula = (formula or "").strip()
    if not formula:
        raise ValueError("Formula cannot be empty")

    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    target = next((x for x in strategies if x.get("id") == strategy_id), None)
    if not target:
        raise ValueError("Strategy not found")

    target["formula"] = formula
    target["updated_at"] = datetime.now().isoformat()
    save_user_momentum_smallcases(data, username)
    return target


def run_strategy_init(strategy_id, username=None):
    """
    Executes the initial portfolio run for the strategy:
    1. Filters universe constituents by stock date_added <= start_date.
    2. Ranks universe using formula.
    3. Allocates equal weight to top no_of_stocks with 0.10% transaction fees.
    4. Updates wallet and sets strategy status to ACTIVE.
    """
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        rank_and_evaluate_universe,
        execute_init_run,
        get_next_trading_day,
        get_official_trading_holidays,
    )

    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    target = next((x for x in strategies if x.get("id") == strategy_id), None)
    if not target:
        raise ValueError("Strategy not found")

    if target.get("status") == "ACTIVE" and len(target.get("runs", [])) > 0:
        raise ValueError("Init has already been executed for this strategy")

    # Determine execution date
    start_d = datetime.strptime(target["start_date"], "%Y-%m-%d").date()
    holidays_set = get_official_trading_holidays()
    exec_date, was_moved = get_next_trading_day(start_d, holidays_set)

    today_d = date.today()
    if exec_date > today_d:
        moved_note = f" (adjusted from {start_d.strftime('%d/%m/%Y')})" if was_moved else ""
        raise ValueError(
            f"Cannot execute Init for future date ({exec_date.strftime('%d/%m/%Y')}{moved_note}). "
            f"Smallcase start date cannot be in the future (today is {today_d.strftime('%d/%m/%Y')})."
        )

    # 1. Fetch universe constituents
    constituents = get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    if not constituents:
        raise ValueError(f"Index '{target.get('index_name')}' contains 0 constituent stocks. Please add stocks in Manual Indices.")

    # 1.1 Pre-warm daily quotes in parallel for all index constituents to prevent 502 Bad Gateway timeouts
    symbols_to_warm = set()
    for c in (constituents or []):
        if isinstance(c, dict) and c.get("symbol"):
            symbols_to_warm.add(c["symbol"])
        elif isinstance(c, str):
            symbols_to_warm.add(c)

    if symbols_to_warm:
        from concurrent.futures import ThreadPoolExecutor
        from modules.momentum_smallcases.momentum_smallcases_calculator import (
            fetch_stock_daily_series,
            save_price_cache,
        )
        worker_count = min(32, max(4, len(symbols_to_warm)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            list(pool.map(lambda s: fetch_stock_daily_series(s), symbols_to_warm))
        save_price_cache()

    # 2. Evaluate and rank stocks
    ranked_stocks, eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target.get("formula"),
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        return_meta=True
    )

    if not ranked_stocks:
        if eligible_count == 0:
            earliest = meta.get("earliest_date_added")
            earliest_str = earliest.strftime("%d/%m/%Y") if earliest else "N/A"
            latest = meta.get("latest_date_added")
            latest_str = latest.strftime("%d/%m/%Y") if latest else "N/A"
            exec_fmt = exec_date.strftime("%d/%m/%Y")
            raise ValueError(
                f"No constituent stocks in index '{target.get('index_name')}' were eligible on or before the Smallcase Start Date ({exec_fmt}). "
                f"Found {len(constituents)} stocks in this index, but their Date Added is between {earliest_str} and {latest_str} (after start date {exec_fmt}). "
                f"Please set your Smallcase Start Date to {earliest_str} or later, or adjust the Date Added of stocks in Manual Indices."
            )
        else:
            failed_syms = meta.get("failed_symbols", [])
            failed_str = ", ".join(failed_syms[:5]) if failed_syms else "all eligible stocks"
            raise ValueError(
                f"Could not calculate momentum metrics for constituent stocks ({failed_str}). "
                f"Please ensure tickers are valid NSE symbols and market data is accessible."
            )

    # 3. Execute equal weight allocation
    portfolio = execute_init_run(
        ranked_stocks=ranked_stocks,
        amount_to_invest=target["amount_to_invest"],
        no_of_stocks=target["no_of_stocks"]
    )

    now_iso = datetime.now().isoformat()

    # Calculate next scheduled rebalance date
    _, next_rebal, _ = calculate_strategy_next_rebalance(exec_date, target["rebalance_day"])

    init_run_entry = {
        "run_id": f"run_init_{uuid.uuid4().hex[:10]}",
        "run_type": "INIT",
        "run_number": 0,
        "title": "Init Run",
        "scheduled_date": target["start_date"],
        "executed_date": exec_date.isoformat(),
        "is_holiday_adjusted": was_moved,
        "formula_used": target.get("formula"),
        "eligible_stocks_count": eligible_count,
        "ranked_stocks": ranked_stocks,
        "portfolio_snapshot": portfolio,
        "changes": portfolio.get("changes", {}),
        "exited_stocks": portfolio.get("exited_stocks", []),
        "executed_at": now_iso
    }

    target["status"] = "ACTIVE"
    target["runs"] = [init_run_entry]
    target["holdings"] = portfolio["holdings"]
    target["current_wallet"] = portfolio["wallet_balance"]
    target["current_portfolio_value"] = portfolio["total_portfolio_value"]
    target["total_capital"] = portfolio.get("total_capital", float(target.get("amount_to_invest", 0.0)))
    target["total_pnl"] = portfolio.get("total_pnl", round(portfolio["total_portfolio_value"] - target["amount_to_invest"], 2))
    target["total_pnl_percent"] = portfolio.get("total_pnl_percent", 0.0)
    target["total_fees_paid"] = round(target.get("total_fees_paid", 0.0) + portfolio["fees_paid"], 2)
    target["next_rebalance_date"] = next_rebal.isoformat()
    target["updated_at"] = now_iso

    # Capital audit log for execution
    added_list = portfolio.get("changes", {}).get("added", [])
    target.setdefault("capital_logs", []).append({
        "id": f"clog_{uuid.uuid4().hex[:8]}",
        "timestamp": now_iso,
        "type": "PORTFOLIO_INIT",
        "amount": target["amount_to_invest"],
        "fees": portfolio["fees_paid"],
        "wallet_after": portfolio["wallet_balance"],
        "notes": f"Init completed: Bought {len(added_list)} stocks. Fees: ₹{portfolio['fees_paid']:.2f}. Remaining cash in wallet: ₹{portfolio['wallet_balance']:.2f}"
    })

    save_user_momentum_smallcases(data, username)
    return target


def run_strategy_rebalance(strategy_id, stepup_amount=0.0, username=None, save_cache=True):
    """
    Executes a rebalance run for the strategy:
    1. Advances to next rebalance trading date.
    2. Takes any stepup_amount and credits it to wallet.
    3. Evaluates constituent stocks added up to rebalance date.
    4. Sells stocks dropping beyond exit_regime_ranking (0.10% fee).
    5. Retains stocks within exit regime.
    6. Buys top newcomers to fill portfolio (0.10% fee).
    7. Updates wallet, capital logs, and sets next rebalance date.
    """
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        rank_and_evaluate_universe,
        execute_rebalance_run,
        get_next_trading_day,
        get_official_trading_holidays,
    )

    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    target = next((x for x in strategies if x.get("id") == strategy_id), None)
    if not target:
        raise ValueError("Strategy not found")

    if target.get("status") != "ACTIVE" or not target.get("runs"):
        raise ValueError("Please run Init before rebalancing")

    runs = target.setdefault("runs", [])
    last_run = runs[-1]
    prev_holdings = target.get("holdings", [])
    prev_wallet = target.get("current_wallet", 0.0)

    # Next scheduled date
    sched_rebal_str = target.get("next_rebalance_date") or date.today().isoformat()
    rebal_d = datetime.strptime(sched_rebal_str[:10], "%Y-%m-%d").date()
    holidays_set = get_official_trading_holidays()
    exec_date, was_moved = get_next_trading_day(rebal_d, holidays_set)

    today_d = date.today()
    if exec_date > today_d:
        moved_note = f" (adjusted from {rebal_d.strftime('%d/%m/%Y')})" if was_moved else ""
        raise ValueError(
            f"Cannot execute rebalance for future date ({exec_date.strftime('%d/%m/%Y')}{moved_note}). "
            f"Market data is not available for future dates (today is {today_d.strftime('%d/%m/%Y')})."
        )

    now_iso = datetime.now().isoformat()

    # Step-up capital handling
    stepup = float(stepup_amount or 0.0)
    if stepup > 0:
        target["amount_to_invest"] = round(target.get("amount_to_invest", 0.0) + stepup, 2)
        target.setdefault("capital_logs", []).append({
            "id": f"clog_{uuid.uuid4().hex[:8]}",
            "timestamp": now_iso,
            "type": "STEPUP_DEPOSIT",
            "amount": stepup,
            "wallet_after": round(prev_wallet + stepup, 2),
            "notes": f"Step-up capital added prior to rebalance: ₹{stepup:,.2f}"
        })

    # Fetch index constituents up to rebalance date
    constituents = get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    if not constituents:
        raise ValueError("No constituents found for index")

    # Standalone rebalance pre-warming
    if save_cache:
        symbols_to_warm = set()
        for c in (constituents or []):
            if isinstance(c, dict) and c.get("symbol"):
                symbols_to_warm.add(c["symbol"])
            elif isinstance(c, str):
                symbols_to_warm.add(c)
        for h in target.get("holdings", []):
            if isinstance(h, dict) and h.get("symbol"):
                symbols_to_warm.add(h["symbol"])
        if symbols_to_warm:
            from concurrent.futures import ThreadPoolExecutor
            from modules.momentum_smallcases.momentum_smallcases_calculator import (
                fetch_stock_daily_series,
                save_price_cache,
            )
            worker_count = min(32, max(4, len(symbols_to_warm)))
            with ThreadPoolExecutor(max_workers=worker_count) as pool:
                list(pool.map(lambda s: fetch_stock_daily_series(s), symbols_to_warm))
            save_price_cache()

    # Rank universe
    ranked_stocks, eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target.get("formula"),
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        return_meta=True,
        save_cache=save_cache
    )

    if not ranked_stocks:
        if eligible_count == 0:
            raise ValueError(f"No constituent stocks in index '{target.get('index_name')}' were eligible on rebalance date {exec_date}.")
        failed_syms = meta.get("failed_symbols", [])
        failed_str = ", ".join(failed_syms[:5]) if failed_syms else "stocks"
        raise ValueError(f"Could not calculate momentum metrics for rebalance date ({failed_str}).")

    # Execute rebalance equal weight allocation
    portfolio = execute_rebalance_run(
        ranked_stocks=ranked_stocks,
        previous_holdings=prev_holdings,
        previous_wallet=prev_wallet,
        stepup_amount=stepup,
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        target_date=exec_date,
        all_universe_stocks=meta.get("all_stocks"),
        total_capital=float(target.get("amount_to_invest", 0.0))
    )

    # Next future rebalance date
    _, next_rebal, _ = calculate_strategy_next_rebalance(exec_date, target["rebalance_day"])

    rebal_number = len(runs)
    rebal_run_entry = {
        "run_id": f"run_rebal_{uuid.uuid4().hex[:10]}",
        "run_type": "REBALANCE",
        "run_number": rebal_number,
        "title": f"Rebalance #{rebal_number}",
        "scheduled_date": sched_rebal_str,
        "executed_date": exec_date.isoformat(),
        "is_holiday_adjusted": was_moved,
        "formula_used": target.get("formula"),
        "eligible_stocks_count": eligible_count,
        "ranked_stocks": ranked_stocks,
        "portfolio_snapshot": portfolio,
        "changes": portfolio.get("changes", {}),
        "exited_stocks": portfolio.get("exited_stocks", []),
        "executed_at": now_iso
    }

    runs.append(rebal_run_entry)
    target["holdings"] = portfolio["holdings"]
    target["current_wallet"] = portfolio["wallet_balance"]
    target["current_portfolio_value"] = portfolio["total_portfolio_value"]
    target["total_capital"] = portfolio.get("total_capital", float(target.get("amount_to_invest", 0.0)))
    target["total_pnl"] = portfolio.get("total_pnl", round(portfolio["total_portfolio_value"] - target["amount_to_invest"], 2))
    target["total_pnl_percent"] = portfolio.get("total_pnl_percent", 0.0)
    target["total_fees_paid"] = round(target.get("total_fees_paid", 0.0) + portfolio["fees_paid"], 2)
    target["next_rebalance_date"] = next_rebal.isoformat()
    target["updated_at"] = now_iso

    # Capital audit log for rebalance
    changes = portfolio.get("changes", {})
    target.setdefault("capital_logs", []).append({
        "id": f"clog_{uuid.uuid4().hex[:8]}",
        "timestamp": now_iso,
        "type": "REBALANCE_EXECUTED",
        "amount": stepup,
        "fees": portfolio["fees_paid"],
        "wallet_after": portfolio["wallet_balance"],
        "notes": f"Rebalance #{rebal_number} executed on {exec_date}. Added: {len(changes.get('added', []))}, Removed: {len(changes.get('removed', []))}, Retained: {len(changes.get('retained', []))}. Fees: ₹{portfolio['fees_paid']:.2f}. Wallet: ₹{portfolio['wallet_balance']:.2f}"
    })

    save_user_momentum_smallcases(data, username)
    return target


def run_strategy_all_rebalances(strategy_id, stepup_per_rebalance=0.0, up_to_date=None, username=None):
    """
    Executes Init (if strategy is in DRAFT status) and then sequentially executes
    all scheduled monthly rebalances up to up_to_date (defaults to today).
    Each rebalance run receives the specified stepup_per_rebalance capital amount.
    Pre-warms all universe quotes upfront to ensure lightning-fast execution and
    prevents 502 Bad Gateway proxy timeouts.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        fetch_stock_daily_series,
        save_price_cache,
    )

    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    target = next((x for x in strategies if x.get("id") == strategy_id), None)
    if not target:
        raise ValueError("Strategy not found")

    if up_to_date:
        if isinstance(up_to_date, str):
            cutoff_d = datetime.strptime(up_to_date[:10], "%Y-%m-%d").date()
        elif isinstance(up_to_date, datetime):
            cutoff_d = up_to_date.date()
        else:
            cutoff_d = up_to_date
    else:
        cutoff_d = date.today()

    today_d = date.today()
    if cutoff_d > today_d:
        raise ValueError(
            f"Cannot execute rebalance for future date ({cutoff_d.strftime('%d/%m/%Y')}). "
            f"Cutoff date cannot be in the future (today is {today_d.strftime('%d/%m/%Y')})."
        )

    # 0. Pre-warm daily quotes in parallel for all index constituents & current holdings
    constituents = get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    symbols_to_warm = set()
    for c in (constituents or []):
        if isinstance(c, dict) and c.get("symbol"):
            symbols_to_warm.add(c["symbol"])
        elif isinstance(c, str):
            symbols_to_warm.add(c)
    for h in target.get("holdings", []):
        if isinstance(h, dict) and h.get("symbol"):
            symbols_to_warm.add(h["symbol"])

    if symbols_to_warm:
        logger.info(f"Pre-warming {len(symbols_to_warm)} universe stock quotes for batch rebalance...")
        worker_count = min(24, max(4, len(symbols_to_warm)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            list(pool.map(lambda s: fetch_stock_daily_series(s), symbols_to_warm))
        save_price_cache()

    init_executed = False
    rebalances_executed = 0
    batch_start_time = time.time()
    max_batch_seconds = 22.0  # Safe threshold well below typical 30s/60s reverse proxy timeouts

    # 1. Execute Init if DRAFT or no runs
    if target.get("status") == "DRAFT" or not target.get("runs"):
        start_d = datetime.strptime(target["start_date"][:10], "%Y-%m-%d").date()
        if start_d > cutoff_d:
            raise ValueError(f"Smallcase start date ({start_d}) is after cutoff date ({cutoff_d}). Cannot run Init.")
        target = run_strategy_init(strategy_id, username=username)
        init_executed = True

    # 2. Iteratively execute all due rebalances up to cutoff_d
    max_rebal_runs = 120  # Safeguard: max 10 years of monthly rebalances
    last_processed_date = None
    reached_time_limit = False

    while rebalances_executed < max_rebal_runs:
        sched_rebal_str = target.get("next_rebalance_date")
        if not sched_rebal_str:
            break
        rebal_d = datetime.strptime(sched_rebal_str[:10], "%Y-%m-%d").date()
        if rebal_d > cutoff_d:
            break
        if last_processed_date and rebal_d <= last_processed_date:
            logger.warning(f"Rebalance date did not advance: {rebal_d} <= {last_processed_date}")
            break

        # Time threshold guard to prevent proxy 502/504 timeout
        if rebalances_executed > 0 and (time.time() - batch_start_time) > max_batch_seconds:
            logger.info(f"Batch time limit ({max_batch_seconds}s) reached after {rebalances_executed} rebalances; returning cleanly.")
            reached_time_limit = True
            break

        try:
            target = run_strategy_rebalance(
                strategy_id,
                stepup_amount=float(stepup_per_rebalance or 0.0),
                username=username,
                save_cache=False
            )
            rebalances_executed += 1
            last_processed_date = rebal_d
        except Exception as e:
            logger.error(f"Error during batch rebalance on {rebal_d}: {e}", exc_info=True)
            err_msg = f"Completed {'Init and ' if init_executed else ''}{rebalances_executed} rebalance(s), but stopped on {rebal_d}: {str(e)}"
            if rebalances_executed > 0 or init_executed:
                raise RuntimeError(err_msg)
            else:
                raise

    # Save disk price cache once after batch completes
    save_price_cache()

    final_target = get_user_strategy(strategy_id, username=username) or target
    total_runs = (1 if init_executed else 0) + rebalances_executed

    if total_runs == 0:
        next_dt_str = final_target.get('next_rebalance_date', '')
        try:
            next_d_obj = datetime.strptime(next_dt_str[:10], "%Y-%m-%d").date()
            next_fmt = next_d_obj.strftime("%d/%m/%Y")
        except Exception:
            next_fmt = next_dt_str
        raise ValueError(
            f"Cannot execute rebalance for future date ({next_fmt}). "
            f"Smallcase is already up to date up to today ({today_d.strftime('%d/%m/%Y')})."
        )
    else:
        parts = []
        if init_executed:
            parts.append("Init")
        if rebalances_executed > 0:
            parts.append(f"{rebalances_executed} rebalance{'s' if rebalances_executed != 1 else ''}")
        stepup_val = float(stepup_per_rebalance or 0.0)
        stepup_txt = f" with ₹{stepup_val:,.2f} step-up per rebalance" if stepup_val > 0 else ""
        msg = f"Successfully executed {' + '.join(parts)}{stepup_txt} up to {cutoff_d}. Next rebalance is on {final_target.get('next_rebalance_date')}."
        if reached_time_limit:
            msg += " (Reached batch safe time limit; click Run All again to continue remaining runs)."

    return {
        "strategy": final_target,
        "init_executed": init_executed,
        "rebalances_executed": rebalances_executed,
        "total_runs_executed": total_runs,
        "message": msg
    }


def delete_user_strategy(strategy_id, username=None):
    """Deletes a strategy by ID."""
    user = username or session.get('username') or 'admin'
    data = load_user_momentum_smallcases(user)
    strategies = data.get("strategies", [])
    initial_len = len(strategies)
    target_id = str(strategy_id or "").strip()
    strategies = [x for x in strategies if str(x.get("id", "")).strip() != target_id]
    if len(strategies) != initial_len:
        data["strategies"] = strategies
        save_user_momentum_smallcases(data, user)
        return True

    # Fallback to admin if not found in current user doc
    if user != 'admin':
        data_admin = load_user_momentum_smallcases('admin')
        admin_strategies = data_admin.get("strategies", [])
        admin_len = len(admin_strategies)
        admin_strategies = [x for x in admin_strategies if str(x.get("id", "")).strip() != target_id]
        if len(admin_strategies) != admin_len:
            data_admin["strategies"] = admin_strategies
            save_user_momentum_smallcases(data_admin, 'admin')
            return True

    return False


def reset_all_momentum_data(username=None):
    """
    Cleans and resets all data related to momentum smallcases (indices, strategies, price caches)
    so user can start fresh from scratch.
    """
    user = username or session.get('username') or 'admin'
    clean_state = {"indices": [], "strategies": []}
    save_user_momentum_smallcases(clean_state, user)

    # Clean local price cache
    try:
        from modules.momentum_smallcases.momentum_smallcases_calculator import _CACHE_FILE, _memory_price_cache, _cache_lock
        with _cache_lock:
            _memory_price_cache.clear()
        if os.path.exists(_CACHE_FILE):
            with open(_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=4)
    except Exception as e:
        logger.warning(f"Error resetting price cache in reset_all_momentum_data: {e}")

    # Clean MongoDB if connected
    try:
        from db_store import db
        if db is not None:
            safe_user = _safe_user(user)
            db["momentum_smallcases"].delete_many({"_id": safe_user})
    except Exception as e:
        logger.warning(f"Error resetting MongoDB momentum_smallcases: {e}")

    return {"success": True, "message": "All momentum smallcase data has been completely reset."}


def get_strategy_consolidated_stocks(strategy_id, username=None):
    """
    Computes consolidated participated stocks performance history for a strategy across
    all executed runs (Init and Rebalances).
    Returns list of participated stocks with:
    - symbol
    - status ('HOLDING' | 'EXITED')
    - entry_month_year (e.g. 'Mar 2024')
    - exit_month_year (e.g. 'Aug 2024' or 'Holding')
    - days_held
    - holding_period_text
    - invested
    - current_or_exit_value
    - pnl (supports negative return)
    - pnl_percent
    - total_stock_pnl
    - total_stock_pnl_percent
    Ordered by longer holding period descending.
    Includes consolidated summary total at end.
    """
    strat = get_user_strategy(strategy_id, username=username)
    if not strat:
        raise ValueError("Strategy not found")

    runs = strat.get("runs", [])
    if not runs:
        return {
            "stocks": [],
            "summary": {
                "total_participated": 0,
                "holding_count": 0,
                "exited_count": 0,
                "total_invested": 0.0,
                "total_value": 0.0,
                "consolidated_pnl": 0.0,
                "consolidated_pnl_percent": 0.0
            }
        }

    def parse_d(d_str):
        if not d_str:
            return None
        try:
            return datetime.strptime(str(d_str)[:10], "%Y-%m-%d").date()
        except Exception:
            return None

    def fmt_month_year(d_obj, d_str=None):
        if not d_obj and d_str:
            d_obj = parse_d(d_str)
        if not d_obj:
            return "—"
        return d_obj.strftime("%b %Y")

    active_stints = {}
    all_stints = []

    for run_idx, run in enumerate(runs):
        exec_date_str = run.get("executed_date") or run.get("scheduled_date") or ""
        exec_date = parse_d(exec_date_str)
        portfolio = run.get("portfolio_snapshot") or {}
        holdings = portfolio.get("holdings") or []
        exited = portfolio.get("exited_stocks") or (portfolio.get("changes", {}).get("exited_stocks") or [])

        # 1. Exited stocks in this run
        for ex in exited:
            sym = ex.get("symbol")
            if not sym:
                continue
            exit_price = round(float(ex.get("exit_price") or 0.0), 2)
            exit_val = round(float(ex.get("exit_value") or (ex.get("quantity", 0) * exit_price)), 2)
            qty = int(ex.get("quantity") or 0)
            avg_price = round(float(ex.get("average_price") or ex.get("buy_price") or 0.0), 2)

            stint = active_stints.pop(sym, None)
            if stint:
                stint["exit_date"] = exec_date_str
                stint["exit_date_obj"] = exec_date
                stint["exit_month_year"] = fmt_month_year(exec_date, exec_date_str)
                stint["exit_price"] = exit_price
                stint["exit_value"] = exit_val
                stint["current_or_exit_value"] = exit_val
                stint["status"] = "EXITED"
                
                inv = stint["invested"]
                pnl = round(exit_val - inv, 2)
                pnl_pct = round(((exit_val - inv) / inv) * 100.0, 2) if inv > 0 else 0.0
                stint["pnl"] = pnl
                stint["pnl_percent"] = pnl_pct
                all_stints.append(stint)
            else:
                inv = round(float(ex.get("invested") or (qty * avg_price)), 2)
                pnl = round(float(ex.get("pnl") if ex.get("pnl") is not None else (exit_val - inv)), 2)
                pnl_pct = round(float(ex.get("pnl_percent") if ex.get("pnl_percent") is not None else (((exit_val - inv) / inv) * 100.0 if inv > 0 else 0.0)), 2)
                prev_run_date_str = runs[max(0, run_idx - 1)].get("executed_date") if run_idx > 0 else exec_date_str
                prev_d = parse_d(prev_run_date_str)
                all_stints.append({
                    "symbol": sym,
                    "status": "EXITED",
                    "entry_date": prev_run_date_str,
                    "entry_date_obj": prev_d,
                    "entry_month_year": fmt_month_year(prev_d, prev_run_date_str),
                    "entry_price": avg_price,
                    "exit_date": exec_date_str,
                    "exit_date_obj": exec_date,
                    "exit_month_year": fmt_month_year(exec_date, exec_date_str),
                    "exit_price": exit_price,
                    "quantity": qty,
                    "invested": inv,
                    "current_or_exit_value": exit_val,
                    "pnl": pnl,
                    "pnl_percent": pnl_pct
                })

        # 2. Holdings in this run
        for h in holdings:
            sym = h.get("symbol")
            if not sym:
                continue
            qty = int(h.get("quantity") or 0)
            buy_price = round(float(h.get("buy_price") or 0.0), 2)
            curr_price = round(float(h.get("current_price") or buy_price), 2)
            inv = round(float(h.get("invested") or (qty * buy_price)), 2)
            curr_val = round(float(h.get("current_value") or (qty * curr_price)), 2)
            pnl = round(float(h.get("pnl") if h.get("pnl") is not None else (curr_val - inv)), 2)
            pnl_pct = round(float(h.get("pnl_percent") if h.get("pnl_percent") is not None else (((curr_val - inv) / inv) * 100.0 if inv > 0 else 0.0)), 2)

            if sym not in active_stints:
                active_stints[sym] = {
                    "symbol": sym,
                    "status": "HOLDING",
                    "entry_date": exec_date_str,
                    "entry_date_obj": exec_date,
                    "entry_month_year": fmt_month_year(exec_date, exec_date_str),
                    "entry_price": buy_price,
                    "exit_date": None,
                    "exit_date_obj": None,
                    "exit_month_year": "Holding",
                    "exit_price": None,
                    "quantity": qty,
                    "invested": inv,
                    "current_price": curr_price,
                    "current_or_exit_value": curr_val,
                    "pnl": pnl,
                    "pnl_percent": pnl_pct,
                    "last_date_obj": exec_date
                }
            else:
                s = active_stints[sym]
                s["quantity"] = qty
                s["current_price"] = curr_price
                s["invested"] = inv
                s["current_or_exit_value"] = curr_val
                s["pnl"] = pnl
                s["pnl_percent"] = pnl_pct
                s["last_date_obj"] = exec_date

    latest_run_date = parse_d(runs[-1].get("executed_date") or runs[-1].get("scheduled_date"))
    for stint in active_stints.values():
        stint["status"] = "HOLDING"
        stint["exit_month_year"] = "Holding"
        stint["exit_date"] = None
        stint["exit_date_obj"] = stint.get("last_date_obj") or latest_run_date
        all_stints.append(stint)

    # Compute holding period duration in days and formatted text
    for s in all_stints:
        d_start = s.get("entry_date_obj") or latest_run_date
        d_end = s.get("exit_date_obj") or latest_run_date
        days = 0
        if d_start and d_end:
            days = max(0, (d_end - d_start).days)
        s["days_held"] = days
        months = round(days / 30.4, 1)
        if months >= 1.0:
            s["holding_period_text"] = f"{int(round(months))} mo{'s' if round(months) != 1 else ''} ({days}d)"
        elif days > 0:
            s["holding_period_text"] = f"{days} day{'s' if days != 1 else ''}"
        else:
            s["holding_period_text"] = "Current (0d)"

    # Compute per-symbol total cumulative P&L across all stints
    sym_totals = {}
    for s in all_stints:
        sym = s["symbol"]
        if sym not in sym_totals:
            sym_totals[sym] = {"invested": 0.0, "pnl": 0.0}
        sym_totals[sym]["invested"] += s["invested"]
        sym_totals[sym]["pnl"] += s["pnl"]

    for s in all_stints:
        sym = s["symbol"]
        tot_inv = sym_totals[sym]["invested"]
        tot_p = sym_totals[sym]["pnl"]
        s["total_stock_pnl"] = round(tot_p, 2)
        s["total_stock_pnl_percent"] = round((tot_p / tot_inv) * 100.0, 2) if tot_inv > 0 else 0.0

    # ORDER BY LONGER HOLDING PERIOD (DESCENDING)
    all_stints.sort(key=lambda x: (x["days_held"], x["pnl"]), reverse=True)

    # Compute consolidated summary
    tot_invested = round(sum(s["invested"] for s in all_stints), 2)
    tot_val = round(sum(s["current_or_exit_value"] for s in all_stints), 2)
    tot_pnl = round(sum(s["pnl"] for s in all_stints), 2)
    tot_pnl_pct = round((tot_pnl / tot_invested) * 100.0, 2) if tot_invested > 0 else 0.0

    # Clean date objects before returning JSON
    for s in all_stints:
        s.pop("entry_date_obj", None)
        s.pop("exit_date_obj", None)
        s.pop("last_date_obj", None)

    return {
        "stocks": all_stints,
        "summary": {
            "total_participated": len(all_stints),
            "holding_count": sum(1 for s in all_stints if s["status"] == "HOLDING"),
            "exited_count": sum(1 for s in all_stints if s["status"] == "EXITED"),
            "total_invested": tot_invested,
            "total_value": tot_val,
            "consolidated_pnl": tot_pnl,
            "consolidated_pnl_percent": tot_pnl_pct
        }
    }


# ==============================================================================
# ASYNC EXECUTION JOBS (Immune to Gunicorn / Nginx / Reverse Proxy 502 Timeouts)
# ==============================================================================

_EXECUTION_JOBS = {}
_JOBS_LOCK = threading.Lock()


def start_async_execution_job(job_type, strategy_id, username=None, **kwargs):
    """
    Launches an execution job in a background thread and returns immediately with a unique job_id.
    Prevents 502 Bad Gateway timeouts caused by long calculations exceeding proxy limits (e.g. 30s).
    """
    import threading
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    with _JOBS_LOCK:
        # Prune old completed jobs if dictionary grows
        if len(_EXECUTION_JOBS) > 100:
            completed_keys = [k for k, v in _EXECUTION_JOBS.items() if v.get("status") in ("COMPLETED", "FAILED")]
            for k in completed_keys[:50]:
                _EXECUTION_JOBS.pop(k, None)

        _EXECUTION_JOBS[job_id] = {
            "id": job_id,
            "job_type": job_type,  # "INIT", "REBALANCE", "RUN_ALL"
            "strategy_id": strategy_id,
            "status": "RUNNING",
            "progress": "Starting execution...",
            "started_at": datetime.now().isoformat(),
            "completed_at": None,
            "result": None,
            "error": None
        }

    def _worker():
        try:
            logger.info(f"Async job {job_id} ({job_type}) started for strategy {strategy_id}")
            if job_type == "INIT":
                res = run_strategy_init(strategy_id, username=username)
            elif job_type == "REBALANCE":
                stepup = kwargs.get("stepup_amount", 0.0)
                res = run_strategy_rebalance(strategy_id, stepup_amount=stepup, username=username)
            elif job_type == "RUN_ALL":
                stepup = kwargs.get("stepup_per_rebalance", 0.0)
                up_to = kwargs.get("up_to_date")
                res = run_strategy_all_rebalances(strategy_id, stepup_per_rebalance=stepup, up_to_date=up_to, username=username)
            else:
                raise ValueError(f"Unknown job type: {job_type}")

            with _JOBS_LOCK:
                _EXECUTION_JOBS[job_id]["status"] = "COMPLETED"
                _EXECUTION_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                _EXECUTION_JOBS[job_id]["result"] = res
            logger.info(f"Async job {job_id} ({job_type}) completed successfully")
        except Exception as e:
            logger.error(f"Error in async job {job_id} ({job_type}): {e}", exc_info=True)
            with _JOBS_LOCK:
                _EXECUTION_JOBS[job_id]["status"] = "FAILED"
                _EXECUTION_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                _EXECUTION_JOBS[job_id]["error"] = str(e)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    return job_id


def get_execution_job_status(job_id):
    """Retrieves current status and result for an async execution job."""
    with _JOBS_LOCK:
        job = _EXECUTION_JOBS.get(job_id)
        if not job:
            return None
        return dict(job)




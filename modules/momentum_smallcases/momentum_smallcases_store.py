"""
CAPITAL DESK - MOMENTUM SMALLCASES STORE
Handles storage, parsing, validation, and retrieval of Manual Momentum Indices.
"""

import os
import re
import uuid
from datetime import datetime, date
from flask import session

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
    Returns a list of parsed stock dictionaries.
    """
    if not stocks_str or not isinstance(stocks_str, str):
        return []

    results = []
    seen = set()

    # Match [symbol, date] patterns
    pattern = re.compile(r'\[\s*([^,\]\r\n]+?)\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*\]')
    matches = pattern.findall(stocks_str)

    for symbol_raw, date_raw in matches:
        sym = symbol_raw.strip().upper()
        if not sym:
            continue
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

    return results


def format_stocks_output(stocks_list):
    """Formats a list of stocks into the canonical string: [symbol, DD/MM/YYYY], ..."""
    if not stocks_list or not isinstance(stocks_list, list):
        return ""
    items = []
    for s in stocks_list:
        sym = s.get("symbol", "").strip().upper()
        dt = s.get("date_added", "").strip()
        if sym and dt:
            items.append(f"[{sym}, {dt}]")
    return ", ".join(items)


def get_user_indices(username=None):
    """Retrieves all manual momentum indices for the user."""
    data = load_user_momentum_smallcases(username)
    indices = data.get("indices", [])
    # Update days_active dynamically
    for idx in indices:
        for s in idx.get("stocks", []):
            s["days_active"] = calculate_days_active(s.get("date_added", ""))
    return indices


def create_user_index(name, description, stocks_str, username=None):
    """Creates a new manual index."""
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
    """Retrieves a single index by ID, with optional live market price enrichment."""
    indices = get_user_indices(username)
    found = next((x for x in indices if x.get("id") == index_id), None)
    if not found:
        return None

    # Clone for return
    result = dict(found)
    stocks = [dict(s) for s in result.get("stocks", [])]

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
    data = load_user_momentum_smallcases(username)
    indices = data.get("indices", [])
    initial_len = len(indices)
    indices = [x for x in indices if x.get("id") != index_id]
    if len(indices) == initial_len:
        return False
    data["indices"] = indices
    save_user_momentum_smallcases(data, username)
    return True

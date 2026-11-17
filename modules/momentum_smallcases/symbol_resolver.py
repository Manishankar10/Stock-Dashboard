"""
CAPITAL DESK - MOMENTUM SMALLCASES SYMBOL RESOLVER
Translates stock / company names into official NSE ticker symbols.
Ensures constituent universe stored in DB always uses valid NSE trading symbols.
"""

import os
import re
import io
import csv
import json
import logging
import difflib
import threading
from datetime import datetime, date
import requests

logger = logging.getLogger(__name__)

_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
_MASTER_FILE = os.path.join(_MODULE_DIR, "nse_equity_master.json")

_symbols_set = set()
_exact_names = {}
_norm_to_sym = {}
_loaded = False
_lock = threading.Lock()


def _normalize_name(s: str) -> str:
    """Normalizes company name for fuzzy/token matching by stripping corporate suffixes."""
    if not s:
        return ""
    text = s.upper().strip()
    # Strip common corporate designations
    text = re.sub(
        r'\b(LIMITED|LTD|LTD\.|PVT|PVT\.|PRIVATE|CORP|CORPORATION|CO|COMPANY|ENTERPRISES|HOLDINGS|INDIA|LABORATORIES|LABS|LAB|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|INDUSTRIES|FINANCE|FINANCIAL)\b',
        '',
        text
    )
    # Strip all non-alphanumeric characters
    text = re.sub(r'[^A-Z0-9]', '', text)
    return text.strip()


def load_master_symbols(force_reload: bool = False):
    """Loads NSE equities master into in-memory lookup maps."""
    global _symbols_set, _exact_names, _norm_to_sym, _loaded
    with _lock:
        if _loaded and not force_reload:
            return

        master = {}
        # 1. Try reading pre-built nse_equity_master.json
        if os.path.exists(_MASTER_FILE):
            try:
                with open(_MASTER_FILE, "r", encoding="utf-8") as f:
                    master = json.load(f)
            except Exception as e:
                logger.warning(f"Error reading nse_equity_master.json: {e}")

        # 2. If master is empty, try downloading from official NSE archives
        if not master:
            try:
                url = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
                headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code == 200:
                    reader = csv.DictReader(io.StringIO(resp.text))
                    for row in reader:
                        sym = (row.get("SYMBOL") or "").strip().upper()
                        cname = (row.get("NAME OF COMPANY") or "").strip()
                        if sym:
                            master[sym] = {
                                "symbol": sym,
                                "name": cname,
                                "series": (row.get(" SERIES") or row.get("SERIES") or "").strip(),
                                "isin": (row.get(" ISIN NUMBER") or row.get("ISIN NUMBER") or "").strip(),
                            }
                    # Save local copy
                    try:
                        with open(_MASTER_FILE, "w", encoding="utf-8") as f:
                            json.dump(master, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f"Could not download EQUITY_L.csv: {e}")

        # 3. Populate memory indexes
        _symbols_set = set(master.keys())
        _exact_names = {}
        _norm_to_sym = {}

        for sym, item in master.items():
            cname = item.get("name", "").strip()
            if cname:
                _exact_names[cname.upper()] = sym
                norm = _normalize_name(cname)
                if norm and norm not in _norm_to_sym:
                    _norm_to_sym[norm] = sym

            # Also allow normalized symbol
            norm_sym = _normalize_name(sym)
            if norm_sym and norm_sym not in _norm_to_sym:
                _norm_to_sym[norm_sym] = sym

        _loaded = True
        logger.info(f"Loaded {len(_symbols_set)} official NSE symbols into symbol resolver.")


def resolve_symbol(raw_input: str) -> str:
    """
    Resolves any stock symbol or company name into its official NSE ticker symbol.
    Returns the resolved symbol (e.g. 'NETWEB', 'CAPLIPOINT', 'SYRMA', 'TDPOWERSYS', 'DAMCAPITAL').
    """
    if not raw_input or not isinstance(raw_input, str):
        return ""

    if not _loaded:
        load_master_symbols()

    q = raw_input.strip().upper()
    # Strip quotes, brackets, or commas
    q = re.sub(r'^[\[\(\"\'\s]+|[\]\)\"\'\s,]+$', '', q).strip()

    # Strip .NS or .BO suffix if user included it
    if q.endswith('.NS') or q.endswith('.BO'):
        q = q.rsplit('.', 1)[0].strip()

    if not q:
        return ""

    # 1. Direct match in official symbols
    if q in _symbols_set:
        return q

    # 2. Exact match in full company names
    if q in _exact_names:
        return _exact_names[q]

    # 3. Normalized string match
    norm_q = _normalize_name(q)
    if norm_q in _norm_to_sym:
        return _norm_to_sym[norm_q]

    # 4. Normalized prefix / contains match
    if len(norm_q) >= 4:
        for n_key, sym_val in _norm_to_sym.items():
            if len(n_key) >= 4 and (norm_q == n_key or n_key.startswith(norm_q) or norm_q.startswith(n_key)):
                return sym_val

    # 5. Difflib close match on normalized names
    if norm_q:
        close_norm = difflib.get_close_matches(norm_q, _norm_to_sym.keys(), n=1, cutoff=0.7)
        if close_norm:
            return _norm_to_sym[close_norm[0]]

    # 6. Difflib close match on official symbols
    close_sym = difflib.get_close_matches(q, _symbols_set, n=1, cutoff=0.75)
    if close_sym:
        return close_sym[0]

    # 7. Online Yahoo Finance search fallback (if still unmapped)
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={requests.utils.quote(raw_input.strip())}&quotesCount=5&newsCount=0"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        res = requests.get(url, headers=headers, timeout=3).json()
        for quote in res.get("quotes", []):
            sym = quote.get("symbol", "").upper().strip()
            exch = quote.get("exchange", "").upper()
            if exch in ("NSI", "NSE") or sym.endswith(".NS"):
                clean_sym = sym.replace(".NS", "").strip()
                if clean_sym:
                    with _lock:
                        _symbols_set.add(clean_sym)
                        if norm_q:
                            _norm_to_sym[norm_q] = clean_sym
                    return clean_sym
    except Exception as e:
        logger.debug(f"Online symbol search failed for {raw_input}: {e}")

    # Fallback: return cleaned uppercase token
    return q


def normalize_date(date_str: str) -> str:
    """Normalizes date string to DD/MM/YYYY format."""
    if not date_str:
        return datetime.now().strftime("%d/%m/%Y")
    cleaned = str(date_str).strip().replace('-', '/').replace('.', '/')
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


def parse_date_obj(date_str: str) -> date:
    """Parses DD/MM/YYYY into a date object for chronological sorting."""
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


def calculate_days_active(date_str: str) -> int:
    """Calculates days elapsed since date_added (DD/MM/YYYY)."""
    if not date_str:
        return 0
    try:
        parts = str(date_str).split('/')
        if len(parts) == 3:
            dt = datetime(int(parts[2]), int(parts[1]), int(parts[0])).date()
            diff = (date.today() - dt).days
            return max(0, diff)
    except Exception:
        pass
    return 0


def resolve_and_parse_stocks(stocks_str: str) -> list:
    """
    Parses stocks input in bracketed or unbracketed format:
    [StockName/Symbol, Date], ...
    Resolves each stock name to its official NSE ticker symbol.
    Returns chronologically sorted list of dicts:
    [{"symbol": "NETWEB", "original_name": "...", "date_added": "DD/MM/YYYY", "days_active": N}, ...]
    """
    if not stocks_str or not isinstance(stocks_str, str):
        return []

    if not _loaded:
        load_master_symbols()

    results = []
    seen = set()

    # 1. Pattern: [symbol/name, date]
    bracket_pattern = re.compile(
        r'\[\s*([^,\]\r\n]+?)\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*\]'
    )
    matches = bracket_pattern.findall(stocks_str)

    if matches:
        for raw_name, date_raw in matches:
            raw_clean = raw_name.strip()
            if not raw_clean:
                continue
            sym = resolve_symbol(raw_clean)
            norm_date = normalize_date(date_raw)
            key = (sym, norm_date)
            if key not in seen:
                seen.add(key)
                days = calculate_days_active(norm_date)
                results.append({
                    "symbol": sym,
                    "original_name": raw_clean,
                    "date_added": norm_date,
                    "days_active": days,
                    "resolved": (sym != raw_clean.upper())
                })
        results.sort(key=lambda s: (parse_date_obj(s.get("date_added")), s.get("symbol", "")))
        return results

    # 2. Pattern: line-by-line or comma-separated pairs: Name, Date or just Name
    lines = [line.strip() for line in re.split(r'[\r\n]+', stocks_str) if line.strip()]
    today_formatted = datetime.now().strftime("%d/%m/%Y")

    for line in lines:
        # Check if line contains a date at end
        date_match = re.search(r'([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\s*$', line)
        if date_match:
            date_raw = date_match.group(1)
            raw_clean = line[:date_match.start()].strip().rstrip(',').strip()
        else:
            date_raw = today_formatted
            raw_clean = line.strip()

        # Remove outer brackets or quotes
        raw_clean = re.sub(r'^[\[\(\"\'\s]+|[\]\)\"\'\s,]+$', '', raw_clean).strip()
        if not raw_clean:
            continue

        sym = resolve_symbol(raw_clean)
        norm_date = normalize_date(date_raw)
        key = (sym, norm_date)
        if key not in seen:
            seen.add(key)
            days = calculate_days_active(norm_date)
            results.append({
                "symbol": sym,
                "original_name": raw_clean,
                "date_added": norm_date,
                "days_active": days,
                "resolved": (sym != raw_clean.upper())
            })

    results.sort(key=lambda s: (parse_date_obj(s.get("date_added")), s.get("symbol", "")))
    return results


def format_stocks_output(stocks_list: list) -> str:
    """Formats a list of stocks into canonical format: [SYMBOL, DD/MM/YYYY], ..."""
    if not stocks_list or not isinstance(stocks_list, list):
        return ""
    items = []
    for s in stocks_list:
        sym = s.get("symbol", "").strip().upper()
        dt = s.get("date_added", "").strip()
        if sym and dt:
            items.append(f"[{sym}, {dt}]")
    return ", ".join(items)


def resolve_stocks_summary(stocks_str: str) -> dict:
    """
    Parses and resolves input stock names, returning summary statistics and canonical string.
    """
    parsed = resolve_and_parse_stocks(stocks_str)
    formatted = format_stocks_output(parsed)
    resolved_replacements = {}
    for p in parsed:
        orig = p.get("original_name", "")
        sym = p.get("symbol", "")
        if orig and sym and orig.upper() != sym:
            resolved_replacements[orig] = sym

    return {
        "success": True,
        "stocks": parsed,
        "formatted_stocks": formatted,
        "total_count": len(parsed),
        "resolved_count": len(resolved_replacements),
        "replacements": resolved_replacements
    }

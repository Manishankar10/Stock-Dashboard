"""
CAPITAL DESK - MOMENTUM SMALLCASES STORE
Handles storage, parsing, validation, and retrieval of Manual Momentum Indices.
"""

import os
import re
import time
import uuid
import json
import logging
import threading
from datetime import datetime, date, timedelta
from flask import session
from modules.common.ist_datetime import now_ist

_CONSTITUENTS_CACHE = {}
_CONSTITUENTS_CACHE_LOCK = threading.Lock()
_CONSTITUENTS_CACHE_TTL_SEC = 300.0


def clear_constituents_cache():
    """Clears the short TTL cache for official index constituents."""
    with _CONSTITUENTS_CACHE_LOCK:
        _CONSTITUENTS_CACHE.clear()


def _extract_strategy_symbols(target, constituents=None):
    """Collects unique constituent and holding symbols for prewarming."""
    symbols = set()
    for c in (constituents or []):
        if isinstance(c, dict) and c.get("symbol"):
            symbols.add(c["symbol"])
        elif isinstance(c, str):
            symbols.add(c)
    for h in (target.get("holdings") or []):
        if isinstance(h, dict) and h.get("symbol"):
            symbols.add(h["symbol"])
    return symbols


def _prewarm_symbols_for_window(symbols_to_warm, min_date_str=None, max_date_str=None, cutoff_date=None, save_cache=True):
    """
    Pre-warms MongoDB stock_closing_prices via Pattern 2 $filter date window first,
    and falls back cleanly (capped at 8 workers) only for symbols missing from DB.
    """
    if not symbols_to_warm:
        return
    from concurrent.futures import ThreadPoolExecutor
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        prewarm_stock_prices_cache,
        get_stock_closing_prices_from_db,
        fetch_stock_daily_series,
        save_price_cache,
    )
    prewarm_stock_prices_cache(symbols_to_warm, min_date=min_date_str, max_date=max_date_str)
    cutoff_str = max_date_str or (cutoff_date.isoformat() if cutoff_date else None)
    missing_from_db = [
        sym for sym in symbols_to_warm
        if get_stock_closing_prices_from_db(sym, target_cutoff_str=cutoff_str) is None
    ]
    if missing_from_db:
        worker_count = min(8, max(2, len(missing_from_db)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            list(pool.map(lambda s: fetch_stock_daily_series(s, target_cutoff_date=cutoff_date), missing_from_db))
        if save_cache:
            save_price_cache()

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_fetcher = None


def init_store(fetcher=None, data_dir=None):
    global _fetcher, _DATA_DIR
    if fetcher:
        _fetcher = fetcher
    if data_dir:
        _DATA_DIR = data_dir


def _resolve_username(username=None):
    if username:
        return str(username).strip()
    try:
        from flask import has_request_context, session
        if has_request_context() and session:
            return session.get('username') or 'admin'
    except Exception:
        pass
    return 'admin'


def _safe_user(username=None):
    username = _resolve_username(username)
    return ''.join(c for c in str(username or '') if c.isalnum() or c in ('_', '-')).lower()


def _file(username=None):
    user = _safe_user(username)
    return os.path.join(_DATA_DIR, 'user_data', f'{user}_momentum_smallcases.json')


RUNS_COLLECTION = "momentum_smallcase_runs"
RANKED_SNAPSHOTS_COLLECTION = "momentum_smallcase_ranked_snapshots"


def _strip_mongo_internal_keys(doc):
    """Returns a shallow copy without MongoDB internal normalization wrapper keys."""
    if not isinstance(doc, dict):
        return doc
    clean = {k: v for k, v in doc.items() if k not in ("_id", "username", "strategy_id", "run_index")}
    return clean


def _rehydrate_external_runs_for_strategies(db, strategies, exclude_run_fields=None):
    """
    Populates s['runs'] from momentum_smallcase_runs (and momentum_smallcase_ranked_snapshots
    unless 'all_ranked_stocks' is excluded) for any strategy stored with runs_externalized=True.
    """
    if db is None or not strategies:
        return strategies

    ext_strats = [
        s for s in strategies
        if isinstance(s, dict) and s.get("id") and (
            s.get("runs_externalized") or (not s.get("runs") and int(s.get("runs_count") or 0) > 0)
        )
    ]
    if not ext_strats:
        return strategies

    ext_ids = [s["id"] for s in ext_strats]
    exclude_set = set(exclude_run_fields or ())

    run_proj = {"_id": 0, "username": 0}
    for f in exclude_set:
        if f != "all_ranked_stocks":
            run_proj[f] = 0

    runs_by_strat = {sid: [] for sid in ext_ids}
    try:
        cursor = db[RUNS_COLLECTION].find({"strategy_id": {"$in": ext_ids}}, run_proj).sort([
            ("strategy_id", 1),
            ("run_index", 1),
        ])
        for rdoc in cursor:
            sid = rdoc.pop("strategy_id", None)
            rdoc.pop("run_index", None)
            if sid in runs_by_strat:
                runs_by_strat[sid].append(rdoc)
    except Exception as e:
        logger.warning(f"Error loading externalized runs for {ext_ids}: {e}")
        return strategies

    if "all_ranked_stocks" not in exclude_set:
        snap_by_id = {}
        snap_by_idx = {}
        try:
            scursor = db[RANKED_SNAPSHOTS_COLLECTION].find(
                {"strategy_id": {"$in": ext_ids}},
                {"_id": 0, "strategy_id": 1, "run_id": 1, "run_index": 1, "all_ranked_stocks": 1},
            )
            for sdoc in scursor:
                sid = sdoc.get("strategy_id")
                rid = sdoc.get("run_id")
                ridx = sdoc.get("run_index")
                stocks = sdoc.get("all_ranked_stocks")
                if stocks is not None:
                    if sid and rid:
                        snap_by_id[(sid, rid)] = stocks
                    if sid is not None and ridx is not None:
                        snap_by_idx[(sid, ridx)] = stocks
        except Exception as e:
            logger.warning(f"Error loading externalized ranked snapshots for {ext_ids}: {e}")

        for sid, rlist in runs_by_strat.items():
            for idx, r in enumerate(rlist):
                rid = r.get("run_id")
                stocks = snap_by_id.get((sid, rid)) if rid else None
                if stocks is None:
                    stocks = snap_by_idx.get((sid, idx))
                if stocks is not None:
                    r["all_ranked_stocks"] = stocks

    for s in ext_strats:
        sid = s["id"]
        ext_runs = runs_by_strat.get(sid)
        if ext_runs:
            s["runs"] = ext_runs
            s["runs_count"] = len(ext_runs)
    return strategies


def _write_externalized_run_and_snapshot(db, safe_user, strategy_id, run_idx, run_entry):
    """Persists a single run document + its optional all_ranked_stocks snapshot into normalized collections."""
    run_id = run_entry.get("run_id") or f"run_{run_idx}_{uuid.uuid4().hex[:8]}"
    doc_id = f"{strategy_id}:{run_id}"
    all_ranked = run_entry.get("all_ranked_stocks")

    run_doc = {k: v for k, v in run_entry.items() if k != "all_ranked_stocks"}
    run_doc["_id"] = doc_id
    run_doc["username"] = safe_user
    run_doc["strategy_id"] = strategy_id
    run_doc["run_id"] = run_id
    run_doc["run_index"] = run_idx
    db[RUNS_COLLECTION].replace_one({"_id": doc_id}, run_doc, upsert=True)

    if all_ranked is not None:
        snap_doc = {
            "_id": doc_id,
            "username": safe_user,
            "strategy_id": strategy_id,
            "run_id": run_id,
            "run_index": run_idx,
            "all_ranked_stocks": all_ranked,
        }
        db[RANKED_SNAPSHOTS_COLLECTION].replace_one({"_id": doc_id}, snap_doc, upsert=True)


def _strip_strategy_runs_header(strategy):
    """Returns a copy of strategy with runs externalized out of the parent user document."""
    runs = strategy.get("runs") or []
    header = dict(strategy)
    header["runs"] = []
    header["runs_externalized"] = True
    header["runs_count"] = len(runs) if runs else int(strategy.get("runs_count") or 0)
    return header


def load_user_momentum_smallcases(username=None):
    """Loads all momentum indices and full strategies (rehydrating externalized runs) for user."""
    user = _resolve_username(username)
    path = _file(username)
    try:
        from db_store import load_user_doc_db
        import db_store
        data = load_user_doc_db("momentum_smallcases", user, path, default_factory=dict)
        if db_store.db is not None and isinstance(data, dict) and data.get("strategies"):
            _rehydrate_external_runs_for_strategies(db_store.db, data["strategies"])
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
    """
    Saves full momentum data (used by admin backup/restore, reset, and JSON fallback).
    When MongoDB is connected, externalizes strategy runs and all_ranked_stocks into
    dedicated normalized collections so the user doc stays well below MongoDB's 16 MB cap.
    """
    user = _resolve_username(username)
    safe_u = _safe_user(user)
    path = _file(username)
    try:
        import db_store
        if db_store.db is not None and isinstance(data, dict):
            col = db_store.db["momentum_smallcases"]
            from pymongo import ReplaceOne
            run_ops = []
            snap_ops = []
            header_strategies = []
            for strat in (data.get("strategies") or []):
                if not isinstance(strat, dict):
                    continue
                sid = strat.get("id")
                runs = strat.get("runs") or []
                for idx, r in enumerate(runs):
                    if not isinstance(r, dict) or not sid:
                        continue
                    rid = r.get("run_id") or f"run_{idx}_{uuid.uuid4().hex[:8]}"
                    doc_id = f"{sid}:{rid}"
                    all_ranked = r.get("all_ranked_stocks")
                    run_doc = {k: v for k, v in r.items() if k != "all_ranked_stocks"}
                    run_doc.update({
                        "_id": doc_id,
                        "username": safe_u,
                        "strategy_id": sid,
                        "run_id": rid,
                        "run_index": idx,
                    })
                    run_ops.append(ReplaceOne({"_id": doc_id}, run_doc, upsert=True))
                    if all_ranked is not None:
                        snap_ops.append(ReplaceOne(
                            {"_id": doc_id},
                            {
                                "_id": doc_id,
                                "username": safe_u,
                                "strategy_id": sid,
                                "run_id": rid,
                                "run_index": idx,
                                "all_ranked_stocks": all_ranked,
                            },
                            upsert=True,
                        ))
                header_strategies.append(_strip_strategy_runs_header(strat))

            db_store.db[RUNS_COLLECTION].delete_many({"username": safe_u})
            db_store.db[RANKED_SNAPSHOTS_COLLECTION].delete_many({"username": safe_u})
            if run_ops:
                db_store.db[RUNS_COLLECTION].bulk_write(run_ops, ordered=False)
            if snap_ops:
                db_store.db[RANKED_SNAPSHOTS_COLLECTION].bulk_write(snap_ops, ordered=False)

            header_doc = dict(data)
            header_doc["strategies"] = header_strategies
            col.replace_one({"_id": safe_u}, {"_id": safe_u, "username": user, "data": header_doc}, upsert=True)

            # Update local JSON backup cleanly
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, path)
            return
    except Exception as e:
        logger.warning(f"Normalized MongoDB save_user_momentum_smallcases fallback for {user}: {e}")

    try:
        from db_store import save_user_doc_db
        save_user_doc_db("momentum_smallcases", user, data, path)
    except Exception:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
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


def parse_stocks_input(stocks_str, verify_symbols=True):
    """
    Parses stocks input in format:
    [stockname1, DD/MM/YYYY] or [stockname1, DD/MM/YYYY, DD/MM/YYYY(exit)]
    Automatically resolves stock / company names to official NSE ticker symbols when verify_symbols=True.
    Returns a list of parsed stock dictionaries ordered by date_added ascending.
    """
    if not stocks_str or not isinstance(stocks_str, str):
        return []

    if verify_symbols:
        try:
            from modules.momentum_smallcases.symbol_resolver import resolve_and_parse_stocks
            parsed = resolve_and_parse_stocks(stocks_str)
            if parsed:
                return parsed
        except Exception as e:
            logger.warning(f"Error resolving symbols in parse_stocks_input: {e}")

    results = []
    seen = set()

    # Match [symbol, date_added] or [symbol, date_added, date_exited]
    pattern = re.compile(
        r'\[\s*([^,\]\r\n]+?)\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})'
        r'(?:\s*,\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}))?\s*\]'
    )
    matches = pattern.findall(stocks_str)

    for symbol_raw, date_raw, exit_raw in matches:
        sym = symbol_raw.strip().upper()
        if not sym:
            continue
        if verify_symbols:
            try:
                from modules.momentum_smallcases.symbol_resolver import resolve_symbol
                sym = resolve_symbol(sym)
            except Exception:
                pass
        norm_date = normalize_date(date_raw)
        norm_exit = normalize_date(exit_raw) if exit_raw else None
        key = (sym, norm_date, norm_exit)
        if key not in seen:
            seen.add(key)
            days = calculate_days_active(norm_date)
            item = {
                "symbol": sym,
                "date_added": norm_date,
                "days_active": days
            }
            if norm_exit:
                item["date_exited"] = norm_exit
            results.append(item)

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
    user = _resolve_username(username)
    data = None
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            doc = col.find_one({"_id": _safe_user(user)}, {"_id": 0, "data.indices": 1})
            if doc and isinstance(doc.get("data"), dict):
                data = doc["data"]
    except Exception as e:
        logger.warning(f"MongoDB projected get_user_indices fallback for {user}: {e}")

    if data is None:
        data = load_user_momentum_smallcases(user)

    indices = data.get("indices", [])
    if not isinstance(indices, list):
        indices = []
    for idx in indices:
        stks = idx.get("stocks", [])
        for s in stks:
            s["days_active"] = calculate_days_active(s.get("date_added", ""))
        stks.sort(key=lambda s: (parse_date_added_obj(s.get("date_added")), s.get("symbol", "")))
        idx["stocks"] = stks
    return indices


def _parse_store_date(d_val, fallback=None):
    """Fast ISO/common date parser delegating to calculator.parse_date_fast."""
    from modules.momentum_smallcases.momentum_smallcases_calculator import parse_date_fast
    return parse_date_fast(d_val, fallback=fallback)


def _coerce_trim_existing(trim_existing, default=False):
    """Uniformly coerces trim_existing bool/string flags."""
    if trim_existing is None:
        return default
    if isinstance(trim_existing, str):
        return trim_existing.strip().lower() not in ("no", "false", "0")
    return bool(trim_existing)


def _persist_strategy_update(username, strategy_id, target, new_run=None, new_capital_logs=None, set_fields=None):
    """
    Atomically updates a single strategy in MongoDB:
    - When new_run is provided, writes the run + all_ranked_stocks snapshot into
      normalized collections (momentum_smallcase_runs & momentum_smallcase_ranked_snapshots)
      and updates only lightweight summary fields + runs_count on the parent user doc.
    - When updating full strategy (e.g. Init or settings), externalizes runs cleanly.
    Falls back cleanly to load/save_user_momentum_smallcases when MongoDB is unavailable
    or the user doc doesn't yet exist in MongoDB.
    """
    user = _resolve_username(username)
    safe_u = _safe_user(user)
    try:
        import db_store
        if db_store.db is not None and user:
            db = db_store.db
            col = db["momentum_smallcases"]
            filt = {"_id": safe_u, "data.strategies.id": strategy_id}
            runs_list = target.get("runs") or []

            if new_run is not None and set_fields is not None:
                run_idx = max(0, len(runs_list) - 1)
                total_runs_count = len(runs_list)
                # Guard: if transitioning a non-externalized strategy to externalized storage,
                # preserve & migrate all pre-existing embedded runs (from full DB doc so
                # ranked_stocks/all_ranked_stocks aren't lost) before clearing data.strategies.$.runs.
                if not target.get("runs_externalized"):
                    prior_runs = []
                    try:
                        existing_doc = col.find_one(filt, {"_id": 0, "data.strategies.$": 1})
                        existing_strats = ((existing_doc or {}).get("data") or {}).get("strategies") or []
                        if existing_strats and isinstance(existing_strats[0].get("runs"), list):
                            prior_runs = existing_strats[0]["runs"]
                    except Exception:
                        prior_runs = []
                    if not prior_runs and len(runs_list) > 1:
                        prior_runs = runs_list[:-1]
                    for p_idx, p_run in enumerate(prior_runs):
                        _write_externalized_run_and_snapshot(db, safe_u, strategy_id, p_idx, p_run)
                    run_idx = max(run_idx, len(prior_runs))
                    total_runs_count = max(total_runs_count, run_idx + 1)

                _write_externalized_run_and_snapshot(db, safe_u, strategy_id, run_idx, new_run)

                ext_set = dict(set_fields)
                ext_set["runs_externalized"] = True
                ext_set["runs_count"] = total_runs_count
                ext_set["runs"] = []
                update_ops = {
                    "$set": {f"data.strategies.$.{k}": v for k, v in ext_set.items()},
                }
                if new_capital_logs:
                    update_ops["$push"] = {
                        "data.strategies.$.capital_logs": (
                            {"$each": new_capital_logs} if len(new_capital_logs) > 1 else new_capital_logs[0]
                        )
                    }
                res = col.update_one(filt, update_ops)
            else:
                for idx, r in enumerate(runs_list):
                    _write_externalized_run_and_snapshot(db, safe_u, strategy_id, idx, r)
                header_target = _strip_strategy_runs_header(target) if runs_list else target
                res = col.update_one(filt, {"$set": {"data.strategies.$": header_target}})

            if res.matched_count > 0:
                target["runs_externalized"] = True
                target["runs_count"] = len(runs_list)
                return True
    except Exception as e:
        logger.warning(f"MongoDB targeted strategy update fallback for {user}/{strategy_id}: {e}")

    data = load_user_momentum_smallcases(user)
    strategies = data.setdefault("strategies", [])
    replaced = False
    for idx, s in enumerate(strategies):
        if s.get("id") == strategy_id:
            strategies[idx] = target
            replaced = True
            break
    if not replaced:
        strategies.insert(0, target)
    save_user_momentum_smallcases(data, user)
    return True


def _fetch_projected_strategy(strategy_id, username=None, exclude_run_fields=None, rehydrate_runs=True):
    """
    Loads a single strategy via MongoDB $filter projection with optional
    server-side field exclusions (e.g. 'all_ranked_stocks', 'ranked_stocks'),
    transparently rehydrating externalized runs from momentum_smallcase_runs
    unless rehydrate_runs=False (for header-only updates).
    """
    user = _resolve_username(username)
    try:
        import db_store
        if db_store.db is not None and user:
            db = db_store.db
            col = db["momentum_smallcases"]
            pipeline = [
                {"$match": {"_id": _safe_user(user)}},
                {"$project": {
                    "_id": 0,
                    "strategies": {
                        "$filter": {
                            "input": {"$ifNull": ["$data.strategies", []]},
                            "as": "s",
                            "cond": {"$eq": ["$$s.id", strategy_id]}
                        }
                    }
                }},
            ]
            if not rehydrate_runs:
                pipeline.append({"$project": {"strategies.runs": 0}})
            elif exclude_run_fields:
                pipeline.append({
                    "$project": {f"strategies.runs.{field}": 0 for field in exclude_run_fields}
                })
            agg = list(col.aggregate(pipeline))
            if agg:
                matched = agg[0].get("strategies") or []
                if matched:
                    strat = matched[0]
                    if rehydrate_runs:
                        _rehydrate_external_runs_for_strategies(db, [strat], exclude_run_fields=exclude_run_fields)
                    return _normalize_strategy_summary_fields(strat)
                return None
    except Exception as e:
        logger.warning(f"MongoDB projected strategy fallback for {user}/{strategy_id}: {e}")

    strategies = get_user_strategies(user)
    return next((x for x in strategies if x.get("id") == strategy_id), None)


def _get_strategy_without_ranked_arrays(strategy_id, username=None):
    """Loads a single strategy stripped of ranked_stocks and all_ranked_stocks on MongoDB's server."""
    return _fetch_projected_strategy(
        strategy_id,
        username=username,
        exclude_run_fields=("ranked_stocks", "all_ranked_stocks"),
    )


def _verify_and_backfill_manual_index_stocks(parsed_stocks, index_id, verify_and_sync=True):
    """
    Verifies parsed manual index symbols against NSE master + stock_closing_prices,
    adds missing valid stocks into `stock_closing_prices` & `custom_tracked_stocks`,
    and strips non-eligible entries while producing a full summary report.
    """
    if not parsed_stocks:
        return [], {
            "already_available_count": 0,
            "already_available_symbols": [],
            "newly_added_count": 0,
            "newly_added_symbols": [],
            "not_eligible_count": 0,
            "not_eligible": [],
        }

    # Preserve non-DB offline behavior when verify_and_sync is False or DB is disconnected
    import db_store
    if not verify_and_sync or db_store.db is None:
        verified_list = []
        not_elig = []
        for s in parsed_stocks:
            if s.get("verified", True):
                clean = {k: v for k, v in s.items() if k != "verify_reason"}
                verified_list.append(clean)
            else:
                not_elig.append({
                    "input": s.get("original_name") or s.get("symbol"),
                    "symbol": s.get("symbol"),
                    "reason": s.get("verify_reason") or "Symbol verification failed",
                })
        kept = verified_list if verified_list else parsed_stocks
        return kept, {
            "already_available_count": len({s["symbol"] for s in kept}),
            "already_available_symbols": sorted({s["symbol"] for s in kept}),
            "newly_added_count": 0,
            "newly_added_symbols": [],
            "not_eligible_count": len(not_elig),
            "not_eligible": not_elig,
        }

    from modules.stock_closing_prices.stock_closing_prices_provider import stock_closing_prices_provider
    report = stock_closing_prices_provider.ensure_symbols_in_closing_prices(
        parsed_stocks,
        source="manual_index",
        manual_index_id=index_id,
    )
    not_elig_syms = {str(x.get("symbol") or "").upper() for x in (report.get("not_eligible") or [])}
    not_elig_inputs = {str(x.get("input") or "").upper() for x in (report.get("not_eligible") or [])}

    eligible_stocks = []
    for s in parsed_stocks:
        sym = str(s.get("symbol") or "").strip().upper()
        orig = str(s.get("original_name") or sym).strip().upper()
        if not s.get("verified", True) or sym in not_elig_syms or orig in not_elig_inputs:
            continue
        clean = {k: v for k, v in s.items() if k not in ("verified", "verify_reason")}
        eligible_stocks.append(clean)

    return eligible_stocks, report


def create_user_index(name, description, stocks_str, username=None, verify_and_sync_prices=True):
    """Creates a new manual index with verified constituents and ensures DB closing prices."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Index name is required")

    description = (description or "").strip()
    parsed_stocks = parse_stocks_input(stocks_str, verify_symbols=verify_and_sync_prices)
    new_id = f"midx_{uuid.uuid4().hex[:12]}"
    eligible_stocks, sync_report = _verify_and_backfill_manual_index_stocks(
        parsed_stocks, new_id, verify_and_sync=verify_and_sync_prices
    )
    if parsed_stocks and not eligible_stocks:
        first_reasons = "; ".join(
            f"{e.get('input')}: {e.get('reason')}" for e in (sync_report.get("not_eligible") or [])[:5]
        )
        raise ValueError(f"No eligible verified stocks found ({first_reasons})")

    raw_formatted = format_stocks_output(eligible_stocks) if eligible_stocks else (stocks_str or "").strip()

    now_iso = datetime.now().isoformat()
    new_index = {
        "id": new_id,
        "name": name,
        "description": description,
        "stocks": eligible_stocks,
        "raw_stocks": raw_formatted,
        "stock_count": len(eligible_stocks),
        "created_at": now_iso,
        "updated_at": now_iso
    }

    user = _resolve_username(username)
    persisted = False
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            res = col.update_one(
                {"_id": _safe_user(user), "data.indices": {"$type": "array"}},
                {
                    "$set": {"username": user},
                    "$push": {"data.indices": {"$each": [new_index], "$position": 0}},
                },
            )
            persisted = res.matched_count > 0
    except Exception as e:
        logger.warning(f"MongoDB targeted create_user_index fallback for {user}: {e}")

    if not persisted:
        data = load_user_momentum_smallcases(user)
        indices = data.setdefault("indices", [])
        indices.insert(0, new_index)
        save_user_momentum_smallcases(data, user)

    clear_constituents_cache()
    ret_index = dict(new_index)
    ret_index["sync_report"] = sync_report
    return ret_index


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

    if enrich_quotes:
        clean_syms = []
        for s in stocks:
            sym = s.get("symbol")
            if sym:
                clean_syms.append(sym.strip().upper().replace('.NS', '').replace('.BO', ''))
        clean_syms = list(dict.fromkeys(clean_syms))

        db_quotes = {}
        if clean_syms:
            try:
                import db_store
                if db_store.db is not None:
                    cursor = db_store.db["stock_closing_prices"].find(
                        {"_id": {"$in": clean_syms}},
                        {"latest_close": 1, "change": 1, "change_pct": 1, "company_name": 1}
                    )
                    for doc in cursor:
                        db_quotes[str(doc.get("_id") or "").strip().upper()] = doc
            except Exception as e:
                logger.debug(f"Batch quote enrichment fallback: {e}")

        for s in stocks:
            sym = s.get("symbol")
            if not sym:
                continue
            clean_s = sym.strip().upper().replace('.NS', '').replace('.BO', '')
            try:
                doc = db_quotes.get(clean_s)
                if not doc:
                    import db_store
                    if db_store.db is None:
                        doc = db_store.load_stock_closing_prices_db(symbol=clean_s, summary_only=True)
                if doc and doc.get("latest_close") is not None:
                    s["current_price"] = doc.get("latest_close")
                    s["change"] = doc.get("change") or 0.0
                    s["change_percent"] = doc.get("change_pct") or 0.0
                    s["company_name"] = doc.get("company_name") or sym
                elif _fetcher:
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


def update_user_index(index_id, name, description, stocks_str, username=None, verify_and_sync_prices=True):
    """Updates an existing manual index, verifies & backfills missing closing prices in DB."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Index name is required")

    description = (description or "").strip()
    parsed_stocks = parse_stocks_input(stocks_str, verify_symbols=verify_and_sync_prices)
    eligible_stocks, sync_report = _verify_and_backfill_manual_index_stocks(
        parsed_stocks, index_id, verify_and_sync=verify_and_sync_prices
    )
    if parsed_stocks and not eligible_stocks:
        first_reasons = "; ".join(
            f"{e.get('input')}: {e.get('reason')}" for e in (sync_report.get("not_eligible") or [])[:5]
        )
        raise ValueError(f"No eligible verified stocks found ({first_reasons})")

    raw_formatted = format_stocks_output(eligible_stocks) if eligible_stocks else (stocks_str or "").strip()
    now_iso = datetime.now().isoformat()

    user = _resolve_username(username)
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            res = col.update_one(
                {"_id": _safe_user(user), "data.indices.id": index_id},
                {
                    "$set": {
                        "data.indices.$.name": name,
                        "data.indices.$.description": description,
                        "data.indices.$.stocks": eligible_stocks,
                        "data.indices.$.raw_stocks": raw_formatted,
                        "data.indices.$.stock_count": len(eligible_stocks),
                        "data.indices.$.updated_at": now_iso,
                    }
                },
            )
            if res.matched_count > 0:
                clear_constituents_cache()
                updated = get_user_index(index_id, username=user, enrich_quotes=False)
                if isinstance(updated, dict):
                    updated["sync_report"] = sync_report
                return updated
    except Exception as e:
        logger.warning(f"MongoDB targeted update_user_index fallback for {user}/{index_id}: {e}")

    data = load_user_momentum_smallcases(user)
    indices = data.get("indices", [])
    target = next((x for x in indices if x.get("id") == index_id), None)
    if not target:
        raise ValueError(f"Manual Index with ID '{index_id}' not found")

    target["name"] = name
    target["description"] = description
    target["stocks"] = eligible_stocks
    target["raw_stocks"] = raw_formatted
    target["stock_count"] = len(eligible_stocks)
    target["updated_at"] = now_iso

    save_user_momentum_smallcases(data, user)
    clear_constituents_cache()
    ret = dict(target)
    ret["sync_report"] = sync_report
    return ret


def delete_user_index(index_id, username=None):
    """Deletes a manual index by ID."""
    user = _resolve_username(username)
    target_id = str(index_id or "").strip()

    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            res = col.update_one(
                {"_id": _safe_user(user)},
                {"$pull": {"data.indices": {"id": target_id}}}
            )
            if res.modified_count > 0:
                return True
            if user != 'admin':
                res_admin = col.update_one(
                    {"_id": _safe_user('admin')},
                    {"$pull": {"data.indices": {"id": target_id}}}
                )
                if res_admin.modified_count > 0:
                    return True
            return False
    except Exception as e:
        logger.warning(f"MongoDB targeted delete_user_index fallback for {user}/{target_id}: {e}")

    data = load_user_momentum_smallcases(user)
    indices = data.get("indices", [])
    initial_len = len(indices)
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
    Retrieves constituent stocks (including membership intervals when tracked) for a given index.
    Returns list of dicts: [{"symbol": "...", "date_added": ..., "date_exited": ..., "intervals": [...]}]
    """
    def _build_official_entries(data):
        hist = data.get("constituent_history") or []
        if hist:
            entries = []
            for h in hist:
                sym = str(h.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                ivs = h.get("intervals") or []
                first_iv = ivs[0] if ivs else {}
                last_iv = ivs[-1] if ivs else {}
                entries.append({
                    "symbol": sym,
                    "date_added": first_iv.get("date_added"),
                    "date_exited": last_iv.get("date_exited") if not h.get("currently_active", True) else None,
                    "intervals": ivs,
                })
            if entries:
                return entries
        stocks = data.get("stocks") or []
        return [{"symbol": s.get("symbol", ""), "date_added": None} for s in stocks if s.get("symbol")]

    if index_type == "manual" or str(index_id).startswith("midx_"):
        idx = get_user_index(index_id, username=username)
        if not idx:
            # Fallback to official nifty benchmark index if not found in user indices
            try:
                from modules.index_stocks.index_stocks_provider import index_stocks_provider
                data = index_stocks_provider.get_index_stocks(index_id)
                if data and ("constituent_history" in data or "stocks" in data):
                    return _build_official_entries(data)
            except Exception:
                pass
            return []
        return idx.get("stocks", [])
    else:
        # Nifty official index (short 300s TTL cache avoids ~8.9s repeat DB fetch per rebalance)
        cache_key = str(index_id or "").strip()
        now_mono = time.monotonic()
        with _CONSTITUENTS_CACHE_LOCK:
            cached_entry = _CONSTITUENTS_CACHE.get(cache_key)
            if cached_entry and (now_mono - cached_entry[0]) < _CONSTITUENTS_CACHE_TTL_SEC:
                return [dict(item) for item in cached_entry[1]]

        try:
            from modules.index_stocks.index_stocks_provider import index_stocks_provider
            data = index_stocks_provider.get_index_stocks(index_id)
            if data and ("constituent_history" in data or "stocks" in data):
                result = _build_official_entries(data)
                if result:
                    with _CONSTITUENTS_CACHE_LOCK:
                        _CONSTITUENTS_CACHE[cache_key] = (time.monotonic(), tuple(dict(item) for item in result))
                return result
        except Exception as e:
            logger.warning(f"Error fetching Nifty index constituents for '{index_id}': {e}")
        # Fallback to user index if not found in Nifty benchmarks
        idx = get_user_index(index_id, username=username)
        if idx:
            return idx.get("stocks", [])
        return []


def calculate_strategy_next_rebalance(base_date, rebalance_day, holidays_set=None):
    """
    Computes next rebalance date based on rebalance_day, and adjusts
    for weekends and official trading holidays.
    """
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        get_next_trading_day,
        get_official_trading_holidays,
        parse_date_fast,
    )

    base = parse_date_fast(base_date, fallback=base_date)

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
    if holidays_set is None:
        holidays_set = get_official_trading_holidays()
    adjusted_date, was_moved = get_next_trading_day(scheduled_date, holidays_set)

    return scheduled_date, adjusted_date, was_moved


def _normalize_strategy_summary_fields(s):
    """Computes normalized capital and PnL summary fields on a strategy dict in-place."""
    cap = float(s.get("total_capital") if s.get("total_capital") is not None else s.get("amount_to_invest", 0.0))
    port_val = float(s.get("current_portfolio_value") if s.get("current_portfolio_value") is not None else cap)
    pnl = float(s.get("total_pnl") if s.get("total_pnl") is not None else (port_val - cap))
    pnl_pct = float(s.get("total_pnl_percent") if s.get("total_pnl_percent") is not None else (((pnl / cap) * 100.0) if cap > 0 else 0.0))
    s["total_capital"] = round(cap, 2)
    s["total_pnl"] = round(pnl, 2)
    s["total_pnl_percent"] = round(pnl_pct, 2)
    return s


def get_user_strategies(username=None):
    """Retrieves all momentum smallcase strategies (full payload) for the user."""
    data = load_user_momentum_smallcases(username)
    strategies = data.get("strategies", [])
    for s in strategies:
        _normalize_strategy_summary_fields(s)
    return strategies


def get_user_strategies_summary(username=None):
    """
    Retrieves lightweight strategy summaries for the Smallcases list view.
    Uses MongoDB server-side $project/$map so heavy runs[], holdings[], and rankings
    are never transferred over the network.
    """
    user = _resolve_username(username)
    strategies = None
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            agg = list(col.aggregate([
                {"$match": {"_id": _safe_user(user)}},
                {"$project": {
                    "_id": 0,
                    "strategies": {
                        "$map": {
                            "input": {"$ifNull": ["$data.strategies", []]},
                            "as": "s",
                            "in": {
                                "id": "$$s.id",
                                "name": "$$s.name",
                                "start_date": "$$s.start_date",
                                "effective_start_date": "$$s.effective_start_date",
                                "index_id": "$$s.index_id",
                                "index_name": "$$s.index_name",
                                "index_type": "$$s.index_type",
                                "no_of_stocks": "$$s.no_of_stocks",
                                "exit_regime_ranking": "$$s.exit_regime_ranking",
                                "rebalance_day": "$$s.rebalance_day",
                                "trim_existing": "$$s.trim_existing",
                                "trading_days_per_month": "$$s.trading_days_per_month",
                                "initial_amount": "$$s.initial_amount",
                                "amount_to_invest": "$$s.amount_to_invest",
                                "total_capital": "$$s.total_capital",
                                "current_portfolio_value": "$$s.current_portfolio_value",
                                "current_wallet": "$$s.current_wallet",
                                "last_stepup_amount": "$$s.last_stepup_amount",
                                "total_fees_paid": "$$s.total_fees_paid",
                                "total_pnl": "$$s.total_pnl",
                                "total_pnl_percent": "$$s.total_pnl_percent",
                                "status": "$$s.status",
                                "next_rebalance_date": "$$s.next_rebalance_date",
                                "created_at": "$$s.created_at",
                                "updated_at": "$$s.updated_at",
                                "runs_count": {"$ifNull": ["$$s.runs_count", {"$size": {"$ifNull": ["$$s.runs", []]}}]}
                            }
                        }
                    }
                }}
            ]))
            if agg:
                strategies = agg[0].get("strategies") or []
            else:
                # Document may not exist yet in MongoDB; check local JSON fallback if present
                path = _file(user)
                if not os.path.exists(path):
                    strategies = []
    except Exception as e:
        logger.warning(f"MongoDB projected get_user_strategies_summary fallback for {user}: {e}")

    if strategies is None:
        full_strategies = get_user_strategies(user)
        strategies = []
        for s in full_strategies:
            summary_item = {
                k: s.get(k)
                for k in (
                    "id", "name", "start_date", "effective_start_date",
                    "index_id", "index_name", "index_type",
                    "no_of_stocks", "exit_regime_ranking", "rebalance_day",
                    "trim_existing", "trading_days_per_month",
                    "initial_amount", "amount_to_invest", "total_capital",
                    "current_portfolio_value", "current_wallet", "last_stepup_amount",
                    "total_fees_paid", "total_pnl", "total_pnl_percent",
                    "status", "next_rebalance_date", "created_at", "updated_at"
                )
            }
            summary_item["runs_count"] = int(s.get("runs_count") or len(s.get("runs") or []))
            strategies.append(summary_item)

    for s in strategies:
        _normalize_strategy_summary_fields(s)
    return strategies


def get_user_strategies_for_compare(username=None):
    """
    Retrieves strategies with run valuation milestones, holdings symbols, and transactions
    needed for the Compare Created Smallcases popup, stripping heavy ranked_stocks and
    all_ranked_stocks arrays on MongoDB's server.
    """
    user = _resolve_username(username)
    strategies = None
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            agg = list(col.aggregate([
                {"$match": {"_id": _safe_user(user)}},
                {"$project": {
                    "_id": 0,
                    "strategies": {
                        "$map": {
                            "input": {"$ifNull": ["$data.strategies", []]},
                            "as": "s",
                            "in": {
                                "id": "$$s.id",
                                "name": "$$s.name",
                                "start_date": "$$s.start_date",
                                "index_id": "$$s.index_id",
                                "index_name": "$$s.index_name",
                                "index_type": "$$s.index_type",
                                "no_of_stocks": "$$s.no_of_stocks",
                                "exit_regime_ranking": "$$s.exit_regime_ranking",
                                "rebalance_day": "$$s.rebalance_day",
                                "trim_existing": "$$s.trim_existing",
                                "trading_days_per_month": "$$s.trading_days_per_month",
                                "amount_to_invest": "$$s.amount_to_invest",
                                "total_capital": "$$s.total_capital",
                                "current_portfolio_value": "$$s.current_portfolio_value",
                                "total_pnl": "$$s.total_pnl",
                                "total_pnl_percent": "$$s.total_pnl_percent",
                                "total_fees_paid": "$$s.total_fees_paid",
                                "status": "$$s.status",
                                "runs_externalized": "$$s.runs_externalized",
                                "runs_count": "$$s.runs_count",
                                "runs": {
                                    "$map": {
                                        "input": {"$ifNull": ["$$s.runs", []]},
                                        "as": "r",
                                        "in": {
                                            "executed_date": "$$r.executed_date",
                                            "scheduled_date": "$$r.scheduled_date",
                                            "title": "$$r.title",
                                            "run_type": "$$r.run_type",
                                            "eligible_stocks_count": "$$r.eligible_stocks_count",
                                            "transactions": {
                                                "$map": {
                                                    "input": {"$ifNull": ["$$r.transactions", {"$ifNull": ["$$r.portfolio_snapshot.transactions", []]}]},
                                                    "as": "tx",
                                                    "in": {
                                                        "symbol": "$$tx.symbol",
                                                        "stock": "$$tx.stock",
                                                        "action": "$$tx.action"
                                                    }
                                                }
                                            },
                                            "portfolio_snapshot": {
                                                "total_capital": "$$r.portfolio_snapshot.total_capital",
                                                "total_portfolio_value": "$$r.portfolio_snapshot.total_portfolio_value",
                                                "total_pnl": "$$r.portfolio_snapshot.total_pnl",
                                                "total_pnl_percent": "$$r.portfolio_snapshot.total_pnl_percent",
                                                "holdings": {
                                                    "$map": {
                                                        "input": {"$ifNull": ["$$r.portfolio_snapshot.holdings", []]},
                                                        "as": "h",
                                                        "in": {
                                                            "symbol": "$$h.symbol",
                                                            "quantity": "$$h.quantity",
                                                            "current_value": "$$h.current_value"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }}
            ]))
            if agg:
                strategies = agg[0].get("strategies") or []
                ext_ids = [
                    s["id"] for s in strategies
                    if isinstance(s, dict) and s.get("id") and (
                        s.get("runs_externalized") or (not s.get("runs") and int(s.get("runs_count") or 0) > 0)
                    )
                ]
                if ext_ids:
                    comp_runs_by_strat = {sid: [] for sid in ext_ids}
                    comp_cursor = db_store.db[RUNS_COLLECTION].find(
                        {"strategy_id": {"$in": ext_ids}},
                        {
                            "_id": 0,
                            "strategy_id": 1,
                            "executed_date": 1,
                            "scheduled_date": 1,
                            "title": 1,
                            "run_type": 1,
                            "eligible_stocks_count": 1,
                            "transactions.symbol": 1,
                            "transactions.stock": 1,
                            "transactions.action": 1,
                            "portfolio_snapshot.total_capital": 1,
                            "portfolio_snapshot.total_portfolio_value": 1,
                            "portfolio_snapshot.total_pnl": 1,
                            "portfolio_snapshot.total_pnl_percent": 1,
                            "portfolio_snapshot.holdings.symbol": 1,
                            "portfolio_snapshot.holdings.quantity": 1,
                            "portfolio_snapshot.holdings.current_value": 1,
                        },
                    ).sort([("strategy_id", 1), ("run_index", 1)])
                    for rdoc in comp_cursor:
                        sid = rdoc.pop("strategy_id", None)
                        if sid in comp_runs_by_strat:
                            comp_runs_by_strat[sid].append(rdoc)
                    for s in strategies:
                        sid = s.get("id")
                        if sid in comp_runs_by_strat and comp_runs_by_strat[sid]:
                            s["runs"] = comp_runs_by_strat[sid]
            else:
                path = _file(user)
                if not os.path.exists(path):
                    strategies = []
    except Exception as e:
        logger.warning(f"MongoDB projected get_user_strategies_for_compare fallback for {user}: {e}")

    if strategies is None:
        strategies = get_user_strategies(user)

    for s in strategies:
        _normalize_strategy_summary_fields(s)
    return strategies


def get_user_strategy(strategy_id, username=None, include_all_ranked=True):
    """Retrieves a single strategy by ID using MongoDB $filter projection when available."""
    exclude_fields = None if include_all_ranked else ("all_ranked_stocks",)
    return _fetch_projected_strategy(strategy_id, username=username, exclude_run_fields=exclude_fields)


def _resolve_index_metadata(index_id, username=None):
    """
    Resolves (index_name, index_type) for an index_id without downloading full
    constituent stock arrays or user strategies.
    """
    raw_id = str(index_id or "").strip()
    if not raw_id.startswith("midx_"):
        try:
            from modules.index_stocks.index_stocks_provider import INDEX_REGISTRY
            reg = INDEX_REGISTRY.get(raw_id)
            if not reg:
                upper_id = raw_id.upper()
                reg = next((v for k, v in INDEX_REGISTRY.items() if k.upper() == upper_id or str(v.get("name", "")).upper() == upper_id), None)
            if reg:
                return reg.get("name", raw_id), "nifty"
        except Exception:
            pass

    # Manual index (or non-registry fallback): project only index id & name
    user = _resolve_username(username)
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            agg = list(col.aggregate([
                {"$match": {"_id": _safe_user(user)}},
                {"$project": {
                    "_id": 0,
                    "indices": {
                        "$map": {
                            "input": {
                                "$filter": {
                                    "input": {"$ifNull": ["$data.indices", []]},
                                    "as": "idx",
                                    "cond": {"$eq": ["$$idx.id", raw_id]}
                                }
                            },
                            "as": "m",
                            "in": {"id": "$$m.id", "name": "$$m.name"}
                        }
                    }
                }}
            ]))
            if agg and agg[0].get("indices"):
                m = agg[0]["indices"][0]
                return m.get("name") or raw_id, "manual"
    except Exception as e:
        logger.warning(f"Projected _resolve_index_metadata fallback for {raw_id}: {e}")

    # Local JSON / full fallback
    all_indices = get_combined_indices_list(user)
    found_idx = next((x for x in all_indices if x["id"] == raw_id), None)
    if found_idx:
        return found_idx["name"], found_idx["type"]
    return raw_id, ("manual" if raw_id.startswith("midx_") else "nifty")


def _prepend_user_strategy(new_strategy, username=None):
    """
    Persists a newly created strategy at index 0 of data.strategies.
    Uses atomic MongoDB $push ($position: 0) when connected so existing strategies
    and run histories are never downloaded or re-uploaded.
    """
    user = _resolve_username(username)
    try:
        import db_store
        if db_store.db is not None and user:
            col = db_store.db["momentum_smallcases"]
            res = col.update_one(
                {"_id": _safe_user(user), "data.strategies": {"$type": "array"}},
                {
                    "$set": {"username": user},
                    "$push": {"data.strategies": {"$each": [new_strategy], "$position": 0}},
                },
            )
            if res.matched_count > 0:
                return
    except Exception as e:
        logger.warning(f"MongoDB atomic _prepend_user_strategy fallback for {user}: {e}")

    data = load_user_momentum_smallcases(user)
    strategies = data.setdefault("strategies", [])
    strategies.insert(0, new_strategy)
    save_user_momentum_smallcases(data, user)


def create_user_strategy(
    name,
    start_date,
    index_id,
    no_of_stocks,
    exit_regime_ranking,
    rebalance_day,
    amount_to_invest,
    formula=None,
    username=None,
    trim_existing=False,
    trading_days_per_month=21
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

    start_d = _parse_store_date(start_date_str)
    if not start_d or len(start_date_str) != 10:
        raise ValueError("Start date must be in YYYY-MM-DD format")

    today_d = now_ist().date()
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

    # Parse trim_existing (default False)
    trim_val = _coerce_trim_existing(trim_existing, default=False)

    # Parse trading_days_per_month (21 or 30, default 21)
    try:
        td_val = 30 if int(trading_days_per_month) == 30 else 21
    except Exception:
        td_val = 21

    # Identify index name & type without loading full index stock arrays or user strategies
    index_name, index_type = _resolve_index_metadata(index_id, username=username)

    # Check holiday adjustment for start date (reuse fetched holidays_set for next rebalance)
    holidays_set = get_official_trading_holidays()
    adj_start, was_moved_start = get_next_trading_day(start_d, holidays_set)

    # Compute first scheduled rebalance date
    _, first_next_rebal, _ = calculate_strategy_next_rebalance(adj_start, rebal_day, holidays_set=holidays_set)

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
        "trim_existing": trim_val,
        "trading_days_per_month": td_val,
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

    _prepend_user_strategy(new_strategy, username=username)

    return new_strategy


def update_user_strategy_formula(strategy_id, formula, username=None):
    """Updates formula for a strategy."""
    formula = (formula or "").strip()
    if not formula:
        raise ValueError("Formula cannot be empty")

    target = get_user_strategy(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found")

    now_iso = datetime.now().isoformat()
    target["formula"] = formula
    target["updated_at"] = now_iso
    _persist_strategy_update(username, strategy_id, target)
    return target


def update_user_strategy_settings(strategy_id, formula=None, trim_existing=None, trading_days_per_month=None, username=None):
    """Updates settings (formula, trim_existing, trading_days_per_month) for a strategy."""
    user = _resolve_username(username)
    target = _fetch_projected_strategy(
        strategy_id,
        username=user,
        exclude_run_fields=("ranked_stocks", "all_ranked_stocks"),
        rehydrate_runs=False,
    )
    if not target:
        raise ValueError("Strategy not found")

    set_fields = {}
    if formula is not None:
        f = (formula or "").strip()
        if f:
            target["formula"] = f
            set_fields["formula"] = f

    if trim_existing is not None:
        coerced_trim = _coerce_trim_existing(trim_existing)
        target["trim_existing"] = coerced_trim
        set_fields["trim_existing"] = coerced_trim

    if trading_days_per_month is not None:
        try:
            td = 21 if int(trading_days_per_month) == 21 else 30
            target["trading_days_per_month"] = td
            set_fields["trading_days_per_month"] = td
        except Exception:
            pass

    now_iso = datetime.now().isoformat()
    target["updated_at"] = now_iso
    set_fields["updated_at"] = now_iso

    updated_direct = False
    try:
        import db_store
        if db_store.db is not None and user:
            res = db_store.db["momentum_smallcases"].update_one(
                {"_id": _safe_user(user), "data.strategies.id": strategy_id},
                {"$set": {f"data.strategies.$.{k}": v for k, v in set_fields.items()}},
            )
            updated_direct = res.matched_count > 0
    except Exception as e:
        logger.warning(f"MongoDB lightweight settings update fallback for {user}/{strategy_id}: {e}")

    if not updated_direct:
        _persist_strategy_update(user, strategy_id, target)
    return target


def run_strategy_init(strategy_id, username=None, _target_ref=None, _preloaded_constituents=None, _preloaded_holidays=None, _save_cache=True):
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

    target = _target_ref if _target_ref is not None else get_user_strategy(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found")

    if target.get("status") == "ACTIVE" and len(target.get("runs", [])) > 0:
        raise ValueError("Init has already been executed for this strategy")

    # Determine execution date
    start_d = _parse_store_date(target["start_date"])
    holidays_set = _preloaded_holidays if _preloaded_holidays is not None else get_official_trading_holidays()
    exec_date, was_moved = get_next_trading_day(start_d, holidays_set)

    today_d = now_ist().date()
    if exec_date > today_d:
        moved_note = f" (adjusted from {start_d.strftime('%d/%m/%Y')})" if was_moved else ""
        raise ValueError(
            f"Cannot execute Init for future date ({exec_date.strftime('%d/%m/%Y')}{moved_note}). "
            f"Smallcase start date cannot be in the future (today is {today_d.strftime('%d/%m/%Y')})."
        )

    # 1. Fetch universe constituents
    constituents = _preloaded_constituents if _preloaded_constituents is not None else get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    if not constituents:
        raise ValueError(f"Index '{target.get('index_name')}' contains 0 constituent stocks. Please add stocks in Manual Indices.")

    # 1.1 Pre-warm daily quotes in parallel for constituents active on exec_date (~450d lookback)
    if _save_cache:
        from modules.momentum_smallcases.momentum_smallcases_calculator import filter_constituents_for_window
        active_constituents = filter_constituents_for_window(constituents, exec_date)
        symbols_to_warm = _extract_strategy_symbols(target, active_constituents)
        if symbols_to_warm:
            win_min = (exec_date - timedelta(days=450)).isoformat()
            win_max = exec_date.isoformat()
            _prewarm_symbols_for_window(
                symbols_to_warm,
                min_date_str=win_min,
                max_date_str=win_max,
                cutoff_date=exec_date,
                save_cache=True
            )

    # 2. Evaluate and rank stocks
    ranked_stocks, eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target.get("formula"),
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        return_meta=True,
        save_cache=_save_cache,
        trading_days_per_month=target.get("trading_days_per_month", 30)
    )

    if not ranked_stocks:
        if eligible_count == 0:
            earliest = meta.get("earliest_effective_date") or meta.get("earliest_date_added")
            earliest_str = earliest.strftime("%d/%m/%Y") if earliest else "N/A"
            latest = meta.get("latest_effective_date") or meta.get("latest_date_added")
            latest_str = latest.strftime("%d/%m/%Y") if latest else "N/A"
            exec_fmt = exec_date.strftime("%d/%m/%Y")
            raise ValueError(
                f"No constituent stocks in index '{target.get('index_name')}' were eligible on or before the Smallcase Start Date ({exec_fmt}). "
                f"Found {len(constituents)} stocks in this index, but their effective entry/price date is between {earliest_str} and {latest_str} (after start date {exec_fmt}). "
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

    # Calculate next scheduled rebalance date reusing already-fetched holidays
    _, next_rebal, _ = calculate_strategy_next_rebalance(exec_date, target["rebalance_day"], holidays_set=holidays_set)

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
        "all_ranked_stocks": meta.get("all_stocks") or ranked_stocks,
        "portfolio_snapshot": portfolio,
        "changes": portfolio.get("changes", {}),
        "exited_stocks": portfolio.get("exited_stocks", []),
        "transactions": portfolio.get("transactions", []),
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

    added_list = portfolio.get("changes", {}).get("added", [])
    target.setdefault("capital_logs", []).append({
        "id": f"clog_{uuid.uuid4().hex[:8]}",
        "timestamp": now_iso,
        "type": "PORTFOLIO_INIT",
        "run_id": init_run_entry["run_id"],
        "run_number": 0,
        "amount": target["amount_to_invest"],
        "fees": portfolio["fees_paid"],
        "wallet_after": portfolio["wallet_balance"],
        "notes": f"Init completed: Bought {len(added_list)} stocks. Fees: ₹{portfolio['fees_paid']:.2f}. Remaining cash in wallet: ₹{portfolio['wallet_balance']:.2f}"
    })

    _persist_strategy_update(username, strategy_id, target)
    return target


def run_strategy_rebalance(
    strategy_id,
    stepup_amount=0.0,
    username=None,
    save_cache=True,
    trim_existing=None,
    _target_ref=None,
    _preloaded_constituents=None,
    _preloaded_holidays=None,
):
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

    target = _target_ref if _target_ref is not None else _get_strategy_without_ranked_arrays(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found")

    if target.get("status") != "ACTIVE" or not target.get("runs"):
        raise ValueError("Please run Init before rebalancing")

    runs = target.setdefault("runs", [])
    prev_holdings = target.get("holdings", [])
    prev_wallet = target.get("current_wallet", 0.0)

    # Next scheduled date
    sched_rebal_str = target.get("next_rebalance_date") or date.today().isoformat()
    rebal_d = _parse_store_date(sched_rebal_str, fallback=date.today())
    holidays_set = _preloaded_holidays if _preloaded_holidays is not None else get_official_trading_holidays()
    exec_date, was_moved = get_next_trading_day(rebal_d, holidays_set)

    today_d = now_ist().date()
    if exec_date > today_d:
        moved_note = f" (adjusted from {rebal_d.strftime('%d/%m/%Y')})" if was_moved else ""
        raise ValueError(
            f"Cannot execute rebalance for future date ({exec_date.strftime('%d/%m/%Y')}{moved_note}). "
            f"Market data is not available for future dates (today is {today_d.strftime('%d/%m/%Y')})."
        )

    now_iso = datetime.now().isoformat()
    new_capital_logs = []

    # Step-up capital handling
    stepup = float(stepup_amount or 0.0)
    if stepup > 0:
        target["amount_to_invest"] = round(target.get("amount_to_invest", 0.0) + stepup, 2)
        stepup_log = {
            "id": f"clog_{uuid.uuid4().hex[:8]}",
            "timestamp": now_iso,
            "type": "STEPUP_DEPOSIT",
            "amount": stepup,
            "wallet_after": round(prev_wallet + stepup, 2),
            "notes": f"Step-up capital added prior to rebalance: ₹{stepup:,.2f}"
        }
        target.setdefault("capital_logs", []).append(stepup_log)
        new_capital_logs.append(stepup_log)

    # Fetch index constituents up to rebalance date (reuse across Rebalance All iterations)
    constituents = _preloaded_constituents if _preloaded_constituents is not None else get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    if not constituents:
        raise ValueError("No constituents found for index")

    # Standalone rebalance windowed pre-warming (~450d lookback up to exec_date)
    # Pre-filter by membership date first so historically exited stocks don't slow down DB prewarm
    if save_cache:
        from modules.momentum_smallcases.momentum_smallcases_calculator import filter_constituents_for_window
        active_constituents = filter_constituents_for_window(constituents, exec_date)
        symbols_to_warm = _extract_strategy_symbols(target, active_constituents)
        if symbols_to_warm:
            win_min = (exec_date - timedelta(days=450)).isoformat()
            win_max = exec_date.isoformat()
            _prewarm_symbols_for_window(
                symbols_to_warm,
                min_date_str=win_min,
                max_date_str=win_max,
                cutoff_date=exec_date,
                save_cache=True
            )

    # Rank universe
    ranked_stocks, eligible_count, meta = rank_and_evaluate_universe(
        stock_items=constituents,
        target_date=exec_date,
        formula_str=target.get("formula"),
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        return_meta=True,
        save_cache=save_cache,
        trading_days_per_month=target.get("trading_days_per_month", 30)
    )

    if not ranked_stocks:
        if eligible_count == 0:
            raise ValueError(f"No constituent stocks in index '{target.get('index_name')}' were eligible on rebalance date {exec_date}.")
        failed_syms = meta.get("failed_symbols", [])
        failed_str = ", ".join(failed_syms[:5]) if failed_syms else "stocks"
        raise ValueError(f"Could not calculate momentum metrics for rebalance date ({failed_str}).")

    # Execute rebalance equal weight allocation
    trim_existing_eff = _coerce_trim_existing(trim_existing, default=_coerce_trim_existing(target.get("trim_existing"), default=False))
    if trim_existing is not None:
        target["trim_existing"] = trim_existing_eff

    # Accumulate total capital with stepup
    curr_cap = float(target.get("total_capital") if target.get("total_capital") is not None else target.get("amount_to_invest", 0.0))
    total_cap_effective = round(curr_cap + float(stepup or 0.0), 2)

    portfolio = execute_rebalance_run(
        ranked_stocks=ranked_stocks,
        previous_holdings=prev_holdings,
        previous_wallet=prev_wallet,
        stepup_amount=stepup,
        no_of_stocks=target["no_of_stocks"],
        exit_regime_ranking=target["exit_regime_ranking"],
        target_date=exec_date,
        all_universe_stocks=meta.get("all_stocks"),
        total_capital=total_cap_effective,
        trim_existing=trim_existing_eff
    )

    # Next future rebalance date reusing already-loaded holidays
    _, next_rebal, _ = calculate_strategy_next_rebalance(exec_date, target["rebalance_day"], holidays_set=holidays_set)

    rebal_number = sum(1 for r in runs if r.get("run_type") == "REBALANCE") + 1
    rebal_run_entry = {
        "run_id": f"run_rebal_{uuid.uuid4().hex[:10]}",
        "run_type": "REBALANCE",
        "run_number": rebal_number,
        "title": f"Rebalance #{rebal_number}",
        "stepup_amount": stepup,
        "scheduled_date": sched_rebal_str,
        "executed_date": exec_date.isoformat(),
        "is_holiday_adjusted": was_moved,
        "formula_used": target.get("formula"),
        "eligible_stocks_count": eligible_count,
        "ranked_stocks": ranked_stocks,
        "all_ranked_stocks": meta.get("all_stocks") or ranked_stocks,
        "portfolio_snapshot": portfolio,
        "changes": portfolio.get("changes", {}),
        "exited_stocks": portfolio.get("exited_stocks", []),
        "transactions": portfolio.get("transactions", []),
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
    target["last_stepup_amount"] = stepup
    target["next_rebalance_date"] = next_rebal.isoformat()
    target["updated_at"] = now_iso

    changes = portfolio.get("changes", {})
    rebal_log = {
        "id": f"clog_{uuid.uuid4().hex[:8]}",
        "timestamp": now_iso,
        "type": "REBALANCE_EXECUTED",
        "run_id": rebal_run_entry["run_id"],
        "run_number": rebal_number,
        "amount": stepup,
        "fees": portfolio["fees_paid"],
        "wallet_after": portfolio["wallet_balance"],
        "notes": f"Rebalance #{rebal_number} executed on {exec_date}. Added: {len(changes.get('added', []))}, Removed: {len(changes.get('removed', []))}, Retained: {len(changes.get('retained', []))}. Fees: ₹{portfolio['fees_paid']:.2f}. Wallet: ₹{portfolio['wallet_balance']:.2f}"
    }
    target.setdefault("capital_logs", []).append(rebal_log)
    new_capital_logs.append(rebal_log)

    set_fields = {
        "holdings": target["holdings"],
        "current_wallet": target["current_wallet"],
        "current_portfolio_value": target["current_portfolio_value"],
        "total_capital": target["total_capital"],
        "total_pnl": target["total_pnl"],
        "total_pnl_percent": target["total_pnl_percent"],
        "total_fees_paid": target["total_fees_paid"],
        "last_stepup_amount": target["last_stepup_amount"],
        "next_rebalance_date": target["next_rebalance_date"],
        "updated_at": target["updated_at"],
        "amount_to_invest": target.get("amount_to_invest"),
        "trim_existing": target.get("trim_existing"),
    }
    _persist_strategy_update(
        username,
        strategy_id,
        target,
        new_run=rebal_run_entry,
        new_capital_logs=new_capital_logs,
        set_fields=set_fields,
    )
    return target


def _resolve_withdrawal_bounds(strategy):
    """
    Computes allowed withdrawal date bounds [min_date, max_date]:
    - min_date: executed/scheduled date of the latest INIT or REBALANCE run
    - max_date: min(next_rebalance_date, today_IST) so users cannot withdraw
      before last rebalance, after next rebalance, or in the future.
    Returns (min_date, max_date, today_d, next_rebal_d).
    """
    runs = strategy.get("runs") or []
    last_rebal_d = None
    for r in runs:
        if r and r.get("run_type") in ("INIT", "REBALANCE"):
            d_obj = _parse_store_date(r.get("executed_date") or r.get("scheduled_date"))
            if d_obj is not None and (last_rebal_d is None or d_obj > last_rebal_d):
                last_rebal_d = d_obj

    if last_rebal_d is None:
        last_rebal_d = _parse_store_date(strategy.get("start_date"))

    today_d = now_ist().date()
    next_rebal_d = _parse_store_date(strategy.get("next_rebalance_date"))
    max_d = min(today_d, next_rebal_d) if next_rebal_d is not None else today_d
    if last_rebal_d is not None and max_d < last_rebal_d:
        max_d = last_rebal_d
    return last_rebal_d, max_d, today_d, next_rebal_d


def get_strategy_withdrawal_prices(strategy_id, target_date_str=None, symbols=None, username=None):
    """
    Returns closing prices for active strategy holdings on `target_date_str`
    (or most recent prior trading day if weekend/holiday), along with valid date bounds.
    """
    target = _get_strategy_without_ranked_arrays(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found.")

    holdings = target.get("holdings") or []
    min_d, max_d, today_d, next_rebal_d = _resolve_withdrawal_bounds(target)

    if target_date_str:
        w_date = _parse_store_date(target_date_str)
        if w_date is None:
            raise ValueError(f"Invalid withdrawal date: '{target_date_str}'")
    else:
        w_date = max_d

    if w_date > today_d:
        raise ValueError(
            f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) cannot be in the future "
            f"(today is {today_d.strftime('%d/%m/%Y')})."
        )
    if min_d is not None and w_date < min_d:
        raise ValueError(
            f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) cannot be earlier than "
            f"last rebalance date ({min_d.strftime('%d/%m/%Y')})."
        )
    if next_rebal_d is not None and w_date > next_rebal_d:
        raise ValueError(
            f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) cannot be after "
            f"next rebalance date ({next_rebal_d.strftime('%d/%m/%Y')})."
        )

    req_syms = [
        str(s).strip().upper()
        for s in (symbols or [h.get("symbol") for h in holdings])
        if s
    ]
    req_syms = list(dict.fromkeys(req_syms))
    holdings_by_sym = {str(h.get("symbol") or "").strip().upper(): h for h in holdings}

    prices_out = {}
    if req_syms:
        from modules.momentum_smallcases.momentum_smallcases_calculator import (
            prewarm_stock_prices_cache,
            fetch_stock_daily_series,
        )
        win_min = (w_date - timedelta(days=20)).isoformat()
        prewarm_stock_prices_cache(req_syms, min_date=win_min, max_date=w_date.isoformat())
        for sym in req_syms:
            try:
                series = fetch_stock_daily_series(sym, target_cutoff_date=w_date, min_date=win_min)
                if series:
                    actual_dt, px = series[-1]
                    actual_iso = actual_dt.isoformat() if hasattr(actual_dt, "isoformat") else str(actual_dt)[:10]
                    prices_out[sym] = {
                        "price": round(float(px), 2),
                        "price_date": actual_iso,
                        "exact_match": actual_iso == w_date.isoformat(),
                    }
                    continue
            except Exception as ex:
                logger.debug(f"Withdrawal price lookup fallback for {sym} on {w_date}: {ex}")
            h = holdings_by_sym.get(sym, {})
            fb_px = float(h.get("current_price") or h.get("buy_price") or 0.0)
            prices_out[sym] = {
                "price": round(fb_px, 2),
                "price_date": None,
                "exact_match": False,
            }

    return {
        "success": True,
        "date": w_date.isoformat(),
        "min_date": min_d.isoformat() if min_d else None,
        "max_date": max_d.isoformat() if max_d else None,
        "next_rebalance_date": next_rebal_d.isoformat() if next_rebal_d else None,
        "today": today_d.isoformat(),
        "prices": prices_out,
    }


def _normalize_withdraw_destination(raw_mode):
    val = str(raw_mode or "OUT_OF_WALLET").strip().upper().replace("-", "_").replace(" ", "_")
    if val in ("TO_WALLET", "WALLET", "IN_WALLET", "INTO_WALLET"):
        return "TO_WALLET"
    if val in ("OUT_OF_WALLET", "OUT", "EXTERNAL", "BANK"):
        return "OUT_OF_WALLET"
    raise ValueError(f"Unsupported withdrawal type '{raw_mode}'. Choose 'TO_WALLET' or 'OUT_OF_WALLET'.")


def run_strategy_withdrawal(strategy_id, withdrawals, comments="", username=None, withdraw_to="OUT_OF_WALLET", withdrawal_date=None):
    """
    Executes a partial or full withdrawal from active strategy holdings.
    - withdrawals: list of dicts: [{"symbol": "INFY", "quantity": 5, "price": 1820.0}, ...]
    - withdraw_to: "TO_WALLET" (credits net proceeds to smallcase wallet) or
      "OUT_OF_WALLET" (cash exits smallcase; wallet balance unchanged).
    - withdrawal_date: optional YYYY-MM-DD date within [last_rebalance_date, min(next_rebalance_date, today)].
    - Validates holdings, date bounds, prices, and quantities.
    - Creates SELL transactions with type 'WITHDRAWAL' and logs explicit withdrawal type.
    - Appends a WITHDRAWAL run entry to strategy['runs'] and capital_logs.
    """
    target = _get_strategy_without_ranked_arrays(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found.")

    if target.get("status") not in ("ACTIVE", "PAUSED"):
        raise ValueError("Cannot withdraw from a strategy that is not active.")

    current_holdings = target.get("holdings", [])
    if not current_holdings:
        raise ValueError("No active holdings found in strategy to withdraw.")

    if not withdrawals or not isinstance(withdrawals, list):
        raise ValueError("No stock withdrawals specified.")

    dest_mode = _normalize_withdraw_destination(withdraw_to)
    is_to_wallet = (dest_mode == "TO_WALLET")
    dest_label = "To Wallet" if is_to_wallet else "Out of Wallet"
    cap_log_type = "WITHDRAWAL_TO_WALLET" if is_to_wallet else "WITHDRAWAL_OUT_OF_WALLET"

    min_d, max_d, today_d, next_rebal_d = _resolve_withdrawal_bounds(target)
    if withdrawal_date:
        w_date = _parse_store_date(withdrawal_date)
        if w_date is None:
            raise ValueError(f"Invalid withdrawal date format: '{withdrawal_date}'")
        if w_date > today_d:
            raise ValueError(
                f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) cannot be in the future "
                f"(today is {today_d.strftime('%d/%m/%Y')})."
            )
        if min_d is not None and w_date < min_d:
            raise ValueError(
                f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) must be on or after the "
                f"last rebalance date ({min_d.strftime('%d/%m/%Y')})."
            )
        if next_rebal_d is not None and w_date > next_rebal_d:
            raise ValueError(
                f"Withdrawal date ({w_date.strftime('%d/%m/%Y')}) cannot be after the "
                f"next rebalance date ({next_rebal_d.strftime('%d/%m/%Y')})."
            )
    else:
        w_date = max_d

    now_dt = now_ist()
    now_iso = now_dt.isoformat()
    exec_date_str = w_date.isoformat()

    holdings_by_sym = {h["symbol"].strip().upper(): h for h in current_holdings}

    transactions = []
    exited_stocks = []
    total_withdrawn_amount = 0.0
    total_withdrawn_cost = 0.0
    total_withdrawn_pnl = 0.0
    total_withdrawn_fees = 0.0
    item_notes_collected = []

    runs = target.setdefault("runs", [])
    withdrawal_num = len([r for r in runs if r.get("run_type") == "WITHDRAWAL"]) + 1

    for item in withdrawals:
        sym = str(item.get("symbol") or "").strip().upper()
        if not sym or sym not in holdings_by_sym:
            continue
        h = holdings_by_sym[sym]
        avail_qty = int(h.get("quantity", 0))
        req_qty = int(item.get("quantity", 0))
        if req_qty <= 0:
            continue
        if req_qty > avail_qty:
            raise ValueError(f"Withdrawal quantity ({req_qty}) exceeds available holdings ({avail_qty}) for {sym}.")

        buy_price = float(h.get("buy_price") or 0.0)
        raw_item_price = item.get("price")
        curr_price = float(raw_item_price if raw_item_price not in (None, "") else (h.get("current_price") or buy_price))
        if curr_price <= 0:
            raise ValueError(f"Withdrawal price must be positive for {sym}.")

        amt = round(req_qty * curr_price, 2)
        cost = round(req_qty * buy_price, 2)
        pnl = round(amt - cost, 2)
        pnl_pct = round((pnl / cost) * 100.0, 2) if cost > 0 else 0.0
        fee = round(amt * 0.0010, 2)  # 0.10% transaction fee
        item_comment = str(item.get("comments") or comments or "Portfolio Withdrawal").strip()
        if item_comment and item_comment != "Portfolio Withdrawal" and item_comment not in item_notes_collected:
            item_notes_collected.append(item_comment)

        total_withdrawn_amount += amt
        total_withdrawn_cost += cost
        total_withdrawn_pnl += pnl
        total_withdrawn_fees += fee

        tx = {
            "transaction_id": f"tx_wdr_{uuid.uuid4().hex[:10]}",
            "symbol": sym,
            "company_name": h.get("company_name") or sym,
            "action": "SELL",
            "action_label": f"WITHDRAW ({req_qty})",
            "quantity": req_qty,
            "price": round(curr_price, 2),
            "amount": amt,
            "buy_price": round(buy_price, 2),
            "pnl": pnl,
            "pnl_percent": pnl_pct,
            "fee": fee,
            "type": "WITHDRAWAL",
            "withdrawal_type": dest_mode,
            "withdrawal_type_label": dest_label,
            "comments": item_comment,
            "notes": item_comment,
            "date": exec_date_str,
            "run_title": f"Withdrawal #{withdrawal_num} ({dest_label})",
            "timestamp": now_iso
        }
        transactions.append(tx)

        # Update or reduce holding quantity
        rem_qty = avail_qty - req_qty
        if rem_qty > 0:
            h["quantity"] = rem_qty
            h["invested"] = round(rem_qty * buy_price, 2)
            h["current_value"] = round(rem_qty * curr_price, 2)
            h["pnl"] = round(h["current_value"] - h["invested"], 2)
            h["pnl_percent"] = round((h["pnl"] / h["invested"]) * 100.0, 2) if h["invested"] > 0 else 0.0
        else:
            exited_stocks.append({
                "symbol": sym,
                "quantity": req_qty,
                "average_price": round(buy_price, 2),
                "exit_price": round(curr_price, 2),
                "invested": cost,
                "exit_value": amt,
                "pnl": pnl,
                "pnl_percent": pnl_pct
            })
            h["quantity"] = 0
            h["current_value"] = 0.0
            h["invested"] = 0.0

    if not transactions:
        raise ValueError("No valid stock quantities were selected for withdrawal.")

    # Filter out holdings that now have 0 quantity
    updated_holdings = [h for h in current_holdings if h.get("quantity", 0) > 0]

    old_wallet = float(target.get("current_wallet") or 0.0)
    net_withdrawn_proceeds = round(total_withdrawn_amount - total_withdrawn_fees, 2)
    curr_cap = float(target.get("total_capital") if target.get("total_capital") is not None else target.get("amount_to_invest", 0.0))

    if is_to_wallet:
        wallet_bal = round(old_wallet + max(0.0, net_withdrawn_proceeds), 2)
        new_cap = curr_cap
    else:
        wallet_bal = old_wallet
        new_cap = max(0.0, round(curr_cap - total_withdrawn_cost, 2))

    target["total_capital"] = new_cap
    target["amount_to_invest"] = new_cap
    target["current_wallet"] = wallet_bal

    # Recalculate weights and remaining valuation
    total_remaining_val = sum(h.get("current_value", 0.0) for h in updated_holdings)
    for h in updated_holdings:
        if new_cap > 0:
            h["weight_percent"] = round((h.get("invested", 0.0) / new_cap) * 100.0, 2)
        elif total_remaining_val > 0:
            h["weight_percent"] = round((h["current_value"] / total_remaining_val) * 100.0, 2)
        else:
            h["weight_percent"] = 0.0

    target["holdings"] = updated_holdings
    target["current_portfolio_value"] = round(total_remaining_val + wallet_bal, 2)
    target["total_fees_paid"] = round(target.get("total_fees_paid", 0.0) + total_withdrawn_fees, 2)
    target["total_pnl"] = round(target["current_portfolio_value"] - new_cap, 2)
    target["total_pnl_percent"] = round((target["total_pnl"] / new_cap) * 100.0, 2) if new_cap > 0 else 0.0
    target["updated_at"] = now_iso

    eff_comments = str(comments or "").strip() or ("; ".join(item_notes_collected) if item_notes_collected else "")

    # Append WITHDRAWAL run entry
    import copy
    snapshot_holdings = copy.deepcopy(updated_holdings)
    run_entry = {
        "run_id": f"run_wdr_{uuid.uuid4().hex[:10]}",
        "run_type": "WITHDRAWAL",
        "withdrawal_type": dest_mode,
        "withdrawal_type_label": dest_label,
        "wallet_credited": is_to_wallet,
        "run_number": len(runs) + 1,
        "title": f"Withdrawal #{withdrawal_num} ({dest_label})",
        "scheduled_date": exec_date_str,
        "executed_date": exec_date_str,
        "comments": eff_comments,
        "total_withdrawn_amount": round(total_withdrawn_amount, 2),
        "net_withdrawn_amount": net_withdrawn_proceeds,
        "total_withdrawn_pnl": round(total_withdrawn_pnl, 2),
        "total_withdrawn_cost": round(total_withdrawn_cost, 2),
        "fees_paid": round(total_withdrawn_fees, 2),
        "exited_stocks": exited_stocks,
        "transactions": transactions,
        "portfolio_snapshot": {
            "holdings": snapshot_holdings,
            "exited_stocks": exited_stocks,
            "wallet_balance": wallet_bal,
            "total_portfolio_value": target["current_portfolio_value"],
            "total_capital": new_cap,
            "total_pnl": target["total_pnl"],
            "total_pnl_percent": target["total_pnl_percent"]
        },
        "executed_at": now_iso
    }
    runs.append(run_entry)

    # Capital audit log for withdrawal (preserving withdrawal type & date)
    wallet_note = (
        f"Credited net ₹{net_withdrawn_proceeds:,.2f} to wallet."
        if is_to_wallet
        else "Withdrawn out of wallet (wallet balance unchanged)."
    )
    wdr_log = {
        "id": f"clog_{uuid.uuid4().hex[:8]}",
        "timestamp": now_iso,
        "withdrawal_date": exec_date_str,
        "type": cap_log_type,
        "withdrawal_type": dest_mode,
        "withdrawal_type_label": dest_label,
        "run_id": run_entry["run_id"],
        "amount": round(total_withdrawn_amount, 2),
        "realized_pnl": round(total_withdrawn_pnl, 2),
        "fees": round(total_withdrawn_fees, 2),
        "wallet_after": wallet_bal,
        "notes": (
            f"Withdrawal #{withdrawal_num} ({dest_label}, Date: {w_date.strftime('%d/%m/%Y')}): "
            f"Withdrawn ₹{total_withdrawn_amount:,.2f} across {len(transactions)} stocks. "
            f"Realized P&L: ₹{total_withdrawn_pnl:,.2f}. {wallet_note} {eff_comments}"
        ).strip()
    }
    target.setdefault("capital_logs", []).append(wdr_log)

    set_fields = {
        "total_capital": target["total_capital"],
        "amount_to_invest": target["amount_to_invest"],
        "current_wallet": target["current_wallet"],
        "holdings": target["holdings"],
        "current_portfolio_value": target["current_portfolio_value"],
        "total_fees_paid": target["total_fees_paid"],
        "total_pnl": target["total_pnl"],
        "total_pnl_percent": target["total_pnl_percent"],
        "updated_at": target["updated_at"],
    }
    _persist_strategy_update(
        username,
        strategy_id,
        target,
        new_run=run_entry,
        new_capital_logs=[wdr_log],
        set_fields=set_fields,
    )
    return {
        "success": True,
        "strategy": target,
        "run": run_entry,
        "withdrawal_type": dest_mode,
        "withdrawal_type_label": dest_label,
        "withdrawal_date": exec_date_str,
        "wallet_after": wallet_bal,
        "withdrawn_amount": round(total_withdrawn_amount, 2),
        "withdrawn_pnl": round(total_withdrawn_pnl, 2),
        "withdrawn_count": len(transactions),
        "message": f"Successfully withdrawn ₹{total_withdrawn_amount:,.2f} across {len(transactions)} stocks."
    }


def run_strategy_all_rebalances(strategy_id, stepup_per_rebalance=0.0, up_to_date=None, username=None, trim_existing=None, enforce_time_limit=True):
    """
    Executes Init (if strategy is in DRAFT status) and then sequentially executes
    all scheduled monthly rebalances up to up_to_date (defaults to today).
    Each rebalance run receives the specified stepup_per_rebalance capital amount.
    Pre-warms only the needed historical window upfront for fast, timeout-safe execution.
    """
    import time
    from modules.momentum_smallcases.momentum_smallcases_calculator import (
        save_price_cache,
        clear_db_prices_cache,
        get_official_trading_holidays,
    )

    target = _get_strategy_without_ranked_arrays(strategy_id, username=username)
    if not target:
        raise ValueError("Strategy not found")

    if trim_existing is not None:
        trim_existing_eff = _coerce_trim_existing(trim_existing)
        target["trim_existing"] = trim_existing_eff
        target["updated_at"] = datetime.now().isoformat()
        _persist_strategy_update(username, strategy_id, target)
    else:
        trim_existing_eff = _coerce_trim_existing(target.get("trim_existing"), default=False)

    today_d = now_ist().date()
    cutoff_d = _parse_store_date(up_to_date, fallback=today_d) if up_to_date else today_d

    if cutoff_d > today_d:
        raise ValueError(
            f"Cannot execute rebalance for future date ({cutoff_d.strftime('%d/%m/%Y')}). "
            f"Cutoff date cannot be in the future (today is {today_d.strftime('%d/%m/%Y')})."
        )

    # 0. Pre-load constituents & holidays ONCE, and pre-warm daily quotes for [earliest needed date - 450d .. cutoff_d]
    constituents = get_strategy_index_constituents(
        target["index_id"],
        target.get("index_type", "manual"),
        username=username
    )
    holidays_set = get_official_trading_holidays()
    symbols_to_warm = _extract_strategy_symbols(target, constituents)
    if symbols_to_warm:
        if target.get("status") == "DRAFT" or not target.get("runs"):
            base_d = _parse_store_date(target.get("start_date"), fallback=cutoff_d)
        elif target.get("next_rebalance_date"):
            base_d = _parse_store_date(target.get("next_rebalance_date"), fallback=cutoff_d)
        else:
            base_d = cutoff_d
        win_min = (base_d - timedelta(days=450)).isoformat()
        win_max = cutoff_d.isoformat()
        logger.info(f"Pre-warming {len(symbols_to_warm)} universe stock quotes ({win_min} to {win_max}) for batch rebalance...")
        _prewarm_symbols_for_window(
            symbols_to_warm,
            min_date_str=win_min,
            max_date_str=win_max,
            cutoff_date=cutoff_d,
            save_cache=True
        )

    init_executed = False
    rebalances_executed = 0
    batch_start_time = time.time()
    max_batch_seconds = 22.0  # Guard synchronous HTTP calls below reverse proxy timeout
    reached_time_limit = False

    try:
        # 1. Execute Init if DRAFT or no runs
        if target.get("status") == "DRAFT" or not target.get("runs"):
            start_d = _parse_store_date(target.get("start_date"))
            if start_d and start_d > cutoff_d:
                raise ValueError(f"Smallcase start date ({start_d}) is after cutoff date ({cutoff_d}). Cannot run Init.")
            target = run_strategy_init(
                strategy_id,
                username=username,
                _target_ref=target,
                _preloaded_constituents=constituents,
                _preloaded_holidays=holidays_set,
                _save_cache=False,
            )
            init_executed = True

        # 2. Iteratively execute all due rebalances up to cutoff_d
        max_rebal_runs = 150
        last_processed_date = None

        while rebalances_executed < max_rebal_runs:
            sched_rebal_str = target.get("next_rebalance_date")
            if not sched_rebal_str:
                break
            rebal_d = _parse_store_date(sched_rebal_str)
            if not rebal_d or rebal_d > cutoff_d:
                break
            if last_processed_date and rebal_d <= last_processed_date:
                logger.warning(f"Rebalance date did not advance: {rebal_d} <= {last_processed_date}")
                break

            if enforce_time_limit and rebalances_executed > 0 and (time.time() - batch_start_time) > max_batch_seconds:
                logger.info(f"Batch time limit ({max_batch_seconds}s) reached after {rebalances_executed} rebalances; returning cleanly.")
                reached_time_limit = True
                break

            try:
                target = run_strategy_rebalance(
                    strategy_id,
                    stepup_amount=float(stepup_per_rebalance or 0.0),
                    username=username,
                    save_cache=False,
                    trim_existing=trim_existing_eff,
                    _target_ref=target,
                    _preloaded_constituents=constituents,
                    _preloaded_holidays=holidays_set,
                )
                rebalances_executed += 1
                last_processed_date = rebal_d
            except ValueError as ve:
                if (rebalances_executed > 0 or init_executed) and "future date" in str(ve).lower():
                    break
                err_msg = f"Completed {'Init and ' if init_executed else ''}{rebalances_executed} rebalance(s), but stopped on {rebal_d}: {str(ve)}"
                if rebalances_executed > 0 or init_executed:
                    raise RuntimeError(err_msg)
                raise
            except Exception as e:
                logger.error(f"Error during batch rebalance on {rebal_d}: {e}", exc_info=True)
                err_msg = f"Completed {'Init and ' if init_executed else ''}{rebalances_executed} rebalance(s), but stopped on {rebal_d}: {str(e)}"
                if rebalances_executed > 0 or init_executed:
                    raise RuntimeError(err_msg)
                else:
                    raise

        save_price_cache()
    finally:
        clear_db_prices_cache()

    final_target = get_user_strategy(strategy_id, username=username, include_all_ranked=False) or target
    total_runs = (1 if init_executed else 0) + rebalances_executed

    if total_runs == 0:
        next_dt_str = final_target.get('next_rebalance_date', '')
        next_d_obj = _parse_store_date(next_dt_str)
        next_fmt = next_d_obj.strftime("%d/%m/%Y") if next_d_obj else next_dt_str
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
    """Deletes a strategy by ID atomically across user doc and externalized run collections."""
    user = _resolve_username(username)
    target_id = str(strategy_id or "").strip()

    try:
        import db_store
        if db_store.db is not None and user:
            db = db_store.db
            col = db["momentum_smallcases"]
            res = col.update_one(
                {"_id": _safe_user(user)},
                {"$pull": {"data.strategies": {"id": target_id}}}
            )
            deleted = res.modified_count > 0
            if not deleted and user != 'admin':
                res_admin = col.update_one(
                    {"_id": _safe_user('admin')},
                    {"$pull": {"data.strategies": {"id": target_id}}}
                )
                deleted = res_admin.modified_count > 0
            if deleted:
                db[RUNS_COLLECTION].delete_many({"strategy_id": target_id})
                db[RANKED_SNAPSHOTS_COLLECTION].delete_many({"strategy_id": target_id})
                return True
            return False
    except Exception as e:
        logger.warning(f"MongoDB targeted delete_user_strategy fallback for {user}/{target_id}: {e}")

    data = load_user_momentum_smallcases(user)
    strategies = data.get("strategies", [])
    initial_len = len(strategies)
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
    user = _resolve_username(username)
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
            db[RUNS_COLLECTION].delete_many({"username": safe_user})
            db[RANKED_SNAPSHOTS_COLLECTION].delete_many({"username": safe_user})
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
    strat = _get_strategy_without_ranked_arrays(strategy_id, username=username)
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
        return _parse_store_date(d_str)

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

    # Assign round/stint numbers chronologically per symbol
    from collections import defaultdict
    stints_by_sym = defaultdict(list)
    for s in all_stints:
        stints_by_sym[s["symbol"]].append(s)

    for sym, group in stints_by_sym.items():
        group.sort(key=lambda x: str(x.get("entry_date") or ""))
        tot = len(group)
        for idx, item in enumerate(group, 1):
            item["round_number"] = idx
            item["total_rounds"] = tot

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
# ASYNC EXECUTION JOBS REGISTRY & PERSISTENCE
# ==============================================================================

_EXECUTION_JOBS = {}
_JOBS_LOCK = threading.Lock()
_JOBS_FILE = os.path.join(_DATA_DIR, 'user_data', 'momentum_execution_jobs.json')


def _load_jobs_from_disk_locked(mark_stale_running=False):
    """Loads execution jobs from disk into memory without clobbering active jobs in peer workers."""
    global _EXECUTION_JOBS
    if not os.path.exists(_JOBS_FILE):
        return
    try:
        with open(_JOBS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict):
                current_pid = os.getpid()
                for k, v in data.items():
                    if not isinstance(v, dict):
                        continue
                    # Preserve full in-memory result if this worker already owns it
                    existing = _EXECUTION_JOBS.get(k)
                    if existing and existing.get("pid") == current_pid and existing.get("status") == "RUNNING":
                        continue
                    # Only mark orphan RUNNING jobs as FAILED on cold startup
                    if mark_stale_running and v.get("status") == "RUNNING":
                        v["status"] = "FAILED"
                        v["error"] = "Execution job was interrupted by server restart. Please re-trigger the rebalance."
                    _EXECUTION_JOBS[k] = v
    except Exception as e:
        logger.warning(f"Error loading momentum execution jobs from disk: {e}")


def _save_jobs_to_disk_locked():
    """Flushes lightweight execution job state to disk atomically (no giant result blobs)."""
    try:
        os.makedirs(os.path.dirname(_JOBS_FILE), exist_ok=True)
        compact_jobs = {}
        for k, v in list(_EXECUTION_JOBS.items())[-25:]:
            if not isinstance(v, dict):
                continue
            compact_jobs[k] = {
                "id": v.get("id"),
                "job_type": v.get("job_type"),
                "strategy_id": v.get("strategy_id"),
                "username": v.get("username"),
                "pid": v.get("pid"),
                "status": v.get("status"),
                "progress": v.get("progress"),
                "started_at": v.get("started_at"),
                "completed_at": v.get("completed_at"),
                "runs_count": v.get("runs_count"),
                "error": v.get("error"),
            }
        tmp = f"{_JOBS_FILE}.tmp.{os.getpid()}"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(compact_jobs, f, indent=2, ensure_ascii=False)
        os.replace(tmp, _JOBS_FILE)
    except Exception as e:
        logger.warning(f"Error saving momentum execution jobs to disk: {e}")


# Initialize jobs from disk on module import (cold startup cleanup only)
try:
    with _JOBS_LOCK:
        _load_jobs_from_disk_locked(mark_stale_running=True)
except Exception:
    pass


def start_async_execution_job(job_type, strategy_id, username=None, **kwargs):
    """
    Launches an execution job in a background thread and returns immediately with a unique job_id.
    Prevents 502 Bad Gateway timeouts caused by long calculations exceeding proxy limits (e.g. 30s).
    Persists compact job state to disk so multi-worker polling and restarts work seamlessly.
    """
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    owner_pid = os.getpid()
    with _JOBS_LOCK:
        if len(_EXECUTION_JOBS) > 25:
            completed_keys = [k for k, v in _EXECUTION_JOBS.items() if v.get("status") in ("COMPLETED", "FAILED")]
            for k in completed_keys[:-10]:
                _EXECUTION_JOBS.pop(k, None)

        _EXECUTION_JOBS[job_id] = {
            "id": job_id,
            "job_type": job_type,  # "INIT", "REBALANCE", "RUN_ALL"
            "strategy_id": strategy_id,
            "username": username,
            "pid": owner_pid,
            "status": "RUNNING",
            "progress": "Starting execution...",
            "started_at": datetime.now().isoformat(),
            "completed_at": None,
            "runs_count": None,
            "result": None,
            "error": None
        }
        _save_jobs_to_disk_locked()

    def _worker():
        try:
            logger.info(f"Async job {job_id} ({job_type}) started for strategy {strategy_id}")
            if job_type == "INIT":
                res = run_strategy_init(strategy_id, username=username)
            elif job_type == "REBALANCE":
                stepup = kwargs.get("stepup_amount", 0.0)
                trim_override = kwargs.get("trim_existing")
                res = run_strategy_rebalance(strategy_id, stepup_amount=stepup, username=username, trim_existing=trim_override)
            elif job_type == "RUN_ALL":
                stepup = kwargs.get("stepup_per_rebalance", 0.0)
                up_to = kwargs.get("up_to_date")
                trim_override = kwargs.get("trim_existing")
                res = run_strategy_all_rebalances(
                    strategy_id,
                    stepup_per_rebalance=stepup,
                    up_to_date=up_to,
                    username=username,
                    trim_existing=trim_override,
                    enforce_time_limit=False
                )
            else:
                raise ValueError(f"Unknown job type: {job_type}")

            res_strat = res.get("strategy") if isinstance(res, dict) and isinstance(res.get("strategy"), dict) else res
            runs_cnt = len(res_strat.get("runs") or []) if isinstance(res_strat, dict) else None

            with _JOBS_LOCK:
                if job_id in _EXECUTION_JOBS:
                    _EXECUTION_JOBS[job_id]["status"] = "COMPLETED"
                    _EXECUTION_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                    _EXECUTION_JOBS[job_id]["runs_count"] = runs_cnt
                    _EXECUTION_JOBS[job_id]["result"] = res
                    # Trim retained heavy result blobs on older COMPLETED jobs so RAM stays bounded
                    completed_with_res = [
                        k for k, v in _EXECUTION_JOBS.items()
                        if k != job_id and v.get("status") == "COMPLETED" and v.get("result") is not None
                    ]
                    for old_k in completed_with_res[:-1]:
                        _EXECUTION_JOBS[old_k]["result"] = None
                    _save_jobs_to_disk_locked()
            logger.info(f"Async job {job_id} ({job_type}) completed successfully")
        except Exception as e:
            logger.error(f"Error in async job {job_id} ({job_type}): {e}", exc_info=True)
            with _JOBS_LOCK:
                if job_id in _EXECUTION_JOBS:
                    _EXECUTION_JOBS[job_id]["status"] = "FAILED"
                    _EXECUTION_JOBS[job_id]["completed_at"] = datetime.now().isoformat()
                    _EXECUTION_JOBS[job_id]["error"] = str(e)
                    _save_jobs_to_disk_locked()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    return job_id


def get_execution_job_status(job_id):
    """Retrieves current status and result for an async execution job, safely syncing across worker processes."""
    current_pid = os.getpid()
    with _JOBS_LOCK:
        job = _EXECUTION_JOBS.get(job_id)
        if not job or (job.get("status") == "RUNNING" and job.get("pid") != current_pid):
            _load_jobs_from_disk_locked(mark_stale_running=False)
            job = _EXECUTION_JOBS.get(job_id)
        if not job:
            return None
        return dict(job)




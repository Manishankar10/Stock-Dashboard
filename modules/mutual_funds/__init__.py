"""Mutual fund discovery and personal investment tracking routes."""

from __future__ import annotations

import datetime as dt
import math
import os
import threading
import uuid
from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, render_template, request, send_from_directory, session
from db_store import load_user_doc_db, save_user_doc_db

from .mutual_funds_provider import AMFIError, AMFI_NAV_SOURCE, MFAPI_NAV_SOURCE, fetch_history, fetch_latest_navs, fetch_official_fund_facts, fetch_scheme_history


mutual_funds_bp = Blueprint("mutual_funds", __name__, template_folder=".")
_MODULE_DIR = Path(__file__).resolve().parent
_LOGIN_REQUIRED = None
_DATA_DIR = "."
_USER_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def init_mutual_funds(login_required, data_dir):
    global _LOGIN_REQUIRED, _DATA_DIR
    _LOGIN_REQUIRED = login_required
    _DATA_DIR = data_dir or "."


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is None:
            return jsonify({"error": "Mutual Funds module is not initialized."}), 500
        return _LOGIN_REQUIRED(view)(*args, **kwargs)
    return wrapper


def _safe_user():
    username = str(session.get("username", ""))
    safe = "".join(char for char in username if char.isalnum() or char in ("_", "-")).lower()
    return safe or "unknown"


def _lock_for_user():
    key = _safe_user()
    with _LOCKS_GUARD:
        return _USER_LOCKS.setdefault(key, threading.RLock())


def _data_path():
    return os.path.join(_DATA_DIR, "user_data", f"{_safe_user()}_mutual_funds.json")


def _empty_data():
    return {
        "schema_version": 1,
        "transactions": [],
        "sip_plans": [],
        "snapshots": [],
        "last_navs": {},
        "nav_history": {},
        "nav_history_ranges": {},
        "nav_history_sources": {},
        "updated_at": None,
    }


def _load_data():
    username = str(session.get("username", ""))
    saved = load_user_doc_db("mutual_funds", username, _data_path(), default_factory=dict)
    data = _empty_data()
    if isinstance(saved, dict):
        data.update(saved)
    for key in ("transactions", "sip_plans", "snapshots"):
        if not isinstance(data.get(key), list):
            data[key] = []
    for key in ("last_navs", "nav_history", "nav_history_ranges", "nav_history_sources"):
        if not isinstance(data.get(key), dict):
            data[key] = {}
    return data


def _save_data(data):
    filepath = _data_path()
    data["updated_at"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    save_user_doc_db("mutual_funds", str(session.get("username", "")), data, filepath)


def _as_date(value, field_name):
    if not value:
        raise ValueError(f"{field_name} is required.")
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid date.") from exc


def _today():
    # India has no daylight saving time; use its market timezone explicitly.
    india_time = dt.timezone(dt.timedelta(hours=5, minutes=30))
    return dt.datetime.now(india_time).date()


def _positive_amount(value):
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Investment amount must be a number.") from exc
    if not math.isfinite(amount) or amount <= 0 or amount > 100000000000:
        raise ValueError("Investment amount must be greater than zero and within the supported limit.")
    return round(amount, 2)


def _nav_map(schemes):
    return {str(item["scheme_code"]): item for item in schemes}


def _merge_nav_source(previous, current):
    if previous == current or previous == "mixed":
        return previous
    return "mixed" if previous else current


def _official_scheme_url(scheme):
    amc = str(scheme.get("amc") or "").lower()
    name = str(scheme.get("name") or "").lower()
    if "aditya birla sun life" in amc and "small cap fund" in name:
        return "https://mutualfund.adityabirlacapital.com/empower/equity-funds/small-cap-fund.html"
    if "motilal oswal" in amc and "midcap fund" in name:
        return "https://www.motilaloswalmf.com/mutual-funds/motilal-oswal-midcap-fund"
    # AMFI is the official industry disclosure source when an AMC-specific scheme
    # page has not yet been mapped for this fund.
    return "https://www.amfiindia.com/otherdata/scheme-wise-disclosure"


def _installment_dates(plan, through_date):
    start = dt.date.fromisoformat(plan["start_date"])
    scheduled_day = max(1, min(28, int(plan.get("installment_day") or start.day)))
    cursor = dt.date(start.year, start.month, scheduled_day)
    dates = []
    while cursor <= through_date:
        if cursor >= start:
            dates.append(cursor.isoformat())
        year = cursor.year + (1 if cursor.month == 12 else 0)
        month = 1 if cursor.month == 12 else cursor.month + 1
        cursor = dt.date(year, month, scheduled_day)
    return dates


def _missed_sips(data, as_of=None):
    today = as_of or _today()
    recorded = {
        (str(tx.get("scheme_code")), str(tx.get("scheduled_date")))
        for tx in data["transactions"] if tx.get("scheduled_date")
    }
    result = []
    seen_schedule_keys = set()
    for plan in data["sip_plans"]:
        if plan.get("status", "ACTIVE") != "ACTIVE":
            continue
        # A schedule due today becomes a missed installment tomorrow.
        for scheduled_date in _installment_dates(plan, today - dt.timedelta(days=1)):
            key = (str(plan.get("scheme_code")), scheduled_date)
            if key not in recorded and key not in seen_schedule_keys:
                seen_schedule_keys.add(key)
                result.append({
                    "sip_id": plan["id"],
                    "scheme_code": str(plan["scheme_code"]),
                    "scheme_name": plan["scheme_name"],
                    "amount": float(plan["amount"]),
                    "scheduled_date": scheduled_date,
                })
    result.sort(key=lambda row: (row["scheduled_date"], row["scheme_name"].casefold()))
    return result



def _xirr(transactions, current_value, as_of):
    cashflows = []
    for transaction in transactions:
        try:
            day = dt.date.fromisoformat(transaction.get("nav_date") or transaction.get("investment_date"))
            cashflows.append((day, -float(transaction.get("amount", 0))))
        except (TypeError, ValueError):
            continue
    if not cashflows or current_value <= 0:
        return None
    first = min(day for day, _ in cashflows)
    if first >= as_of:
        return None
    cashflows.append((as_of, current_value))
    days = [(day - first).days / 365.0 for day, _ in cashflows]

    def npv(rate):
        return sum(amount / ((1.0 + rate) ** years) for (_, amount), years in zip(cashflows, days))

    low, high = -0.9999, 10.0
    low_value, high_value = npv(low), npv(high)
    while low_value * high_value > 0 and high < 100000:
        high *= 2
        high_value = npv(high)
    if low_value * high_value > 0:
        return None
    for _ in range(100):
        middle = (low + high) / 2
        middle_value = npv(middle)
        if abs(middle_value) < 1e-7:
            return middle * 100
        if low_value * middle_value <= 0:
            high, high_value = middle, middle_value
        else:
            low, low_value = middle, middle_value
    return ((low + high) / 2) * 100


def _portfolio_response(data, feed):
    latest = _nav_map(feed["schemes"])
    units_by_code = {}
    invested_by_code = {}
    tx_by_code = {}
    for transaction in data["transactions"]:
        code = str(transaction.get("scheme_code", ""))
        units_by_code[code] = units_by_code.get(code, 0.0) + float(transaction.get("units", 0))
        invested_by_code[code] = invested_by_code.get(code, 0.0) + float(transaction.get("amount", 0))
        tx_by_code.setdefault(code, []).append(transaction)

    holdings = []
    total_value = 0.0
    total_invested = 0.0
    now = _today()
    for code, units in units_by_code.items():
        if units <= 0:
            continue
        entry = latest.get(code)
        transactions = tx_by_code.get(code, [])
        name = (entry or {}).get("name") or transactions[-1].get("scheme_name") or "Mutual fund scheme"
        nav = float(entry["nav"]) if entry else float(transactions[-1].get("nav", 0))
        nav_date = entry.get("nav_date") if entry else transactions[-1].get("nav_date")
        invested = invested_by_code.get(code, 0.0)
        current_value = units * nav
        total_value += current_value
        total_invested += invested
        holdings.append({
            "scheme_code": code,
            "scheme_name": name,
            "amc": (entry or {}).get("amc", ""),
            "units": units,
            "invested": invested,
            "current_nav": nav,
            "nav_date": nav_date,
            "current_value": current_value,
            "pnl": current_value - invested,
            "return_pct": ((current_value / invested) - 1) * 100 if invested else None,
            "nav_updated": bool(entry) and not feed.get("is_stale", False),
        })
    holdings.sort(key=lambda row: row["current_value"], reverse=True)
    return {
        "holdings": holdings,
        "transactions": sorted(data["transactions"], key=lambda row: (row.get("nav_date", ""), row.get("created_at", "")), reverse=True),
        "sip_plans": data["sip_plans"],
        "missed_sips": _missed_sips(data),
        "snapshots": data["snapshots"],
        "summary": {
            "invested": total_invested,
            "current_value": total_value,
            "pnl": total_value - total_invested,
            "return_pct": ((total_value / total_invested) - 1) * 100 if total_invested else None,
            "xirr": _xirr(data["transactions"], total_value, now),
            "holding_count": len(holdings),
            "sip_count": sum(1 for plan in data["sip_plans"] if plan.get("status", "ACTIVE") == "ACTIVE"),
            "missed_sip_count": len(_missed_sips(data)),
        },
        "nav_as_of": feed.get("nav_as_of"),
        "refreshed_at": feed.get("fetched_at"),
        "source": feed.get("source"),
        "source_label": feed.get("source_label"),
        "is_stale": bool(feed.get("is_stale")),
        "refresh_error": feed.get("refresh_error"),
        "updated_at": data.get("updated_at"),
    }


def _store_snapshot(data, response):
    if response.get("is_stale"):
        return
    nav_date = response.get("nav_as_of")
    if not nav_date:
        return
    snapshot = {
        "date": nav_date,
        "captured_at": response.get("refreshed_at"),
        "invested": response["summary"]["invested"],
        "current_value": response["summary"]["current_value"],
        "pnl": response["summary"]["pnl"],
        "nav_source": response.get("source"),
    }
    data["snapshots"] = [row for row in data["snapshots"] if row.get("date") != nav_date]
    data["snapshots"].append(snapshot)
    data["snapshots"].sort(key=lambda row: row.get("date", ""))
    data["snapshots"] = data["snapshots"][-4000:]


def _select_nav(code, requested_date, latest_feed=None, cached_data=None, fast=False, scheme_hint=None):
    current = _nav_map(latest_feed["schemes"]).get(str(code)) if latest_feed else None
    if current is None and cached_data:
        current = cached_data.get("last_navs", {}).get(str(code))
    if current is None:
        current = scheme_hint
    if current and current.get("nav_date") == requested_date.isoformat():
        return current
    end = min(requested_date + dt.timedelta(days=14), _today())
    if end < requested_date:
        raise ValueError("Investment date cannot be in the future.")

    if cached_data:
        ranges = cached_data.get("nav_history_ranges", {}).get(str(code), [])
        is_covered = any(
            isinstance(item, list) and len(item) == 2
            and item[0] <= requested_date.isoformat() and item[1] >= end.isoformat()
            for item in ranges
        )
        if is_covered:
            history = cached_data.get("nav_history", {}).get(str(code), {})
            eligible = [
                {"date": day, "nav": float(nav)} for day, nav in history.items()
                if requested_date.isoformat() <= day <= end.isoformat() and float(nav) > 0
            ]
            if eligible:
                eligible.sort(key=lambda row: row["date"])
                nav_source = cached_data.get("nav_history_sources", {}).get(str(code))
                source = MFAPI_NAV_SOURCE if nav_source == MFAPI_NAV_SOURCE else AMFI_NAV_SOURCE
                picked = eligible[0]
                return {"scheme_code": str(code), "nav": picked["nav"], "nav_date": picked["date"], "source": source}

    if fast:
        # This endpoint is scheme-specific and accepts the required date range;
        # keep its timeouts bounded so a failed provider cannot stall the action.
        try:
            rows = fetch_scheme_history(code, requested_date, end, timeout=(3, 6))
            fallback_used = True
        except AMFIError:
            try:
                rows = fetch_history(
                    requested_date, end,
                    amc_name=current.get("amc") if current else None,
                    scheme_type=current.get("scheme_type") if current else None,
                    form_only=True, timeout=(2, 4), fast_form=True,
                )
                fallback_used = False
            except AMFIError as fallback_error:
                raise AMFIError("Historical NAV lookup is temporarily unavailable. Please retry shortly.") from fallback_error
        eligible = [
            row for row in rows.get(str(code), [])
            if requested_date.isoformat() <= row["date"] <= end.isoformat() and float(row["nav"]) > 0
        ]
        if not eligible:
            raise ValueError("No published NAV was found for this scheme on or after that date. Choose another investment date.")
        eligible.sort(key=lambda row: row["date"])
        picked = eligible[0]
        source = MFAPI_NAV_SOURCE if fallback_used else AMFI_NAV_SOURCE
        if cached_data:
            code_key = str(code)
            history = cached_data.setdefault("nav_history", {}).setdefault(code_key, {})
            for row in rows.get(code_key, []):
                if requested_date.isoformat() <= row["date"] <= end.isoformat() and float(row["nav"]) > 0:
                    history[row["date"]] = float(row["nav"])
            ranges = cached_data.setdefault("nav_history_ranges", {}).setdefault(code_key, [])
            covered_range = [requested_date.isoformat(), end.isoformat()]
            if covered_range not in ranges:
                ranges.append(covered_range)
            sources = cached_data.setdefault("nav_history_sources", {})
            sources[code_key] = _merge_nav_source(sources.get(code_key), source)
        return {"scheme_code": str(code), "nav": float(picked["nav"]), "nav_date": picked["date"], "source": source}

    rows = {}
    fallback_used = False

    # Try fast cached scheme history lookup first
    try:
        rows = fetch_scheme_history(code, requested_date, end)
        fallback_used = True
    except AMFIError:
        pass

    if str(code) not in rows:
        if current:
            try:
                rows = fetch_history(
                    requested_date,
                    end,
                    amc_name=current.get("amc"),
                    scheme_type=current.get("scheme_type"),
                    form_only=True,
                )
            except AMFIError:
                pass
        if str(code) not in rows:
            try:
                rows = fetch_history(
                    requested_date,
                    end,
                    amc_name=current.get("amc") if current else None,
                    scheme_type=current.get("scheme_type") if current else None,
                )
            except AMFIError as amfi_error:
                raise AMFIError(f"Historical NAV lookup failed for scheme {code}: {amfi_error}") from amfi_error

    eligible = rows.get(str(code), [])
    eligible = [row for row in eligible if requested_date.isoformat() <= row["date"] <= end.isoformat()]
    eligible.sort(key=lambda row: row["date"])
    if not eligible:
        raise ValueError("No published NAV was found for this scheme on or after that date. Choose another investment date.")
    picked = eligible[0]
    source = MFAPI_NAV_SOURCE if fallback_used else AMFI_NAV_SOURCE
    return {"scheme_code": str(code), "nav": picked["nav"], "nav_date": picked["date"], "source": source}



@mutual_funds_bp.get("/mutual-funds")
@_guard
def mutual_funds_page():
    return render_template("mutual_funds.html")


@mutual_funds_bp.get("/mutual-funds/dashboard")
@_guard
def mutual_funds_dashboard_page():
    return render_template("mutual_fund_dashboard.html")


@mutual_funds_bp.get("/mutual-funds/fund/<scheme_code>")
@_guard
def mutual_fund_detail_page(scheme_code):
    return render_template("mutual_fund_detail.html", scheme_code=scheme_code)


@mutual_funds_bp.get("/mutual-funds.css")
@_guard
def mutual_funds_stylesheet():
    return _no_store(send_from_directory(_MODULE_DIR, "mutual_funds.css", mimetype="text/css"))


@mutual_funds_bp.get("/mutual-funds.js")
@_guard
def mutual_funds_javascript():
    return _no_store(send_from_directory(_MODULE_DIR, "mutual_funds.js", mimetype="application/javascript"))


@mutual_funds_bp.get("/mutual-fund-dashboard.js")
@_guard
def mutual_fund_dashboard_javascript():
    return _no_store(send_from_directory(_MODULE_DIR, "mutual_fund_dashboard.js", mimetype="application/javascript"))


@mutual_funds_bp.get("/mutual-fund-detail.js")
@_guard
def mutual_fund_detail_javascript():
    return _no_store(send_from_directory(_MODULE_DIR, "mutual_fund_detail.js", mimetype="application/javascript"))


@mutual_funds_bp.get("/mutual-fund-investment.js")
@_guard
def mutual_fund_investment_javascript():
    return _no_store(send_from_directory(_MODULE_DIR, "mutual_fund_investment.js", mimetype="application/javascript"))



@mutual_funds_bp.get("/api/mutual-funds/catalog")
@_guard
def mutual_funds_catalog():
    try:
        feed = fetch_latest_navs()
        schemes = feed["schemes"]
        return _no_store(jsonify({
            "schemes": schemes,
            "amcs": sorted({row["amc"] for row in schemes if row.get("amc")}),
            "categories": sorted({row["category"] for row in schemes if row.get("category")}),
            "scheme_types": sorted({row["scheme_type"] for row in schemes if row.get("scheme_type")}),
            "count": len(schemes),
            "nav_as_of": feed["nav_as_of"],
            "refreshed_at": feed["fetched_at"],
            "source": feed["source"],
            "source_label": feed["source_label"],
            "notice": "Mutual fund NAVs are published values and may not be intraday prices.",
        }))
    except AMFIError as exc:
        return jsonify({"error": str(exc)}), 503


@mutual_funds_bp.get("/api/mutual-funds/schemes/<scheme_code>/details")
@_guard
def mutual_fund_details(scheme_code):
    if not str(scheme_code).isdigit():
        return jsonify({"error": "Select a valid AMFI scheme code."}), 400
    period_days = {"1m": 31, "3m": 92, "6m": 184, "1y": 366, "3y": 1096, "5y": 1827, "10y": 3653, "all": 36525}
    period = request.args.get("period", "3y")
    if period not in period_days:
        return jsonify({"error": "Choose a supported chart period."}), 400
    try:
        feed = fetch_latest_navs()
        scheme = _nav_map(feed["schemes"]).get(str(scheme_code))
        if not scheme:
            return jsonify({"error": "This scheme is not present in the current AMFI NAV report."}), 404
        end = dt.date.fromisoformat(feed["nav_as_of"])
        start = end - dt.timedelta(days=period_days[period])
        with _lock_for_user():
            data = _load_data()
            history = data["nav_history"].setdefault(str(scheme_code), {})
            ranges = data["nav_history_ranges"].setdefault(str(scheme_code), [])
            if not isinstance(history, dict):
                history = data["nav_history"][str(scheme_code)] = {}
            if not isinstance(ranges, list):
                ranges = data["nav_history_ranges"][str(scheme_code)] = []
            history_source = data["nav_history_sources"].get(str(scheme_code))
            if not history_source and history:
                history_source = AMFI_NAV_SOURCE
            if period == "all":
                # MFapi.in supports one scheme/date-range response; use it for
                # full inception history so AMFI's 90-day limit doesn't cause
                # hundreds of requests.
                covered = any(isinstance(item, list) and len(item) == 2 and item[0] <= start.isoformat() and item[1] >= end.isoformat() for item in ranges)
                if not covered:
                    rows = fetch_scheme_history(scheme_code, start, end)
                    for row in rows.get(str(scheme_code), []):
                        history[row["date"]] = float(row["nav"])
                    ranges.append([start.isoformat(), end.isoformat()])
                    history_source = _merge_nav_source(history_source, MFAPI_NAV_SOURCE)
                    data["nav_history_sources"][str(scheme_code)] = history_source
            chunk_start = start if period != "all" else end + dt.timedelta(days=1)
            while chunk_start <= end:
                chunk_end = min(chunk_start + dt.timedelta(days=89), end)
                key = [chunk_start.isoformat(), chunk_end.isoformat()]
                covered = any(isinstance(item, list) and len(item) == 2 and item[0] <= key[0] and item[1] >= key[1] for item in ranges)
                if not covered:
                    amfi_error = None
                    try:
                        rows = fetch_history(
                            chunk_start, chunk_end,
                            amc_name=scheme.get("amc"),
                            scheme_type=scheme.get("scheme_type"),
                            form_only=True,
                        )
                    except AMFIError as exc:
                        amfi_error = exc
                        rows = {}
                    used_fallback = str(scheme_code) not in rows
                    if used_fallback:
                        try:
                            # MFapi.in accepts date-range requests beyond AMFI's 90-day limit.
                            # Fetch this selected period once instead of one fallback call per chunk.
                            rows = fetch_scheme_history(scheme_code, start, end)
                        except AMFIError as fallback_error:
                            reason = f"AMFI history failed ({amfi_error}); " if amfi_error else "AMFI returned no rows; "
                            raise AMFIError(reason + f"MFapi.in fallback failed ({fallback_error}).") from fallback_error
                    current_source = MFAPI_NAV_SOURCE if used_fallback else AMFI_NAV_SOURCE
                    history_source = _merge_nav_source(history_source, current_source)
                    data["nav_history_sources"][str(scheme_code)] = history_source
                    for row in rows.get(str(scheme_code), []):
                        history[row["date"]] = float(row["nav"])
                    if used_fallback:
                        ranges.append([start.isoformat(), end.isoformat()])
                        break
                    ranges.append(key)
                chunk_start = chunk_end + dt.timedelta(days=1)
            _save_data(data)
            points = [
                {"date": day, "nav": float(nav)}
                for day, nav in sorted(history.items())
                if start.isoformat() <= day <= end.isoformat()
            ]
        if not points:
            return jsonify({"error": "AMFI and MFapi.in returned no NAV history for this scheme and period."}), 503
        previous_nav = points[-2]["nav"] if len(points) > 1 else None
        first, last = points[0], points[-1]
        official_facts = fetch_official_fund_facts(scheme)
        elapsed_days = max(1, (dt.date.fromisoformat(last["date"]) - dt.date.fromisoformat(first["date"])).days)
        annualized = ((last["nav"] / first["nav"]) ** (365.25 / elapsed_days) - 1) * 100 if first["nav"] > 0 else None
        return _no_store(jsonify({
            "scheme": scheme,
            "official_scheme_url": official_facts.get("source_url") or _official_scheme_url(scheme),
            "fund_facts": official_facts,
            "points": points,
            "available_start_date": min(history) if history else first["date"],
            "period": period,
            "return_pct": ((last["nav"] / first["nav"]) - 1) * 100 if first["nav"] else None,
            "annualized_return_pct": annualized,
            "daily_return_pct": ((last["nav"] / previous_nav) - 1) * 100 if previous_nav else None,
            "source": history_source or AMFI_NAV_SOURCE,
            "source_label": "Mixed AMFI and MFapi.in history" if history_source == "mixed" else ("MFapi.in historical NAV fallback" if history_source == MFAPI_NAV_SOURCE else "AMFI historical NAV"),
            "refreshed_at": feed["fetched_at"],
            "nav_as_of": feed["nav_as_of"],
            "facts_notice": (
                ("Could not load fund facts from " + str(official_facts.get("source_name")) + ". Open the source page to view current details." if official_facts.get("unavailable") else "Fund facts are read from " + str(official_facts.get("source_name")) + ". Values reflect the latest data available on that source page.")
                if official_facts.get("source_name") else "Fund facts are shown only when available from a mapped source. Missing details are marked."
            ),
        }))
    except (ValueError, AMFIError) as exc:
        return jsonify({"error": str(exc)}), 503 if isinstance(exc, AMFIError) else 400


@mutual_funds_bp.get("/api/mutual-funds/portfolio")
@_guard
def mutual_funds_portfolio():
    try:
        refresh_error = None
        force_refresh = str(request.args.get("refresh", "1")).lower() in ("1", "true", "yes")
        feed = None
        if force_refresh:
            try:
                feed = fetch_latest_navs()
            except AMFIError as exc:
                refresh_error = str(exc)
        with _lock_for_user():
            data = _load_data()
            if feed is None:
                recent_by_code = {}
                for transaction in data["transactions"]:
                    code = str(transaction.get("scheme_code", ""))
                    existing = recent_by_code.get(code)
                    if not existing or str(transaction.get("nav_date", "")) > str(existing.get("nav_date", "")):
                        recent_by_code[code] = {
                            "scheme_code": code,
                            "name": transaction.get("scheme_name", "Mutual fund scheme"),
                            "amc": transaction.get("amc", ""),
                            "nav": float(transaction.get("nav", 0)),
                            "nav_date": transaction.get("nav_date"),
                        }
                known = dict(recent_by_code)
                known.update(data.get("last_navs", {}))
                feed = {
                    "schemes": list(known.values()),
                    "nav_as_of": max((row.get("nav_date") or "" for row in known.values()), default=None) or None,
                    "fetched_at": None,
                    "source": None,
                    "source_label": "Saved AMFI NAVs",
                    "is_stale": True,
                    "refresh_error": refresh_error,
                }
            else:
                codes = {str(row.get("scheme_code")) for row in data["transactions"]}
                latest = _nav_map(feed["schemes"])
                for code in codes:
                    if code in latest:
                        data["last_navs"][code] = latest[code]
            response = _portfolio_response(data, feed)
            _store_snapshot(data, response)
            _save_data(data)
            response["updated_at"] = data["updated_at"]
        return _no_store(jsonify(response))
    except AMFIError as exc:
        return jsonify({"error": str(exc)}), 503


@mutual_funds_bp.post("/api/mutual-funds/investments")
@_guard
def mutual_funds_record_investment():
    payload = request.get_json(silent=True) or {}
    try:
        amount = _positive_amount(payload.get("amount"))
        code = str(payload.get("scheme_code") or "").strip()
        if not code.isdigit():
            raise ValueError("Select a valid mutual fund scheme.")
        today = _today()
        effective_date = _as_date(payload.get("investment_date") or today.isoformat(), "Investment date")
        if effective_date > today:
            raise ValueError("Investment date cannot be in the future.")
        feed = fetch_latest_navs()
        current = _nav_map(feed["schemes"]).get(code)
        if not current:
            raise ValueError("This scheme is not present in the current AMFI NAV report.")
        # A same-day entry uses the latest NAV AMFI has published so far, which
        # commonly carries the prior business day's date.
        if effective_date == today:
            nav_record = current
        else:
            nav_record = current if current["nav_date"] == effective_date.isoformat() else _select_nav(code, effective_date, feed)
        if float(nav_record["nav"]) <= 0:
            raise ValueError("This scheme has no positive published NAV for the selected date.")
        units = amount / float(nav_record["nav"])
        kind = str(payload.get("kind") or "LUMPSUM").upper()
        if kind not in ("LUMPSUM", "SIP", "CATCH_UP"):
            raise ValueError("Choose a valid investment type.")
        created = {
            "id": "mf_" + uuid.uuid4().hex[:16],
            "scheme_code": code,
            "scheme_name": current["name"],
            "amc": current.get("amc"),
            "scheme_type": current.get("scheme_type"),
            "kind": kind,
            "amount": amount,
            "nav": float(nav_record["nav"]),
            "nav_date": nav_record["nav_date"],
            "investment_date": effective_date.isoformat(),
            "units": units,
            "created_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": "MFapi.in" if nav_record.get("source") == MFAPI_NAV_SOURCE else "AMFI",
        }
        with _lock_for_user():
            data = _load_data()
            data["transactions"].append(created)
            _save_data(data)
        return _no_store(jsonify({"transaction": created, "message": "Investment record saved to your portfolio."})), 201
    except (ValueError, AMFIError) as exc:
        return jsonify({"error": str(exc)}), 400 if isinstance(exc, ValueError) else 503


@mutual_funds_bp.route("/api/mutual-funds/investments/<tx_id>", methods=["PUT", "POST"])
@_guard
def mutual_funds_update_investment(tx_id):
    payload = request.get_json(silent=True) or {}
    try:
        with _lock_for_user():
            data = _load_data()
            tx = next((item for item in data["transactions"] if item.get("id") == tx_id), None)
            if not tx:
                return jsonify({"error": "Investment record not found."}), 404

            code = str(tx.get("scheme_code", ""))
            amount = _positive_amount(payload.get("amount", tx.get("amount")))
            today = _today()
            investment_date_str = payload.get("investment_date") or tx.get("investment_date") or today.isoformat()
            effective_date = _as_date(investment_date_str, "Investment date")
            if effective_date > today:
                raise ValueError("Investment date cannot be in the future.")

            kind = str(payload.get("kind") or tx.get("kind") or "LUMPSUM").upper()
            if kind not in ("LUMPSUM", "SIP", "CATCH_UP"):
                raise ValueError("Choose a valid investment type.")

            if effective_date.isoformat() != tx.get("investment_date"):
                if effective_date == today:
                    current = data.get("last_navs", {}).get(code)
                    nav_record = current or {"nav": tx.get("nav", 0), "nav_date": tx.get("nav_date"), "source": tx.get("source")}
                else:
                    nav_record = _select_nav(code, effective_date, cached_data=data, fast=True)
                nav = float(nav_record["nav"])
                nav_date = nav_record["nav_date"]
                source = "MFapi.in" if nav_record.get("source") == MFAPI_NAV_SOURCE else "AMFI"
            else:
                nav = float(tx.get("nav", 0))
                nav_date = tx.get("nav_date")
                source = tx.get("source")

            if nav <= 0:
                raise ValueError("This scheme has no positive published NAV for the selected date.")

            tx["amount"] = amount
            tx["investment_date"] = effective_date.isoformat()
            tx["nav"] = nav
            tx["nav_date"] = nav_date
            tx["units"] = amount / nav
            tx["kind"] = kind
            if source:
                tx["source"] = source

            _save_data(data)
        return _no_store(jsonify({"transaction": tx, "message": "Investment record updated."}))
    except (ValueError, AMFIError) as exc:
        return jsonify({"error": str(exc)}), 400 if isinstance(exc, ValueError) else 503


@mutual_funds_bp.route("/api/mutual-funds/investments/<tx_id>", methods=["DELETE"])
@mutual_funds_bp.route("/api/mutual-funds/investments/<tx_id>/delete", methods=["POST", "DELETE"])
@_guard
def mutual_funds_delete_investment(tx_id):
    with _lock_for_user():
        data = _load_data()
        original_count = len(data["transactions"])
        data["transactions"] = [item for item in data["transactions"] if item.get("id") != tx_id]
        if len(data["transactions"]) == original_count:
            return jsonify({"error": "Investment record not found."}), 404
        _save_data(data)
    return _no_store(jsonify({"message": "Investment record deleted."}))



@mutual_funds_bp.post("/api/mutual-funds/sips")
@_guard
def mutual_funds_create_sip():
    payload = request.get_json(silent=True) or {}
    try:
        amount = _positive_amount(payload.get("amount"))
        code = str(payload.get("scheme_code") or "").strip()
        if not code.isdigit():
            raise ValueError("Select a valid mutual fund scheme.")
        start = _as_date(payload.get("start_date"), "SIP start date")
        if start > _today() + dt.timedelta(days=3650):
            raise ValueError("SIP start date is too far in the future.")
        feed = fetch_latest_navs()
        scheme = _nav_map(feed["schemes"]).get(code)
        if not scheme:
            raise ValueError("This scheme is not present in the current AMFI NAV report.")
        if float(scheme["nav"]) <= 0:
            raise ValueError("This scheme has no positive published NAV and cannot be tracked as a new SIP.")
        day = max(1, min(28, int(payload.get("installment_day") or start.day)))
        with _lock_for_user():
            data = _load_data()
            existing = next((
                p for p in data["sip_plans"]
                if str(p.get("scheme_code")) == code
                and p.get("status", "ACTIVE") == "ACTIVE"
                and p.get("start_date") == start.isoformat()
                and abs(float(p.get("amount", 0)) - amount) < 0.01
                and int(p.get("installment_day") or start.day) == day
            ), None)
            if existing:
                return _no_store(jsonify({"sip": existing, "message": "This monthly investment plan is already active."})), 200

            plan = {
                "id": "sip_" + uuid.uuid4().hex[:14],
                "scheme_code": code,
                "scheme_name": scheme["name"],
                "amc": scheme.get("amc"),
                "scheme_type": scheme.get("scheme_type"),
                "amount": amount,
                "start_date": start.isoformat(),
                "installment_day": day,
                "frequency": "Monthly",
                "status": "ACTIVE",
                "created_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            }
            data["sip_plans"].append(plan)
            _save_data(data)
        return _no_store(jsonify({"sip": plan, "message": "Monthly investment plan saved."})), 201
    except (TypeError, ValueError, AMFIError) as exc:
        status = 503 if isinstance(exc, AMFIError) else 400
        return jsonify({"error": str(exc)}), status


@mutual_funds_bp.post("/api/mutual-funds/sips/<sip_id>/catch-up")
@_guard
def mutual_funds_catch_up_sip(sip_id):
    payload = request.get_json(silent=True) or {}
    try:
        scheduled = _as_date(payload.get("scheduled_date"), "Missed installment date")
        with _lock_for_user():
            data = _load_data()
            plan = next((item for item in data["sip_plans"] if item.get("id") == sip_id and item.get("status", "ACTIVE") == "ACTIVE"), None)
            if not plan:
                return jsonify({"error": "Monthly investment plan not found or inactive."}), 404
            due_dates = set(_installment_dates(plan, _today() - dt.timedelta(days=1)))
            recorded = any(
                str(tx.get("scheme_code")) == str(plan["scheme_code"]) and tx.get("scheduled_date") == scheduled.isoformat()
                for tx in data["transactions"]
            )
            if scheduled.isoformat() not in due_dates or recorded:
                return jsonify({"error": "This installment is not currently due, or it has already been recorded."}), 409
            plan = dict(plan)

        # Avoid the all-schemes daily NAV download. A catch-up needs only this
        # scheme's NAVs around the scheduled date, which can already be cached.
        nav_cache_data = data
        nav_record = _select_nav(plan["scheme_code"], scheduled, cached_data=nav_cache_data, fast=True, scheme_hint=plan)
        amount = float(plan["amount"])
        if float(nav_record["nav"]) <= 0:
            return jsonify({"error": "No positive published NAV is available for this installment."}), 400
        transaction = {
            "id": "mf_" + uuid.uuid4().hex[:16],
            "scheme_code": str(plan["scheme_code"]),
            "scheme_name": plan["scheme_name"],
            "amc": plan.get("amc"),
            "scheme_type": plan.get("scheme_type"),
            "kind": "SIP",
            "amount": amount,
            "nav": float(nav_record["nav"]),
            "nav_date": nav_record["nav_date"],
            "investment_date": scheduled.isoformat(),
            "scheduled_date": scheduled.isoformat(),
            "units": amount / float(nav_record["nav"]),
            "sip_id": sip_id,
            "created_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": "MFapi.in" if nav_record.get("source") == MFAPI_NAV_SOURCE else "AMFI",
        }
        with _lock_for_user():
            # Recheck after the network lookup to make double clicks/idempotent
            # retries safe without holding the user lock during HTTP requests.
            data = _load_data()
            plan_now = next((item for item in data["sip_plans"] if item.get("id") == sip_id and item.get("status", "ACTIVE") == "ACTIVE"), None)
            if not plan_now:
                return jsonify({"error": "Monthly investment plan not found or inactive."}), 404
            due_dates = set(_installment_dates(plan_now, _today() - dt.timedelta(days=1)))
            if scheduled.isoformat() not in due_dates or any(
                tx.get("sip_id") == sip_id and tx.get("scheduled_date") == scheduled.isoformat()
                for tx in data["transactions"]
            ):
                return jsonify({"error": "This installment is not currently due, or it has already been recorded."}), 409
            code_key = str(plan["scheme_code"])
            cached_rows = nav_cache_data.get("nav_history", {}).get(code_key, {})
            if cached_rows:
                data.setdefault("nav_history", {}).setdefault(code_key, {}).update(cached_rows)
                cached_ranges = nav_cache_data.get("nav_history_ranges", {}).get(code_key, [])
                target_ranges = data.setdefault("nav_history_ranges", {}).setdefault(code_key, [])
                for date_range in cached_ranges:
                    if date_range not in target_ranges:
                        target_ranges.append(date_range)
                cached_source = nav_cache_data.get("nav_history_sources", {}).get(code_key)
                if cached_source:
                    sources = data.setdefault("nav_history_sources", {})
                    sources[code_key] = _merge_nav_source(sources.get(code_key), cached_source)
            data["transactions"].append(transaction)
            _save_data(data)
        source_label = "MFapi.in" if nav_record.get("source") == MFAPI_NAV_SOURCE else "AMFI"
        return _no_store(jsonify({"transaction": transaction, "message": f"Installment recorded using the {source_label} NAV dated {nav_record['nav_date']}."})), 201
    except (ValueError, AMFIError) as exc:
        status = 503 if isinstance(exc, AMFIError) else 400
        return jsonify({"error": str(exc)}), status


@mutual_funds_bp.post("/api/mutual-funds/sips/<sip_id>/status")
@_guard
def mutual_funds_update_sip_status(sip_id):
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).upper()
    if status not in ("ACTIVE", "PAUSED"):
        return jsonify({"error": "SIP status must be ACTIVE or PAUSED."}), 400
    with _lock_for_user():
        data = _load_data()
        plan = next((item for item in data["sip_plans"] if item.get("id") == sip_id), None)
        if not plan:
            return jsonify({"error": "Monthly investment plan not found."}), 404
        plan["status"] = status
        _save_data(data)
    return _no_store(jsonify({"sip": plan}))


@mutual_funds_bp.route("/api/mutual-funds/sips/<sip_id>", methods=["PUT", "POST"])
@_guard
def mutual_funds_update_sip(sip_id):
    payload = request.get_json(silent=True) or {}
    with _lock_for_user():
        data = _load_data()
        plan = next((item for item in data["sip_plans"] if item.get("id") == sip_id), None)
        if not plan:
            return jsonify({"error": "Monthly investment plan not found."}), 404

        if "amount" in payload:
            try:
                amount = _positive_amount(payload.get("amount"))
                plan["amount"] = amount
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        if "start_date" in payload and payload.get("start_date"):
            try:
                start = _as_date(payload.get("start_date"), "SIP start date")
                if start > _today() + dt.timedelta(days=3650):
                    return jsonify({"error": "SIP start date is too far in the future."}), 400
                plan["start_date"] = start.isoformat()
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        if "installment_day" in payload and payload.get("installment_day") is not None and str(payload.get("installment_day")).strip() != "":
            try:
                day = int(payload.get("installment_day"))
                if day < 1 or day > 28:
                    return jsonify({"error": "Installment day must be between 1 and 28."}), 400
                plan["installment_day"] = day
            except (ValueError, TypeError):
                return jsonify({"error": "Installment day must be a valid number between 1 and 28."}), 400

        if "status" in payload:
            status = str(payload.get("status", "")).upper()
            if status not in ("ACTIVE", "PAUSED"):
                return jsonify({"error": "SIP status must be ACTIVE or PAUSED."}), 400
            plan["status"] = status

        _save_data(data)
    return _no_store(jsonify({"sip": plan, "message": "Monthly investment plan updated."}))


@mutual_funds_bp.route("/api/mutual-funds/sips/<sip_id>", methods=["DELETE"])
@mutual_funds_bp.route("/api/mutual-funds/sips/<sip_id>/delete", methods=["POST", "DELETE"])
@_guard
def mutual_funds_delete_sip(sip_id):
    with _lock_for_user():
        data = _load_data()
        original_count = len(data["sip_plans"])
        data["sip_plans"] = [item for item in data["sip_plans"] if item.get("id") != sip_id]
        if len(data["sip_plans"]) == original_count:
            return jsonify({"error": "Monthly investment plan not found."}), 404
        _save_data(data)
    return _no_store(jsonify({"message": "Monthly investment plan deleted."}))



@mutual_funds_bp.get("/api/mutual-funds/performance")
@_guard
def mutual_funds_performance():
    try:
        with _lock_for_user():
            data = _load_data()
            requested_code = str(request.args.get("scheme_code") or "").strip()
            transactions = data["transactions"]
            if requested_code:
                transactions = [tx for tx in transactions if str(tx.get("scheme_code")) == requested_code]
            if not transactions:
                return _no_store(jsonify({"points": [], "source": AMFI_NAV_SOURCE, "message": "No investment history is available for this fund yet." if requested_code else "Start a SIP or One-Time investment to build your performance history."}))
            end = _today()
            start = min(dt.date.fromisoformat(row.get("nav_date") or row.get("investment_date")) for row in transactions)
            requested_start = request.args.get("start_date")
            if requested_start:
                start = max(start, _as_date(requested_start, "Start date"))
            if start > end:
                return jsonify({"error": "There is no performance history for the selected period."}), 400
            codes = sorted({str(tx["scheme_code"]) for tx in transactions})
            latest_metadata = data.get("last_navs", {})
            transaction_metadata = {}
            for tx in transactions:
                transaction_metadata.setdefault(str(tx["scheme_code"]), tx)
            groups = {}
            for code in codes:
                metadata = latest_metadata.get(code) or transaction_metadata.get(code, {})
                group_key = (metadata.get("amc") or "", metadata.get("scheme_type") or "")
                groups.setdefault(group_key, []).append(code)
            history = data.setdefault("nav_history", {})
            sources = data.setdefault("nav_history_sources", {})
            for code in codes:
                history.setdefault(code, {})
                code_history = history[code]
                has_start = any(day <= start.isoformat() for day in code_history)
                has_end = any(day >= (end - dt.timedelta(days=7)).isoformat() for day in code_history)
                if not (has_start and has_end) or len(code_history) < 2:
                    try:
                        rows = fetch_scheme_history(code, start, end)
                        scheme_rows = rows.get(code, [])
                        for row in scheme_rows:
                            code_history[row["date"]] = float(row["nav"])
                        if scheme_rows:
                            sources[code] = MFAPI_NAV_SOURCE
                    except AMFIError:
                        try:
                            rows = fetch_history(start, end, form_only=True)
                            scheme_rows = rows.get(code, [])
                            for row in scheme_rows:
                                code_history[row["date"]] = float(row["nav"])
                        except AMFIError:
                            pass
            _save_data(data)

            all_dates = sorted({day for code in codes for day in history.get(code, {}) if start.isoformat() <= day <= end.isoformat()})
            if not all_dates:
                return jsonify({"error": "AMFI returned no historical NAV rows for this portfolio."}), 503
            tx_dates = {}
            for tx in transactions:
                day = tx.get("nav_date") or tx.get("investment_date")
                tx_dates.setdefault(day, []).append(tx)
            units = {code: 0.0 for code in codes}
            costs = 0.0
            latest_navs = {}
            points = []
            for day in all_dates:
                for tx in tx_dates.get(day, []):
                    code = str(tx["scheme_code"])
                    units[code] = units.get(code, 0.0) + float(tx.get("units", 0))
                    costs += float(tx.get("amount", 0))
                for code in codes:
                    value = history.get(code, {}).get(day)
                    if value is not None:
                        latest_navs[code] = float(value)
                current_value = sum(units.get(code, 0.0) * latest_navs.get(code, 0.0) for code in codes)
                points.append({
                    "date": day,
                    "invested": costs,
                    "value": current_value,
                    "pnl": current_value - costs,
                })
        return _no_store(jsonify({
            "points": points,
            "range_start": points[0]["date"] if points else None,
            "range_end": points[-1]["date"] if points else None,
            "source": "mixed" if any(data.get("nav_history_sources", {}).get(code) == MFAPI_NAV_SOURCE for code in codes) else AMFI_NAV_SOURCE,
        }))
    except (ValueError, AMFIError) as exc:
        return jsonify({"error": str(exc)}), 503 if isinstance(exc, AMFIError) else 400


def _no_store(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response

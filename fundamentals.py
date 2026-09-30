"""Capital Desk - Fundamentals only
Direct Yahoo Finance HTTP API adapter.
No yfinance / pandas dependency.

Frontend flow:
  fundamental-analysis.html -> GET /api/fundamentals?symbol=TCS.NS
Backend flow:
  Yahoo cookie -> Yahoo crumb -> quoteSummary/chart APIs

The Yahoo cookie + crumb are kept server-side in one requests.Session because
Yahoo binds the crumb to the cookie. On 401/Invalid Crumb the session is reset
and the handshake is repeated automatically.
"""

from flask import Blueprint, request, jsonify, render_template
import datetime as dt
import math
import threading
try:
    from curl_cffi import requests as yahoo_requests
    _YAHOO_HTTP = "curl_cffi"
except ImportError:
    import requests as yahoo_requests
    _YAHOO_HTTP = "requests"

import requests
import time

fundamentals_bp = Blueprint("fundamentals", __name__)


@fundamentals_bp.get("/fundamentals")
def fundamentals_page():
    """Serve the Fundamentals HTML page from Flask templates/."""
    symbol = (request.args.get("symbol") or "").strip().upper()
    if not symbol:
        return "Symbol is required", 400
    return render_template("fundamental-analysis.html", symbol=symbol)

YAHOO_Q1 = "https://query1.finance.yahoo.com"
YAHOO_Q2 = "https://query2.finance.yahoo.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"

_FUNDAMENTALS_CACHE_TTL = 180
_fundamentals_cache = {}

# Yahoo's crumb is tied to the session cookie. Keep both together.
_yahoo_lock = threading.RLock()
_yahoo_session = None
_yahoo_crumb = None


def _new_session():
    """Create a Yahoo-compatible browser-like HTTP session."""
    if _YAHOO_HTTP == "curl_cffi":
        s = yahoo_requests.Session(impersonate="chrome")
    else:
        s = yahoo_requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
        "Connection": "keep-alive",
    })
    return s


def _reset_yahoo_session():
    global _yahoo_session, _yahoo_crumb
    with _yahoo_lock:
        _yahoo_session = _new_session()
        _yahoo_crumb = None


def _get_session():
    global _yahoo_session
    with _yahoo_lock:
        if _yahoo_session is None:
            _reset_yahoo_session()
        return _yahoo_session


def _bootstrap_crumb(force=False):
    """Bootstrap Yahoo cookie + crumb with retries and both query hosts."""
    global _yahoo_crumb
    with _yahoo_lock:
        if not force and _yahoo_crumb:
            return _yahoo_crumb
        s = _get_session()
        try:
            s.get("https://fc.yahoo.com", timeout=15, allow_redirects=True)
        except Exception:
            pass
        last_status = None
        last_body = ""
        for retry in range(3):
            for host in (YAHOO_Q1, YAHOO_Q2):
                try:
                    resp = s.get(f"{host}/v1/test/getcrumb", timeout=15, allow_redirects=True)
                    body = (resp.text or "").strip()
                    last_status, last_body = resp.status_code, body
                    if (resp.status_code == 200 and body and
                        "<html" not in body.lower() and
                        "too many requests" not in body.lower() and
                        not body.lower().startswith("edge:")):
                        _yahoo_crumb = body
                        return body
                except Exception as exc:
                    last_body = str(exc)
            if retry < 2:
                time.sleep(1.5 * (2 ** retry))
        if last_status == 429 or "too many requests" in last_body.lower() or last_body.lower().startswith("edge:"):
            if _YAHOO_HTTP != "curl_cffi":
                raise RuntimeError("Yahoo is blocking the server HTTP fingerprint. Install curl_cffi: pip install -U curl_cffi")
            raise RuntimeError("Yahoo Finance is temporarily throttling the server IP for crumb requests. Chrome TLS impersonation is enabled; if this persists, wait a few minutes or use a different outbound IP.")
        raise RuntimeError("Unable to obtain a valid Yahoo Finance crumb from query1/query2")


def _yahoo_get(path, params=None, crumb_required=True, retries=2):
    global _yahoo_crumb
    last_error = None
    for attempt in range(retries + 1):
        try:
            s = _get_session()
            query = dict(params or {})
            if crumb_required:
                query["crumb"] = _bootstrap_crumb(force=False)
            response = s.get(path, params=query, timeout=25, allow_redirects=True)
            text = response.text or ""
            invalid_crumb = (response.status_code in (401, 403) or "Invalid Crumb" in text or '"code":"Unauthorized"' in text or '"code": "Unauthorized"' in text)
            if invalid_crumb and attempt < retries:
                with _yahoo_lock:
                    _reset_yahoo_session()
                time.sleep(1.0 * (2 ** attempt))
                continue
            if response.status_code == 429 and attempt < retries:
                time.sleep(1.5 * (2 ** attempt))
                continue
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            if "temporarily throttling" in str(exc).lower() or "install curl_cffi" in str(exc).lower():
                break
            if attempt < retries:
                time.sleep(1.0 * (2 ** attempt))
    raise last_error or RuntimeError("Yahoo Finance request failed")

def _clean(value):
    if value is None:
        return None
    if isinstance(value, dict):
        if set(value.keys()) >= {"raw"}:
            return _clean(value.get("raw"))
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return value
    return value


def _raw(obj, key, default=None):
    v = obj.get(key, default) if isinstance(obj, dict) else default
    if isinstance(v, dict) and "raw" in v:
        return v.get("raw")
    return v


def _module(result, name):
    return result.get(name) or {}


def _unwrap_quote_summary(data):
    return (((data or {}).get("quoteSummary") or {}).get("result") or [{}])[0]


def _statement_table(module, statement_keys=None):
    """Normalize Yahoo annual statements across legacy and current response shapes."""
    if not isinstance(module, dict):
        return {"columns": [], "rows": []}

    candidates = list(statement_keys or []) + [
        "incomeStatementHistory", "incomeStatementHistoryAnnual",
        "balanceSheetHistory", "balanceSheetStatements",
        "cashflowStatementHistory", "cashflowStatements",
        "annualReports", "annualFinancials", "financials",
    ]

    def find_reports(obj, depth=0):
        if depth > 4:
            return []
        if isinstance(obj, list):
            dicts = [x for x in obj if isinstance(x, dict)]
            if dicts and any(("endDate" in x or "asOfDate" in x or "period" in x) for x in dicts):
                return dicts
            for x in dicts:
                found = find_reports(x, depth + 1)
                if found:
                    return found
        elif isinstance(obj, dict):
            for preferred_key in candidates:
                if preferred_key in obj:
                    found = find_reports(obj[preferred_key], depth + 1)
                    if found:
                        return found
            for value in obj.values():
                found = find_reports(value, depth + 1)
                if found:
                    return found
        return []

    reports = find_reports(module)
    if not reports:
        return {"columns": [], "rows": []}

    def raw_value(value):
        if isinstance(value, dict):
            if value.get("raw") is not None:
                return value.get("raw")
            if value.get("fmt") is not None:
                return value.get("fmt")
        return value

    def period_of(report):
        end = raw_value(report.get("endDate") or report.get("asOfDate") or report.get("period"))
        return str(end)[:10] if end else None

    columns = [period_of(r) for r in reports]
    valid = [(r, c) for r, c in zip(reports, columns) if c]
    reports = [r for r, _ in valid]
    columns = [c for _, c in valid]
    if not columns:
        return {"columns": [], "rows": []}

    preferred = [
        "totalRevenue", "costOfRevenue", "grossProfit", "operatingExpense", "operatingIncome",
        "ebit", "ebitda", "netIncome", "netIncomeCommonStockholders", "netIncomeApplicableToCommonShares",
        "dilutedEPS", "basicEPS", "basicAverageShares", "dilutedAverageShares",
        "totalAssets", "totalLiabilitiesNetMinorityInterest", "totalLiab", "stockholdersEquity",
        "commonStockEquity", "cashCashEquivalentsAndShortTermInvestments", "cashAndCashEquivalents",
        "totalDebt", "netDebt", "currentAssets", "currentLiabilities", "workingCapital",
        "operatingCashFlow", "investingCashFlow", "financingCashFlow", "freeCashFlow",
        "capitalExpenditure", "capitalExpenditures", "endCashPosition", "changesInCash",
    ]

    def values_for(key):
        return [raw_value(report.get(key)) for report in reports]

    available = set()
    for report in reports:
        available.update(k for k in report.keys() if k not in {"endDate", "asOfDate", "period", "maxAge", "currencyCode", "periodType"})

    ordered_keys = [k for k in preferred if k in available]
    for key in sorted(available):
        if key not in ordered_keys:
            vals = values_for(key)
            if any(v is not None for v in vals):
                ordered_keys.append(key)

    rows = [{"label": key, "values": values_for(key)} for key in ordered_keys if any(v is not None for v in values_for(key))]
    return {"columns": columns, "rows": rows}


def _statement_records(module, statement_keys=None):
    """Return annual statement records from any of Yahoo's common response shapes."""
    table = _statement_table(module, statement_keys)
    cols = table.get("columns") or []
    rows = table.get("rows") or []
    records = []
    for idx, col in enumerate(cols):
        record = {"date": col}
        for row in rows:
            vals = row.get("values") or []
            if idx < len(vals):
                record[row.get("label")] = vals[idx]
        records.append(record)
    return records


def _build_chart(symbol):
    """5-year monthly price data. Chart API does not require a crumb."""
    data = _yahoo_get(
        f"{YAHOO_Q1}/v8/finance/chart/{requests.utils.quote(symbol, safe='')}",
        params={"range": "5y", "interval": "1mo", "events": "div,splits", "includeAdjustedClose": "true"},
        crumb_required=False,
        retries=1,
    )
    result = ((data.get("chart") or {}).get("result") or [{}])[0]
    timestamps = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    closes = quote.get("close") or []
    chart = []
    for i, ts in enumerate(timestamps):
        close = closes[i] if i < len(closes) else None
        if close is None:
            continue
        chart.append({
            "date": dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).strftime("%Y-%m"),
            "value": close,
        })
    return chart


@fundamentals_bp.get("/api/fundamentals")
def fundamentals():
    symbol = (request.args.get("symbol") or "").strip().upper()
    if not symbol:
        return jsonify({"error": "symbol is required"}), 400

    now = time.time()
    cached = _fundamentals_cache.get(symbol)
    if cached and now - cached[0] < _FUNDAMENTALS_CACHE_TTL:
        return jsonify(cached[1])

    modules = [
        "price",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "summaryProfile",
        "assetProfile",
        "calendarEvents",
        "earnings",
        "earningsTrend",
        "incomeStatementHistory",
        "incomeStatementHistoryQuarterly",
        "balanceSheetHistory",
        "balanceSheetHistoryQuarterly",
        "cashflowStatementHistory",
        "cashflowStatementHistoryQuarterly",
        "recommendationTrend",
        "institutionOwnership",
        "majorHoldersBreakdown",
        "insiderTransactions",
        "insiderHolders",
    ]

    try:
        data = _yahoo_get(
            f"{YAHOO_Q2}/v10/finance/quoteSummary/{requests.utils.quote(symbol, safe='')}",
            params={"modules": ",".join(modules), "formatted": "false", "lang": "en-US", "region": "US", "corsDomain": "finance.yahoo.com"},
            crumb_required=True,
            retries=2,
        )

        q = _unwrap_quote_summary(data)
        price = _module(q, "price")
        summary = _module(q, "summaryDetail")
        stats = _module(q, "defaultKeyStatistics")
        fin = _module(q, "financialData")
        profile = _module(q, "summaryProfile") or _module(q, "assetProfile")
        calendar = _module(q, "calendarEvents")
        earnings = _module(q, "earnings")
        trend = _module(q, "earningsTrend")

        current = _raw(price, "regularMarketPrice")
        previous = _raw(price, "regularMarketPreviousClose")
        if current is not None and previous is not None:
            change = current - previous
            change_pct = (change / previous * 100) if previous else None
        else:
            change = change_pct = None

        # Financial statement modules are normalized enough for the existing template.
        income = _module(q, "incomeStatementHistory")
        income_quarterly = _module(q, "incomeStatementHistoryQuarterly")
        balance = _module(q, "balanceSheetHistory")
        cashflow = _module(q, "cashflowStatementHistory")
        cashflow_quarterly = _module(q, "cashflowStatementHistoryQuarterly")

        income_records = _statement_records(income, ["incomeStatementHistory", "incomeStatementHistoryAnnual"])
        income_quarterly_records = _statement_records(income_quarterly, ["incomeStatementHistoryQuarterly", "quarterlyReports", "quarterlyFinancials"])
        balance_records = _statement_records(balance, ["balanceSheetStatements", "balanceSheetHistory"])
        cashflow_records = _statement_records(cashflow, ["cashflowStatements", "cashflowStatementHistory"])
        cashflow_quarterly_records = _statement_records(cashflow_quarterly, ["cashflowStatementHistoryQuarterly", "quarterlyReports", "quarterlyFinancials"])

        def pct(v):
            return None if v is None else v * 100

        market_cap = _raw(price, "marketCap")
        enterprise_value = _raw(stats, "enterpriseValue") or _raw(fin, "enterpriseValue")
        trailing_pe = _raw(summary, "trailingPE") or _raw(stats, "trailingPE")
        forward_pe = _raw(summary, "forwardPE") or _raw(stats, "forwardPE")
        pb = _raw(stats, "priceToBook")
        ps = _raw(summary, "priceToSalesTrailing12Months")
        ev_ebitda = _raw(stats, "enterpriseToEbitda")
        div_yield = _raw(summary, "dividendYield")

        revenue = _raw(fin, "totalRevenue")
        net_income = _raw(fin, "netIncomeToCommon")
        operating_income = _raw(fin, "operatingIncome")
        ebitda = _raw(fin, "ebitda")
        eps = _raw(stats, "trailingEps") or _raw(stats, "forwardEps")
        roe = _raw(fin, "returnOnEquity")
        roic = _raw(fin, "returnOnAssets")
        op_margin = _raw(fin, "operatingMargins")
        profit_margin = _raw(fin, "profitMargins")
        revenue_growth = _raw(fin, "revenueGrowth")
        earnings_growth = _raw(fin, "earningsGrowth")
        debt = _raw(fin, "totalDebt")
        cash = _raw(fin, "totalCash")
        equity = _raw(fin, "totalStockholderEquity")
        current_assets = _raw(fin, "totalCurrentAssets")
        current_liabilities = _raw(fin, "totalCurrentLiabilities")
        ocf = _raw(fin, "operatingCashflow")
        capex = _raw(fin, "capitalExpenditures")
        fcf = _raw(fin, "freeCashflow")

        net_debt = debt - cash if debt is not None and cash is not None else None
        current_ratio = current_assets / current_liabilities if current_assets is not None and current_liabilities else None
        debt_equity = debt / equity if debt is not None and equity else None

        ownership_module = _module(q, "majorHoldersBreakdown")
        ownership = {
            "insiders_percent": pct(_raw(ownership_module, "insidersPercentHeld")),
            "institutions_percent": pct(_raw(ownership_module, "institutionsPercentHeld")),
            "institutions_float_percent": pct(_raw(ownership_module, "institutionsFloatPercentHeld")),
            "float_shares": (_raw(stats, "floatShares") / 1e7) if _raw(stats, "floatShares") is not None else None,
            "shares_outstanding": (_raw(stats, "sharesOutstanding") / 1e7) if _raw(stats, "sharesOutstanding") is not None else None,
        }

        price_target = {}
        try:
            # Current Yahoo quoteSummary financialData contains targetMeanPrice etc.
            for k in ("targetLowPrice", "targetMeanPrice", "targetMedianPrice", "targetHighPrice", "numberOfAnalystOpinions"):
                price_target[k] = _raw(fin, k)
        except Exception:
            pass

        estimate_rows = []
        et = trend.get("trend") or []
        for row in et:
            if not isinstance(row, dict):
                continue
            period = row.get("period")
            eps_est = _raw(row.get("earningsEstimate") or {}, "avg")
            revenue_est = _raw(row.get("revenueEstimate") or {}, "avg")
            estimate_rows.append({"period": period, "eps_estimate": eps_est, "revenue_estimate": revenue_est})

        # Build annual revenue / profit / EPS trends directly from statement records.
        earnings_rows = []
        for row in income_records:
            earnings_rows.append({
                "date": row.get("date"),
                "revenue": row.get("totalRevenue"),
                "net_income": row.get("netIncome") or row.get("netIncomeCommonStockholders") or row.get("netIncomeApplicableToCommonShares"),
                "eps": row.get("dilutedEPS") or row.get("basicEPS"),
                "operating_income": row.get("operatingIncome"),
            })

        try:
            chart = _build_chart(symbol)
        except Exception:
            chart = []

        result = {
            "symbol": symbol,
            "as_of": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": "Yahoo Finance direct API",
            "company": {
                "name": _raw(price, "longName") or _raw(price, "shortName"),
                "sector": profile.get("sector"),
                "industry": profile.get("industry"),
                "country": profile.get("country"),
                "employees": profile.get("fullTimeEmployees"),
                "website": profile.get("website"),
                "summary": profile.get("longBusinessSummary"),
            },
            "quote": {
                "current_price": current,
                "previous_close": previous,
                "change": change,
                "change_percent": change_pct,
                "day_high": _raw(price, "regularMarketDayHigh"),
                "day_low": _raw(price, "regularMarketDayLow"),
                "fifty_two_week_high": _raw(summary, "fiftyTwoWeekHigh"),
                "fifty_two_week_low": _raw(summary, "fiftyTwoWeekLow"),
                "volume": _raw(price, "regularMarketVolume"),
                "average_volume": _raw(summary, "averageVolume"),
            },
            "valuation": {
                "market_cap": market_cap,
                "enterprise_value": enterprise_value,
                "trailing_pe": trailing_pe,
                "forward_pe": forward_pe,
                "price_to_sales": ps,
                "price_to_book": pb,
                "ev_to_ebitda": ev_ebitda,
                "dividend_yield": pct(div_yield),
            },
            "profitability": {
                "revenue": revenue,
                "net_income": net_income,
                "operating_income": operating_income,
                "ebitda": ebitda,
                "eps": eps,
                "roe": pct(roe),
                "roce": pct(roic),
                "operating_margin": pct(op_margin),
                "profit_margin": pct(profit_margin),
            },
            "growth": {
                "revenue_growth": pct(revenue_growth),
                "earnings_growth": pct(earnings_growth),
            },
            "balance_sheet_summary": {
                "total_assets": _raw(fin, "totalAssets"),
                "total_debt": debt,
                "cash": cash,
                "net_debt": net_debt,
                "equity": equity,
                "working_capital": (current_assets - current_liabilities) if current_assets is not None and current_liabilities is not None else None,
                "debt_to_equity": debt_equity,
                "current_ratio": current_ratio,
            },
            "cashflow_summary": {
                "operating_cashflow": ocf,
                "capex": capex,
                "free_cashflow": fcf,
                "financing_cashflow": _raw(fin, "totalCashFromFinancingActivities"),
                "dividends_paid": _raw(fin, "cashDividendsPaid"),
            },
            "income_statement": _statement_table(income_quarterly, ["incomeStatementHistoryQuarterly", "quarterlyReports", "quarterlyFinancials"]),
            "balance_sheet": _statement_table(balance, ["balanceSheetStatements", "balanceSheetHistory"]),
            "cashflow": _statement_table(cashflow_quarterly, ["cashflowStatementHistoryQuarterly", "quarterlyReports", "quarterlyFinancials"]),
            "charts": {
                "price": chart,
                "annual": earnings_rows,
            },
            "actions": [],
            "ownership": ownership,
            "analyst": {
                "price_target": price_target,
                "estimates": estimate_rows,
                "recommendation_trend": _module(q, "recommendationTrend"),
            },
            "documents": [],
            "links": [{"label": "Screener", "url": "https://www.screener.in/company/" + symbol.replace(".NS", "").replace(".BO", "") + "/"}],
            "calendar": calendar,
        }

        cleaned = _clean(result)
        _fundamentals_cache[symbol] = (time.time(), cleaned)
        return jsonify(cleaned)

    except Exception as exc:
        return jsonify({
            "error": str(exc),
            "symbol": symbol,
            "source": "Yahoo Finance direct API",
            "hint": "Yahoo Fundamentals uses a cookie-bound crumb. The backend automatically refreshes the cookie+crumb pair on Invalid Crumb/401."
        }), 502

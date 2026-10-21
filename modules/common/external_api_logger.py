import os
import sys
import time
import json
import uuid
import datetime
import urllib.parse
import threading
import logging

from modules.common.data_paths import APP_DATA_DIR

logger = logging.getLogger("external_api_logger")

EXTERNAL_LOGS_DIR = os.path.join(APP_DATA_DIR, "external_api_logs")
EXTERNAL_LOGS_INDEX = os.path.join(APP_DATA_DIR, "external_api_logs.json")

# In-memory buffer to keep recent logs cached for fast queries
_LOGS_CACHE = []
_LOGS_LOCK = threading.Lock()
_INSTALLED = False

# Max logs kept in index file and memory buffer
MAX_INDEXED_LOGS = 1000

# Original unpatched functions
_ORIG_REQUESTS_SESSION_REQUEST = None
_ORIG_CURL_SESSION_REQUEST = None
_ORIG_URLLIB_URLOPEN = None


def _ensure_dirs():
    """Ensure the external logs directory exists."""
    if not os.path.exists(EXTERNAL_LOGS_DIR):
        try:
            os.makedirs(EXTERNAL_LOGS_DIR, exist_ok=True)
        except Exception as e:
            logger.warning(f"Failed to create external logs directory: {e}")


def _is_loopback_url(url_str):
    """Check if URL targets localhost or loopback interface."""
    try:
        parsed = urllib.parse.urlparse(str(url_str))
        host = (parsed.hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "0.0.0.0", "::1")
    except Exception:
        return False


def _safe_serialize(val, max_len=4000):
    """Safely serialize objects into JSON-compatible values."""
    if val is None or isinstance(val, (int, float, bool)):
        return val
    if isinstance(val, str):
        return val[:max_len]
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")[:max_len]
    if isinstance(val, dict):
        res = {}
        for k, v in list(val.items())[:50]:
            res[str(k)] = _safe_serialize(v, max_len=1000)
        return res
    if isinstance(val, (list, tuple, set)):
        return [_safe_serialize(x, max_len=1000) for x in list(val)[:50]]
    try:
        return str(val)[:max_len]
    except Exception:
        return "<unserializable>"


def _extract_caller_info():
    """
    Walk up the call stack to identify the exact Python business logic file,
    line number, and function that initiated the external API call.
    """
    frame = None
    try:
        frame = sys._getframe(1)
        while frame:
            filename = frame.f_code.co_filename.replace("\\", "/")
            fn_lower = filename.lower()
            func_name = frame.f_code.co_name

            # Skip wrapper frames, standard libraries, virtualenv, and HTTP client internals
            if (
                func_name in (
                    "_hooked_requests_request",
                    "_hooked_curl_request",
                    "_hooked_urllib_urlopen",
                    "_extract_caller_info",
                    "record_external_call",
                    "request",
                    "get",
                    "post",
                    "put",
                    "delete",
                    "patch",
                    "head",
                    "options",
                )
                or any(
                    skip in fn_lower
                    for skip in [
                        "external_api_logger",
                        "site-packages",
                        "venv/",
                        "/venv",
                        "lib/python",
                        "<frozen",
                        "requests/",
                        "requests\\",
                        "curl_cffi",
                        "urllib/",
                        "urllib\\",
                        "http/client",
                        "http\\client",
                        "socket.py",
                    ]
                )
            ):
                frame = frame.f_back
                continue

            # Found the caller frame!
            rel_path = filename
            try:
                rel_path = os.path.relpath(filename, start=os.getcwd()).replace("\\", "/")
            except Exception:
                pass

            return {
                "file": os.path.basename(filename),
                "path": rel_path,
                "line": frame.f_lineno,
                "function": func_name,
            }
    except Exception:
        pass
    finally:
        del frame

    return {
        "file": "unknown.py",
        "path": "unknown",
        "line": 0,
        "function": "unknown",
    }


def record_external_call(
    method,
    url,
    params=None,
    data=None,
    json_payload=None,
    headers=None,
    status_code=None,
    duration_ms=0.0,
    error=None,
    library="requests",
    caller_info=None,
):
    """
    Records an external API call, stores it as an individual JSON file in app_data/external_api_logs/,
    and maintains the searchable index in app_data/external_api_logs.json.
    """
    if _is_loopback_url(url):
        return None

    try:
        _ensure_dirs()
        now = datetime.datetime.now()
        timestamp_iso = now.isoformat()
        datetime_str = now.strftime("%Y-%m-%d %H:%M:%S")
        log_id = f"ext_{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

        parsed = urllib.parse.urlparse(str(url))
        domain = parsed.netloc or parsed.hostname or "unknown"
        endpoint = parsed.path or "/"

        # Combine query parameters
        parameters = {}
        if parsed.query:
            try:
                for k, v in urllib.parse.parse_qs(parsed.query, keep_blank_values=True).items():
                    parameters[k] = v[0] if len(v) == 1 else v
            except Exception:
                pass

        if params:
            if isinstance(params, dict):
                for k, v in params.items():
                    parameters[str(k)] = _safe_serialize(v)
            elif isinstance(params, (list, tuple)):
                try:
                    for k, v in dict(params).items():
                        parameters[str(k)] = _safe_serialize(v)
                except Exception:
                    parameters["_raw_params"] = _safe_serialize(params)

        # Body / Payload
        payload = None
        if json_payload is not None:
            payload = _safe_serialize(json_payload)
        elif data is not None:
            if isinstance(data, (dict, list)):
                payload = _safe_serialize(data)
            else:
                try:
                    payload = json.loads(data)
                except Exception:
                    payload = _safe_serialize(data)

        if not caller_info:
            caller_info = _extract_caller_info()

        # Clean URL without credentials
        clean_url = str(url)

        # Format status text
        if status_code:
            status_text = f"{status_code}"
            if status_code == 200:
                status_text = "200 OK"
            elif status_code == 201:
                status_text = "201 Created"
            elif status_code == 204:
                status_text = "204 No Content"
            elif status_code == 400:
                status_text = "400 Bad Request"
            elif status_code == 401:
                status_text = "401 Unauthorized"
            elif status_code == 403:
                status_text = "403 Forbidden"
            elif status_code == 404:
                status_text = "404 Not Found"
            elif status_code >= 500:
                status_text = f"{status_code} Server Error"
        else:
            status_text = "Failed" if error else "Unknown"

        log_record = {
            "id": log_id,
            "timestamp": timestamp_iso,
            "datetime": datetime_str,
            "method": str(method).upper(),
            "url": clean_url,
            "domain": domain,
            "endpoint": endpoint,
            "python_file": caller_info.get("file", "unknown.py"),
            "caller_path": caller_info.get("path", "unknown"),
            "caller_line": caller_info.get("line", 0),
            "caller_function": caller_info.get("function", "unknown"),
            "caller_full": f"{caller_info.get('file', 'unknown.py')}:{caller_info.get('line', 0)} ({caller_info.get('function', 'unknown')})",
            "parameters": parameters,
            "payload": payload,
            "status_code": status_code,
            "status_text": status_text,
            "duration_ms": duration_ms,
            "error": str(error) if error else None,
            "library": library,
            "log_file": f"{log_id}.json",
        }

        # 1. Write individual JSON file into app_data/external_api_logs/{log_id}.json
        individual_file_path = os.path.join(EXTERNAL_LOGS_DIR, f"{log_id}.json")
        try:
            with open(individual_file_path, "w", encoding="utf-8") as f:
                json.dump(log_record, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Failed to write individual log file {individual_file_path}: {e}")

        # 2. Update thread-safe in-memory cache and master index JSON file
        with _LOGS_LOCK:
            _LOGS_CACHE.insert(0, log_record)
            if len(_LOGS_CACHE) > MAX_INDEXED_LOGS:
                _LOGS_CACHE.pop()

            try:
                with open(EXTERNAL_LOGS_INDEX, "w", encoding="utf-8") as f:
                    json.dump(_LOGS_CACHE[:MAX_INDEXED_LOGS], f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.warning(f"Failed to write external logs index {EXTERNAL_LOGS_INDEX}: {e}")

        return log_record

    except Exception as e:
        logger.error(f"Error recording external API call: {e}")
        return None


def _hooked_requests_request(self, method, url, *args, **kwargs):
    """Intercept requests.Session.request calls."""
    if _is_loopback_url(url):
        return _ORIG_REQUESTS_SESSION_REQUEST(self, method, url, *args, **kwargs)

    caller_info = _extract_caller_info()
    start_time = time.time()
    status_code = None
    error_msg = None
    response = None

    try:
        response = _ORIG_REQUESTS_SESSION_REQUEST(self, method, url, *args, **kwargs)
        status_code = getattr(response, "status_code", None)
        return response
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {str(exc)}"
        raise
    finally:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        try:
            record_external_call(
                method=method,
                url=url,
                params=kwargs.get("params"),
                data=kwargs.get("data"),
                json_payload=kwargs.get("json"),
                headers=kwargs.get("headers"),
                status_code=status_code,
                duration_ms=duration_ms,
                error=error_msg,
                library="requests",
                caller_info=caller_info,
            )
        except Exception as log_err:
            logger.debug(f"Failed to log requests call: {log_err}")


def _hooked_curl_request(self, method, url, *args, **kwargs):
    """Intercept curl_cffi.requests.session.Session.request calls."""
    if _is_loopback_url(url):
        return _ORIG_CURL_SESSION_REQUEST(self, method, url, *args, **kwargs)

    caller_info = _extract_caller_info()
    start_time = time.time()
    status_code = None
    error_msg = None
    response = None

    try:
        response = _ORIG_CURL_SESSION_REQUEST(self, method, url, *args, **kwargs)
        status_code = getattr(response, "status_code", None)
        return response
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {str(exc)}"
        raise
    finally:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        try:
            record_external_call(
                method=method,
                url=url,
                params=kwargs.get("params"),
                data=kwargs.get("data"),
                json_payload=kwargs.get("json"),
                headers=kwargs.get("headers"),
                status_code=status_code,
                duration_ms=duration_ms,
                error=error_msg,
                library="curl_cffi",
                caller_info=caller_info,
            )
        except Exception as log_err:
            logger.debug(f"Failed to log curl_cffi call: {log_err}")


def _hooked_urllib_urlopen(url, *args, **kwargs):
    """Intercept urllib.request.urlopen calls."""
    req_url = ""
    method = "GET"
    data = None

    try:
        import urllib.request
        if isinstance(url, urllib.request.Request):
            req_url = url.full_url
            method = url.get_method()
            data = url.data
        else:
            req_url = str(url)
    except Exception:
        req_url = str(url)

    if _is_loopback_url(req_url):
        return _ORIG_URLLIB_URLOPEN(url, *args, **kwargs)

    caller_info = _extract_caller_info()
    start_time = time.time()
    status_code = None
    error_msg = None
    response = None

    try:
        response = _ORIG_URLLIB_URLOPEN(url, *args, **kwargs)
        status_code = getattr(response, "status", None) or getattr(response, "code", None) or 200
        return response
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {str(exc)}"
        if hasattr(exc, "code"):
            status_code = exc.code
        raise
    finally:
        duration_ms = round((time.time() - start_time) * 1000, 2)
        try:
            record_external_call(
                method=method,
                url=req_url,
                data=data or kwargs.get("data"),
                status_code=status_code,
                duration_ms=duration_ms,
                error=error_msg,
                library="urllib",
                caller_info=caller_info,
            )
        except Exception as log_err:
            logger.debug(f"Failed to log urllib call: {log_err}")


def install_external_api_logger():
    """
    Install hooks across requests, curl_cffi, and urllib.
    Captures all external HTTP requests made across the entire application.
    """
    global _INSTALLED, _ORIG_REQUESTS_SESSION_REQUEST, _ORIG_CURL_SESSION_REQUEST, _ORIG_URLLIB_URLOPEN

    if _INSTALLED:
        return

    _ensure_dirs()
    _init_logs_cache()

    # 1. Patch requests.Session.request
    try:
        import requests
        if hasattr(requests.Session, "request"):
            _ORIG_REQUESTS_SESSION_REQUEST = requests.Session.request
            requests.Session.request = _hooked_requests_request
    except Exception as e:
        logger.warning(f"Could not hook requests.Session.request: {e}")

    # 2. Patch curl_cffi.requests.session.Session.request
    try:
        import curl_cffi.requests.session
        if hasattr(curl_cffi.requests.session.Session, "request"):
            _ORIG_CURL_SESSION_REQUEST = curl_cffi.requests.session.Session.request
            curl_cffi.requests.session.Session.request = _hooked_curl_request
    except Exception as e:
        logger.debug(f"curl_cffi not installed or could not hook: {e}")

    # 3. Patch urllib.request.urlopen
    try:
        import urllib.request
        if hasattr(urllib.request, "urlopen"):
            _ORIG_URLLIB_URLOPEN = urllib.request.urlopen
            urllib.request.urlopen = _hooked_urllib_urlopen
    except Exception as e:
        logger.warning(f"Could not hook urllib.request.urlopen: {e}")

    _INSTALLED = True
    logger.info("External API call interceptor successfully installed.")


def _init_logs_cache():
    """Load existing logs from index file or disk into cache on startup."""
    global _LOGS_CACHE
    with _LOGS_LOCK:
        if _LOGS_CACHE:
            return

        if os.path.exists(EXTERNAL_LOGS_INDEX):
            try:
                with open(EXTERNAL_LOGS_INDEX, "r", encoding="utf-8") as f:
                    _LOGS_CACHE = json.load(f)
                    return
            except Exception:
                _LOGS_CACHE = []

        # Fallback: scan disk folder if index is missing
        if os.path.exists(EXTERNAL_LOGS_DIR):
            try:
                files = [
                    os.path.join(EXTERNAL_LOGS_DIR, f)
                    for f in os.listdir(EXTERNAL_LOGS_DIR)
                    if f.endswith(".json")
                ]
                # Sort newest first
                files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
                loaded = []
                for fp in files[:MAX_INDEXED_LOGS]:
                    try:
                        with open(fp, "r", encoding="utf-8") as f:
                            loaded.append(json.load(f))
                    except Exception:
                        pass
                _LOGS_CACHE = loaded
            except Exception:
                _LOGS_CACHE = []


def get_external_api_logs(limit=200, search=None, method=None):
    """
    Retrieve logged external API calls.
    Supports filtering by search query and HTTP method.
    """
    _init_logs_cache()

    with _LOGS_LOCK:
        logs = list(_LOGS_CACHE)

    # Filter by method
    if method and method.upper() != "ALL":
        method_upper = method.upper()
        logs = [l for l in logs if l.get("method", "").upper() == method_upper]

    # Filter by search string
    if search:
        s = search.strip().lower()
        filtered = []
        for l in logs:
            url_match = s in str(l.get("url", "")).lower()
            file_match = s in str(l.get("python_file", "")).lower()
            caller_match = s in str(l.get("caller_path", "")).lower() or s in str(l.get("caller_function", "")).lower()
            domain_match = s in str(l.get("domain", "")).lower()
            params_match = s in json.dumps(l.get("parameters", {})).lower()
            status_match = s in str(l.get("status_text", "")).lower() or s in str(l.get("status_code", "")).lower()
            if url_match or file_match or caller_match or domain_match or params_match or status_match:
                filtered.append(l)
        logs = filtered

    if limit and limit > 0:
        logs = logs[:limit]

    return logs


def get_external_api_stats():
    """Return summary statistics of logged external API calls."""
    _init_logs_cache()
    with _LOGS_LOCK:
        logs = list(_LOGS_CACHE)

    total = len(logs)
    get_count = sum(1 for l in logs if l.get("method") == "GET")
    post_count = sum(1 for l in logs if l.get("method") == "POST")
    other_count = total - (get_count + post_count)
    error_count = sum(1 for l in logs if l.get("error") or (l.get("status_code") and l.get("status_code") >= 400))
    latest_time = logs[0].get("datetime") if logs else "None"

    return {
        "total": total,
        "get_count": get_count,
        "post_count": post_count,
        "other_count": other_count,
        "error_count": error_count,
        "latest_time": latest_time,
    }


def delete_all_external_api_logs():
    """
    Deletes all individual log JSON files in app_data/external_api_logs/,
    clears app_data/external_api_logs.json, and resets in-memory cache.
    """
    global _LOGS_CACHE
    deleted_files = 0

    with _LOGS_LOCK:
        # 1. Delete all individual files in directory
        if os.path.exists(EXTERNAL_LOGS_DIR):
            for filename in os.listdir(EXTERNAL_LOGS_DIR):
                if filename.endswith(".json"):
                    file_path = os.path.join(EXTERNAL_LOGS_DIR, filename)
                    try:
                        os.remove(file_path)
                        deleted_files += 1
                    except Exception as e:
                        logger.warning(f"Could not delete {file_path}: {e}")

        # 2. Reset master index JSON
        try:
            with open(EXTERNAL_LOGS_INDEX, "w", encoding="utf-8") as f:
                json.dump([], f)
        except Exception as e:
            logger.warning(f"Could not reset {EXTERNAL_LOGS_INDEX}: {e}")

        # 3. Reset in-memory cache
        _LOGS_CACHE = []

    logger.info(f"Deleted {deleted_files} external API log files.")
    return {
        "success": True,
        "deleted_count": deleted_files,
        "message": f"Successfully deleted {deleted_files} external API call log files.",
    }

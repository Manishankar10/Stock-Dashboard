"""
Centralized Indian Standard Time (IST, UTC+05:30) utility module.
Provides consistent timezone handling and date/time formatting across Capital Desk.
"""

import datetime
from typing import Optional, Union

# Indian Standard Time (UTC+05:30) timezone object
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30), name="IST")


def get_ist_timezone() -> datetime.timezone:
    """Return the IST timezone object."""
    return IST


def now_ist() -> datetime.datetime:
    """Return the current datetime strictly in Indian Standard Time (IST)."""
    return datetime.datetime.now(IST)


def today_ist() -> datetime.date:
    """Return today's date in Indian Standard Time (IST)."""
    return now_ist().date()


def today_ist_str(fmt: str = "%Y-%m-%d") -> str:
    """Return today's date formatted as a string according to fmt in IST."""
    return today_ist().strftime(fmt)


def to_ist(val: Union[datetime.datetime, datetime.date, float, int, str]) -> datetime.datetime:
    """
    Convert a datetime, date, timestamp, or ISO string to an aware datetime in IST.
    If already timezone-aware, converts to IST.
    If naive datetime, assumes it is local/IST or UTC depending on context, attaching IST.
    """
    if isinstance(val, (int, float)):
        return datetime.datetime.fromtimestamp(val, tz=IST)

    if isinstance(val, datetime.date) and not isinstance(val, datetime.datetime):
        return datetime.datetime.combine(val, datetime.time.min, tzinfo=IST)

    if isinstance(val, datetime.datetime):
        if val.tzinfo is None:
            # Naive datetime: treat as IST
            return val.replace(tzinfo=IST)
        return val.astimezone(IST)

    if isinstance(val, str):
        val_str = val.strip()
        # Try ISO format
        try:
            parsed = datetime.datetime.fromisoformat(val_str.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=IST)
            return parsed.astimezone(IST)
        except Exception:
            pass

        # Try standard formats
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d-%m-%Y %H:%M:%S",
            "%d-%m-%Y %I:%M:%S %p",
            "%d %b %Y, %I:%M %p",
            "%d %b %Y, %I:%M %p IST",
            "%d %b %Y %H:%M:%S",
            "%Y-%m-%d",
            "%d-%m-%Y",
        ):
            try:
                parsed = datetime.datetime.strptime(val_str, fmt)
                return parsed.replace(tzinfo=IST)
            except Exception:
                continue

    # Fallback to now in IST
    return now_ist()


def format_ist_display(
    dt_val: Optional[Union[datetime.datetime, datetime.date, float, int, str]] = None,
    with_tz: bool = True
) -> str:
    """
    Format a datetime value into the standard platform display format:
    e.g. '24 Oct 2026, 06:30 PM IST' (or without ' IST' if with_tz=False).
    Maintains existing platform format while enforcing IST.
    """
    if dt_val is None:
        dt = now_ist()
    elif isinstance(dt_val, str):
        cleaned = dt_val.strip()
        if not cleaned:
            dt = now_ist()
        elif cleaned.endswith(" IST") and not with_tz:
            return cleaned[:-4].strip()
        elif cleaned.endswith(" IST") and with_tz:
            return cleaned
        else:
            try:
                dt = to_ist(cleaned)
            except Exception:
                return f"{cleaned} IST" if with_tz and not cleaned.endswith(" IST") else cleaned
    else:
        dt = to_ist(dt_val)

    formatted = dt.strftime("%d %b %Y, %I:%M %p")
    return f"{formatted} IST" if with_tz else formatted


def format_ist_standard(
    dt_val: Optional[Union[datetime.datetime, datetime.date, float, int, str]] = None,
    with_tz: bool = False
) -> str:
    """
    Format into standard '%Y-%m-%d %H:%M:%S' (optionally with ' IST' suffix) in IST.
    """
    dt = now_ist() if dt_val is None else to_ist(dt_val)
    formatted = dt.strftime("%Y-%m-%d %H:%M:%S")
    return f"{formatted} IST" if with_tz else formatted


def format_ist_iso(
    dt_val: Optional[Union[datetime.datetime, datetime.date, float, int, str]] = None
) -> str:
    """
    Format into ISO-8601 string strictly in IST (offset +05:30).
    """
    dt = now_ist() if dt_val is None else to_ist(dt_val)
    return dt.isoformat()

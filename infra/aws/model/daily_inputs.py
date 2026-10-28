"""Map dated self-reports without inferring measurements or changing model contracts."""
from datetime import datetime, timedelta, timezone


def daily_record(remote, as_of=None):
    current = as_of or datetime.now(timezone(timedelta(hours=9))).date()
    surveys = (remote.get("game") or {}).get("dailySurveys") or {}
    row = surveys.get(current.isoformat()) if isinstance(surveys, dict) else None
    return row if isinstance(row, dict) and row.get("date") == current.isoformat() and row.get("submittedAt") is not None else None


def latest_pressure(row):
    if not row or row.get("bloodPressureStatus") != "measured":
        return None
    for name in ["evening", "morning"]:
        value = row.get(name)
        if isinstance(value, dict):
            s, d = value.get("systolic"), value.get("diastolic")
            if type(s) is int and type(d) is int and 10 <= d < s <= 999:
                return f"{s} / {d}"
    return None


def weekly_activity(remote, as_of=None):
    current = as_of or datetime.now(timezone(timedelta(hours=9))).date()
    surveys = (remote.get("game") or {}).get("dailySurveys") or {}
    if not isinstance(surveys, dict):
        return None
    values = [surveys.get((current - timedelta(days=i)).isoformat(), {}).get("activeMinutes") for i in range(7)]
    if not all(type(v) is int and 0 <= v <= 1440 for v in values):
        return None
    return sum(values)

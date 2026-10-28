"""Authenticated M1-S adapter. No training, input logging, or service-role key."""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get("REXRUN_MODEL_SOURCE", ROOT / "m1_stage"))
sys.path.insert(0, str(SOURCE))
MODEL_VERSION = "M1-20261020_150607-nested__base"
MODEL_SHA256 = "8c2b5e02e27a85a250025809170d32f26945f6859c279ecb8f85917e492a19ac"
_predictor = None


def predictor():
    global _predictor
    if _predictor is None:
        from m1.predict import M1Predictor
        model_dir = SOURCE / "artifacts/20261020_150607/nested__base"
        if hashlib.sha256((model_dir / "model.pkl").read_bytes()).hexdigest() != MODEL_SHA256:
            raise RuntimeError("MODEL_INTEGRITY_FAILED")
        _predictor = M1Predictor.load(model_dir)
        if _predictor.meta["model_version"] != MODEL_VERSION:
            raise RuntimeError("MODEL_VERSION_MISMATCH")
    return _predictor


def saved_profile_input(remote: dict, as_of=None) -> dict:
    """Keep nulls unknown, BP as an exclusion, and days distinct from drinks."""
    h = remote.get("health_profile") or {}
    d = h.get("details") or {}
    conditions = d.get("conditions") if isinstance(d.get("conditions"), list) else None
    # Explicit "none"/[] is observed False; unknown stays missing. Preserve legacy [] answers.
    if not conditions and d.get("conditionStatus") == "unknown":
        conditions = None
    family = d.get("familyHistory") if isinstance(d.get("familyHistory"), list) else []
    family_htn = True if "hypertension" in family else d.get("hypertensionFamily")
    active = [m for m in remote.get("medications", []) if m.get("active") and not m.get("archived")]
    known_htn_med = d.get("htnStatus") == "on_medication" or any(
        m.get("condition") in ("hypertension", "고혈압") for m in active
    )
    result = {
        "age": h.get("age"), "sex": h.get("sex"),
        "height_cm": h.get("height_cm"), "weight_kg": h.get("weight_kg"),
        "fasting_glucose": h.get("fasting_glucose"),
        "activity_minutes_week": d.get("activeMinutesWeek"),
        "family_htn": family_htn, "sleep_hours": d.get("sleepHours"),
        "dm_dx": None if conditions is None else "diabetes" in conditions,
        "htn_med": known_htn_med,
        "waist_cm": d.get("waistCm"), "resting_hr": d.get("restingHeartRate"),
        "education_years": d.get("educationYears"),
        "alcohol_week": d.get("alcoholWeek"), "binge": d.get("bingeMonthly"),
    }
    from daily_inputs import daily_record, latest_pressure, weekly_activity
    daily = daily_record(remote, as_of)
    if daily:
        result.update(sleep_hours=daily.get("sleepHours"), resting_hr=daily.get("restingHr"), fasting_glucose=daily.get("fastingGlucose"))
        observed_bp = latest_pressure(daily)
        if observed_bp:
            result["blood_pressure"] = observed_bp
    activity = weekly_activity(remote, as_of)
    if activity is not None:
        result["activity_minutes_week"] = activity
    # A single entered reading is not a home-BP average or an M1 feature.
    if h.get("onboarding_bp_text") and "blood_pressure" not in result:
        result["blood_pressure"] = h["onboarding_bp_text"]
    # Explicit zero drinking days implies zero drinks. Nonzero days do not.
    if d.get("alcoholDays") == 0:
        result.update(alcohol_week=0, binge=False)
    return {k: v for k, v in result.items() if v is not None}


def with_input_gaps(model, payload: dict) -> dict:
    result = model.predict(payload)
    if result.get("data_quality") != "insufficient":
        return result
    # Explain the existing model's missing flags; do not relax its quality threshold.
    names = {"waist_missing": "waist_cm", "alcohol_missing": "alcohol_week",
        "activity_missing": "activity_minutes_week", "family_htn_missing": "family_htn",
        "sleep_missing": "sleep_hours", "diabetes_missing": "diabetes_flag",
        "fasting_glucose_missing": "fasting_glucose", "resting_hr_missing": "resting_hr",
        "education_missing": "education_years"}
    transformed = model.fast.transform(payload)
    missing = [name for name in ("age", "sex", "bmi") if f"{name}_missing" in transformed.problems]
    missing += [name for flag, name in names.items() if transformed.flags.get(flag)]
    return {**result, "missing_inputs": missing}


def valid_types(payload: dict) -> bool:
    numeric = {
        "age", "bmi", "height_cm", "weight_kg", "waist_cm", "alcohol_week",
        "alcohol_freq_per_week", "alcohol_drinks_per_occasion", "binge_freq_per_month",
        "activity_minutes_week", "moderate_min_week", "vigorous_min_week", "walk_min_week",
        "sleep_hours", "fasting_glucose", "hba1c", "resting_hr", "education_years", "stress_score",
    }
    integers = {"age", "activity_minutes_week", "resting_hr", "education_years", "stress_score"}
    booleans = {"alcohol_per_day", "binge", "activity_low_flag", "family_htn",
        "sleep_short_flag", "diabetes_flag", "family_htn_father", "family_htn_mother",
        "family_htn_sibling", "dm_dx", "dm_med", "htn_med"}
    for key, value in payload.items():
        key = key.strip().lower()
        if value is None:
            continue
        if key in numeric:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                return False
            if key in integers and value != int(value):
                return False
        elif key in booleans and not isinstance(value, (str, bool, int, float)):
            return False
        elif key in {"sex", "smoking"} and not isinstance(value, (str, int)):
            return False
    return True


class UpstreamError(Exception):
    def __init__(self, status):
        self.status = status


def supabase_call(path: str, token: str, *, post=False):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    req = Request(url, data=b"{}" if post else None, headers={
        "apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"],
        "Authorization": token, "Content-Type": "application/json",
    }, method="POST" if post else "GET")
    try:
        with urlopen(req, timeout=6) as response:
            return json.load(response)
    except HTTPError as exc:
        # Never include upstream response bodies or tokens in logs/errors.
        raise UpstreamError(exc.code) from None


def create_handler(call=supabase_call, get_predictor=predictor):
    def handle(event, context=None):
        def reply(status, body):
            return {"statusCode": status, "headers": {
                "content-type": "application/json", "cache-control": "no-store",
                "x-content-type-options": "nosniff",
            }, "body": json.dumps(body, ensure_ascii=False, allow_nan=False)}
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method")
        if path == "/predictions/bp-stage/health" and method == "GET":
            try:
                get_predictor()
                return reply(200, {"ready": True, "model_version": MODEL_VERSION, "feature_version": "1.2.0", "ranker": False})
            except Exception:
                return reply(503, {"error": "MODEL_UNAVAILABLE"})
        if path not in ("/predictions/bp-stage", "/v1/predictions/bp-stage") or method != "POST":
            return reply(404, {"error": "NOT_FOUND"})
        # Public demo accepts a fixed synthetic persona ID only; no user-supplied health data.
        if path == "/predictions/bp-stage" and not event.get("isBase64Encoded"):
            demo_body = event.get("body") or ""
            if isinstance(demo_body, str) and len(demo_body) <= 128:
                try:
                    demo_request = json.loads(demo_body)
                except (ValueError, TypeError):
                    demo_request = None
                if demo_request == {"demo_persona": "htn-diabetes-v1"}:
                    try:
                        from quest_analysis import demo_remote, analysis_response
                        remote = demo_remote()
                        m1_result = with_input_gaps(get_predictor(), saved_profile_input(remote))
                        return reply(200, analysis_response(m1_result, remote, synthetic=True))
                    except Exception:
                        return reply(503, {"error": "MODEL_UNAVAILABLE", "retryable": True})
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        token = headers.get("authorization", "")
        if not isinstance(token, str) or not token.startswith("Bearer ") or len(token) > 8192:
            return reply(401, {"error": "AUTH_REQUIRED"})
        try:
            raw = event.get("body") or "{}"
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            if len(raw.encode("utf-8")) > 16384:
                return reply(413, {"error": "BODY_TOO_LARGE"})
            payload = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(payload, dict) or not valid_types(payload):
                return reply(400, {"error": "INVALID_BODY"})
        except (ValueError, TypeError, UnicodeError):
            return reply(400, {"error": "INVALID_JSON"})
        try:
            try:
                user = call("/auth/v1/user", token)
            except UpstreamError as exc:
                if exc.status in (400, 401, 403):
                    return reply(401, {"error": "SESSION_EXPIRED"})
                raise
            if not isinstance(user.get("id"), str):
                return reply(401, {"error": "SESSION_EXPIRED"})
            consents = call("/rest/v1/user_consents?select=version&consent_type=eq.health_cloud_storage&version=eq.health-cloud-v1&revoked_at=is.null", token)
            if not consents:
                return reply(403, {"error": "HEALTH_CONSENT_REQUIRED"})
            if path == "/v1/predictions/bp-stage":
                include_m2 = set(payload) == {"include_m2"} and payload["include_m2"] is True
                if payload and not include_m2:
                    return reply(400, {"error": "SAVED_PROFILE_BODY_MUST_BE_EMPTY"})
                profiles = call("/rest/v1/health_profiles?select=age,sex,height_cm,weight_kg,onboarding_bp_text,fasting_glucose,details&limit=1", token)
                medications = call("/rest/v1/medications?select=condition,active&archived=eq.false&active=eq.true", token)
                remote = {"health_profile": profiles[0] if profiles else None, "medications": medications}
                snapshots = call("/rest/v1/game_saves?select=snapshot&limit=1", token)
                remote["game"] = snapshots[0].get("snapshot", {}) if isinstance(snapshots, list) and snapshots else {}
                payload = saved_profile_input(remote)
                if not valid_types(payload):
                    return reply(400, {"error": "INVALID_SAVED_PROFILE"})
                if include_m2:
                    from quest_analysis import analysis_response
                    return reply(200, analysis_response(with_input_gaps(get_predictor(), payload), remote))
            # Domain refusal is HTTP 200, per ai/m1_stage/docs/api_spec.md.
            return reply(200, with_input_gaps(get_predictor(), payload))
        except UpstreamError as exc:
            return reply(401 if exc.status == 401 else 503, {"error": "SESSION_EXPIRED" if exc.status == 401 else "STORAGE_UNAVAILABLE"})
        except Exception:
            return reply(503, {"error": "MODEL_UNAVAILABLE", "retryable": True})
    return handle


handler = create_handler()

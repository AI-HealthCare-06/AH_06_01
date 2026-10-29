"""M1/M2 integration; rule thresholds remain in the imported model contracts."""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re

def today_kst():
    return datetime.now(timezone(timedelta(hours=9))).date()

def demo_remote(as_of=None, persona_id="htn-diabetes-v1"):
    current = as_of or today_kst()
    files = {"htn-diabetes-v1": "demo-persona.json", "office-month-v1": "demo-persona-office-month.json"}
    if persona_id not in files:
        raise ValueError("Unknown fixed demo persona")
    fixture_path = Path(__file__).with_name(files[persona_id])
    if not fixture_path.exists():
        fixture_path = Path(__file__).resolve().parents[3] / "frontend/src/design" / files[persona_id]
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    p = fixture["profile"]
    history = {(current - timedelta(days=len(fixture["records"])-1-i)).isoformat(): record for i, record in enumerate(fixture["records"])}
    surveys = {}
    for day, row in history.items():
        answers = row["survey"]
        surveys[day] = {**answers, "date": day,
            "submittedAt": int(datetime.fromisoformat(day + "T00:00:00+09:00").timestamp() * 1000),
            "bloodPressureStatus": "measured", "morning": {"systolic": row["systolic"], "diastolic": row["diastolic"]}, "evening": row.get("evening"),
            "pulseStatus": "measured" if row["restingHr"] is not None else "not-measured", "restingHr": row["restingHr"], "sleepStatus": "reported", "sleepInputKind": "times",
            "sleepHours": row["sleepHours"], "fastingGlucose": row["glucose"],
            "snoring": None if answers["snoringScore"] is None else answers["snoringScore"] > 0, "daytimeSleepiness": None if answers["daytimeSleepinessScore"] is None else answers["daytimeSleepinessScore"] > 0}
    return {"health_profile": {"age": p["age"], "sex": p["sex"], "height_cm": p["height"],
        "weight_kg": p["weight"], "onboarding_bp_text": p["bloodPressure"], "fasting_glucose": p["glucose"], "details": p},
        "medications": fixture["medications"], "game": {"healthHistory": history, "dailySurveys": surveys,
            "questHistoryDetails": {day: [*row["completed"], "survey"] for day, row in history.items()}}, "demo_m2": fixture["m2"]}

def analysis_response(m1_result, remote, *, synthetic=False, as_of=None):
    from m2_state.inference.judge_m2 import judge
    current = as_of or today_kst()
    previous_date = (current - timedelta(days=1)).isoformat()
    h = remote.get("health_profile") or {}
    p = h.get("details") or {}
    game = remote.get("game") or {}
    previous_health = (game.get("healthHistory") or {}).get(previous_date) or {}
    from daily_inputs import daily_record, weekly_activity
    daily = daily_record(remote, current)
    observed = daily if daily else previous_health
    daily_extra = daily or {}
    activity_minutes = weekly_activity(remote, current)
    previous_ids = (game.get("questHistoryDetails") or {}).get(previous_date)
    previous_ids = [q for q in previous_ids if q in {"medicine","meal","walk","water","sleep","survey"}] if isinstance(previous_ids, list) else None
    meds = [m for m in remote.get("medications", []) if m.get("active") and not m.get("archived")]
    htn_meds = [m for m in meds if m.get("condition") in ("hypertension", "고혈압")]
    treated = p.get("htnStatus") == "on_medication" or bool(htn_meds)
    step, step_source = m1_result.get("stage_top"), "M1-S"
    if treated:
        step, step_source = "htn", "medication-contract"
    elif not step:
        step, step_source = None, "unavailable"
    extra = remote.get("demo_m2") if synthetic else {}
    extra = extra or {}
    m2_payload = {
        "subject_id": "synthetic-demo" if synthetic else "current-user", "as_of": current.isoformat(),
        "m1_bp_step": {"step": step, "step_date": current.isoformat()},
        "age_sex": {"age": h.get("age"), "sex": "M" if h.get("sex") == "male" else "F" if h.get("sex") == "female" else None},
        "height_weight_waist": {"height_cm": h.get("height_cm"), "weight_kg": h.get("weight_kg"), "waist_cm": p.get("waistCm")},
        "pulse_hr": {"resting_hr": observed.get("restingHr", p.get("restingHeartRate"))},
        "medication": {"status": 3 if treated else 2 if p.get("htnStatus") == "diagnosed_untreated" else 1 if p.get("htnStatus") == "none" else None,
            "drugs": [{"name": m["name"]} for m in htn_meds if m.get("name")], "triple_with_diuretic": False if synthetic else None},
        "symptom_flags": {"nocturia": daily_extra.get("nocturia") if daily else extra.get("nocturia")},
        "sleep_snoring": {"sleep_hours": observed.get("sleepHours", p.get("sleepHours")),
            **{key: daily_extra.get({"snoring":"snoring","daytime_sleepiness":"daytimeSleepiness","nocturia":"nocturia"}[key]) if daily else extra.get(key) for key in ("snoring","daytime_sleepiness","nocturia")}},
        "diet_sodium": {key: extra.get(key) for key in ("salty_habit","eating_out_per_week")},
        "activity": {"moderate_min_per_week": activity_minutes if activity_minutes is not None else p.get("activeMinutesWeek"), "steps_per_day": previous_health.get("steps"), "sedentary_hours": daily_extra.get("sedentaryHours") if daily else extra.get("sedentary_hours")},
        "smoking_alcohol": {"smoking": "current" if p.get("smoking") is True else "never" if p.get("smoking") is False else None,
            "alcohol_per_week": 0 if p.get("alcoholDays") == 0 else None, "binge": p.get("bingeMonthly")},
        "lab_glucose_lipid": {"fpg": daily.get("fastingGlucose") if daily else previous_health.get("glucose", h.get("fasting_glucose"))},
        "family_history": {"htn": p.get("hypertensionFamily"), "stroke": True if "stroke" in p.get("familyHistory",[]) else None},
    }
    return {"m1": m1_result, "m1_bridge": {"step": step, "source": step_source},
        "m2": judge(m2_payload), "previous_day": {"date": previous_date, "completed_quests": previous_ids,
            "steps": previous_health.get("steps"), "sleep_hours": previous_health.get("sleepHours")},
        "source": "synthetic-demo" if synthetic else "saved-profile", "as_of": current.isoformat(), "daily_survey_date": daily.get("date") if daily else None}

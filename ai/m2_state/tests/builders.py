"""tests/builders.py — 테스트·골든 케이스용 입력 생성기 (v0.2.0, M1 step 기반).

여기의 값은 '입력 데이터' 이지 임계값이 아니다. step 값은 thresholds.STEP_* 를 쓴다.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

import thresholds as T

AS_OF = dt.date(2026, 10, 21)


def full_payload(
    *,
    step: str = T.STEP_NORMAL,
    step_date: Optional[str] = None,
    m1_extra: Optional[dict] = None,          # pending_m1 필드를 넣어 볼 때
    med_status: int = T.MED_NO_DIAGNOSIS,
    drugs: Optional[list] = None,
    triple: Optional[bool] = False,
    sex: str = "M",
    age: int = 50,
    symptoms: Optional[dict] = None,
    sleep: Optional[dict] = None,
    smoking: str = "never",
    binge: bool = False,
    salty: bool = False,
    family_htn: bool = False,
    labs: bool = True,
    kidney: bool = True,
    subject_id: str = "S1",
    as_of: dt.date = AS_OF,
) -> dict:
    sym = {k: False for k in ("headache", "visual_disturbance", "chest_pain", "dyspnea", "paralysis",
                               "speech_disturbance", "dizziness", "syncope", "nocturia")}
    if symptoms:
        sym.update(symptoms)
    slp = {"bedtime": "23:00", "wake_time": "06:30", "sleep_hours": 7.0,
           "snoring": False, "daytime_sleepiness": False, "nocturia": False}
    if sleep:
        slp.update(sleep)
    if drugs is None:
        drugs = [] if med_status != T.MED_ON_TREATMENT else [{"name": "drug_a", "dose_time": "08:00"}]
    m1 = {"step": step, "step_date": step_date}
    if m1_extra:
        m1.update(m1_extra)
    return {
        "subject_id": subject_id,
        "as_of": as_of.isoformat(),
        "m1_bp_step": m1,
        "pulse_hr": {"resting_hr": 70, "irregular_pulse": False},
        "symptom_flags": sym,
        "age_sex": {"age": age, "sex": sex},
        "height_weight_waist": {"height_cm": 170, "weight_kg": 65, "waist_cm": 80},
        "medication": {"status": med_status, "drugs": drugs, "triple_with_diuretic": triple},
        "smoking_alcohol": {"smoking": smoking, "alcohol_per_week": 0, "drinks_per_occasion": 0, "binge": binge},
        "sleep_snoring": slp,
        "diet_sodium": {"salty_habit": salty, "eating_out_per_week": 2},
        "activity": {"moderate_min_per_week": 150, "steps_per_day": 7000, "sedentary_hours": 8},
        "lab_glucose_lipid": {"fpg": 95, "hba1c": 5.4, "tc": 180, "tg": 100, "hdl": 55, "ldl": 100} if labs else None,
        "lab_kidney": {"creatinine": 0.9, "urine_protein": "negative"} if kidney else None,
        "family_history": {"htn": family_htn, "stroke": False, "mi": False},
        "clinical_exam": None,
    }

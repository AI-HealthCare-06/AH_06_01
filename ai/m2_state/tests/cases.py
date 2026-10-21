"""tests/cases.py — 상태별 표준 입력. 결측·복약 테스트와 골든 케이스가 공유한다.

CANON[code]() 는 그 상태의 '대표 결과' 를 내는 입력이다.
- 구현된 상태: positive
- M1 대기 상태: 지금 낼 수 있는 대표 상태(EXPECTED_CANON 참고)
"""
from __future__ import annotations

import thresholds as T
from rules_m2 import M1, PENDING_M1_FIELDS
from tests.builders import full_payload

DRUGS4 = [{"name": f"drug_{i}", "dose_time": "08:00"} for i in range(T.RESISTANT_MIN_DRUGS + 1)]


def elevated(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.ELEVATED_STEP)
    return full_payload(med_status=med_status, **kw)


def prehtn(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.PREHTN_STEP)
    return full_payload(med_status=med_status, smoking="current", salty=True, family_htn=True, **kw)


def htn_suspect(med_status=T.MED_DIAGNOSED_UNTREATED, **kw):
    kw.setdefault("step", T.HTN_SUSPECT_STEP)
    return full_payload(med_status=med_status, **kw)


def htn_stage2_screen(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.STEP_HTN)
    return full_payload(med_status=med_status, **kw)


def ish(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("age", 72)
    kw.setdefault("sex", "F")
    kw.setdefault("step", T.STEP_HTN)
    return full_payload(med_status=med_status, **kw)


def white_coat(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.STEP_PREHTN)
    return full_payload(med_status=med_status, **kw)


def masked(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.STEP_NORMAL)
    return full_payload(med_status=med_status, **kw)


def morning(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("step", T.STEP_HTN)
    return full_payload(med_status=med_status, **kw)


def nocturnal_screen(med_status=T.MED_NO_DIAGNOSIS, **kw):
    kw.setdefault("sleep", {"snoring": True, "daytime_sleepiness": True})
    kw.setdefault("step", T.STEP_NORMAL)
    return full_payload(med_status=med_status, **kw)


def resistant_suspect(med_status=T.MED_ON_TREATMENT, **kw):
    kw.setdefault("triple", True)
    kw.setdefault("drugs", DRUGS4)
    kw.setdefault("step", T.STEP_HTN)
    return full_payload(med_status=med_status, **kw)


CANON = {
    "ELEVATED": elevated,
    "PREHTN": prehtn,
    "HTN_SUSPECT": htn_suspect,
    "HTN_STAGE2_SCREEN": htn_stage2_screen,
    "ISH": ish,
    "WHITE_COAT": white_coat,
    "MASKED": masked,
    "MORNING": morning,
    "NOCTURNAL_SCREEN": nocturnal_screen,
    "RESISTANT_SUSPECT": resistant_suspect,
}
assert tuple(CANON) == T.STATE_CODES

P, NE = T.STATUS_POSITIVE, T.STATUS_NOT_EVALUABLE


def _pend(code):
    return [f"{M1}.{f}" for f in PENDING_M1_FIELDS[code]]


# CANON 입력에서 기대하는 (status, missing_required)
EXPECTED_CANON = {
    "ELEVATED": (P, []),
    "PREHTN": (P, []),
    "HTN_SUSPECT": (P, []),
    "HTN_STAGE2_SCREEN": (NE, _pend("HTN_STAGE2_SCREEN")),
    "ISH": (NE, _pend("ISH")),
    "WHITE_COAT": (NE, _pend("WHITE_COAT")),
    "MASKED": (NE, _pend("MASKED")),
    "MORNING": (NE, _pend("MORNING")),
    "NOCTURNAL_SCREEN": (P, []),
    "RESISTANT_SUSPECT": (NE, _pend("RESISTANT_SUSPECT")),
}

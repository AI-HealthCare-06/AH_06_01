"""step 값별 테스트: M1 step(normal/elevated/prehtn/htn) 4개 × 상태. mmHg 경계값 테스트는 M1 쪽으로 넘어갔다."""
from __future__ import annotations

import pytest

import thresholds as T
from rules_m2 import M1
from tests.builders import full_payload
from tests.cases import CANON, EXPECTED_CANON
from tests.conftest import state

P, N, NE = T.STATUS_POSITIVE, T.STATUS_NEGATIVE, T.STATUS_NOT_EVALUABLE
S1, S2, S3 = T.MED_NO_DIAGNOSIS, T.MED_DIAGNOSED_UNTREATED, T.MED_ON_TREATMENT
SYM2 = {"snoring": True, "daytime_sleepiness": True}

# (상태, step) → 기대 status. 미치료자(11=1) 기준.
STEP_TABLE = {
    "ELEVATED":         {T.STEP_NORMAL: N, T.STEP_ELEVATED: P, T.STEP_PREHTN: N, T.STEP_HTN: N},
    "PREHTN":           {T.STEP_NORMAL: N, T.STEP_ELEVATED: N, T.STEP_PREHTN: P, T.STEP_HTN: N},
    "HTN_SUSPECT":      {T.STEP_NORMAL: N, T.STEP_ELEVATED: N, T.STEP_PREHTN: N, T.STEP_HTN: P},
    "NOCTURNAL_SCREEN": {T.STEP_NORMAL: NE, T.STEP_ELEVATED: NE, T.STEP_PREHTN: NE, T.STEP_HTN: NE},  # 증상 0 → 저녁 분기 대기
}
CASES = [(code, s) for code in STEP_TABLE for s in T.STEPS]


@pytest.mark.parametrize("code,step", CASES, ids=[f"{c}-{s}" for c, s in CASES])
def test_step_implemented_states_untreated(code, step):
    r = state(full_payload(step=step, med_status=S1), code)
    assert r["status"] == STEP_TABLE[code][step]
    assert r["evidence"]["step"] == step


@pytest.mark.parametrize("step", T.STEPS)
def test_step_NOCTURNAL_SCREEN_symptom_branch_independent_of_step(step):
    r = state(full_payload(step=step, sleep=SYM2), "NOCTURNAL_SCREEN")
    assert r["status"] == P and r["evidence"]["n_symptoms"] == T.NOCTURNAL_SYMPTOM_MIN


@pytest.mark.parametrize("n,expect", [(T.NOCTURNAL_SYMPTOM_MIN - 1, NE), (T.NOCTURNAL_SYMPTOM_MIN, P), (T.NOCTURNAL_SYMPTOM_MIN + 1, P)])
def test_step_NOCTURNAL_SCREEN_symptom_count(n, expect):
    keys = ["snoring", "daytime_sleepiness", "nocturia"][:n]
    r = state(full_payload(sleep={k: True for k in keys}), "NOCTURNAL_SCREEN")
    assert r["evidence"]["n_symptoms"] == n and r["status"] == expect
    if expect == NE:
        assert r["missing_required"] == [f"{M1}.evening_step"]
        assert "evening_branch:pending_m1" in r["notes"]


def test_step_NOCTURNAL_SCREEN_nocturia_from_symptom_flags():
    r = state(full_payload(sleep={"snoring": True}, symptoms={"nocturia": True}), "NOCTURNAL_SCREEN")
    assert r["evidence"]["n_symptoms"] == 2 and r["status"] == P and r["evidence"]["abpm_used"] is False


def test_step_PREHTN_risk_factor_list():
    ev = state(full_payload(step=T.STEP_PREHTN, smoking="current", salty=True, family_htn=True, binge=True), "PREHTN")["evidence"]
    assert ev["risk_factors"] == ["smoking_current", "binge_drinking", "high_sodium_habit", "family_history"]
    assert ev["n_risk_factors"] == 4
    assert ev["risk_factors_pending"] == ["bmi", "waist", "activity"]      # D-07 기준 미정
    r0 = state(full_payload(step=T.STEP_PREHTN), "PREHTN")
    assert r0["status"] == P and r0["evidence"]["n_risk_factors"] == 0      # 위험인자 0 이어도 판정은 step 으로
    assert "risk_factors_listed_not_conditioning" in r0["notes"]


def test_step_PREHTN_risk_factor_numeric_when_thresholds_set(pending):
    pending("RISK_BMI_MIN", 25.0)
    pending("RISK_ACTIVITY_MIN_PER_WEEK_BELOW", 150)
    p = full_payload(step=T.STEP_PREHTN)
    p["height_weight_waist"]["weight_kg"] = 80          # BMI 27.7
    p["activity"]["moderate_min_per_week"] = 149
    ev = state(p, "PREHTN")["evidence"]
    assert ev["risk_factors"] == ["bmi_high", "low_activity"] and ev["risk_factors_pending"] == ["waist"]


def test_step_HTN_SUSPECT_treated_is_pending_bp_level():
    r = state(full_payload(step=T.STEP_HTN, med_status=S3), "HTN_SUSPECT")
    assert r["status"] == NE and r["missing_required"] == [f"{M1}.bp_level_step"]
    assert {"htn_step_includes_medication", "pending_m1"} <= set(r["notes"])


PENDING_CASES = [(c, s) for c in T.PENDING_M1_STATES for s in T.STEPS]


@pytest.mark.parametrize("code,step", PENDING_CASES, ids=[f"{c}-{s}" for c, s in PENDING_CASES])
def test_step_pending_states_do_not_depend_on_step(code, step):
    p = CANON[code](step=step)
    r = state(p, code)
    exp_status, exp_missing = EXPECTED_CANON[code]
    assert (r["status"], r["missing_required"]) == (exp_status, exp_missing)
    assert "pending_m1" in r["notes"]


@pytest.mark.parametrize("code", T.PENDING_M1_STATES)
def test_step_pending_fields_accepted_but_unused(code):
    extra = {"morning_step": T.STEP_HTN, "evening_step": T.STEP_NORMAL, "office_step": T.STEP_HTN,
             "bp_level_step": T.STEP_HTN, "stage2_flag": True, "ish_flag": True, "guard_flag": True}
    r = state(CANON[code](m1_extra=extra), code)
    assert (r["status"], r["missing_required"]) == EXPECTED_CANON[code]   # 들어와도 아직 규칙은 쓰지 않음


def test_step_RESISTANT_SUSPECT_decidable_parts():
    r = state(CANON["RESISTANT_SUSPECT"](triple=False), "RESISTANT_SUSPECT")
    assert r["status"] == N and r["evidence"]["triple_with_diuretic"] is False      # 3제 조건 불충족 → 혈압 무관
    r2 = state(CANON["RESISTANT_SUSPECT"](triple=None), "RESISTANT_SUSPECT")
    assert r2["status"] == NE and r2["missing_required"] == ["medication.triple_with_diuretic"]
    r3 = state(CANON["RESISTANT_SUSPECT"](), "RESISTANT_SUSPECT")
    assert r3["status"] == NE and r3["missing_required"] == [f"{M1}.bp_level_step"]
    assert r3["evidence"]["n_drugs"] == T.RESISTANT_MIN_DRUGS + 1

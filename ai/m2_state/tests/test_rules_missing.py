"""결측 테스트: 상태별 필수 항목을 하나씩 제거 → not_evaluable."""
from __future__ import annotations

import pytest

import rules_m2 as R
import thresholds as T
from inference.judge_m2 import judge
from tests.builders import full_payload
from tests.cases import CANON, EXPECTED_CANON
from tests.conftest import state

PAIRS = [(code, var) for code in T.STATE_CODES for var in R.required_vars(code)]


@pytest.mark.parametrize("code,var", PAIRS, ids=[f"{c}-{v}" for c, v in PAIRS])
def test_missing_required_var_gives_not_evaluable(code, var):
    p = CANON[code]()
    r0 = state(p, code)
    assert (r0["status"], r0["missing_required"]) == EXPECTED_CANON[code], "전제: 결측 전 대표 결과"
    p[var] = None
    r = state(p, code)
    assert r["status"] == T.STATUS_NOT_EVALUABLE
    assert r["missing_required"] == [var]


@pytest.mark.parametrize("code", T.STATE_CODES)
def test_missing_auxiliary_var_does_not_change_status(code):
    p = CANON[code]()
    for var in R.auxiliary_vars(code):
        p[var] = None
    r = state(p, code)
    assert (r["status"], r["missing_required"]) == EXPECTED_CANON[code]
    assert r["auxiliary_present"] == []


def test_missing_step_field_only():
    p = CANON["ELEVATED"]()
    p["m1_bp_step"] = {"step": None, "step_date": "2026-10-20"}
    r = state(p, "ELEVATED")
    assert r["status"] == T.STATUS_NOT_EVALUABLE and r["missing_required"] == ["m1_bp_step"]


def test_missing_everything_but_step():
    p = full_payload(step=T.STEP_HTN)
    for k in list(p):
        if k not in ("subject_id", "as_of", "m1_bp_step"):
            p[k] = None
    st = {c: s["status"] for c, s in judge(p)["states"].items()}
    assert set(st.values()) == {T.STATUS_NOT_EVALUABLE}     # age_sex 가 전부에 필수

"""출력에 금지 표현·한글 문구가 없고 상태 코드와 숫자만 있는지 검사."""
from __future__ import annotations

import json

import pytest

import thresholds as T
from inference.judge_m2 import judge
from tests.builders import full_payload
from tests.cases import CANON


def _payloads():
    ps = [CANON[c]() for c in T.STATE_CODES]
    ps += [full_payload(step=s, med_status=m) for s in T.STEPS for m in (1, 2, 3)]
    bad = full_payload(); bad["age_sex"]["age"] = 10 ** 6         # 거부
    ps.append(bad)
    return ps


@pytest.mark.parametrize("i,p", list(enumerate(_payloads())))
def test_output_has_no_forbidden_terms_and_is_ascii(i, p):
    out = judge(p)
    s = json.dumps(out, ensure_ascii=False)
    for term in T.FORBIDDEN_OUTPUT_TERMS:
        assert term not in s
    assert s.isascii(), "출력은 상태 코드와 숫자만: 비ASCII(문구) 금지"


def test_output_schema_keys():
    out = judge(CANON["ELEVATED"]())
    assert set(out) >= {"module", "contract_version", "thresholds_version", "subject_id", "as_of", "data_quality",
                        "violations", "presence", "m1_bp_step", "guard", "target_bp", "states",
                        "implemented_states", "pending_m1_states", "display_priority"}
    assert tuple(out["states"]) == T.STATE_CODES
    assert out["display_priority"] is None                 # 우선순위 결정 대기
    assert out["guard"] == {"triggered": None, "pending_m1_field": "guard_flag"}
    assert out["m1_bp_step"]["step"] == T.STEP_ELEVATED
    assert out["implemented_states"] == list(T.IMPLEMENTED_STATES)
    assert out["target_bp"] == {"sbp": None, "dbp": None, "diabetes": None, "ckd": None, "basis": None}
    assert out["as_of"] == CANON["ELEVATED"]()["as_of"]


def test_target_bp_switch_when_comorbidity_thresholds_set(pending):
    pending("DIABETES_HBA1C_MIN", 6.5)
    p = CANON["ELEVATED"]()
    p["lab_glucose_lipid"]["hba1c"] = 7.0
    out = judge(p)
    assert (out["target_bp"]["sbp"], out["target_bp"]["dbp"]) == T.TARGET_BP_COMORBID
    assert out["target_bp"]["diabetes"] is True and out["target_bp"]["basis"] == "comorbidity"
    assert out["states"]["ELEVATED"]["status"] == T.STATUS_POSITIVE    # A군 규칙은 바뀌지 않음

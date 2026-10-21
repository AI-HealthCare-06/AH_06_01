"""계약 검증·변환 모듈 테스트 (v0.2.0)."""
from __future__ import annotations

import json

import pandas as pd
import pytest

import feature_contract as fc
import thresholds as T
from inference.judge_m2 import judge
from tests.builders import full_payload
from tests.conftest import statuses


def test_contract_version_and_no_raw_bp_variables():
    c = fc.load_contract()
    assert c["version"] == "0.2.0"
    names = {v["name"] for v in c["variables"]}
    assert "m1_bp_step" in names
    assert not names & {"home_bp_morning", "home_bp_evening", "office_bp", "abpm_24h", "orthostatic_set"}


def test_contract_full_payload_is_ok_and_present():
    vr = fc.validate(full_payload())
    assert vr.data_quality == T.DQ_OK
    absent = [k for k, v in vr.presence.items() if not v]
    assert absent == ["clinical_exam"]


def test_contract_out_of_range_rejects_whole_input_without_clipping():
    p = full_payload()
    p["age_sex"]["age"] = 10 ** 6
    vr = fc.validate(p)
    assert vr.data_quality == T.DQ_OUT_OF_RANGE
    v = vr.violations[0]
    assert (v.variable, v.field, v.kind, v.value) == ("age_sex", "age", T.DQ_OUT_OF_RANGE, 10 ** 6)
    out = judge(p)
    assert out["data_quality"] == T.DQ_OUT_OF_RANGE
    assert {s["status"] for s in out["states"].values()} == {T.STATUS_NOT_EVALUATED}


@pytest.mark.parametrize("path,value", [
    (("height_weight_waist", "weight_kg"), 10 ** 6),
    (("lab_kidney", "creatinine"), 10 ** 6),
    (("smoking_alcohol", "alcohol_per_week"), -1),
    (("pulse_hr", "resting_hr"), 10 ** 6),
])
def test_contract_out_of_range_other_fields(path, value):
    p = full_payload()
    obj = p
    for k in path[:-1]:
        obj = obj[k]
    obj[path[-1]] = value
    assert fc.validate(p).data_quality == T.DQ_OUT_OF_RANGE


def test_contract_invalid_step_and_enum():
    p = full_payload()
    p["m1_bp_step"]["step"] = "high"
    vr = fc.validate(p)
    assert vr.data_quality == T.DQ_INVALID and vr.violations[0].field == "step"
    p = full_payload()
    p["medication"]["status"] = 9
    assert fc.validate(p).data_quality == T.DQ_INVALID
    p = full_payload()
    p["medication"]["status"] = "3"           # 숫자 enum 의 문자열 표기는 허용
    vr = fc.validate(p)
    assert vr.data_quality == T.DQ_OK and vr.payload["medication"]["status"] == 3
    p = full_payload()
    p["m1_bp_step"]["step"] = " HTN "
    assert fc.validate(p).data_quality == T.DQ_INVALID   # 대소문자·공백 정규화는 하지 않음


def test_contract_missing_is_not_out_of_range():
    p = full_payload()
    p["lab_kidney"]["creatinine"] = float("nan")
    p["diet_sodium"]["salty_habit"] = ""
    vr = fc.validate(p)
    assert vr.data_quality == T.DQ_OK
    assert vr.presence["diet_sodium"] is False      # present_if all:[salty_habit]
    assert vr.presence["lab_kidney"] is True        # urine_protein 남아 있음 (any)


def test_contract_presence_rules():
    p = full_payload()
    p["age_sex"] = {"age": 50, "sex": None}
    p["symptom_flags"] = {k: False for k in p["symptom_flags"]}
    p["height_weight_waist"]["waist_cm"] = None
    vr = fc.validate(p)
    assert vr.presence["age_sex"] is False
    assert vr.presence["symptom_flags"] is True     # 전부 False 여도 입력됨
    assert vr.presence["height_weight_waist"] is False
    p2 = full_payload()
    p2["age_sex"] = {"birth_date": "1976-05-01", "sex": "F"}
    assert fc.validate(p2).presence["age_sex"] is True


def test_contract_pending_m1_fields_validated():
    p = full_payload(m1_extra={"evening_step": "bad"})
    assert fc.validate(p).data_quality == T.DQ_INVALID
    p = full_payload(m1_extra={"evening_step": T.STEP_HTN, "stage2_flag": True})
    assert fc.validate(p).data_quality == T.DQ_OK


def _to_table(p: dict) -> pd.DataFrame:
    row = {"subject_id": p["subject_id"], "as_of": p["as_of"]}
    for var, d in p.items():
        if isinstance(d, dict):
            for k, v in d.items():
                row[f"{var}__{k}"] = json.dumps(v) if isinstance(v, list) else v
    return pd.DataFrame([row])


def test_contract_from_table_roundtrip_matches_nested_payload():
    p = full_payload(step=T.STEP_HTN, med_status=T.MED_ON_TREATMENT, triple=True,
                     drugs=[{"name": "a", "dose_time": "08:00"}] * 3)
    df = _to_table(p)
    q = fc.from_table(df, "S1")
    assert fc.validate(q).data_quality == T.DQ_OK
    assert statuses(q) == statuses(p)
    assert q["medication"]["drugs"] == p["medication"]["drugs"]
    assert q["m1_bp_step"]["step"] == T.STEP_HTN


def test_contract_compare_columns_reports_missing_and_extra():
    df = _to_table(full_payload())
    cols = [c for c in df.columns if c != "m1_bp_step__step"] + ["unknown_col"]
    rep = fc.compare_columns(cols)
    assert "m1_bp_step__step" in rep["missing"]
    assert rep["extra"] == ["unknown_col"]
    assert "m1_bp_step" in rep["missing_required_vars"]
    rep2 = fc.compare_columns(["BP_STEP"], column_aliases={"BP_STEP": "m1_bp_step__step"})
    assert rep2["matched"] == ["m1_bp_step__step"]

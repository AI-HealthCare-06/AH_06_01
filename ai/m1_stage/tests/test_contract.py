"""
[파일] tests/test_contract.py
[용도] feature_contract.yaml 로딩, 모델 열 순서, 단조 벡터 길이, 혈압 컬럼 차단, 결측 플래그 소유 규칙을 검사한다.
[왜 필요한가] yaml 을 고쳤을 때 열 순서가 깨지거나 혈압 컬럼이 피처로 새는 것을 즉시 잡기 위해서다.
[쓰는 곳] pytest
"""

import pytest

from m1.contract import Contract


def test_load_and_columns():
    c = Contract.load()
    assert c.version
    cols = c.model_columns()
    assert cols[0] == "age" and "male" in cols and "missing_count" in cols
    assert len(c.monotone_vector(cols)) == len(cols)
    full = c.model_columns(["smoking", "stress_score"])
    assert {"smoking_former", "smoking_current", "stress_score"} <= set(full)


def test_forbidden_bp_columns():
    c = Contract.load()
    for bad in ["sbp_mean", "DBP_1", "home_bp_avg", "systolic", "blood_pressure", "bp", "htn_med"]:
        with pytest.raises(ValueError):
            c.check_forbidden([bad])
    c.check_forbidden(["resting_hr", "heart_rate_bpm", "bmi", "age"])


def test_flag_owner_shared_alcohol_flag():
    c = Contract.load()
    assert c.flag_owner()["alcohol_missing"] == "alcohol_week"

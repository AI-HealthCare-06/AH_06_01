"""tests/test_contract.py — Feature Contract v1 변환 규칙 검증 (모델 아티팩트 불필요)

인수인계 7장 중 결측·범위·누수·미적용 규칙이 계약 층에서 지켜지는지 본다. test_sanity.py 는
같은 규칙을 predict_htn_risk 끝단에서 다시 확인한다.
"""
from __future__ import annotations

import math

import pandas as pd
import pytest

import thresholds_kr_v1 as T
from features import contract_v1 as C

IMP = C.Imputers.provisional()


def person(**over) -> dict:
    base = {
        "feature_version": "v1",
        "age": 40, "sex": "male", "bmi": 23.0, "waist_cm": 82.0,
        "smoking_status": "never", "alcohol_units_week": 2.0,
        "activity_minutes_week": 150, "activity_low_flag": False,
        "sleep_avg_h": 7.0, "sodium_risk_score": 1, "stress_score": 2,
        "family_htn": False, "diabetes_flag": False,
    }
    base.update(over)
    return base


# ── 계약 파일 자체 ──────────────────────────────────────────────────────────
def test_yaml_ranges_match_thresholds():
    C.check_ranges_match_thresholds()


def test_contract_constants_from_yaml():
    assert C.REQUIRED == ("age", "sex", "bmi")
    assert C.LITE_FEATURES == ("age", "sex", "bmi", "waist_cm", "smoking_status")
    assert len(C.FULL_FEATURES) == 14
    assert "sbp" in C.NEVER_FEATURES and "home_sbp_avg_7d" in C.NEVER_FEATURES
    assert set(C.NUMERIC_COLUMNS_FULL) >= set(C.NUMERIC_COLUMNS_LITE)
    assert set(C.MONOTONE_CONSTRAINTS) == set(C.NUMERIC_COLUMNS_FULL)


# ── 정상 경로 ───────────────────────────────────────────────────────────────
def test_ok_full():
    r = C.build_features(person(), IMP)
    assert r.data_quality == "ok" and r.model_id == C.MODEL_FULL
    assert tuple(r.features) == C.FULL_FEATURES
    assert r.features["missing_count"] == 0 and r.features["activity_low_flag"] is False
    row = C.encode_numeric(r.features, C.MODEL_FULL)
    assert tuple(row) == C.NUMERIC_COLUMNS_FULL
    assert row["sex_female"] == 0.0 and row["smoking_current"] == 0.0


def test_derived_flag_ignores_client_value():
    # 클라이언트가 보낸 activity_low_flag 는 믿지 않고 분(minutes)으로 다시 계산
    r = C.build_features(person(activity_minutes_week=30, activity_low_flag=False), IMP)
    assert r.features["activity_low_flag"] is True
    r = C.build_features(person(activity_minutes_week=200, activity_low_flag=True), IMP)
    assert r.features["activity_low_flag"] is False


def test_bmi_derived_from_height_weight():
    p = person()
    p.pop("bmi")
    p.update(height_cm=175.0, weight_kg=70.0)
    r = C.build_features(p, IMP)
    assert r.accepted and abs(r.features["bmi"] - 70 / 1.75**2) < 1e-9


# ── 결측 ────────────────────────────────────────────────────────────────────
def test_one_or_two_missing_stays_full_with_flags():
    p = person()
    p.pop("sleep_avg_h")
    p["stress_score"] = None
    r = C.build_features(p, IMP)
    assert r.data_quality == "ok" and r.model_id == C.MODEL_FULL
    assert sorted(r.missing_features) == ["sleep_avg_h", "stress_score"]
    assert r.features["sleep_avg_h"] == 7.0 and r.features["stress_score"] == 2
    assert r.features["missing_count"] == 2


def test_three_missing_falls_back_to_lite_partial():
    p = person()
    for k in ("alcohol_units_week", "sodium_risk_score", "family_htn"):
        p.pop(k)
    r = C.build_features(p, IMP)
    assert r.data_quality == "partial" and r.model_id == C.MODEL_LITE
    assert r.features["missing_count"] == 3
    row = C.encode_numeric(r.features, C.MODEL_LITE)
    assert tuple(row) == C.NUMERIC_COLUMNS_LITE


def test_activity_missing_sets_low_flag_true():
    p = person()
    p.pop("activity_minutes_week")
    p.pop("activity_low_flag")
    r = C.build_features(p, IMP)
    assert r.features["activity_low_flag"] is True
    assert r.features["activity_minutes_week"] == round(IMP.activity_median)


def test_waist_imputed_by_sex_and_bmi_band():
    p = person(sex="female", bmi=27.0)
    p.pop("waist_cm")
    r = C.build_features(p, IMP)
    assert r.features["waist_cm"] == IMP.waist_by_sex_bmi_band["female|obese1"]
    assert "waist_cm" in r.missing_features


@pytest.mark.parametrize("field", ["age", "sex", "bmi"])
def test_required_missing_is_insufficient(field):
    p = person()
    p.pop(field)
    r = C.build_features(p, IMP)
    assert r.data_quality == "insufficient" and r.missing_features == [field]
    assert r.features == {} and r.model_id is None


def test_sex_other_is_insufficient_not_crash():
    # 데이터 사전 P02 는 other 를 허용하지만 모델은 male/female 로만 학습 → 범위 밖으로 거부
    r = C.build_features(person(sex="other"), IMP)
    assert r.data_quality == "out_of_range" and r.out_of_range == ["sex"]


# ── 범위 밖: 클리핑 금지 ─────────────────────────────────────────────────────
@pytest.mark.parametrize("field,value", [
    ("bmi", 60.0), ("age", 150), ("sleep_avg_h", 20.0), ("waist_cm", 10.0),
    ("sodium_risk_score", 3), ("stress_score", 0), ("alcohol_units_week", -1),
    ("smoking_status", "sometimes"), ("family_htn", "maybe"), ("age", 40.5), ("bmi", float("nan")),
])
def test_out_of_range_rejected(field, value):
    r = C.build_features(person(**{field: value}), IMP)
    if field == "bmi" and isinstance(value, float) and math.isnan(value):
        assert r.data_quality == "insufficient"  # NaN 은 결측으로 본다 → 필수 피처 결측
    else:
        assert r.data_quality == "out_of_range", r
        assert field in r.out_of_range


def test_age_18_is_out_of_contract_range_not_minor():
    # 앱은 18세 이상 허용이지만 학습 데이터는 19세부터 → 계약 범위 밖. 기획팀 확인 항목.
    r = C.build_features(person(age=18), IMP)
    assert r.data_quality == "out_of_range"


# ── 미적용 대상 ─────────────────────────────────────────────────────────────
def test_minor_not_applicable():
    r = C.build_features(person(age=16), IMP)
    assert r.data_quality == "not_applicable"


def test_pregnant_not_applicable_even_if_other_fields_bad():
    r = C.build_features(person(sex="female", age=32, pregnancy_status="pregnant", bmi=99), IMP)
    assert r.data_quality == "not_applicable"


# ── 누수 차단 ───────────────────────────────────────────────────────────────
def test_bp_keys_ignored_and_reported():
    a = C.build_features(person(), IMP)
    b = C.build_features(person(sbp=170, dbp=105, home_sbp_avg_7d=150, htn_status="on_medication"), IMP)
    assert a.features == b.features
    assert set(b.ignored_keys) == {"sbp", "dbp", "home_sbp_avg_7d", "htn_status"}
    assert any(w.startswith("ignored_never_features") for w in b.warnings)
    assert not any(k in C.NUMERIC_COLUMNS_FULL for k in C.NEVER_FEATURES)


def test_input_dict_not_mutated():
    p = person(sbp=170)
    C.build_features(p, IMP)
    assert "sbp" in p and "feature_version" in p


# ── 학습용 DataFrame 변환과 대치값 적합 ──────────────────────────────────────
def test_transform_frame_and_fit_imputers():
    rows = [person(age=a, sex=s, bmi=b, waist_cm=w) for a, s, b, w in [
        (30, "male", 22.0, 80.0), (45, "female", 26.0, 85.0), (60, "male", 28.0, 95.0), (16, "male", 22.0, 80.0)]]
    rows.append(person(age=50, bmi=60.0))  # out_of_range
    df = pd.DataFrame(rows)
    X, results = C.transform_frame(df, IMP)
    assert len(X) == 3 and list(X.columns) == list(C.NUMERIC_COLUMNS_FULL)
    assert [r.data_quality for r in results] == ["ok", "ok", "ok", "not_applicable", "out_of_range"]

    imp = C.fit_imputers(df.iloc[:3], source="test")
    assert imp.waist_by_sex["male"] == 87.5 and imp.waist_by_sex["female"] == 85.0
    assert imp.waist("male", 22.0) == 80.0 and imp.waist("female", 26.0) == 85.0
    assert imp.waist("female", 35.0) == 85.0  # 구간 키 없음 → 성별 fallback
    assert imp.activity_median == 150.0


def test_app_helpers():
    assert C.stress_app_to_contract(1) == 1 and C.stress_app_to_contract(5) == 4 and C.stress_app_to_contract(3) == 3
    assert C.alcohol_units_week_from(3, 4) == 12.0
    assert C.activity_band(100) == 0 and C.activity_band(150) == 1 and C.activity_band(301) == 2
    assert C.sleep_band(5.9) == 0 and C.sleep_band(8.0) == 1 and C.sleep_band(8.1) == 2
    assert [C.bmi_band(b) for b in (17, 20, 24, 27, 31)] == ["under", "normal", "over", "obese1", "obese2"]
    assert T.risk_level(0.0) == "low" and T.risk_level(0.15) == "moderate" and T.risk_level(0.5) == "very_high"

"""tests/test_predictor_stub.py — 추론 경로 끝까지를 '작은 합성 모델'로 검증 (실제 아티팩트 불필요)

실제 KNHANES 모델이 생기기 전에 predictor 의 출력 계약·거부 응답·이유 코드 매핑·결정성·
번들 저장/로드가 동작하는지 본다. 성능 수치는 보지 않는다.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import thresholds_kr_v1 as T
from features import contract_v1 as C
from inference.bundle import ModelBundle, RegressionBundle
from inference.predictor import RiskPredictor, DISCLAIMER_KEY

IMP = C.Imputers.provisional()


def _synthetic_bundle(model_id: str, seed: int = 0) -> ModelBundle:
    """상식적 방향(나이·BMI·허리·흡연·음주·나트륨 ↑ 위험↑, 활동 ↑ 위험↓)을 가진 합성 데이터로 LR 학습."""
    rng = np.random.default_rng(seed)
    cols = list(C.columns_for(model_id))
    n = 4000
    X = np.column_stack([
        rng.uniform(19, 90, n), rng.integers(0, 2, n), rng.uniform(16, 40, n), rng.uniform(60, 120, n),
        rng.integers(0, 2, n), rng.integers(0, 2, n),
    ] + ([
        rng.uniform(0, 40, n), rng.uniform(0, 600, n), rng.integers(0, 2, n), rng.uniform(4, 10, n),
        rng.integers(0, 3, n), rng.integers(1, 5, n), rng.integers(0, 2, n), rng.integers(0, 2, n), rng.integers(0, 4, n),
    ] if model_id == C.MODEL_FULL else []))
    w = {"age": 0.06, "sex_female": -0.3, "bmi": 0.15, "waist_cm": 0.03, "smoking_former": 0.1, "smoking_current": 0.4,
         "alcohol_units_week": 0.03, "activity_minutes_week": -0.002, "activity_low_flag": 0.2, "sleep_avg_h": -0.05,
         "sodium_risk_score": 0.3, "stress_score": 0.1, "family_htn": 0.5, "diabetes_flag": 0.6, "missing_count": 0.0}
    z = sum(w[c] * X[:, i] for i, c in enumerate(cols)) - 9.0
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype(int)
    pipe = Pipeline([("scale", StandardScaler()), ("lr", LogisticRegression(max_iter=500))]).fit(X, y)
    return ModelBundle(model_id=model_id, model_version="0.0.0-stub", estimator=pipe, imputers=IMP,
                       reference={c: float(v) for c, v in zip(cols, X.mean(axis=0))}, metadata={"synthetic": True})


@pytest.fixture(scope="module")
def predictor() -> RiskPredictor:
    return RiskPredictor(full=_synthetic_bundle(C.MODEL_FULL), lite=_synthetic_bundle(C.MODEL_LITE))


def person(**over) -> dict:
    base = {"feature_version": "v1", "age": 40, "sex": "male", "bmi": 23.0, "waist_cm": 82.0,
            "smoking_status": "never", "alcohol_units_week": 2.0, "activity_minutes_week": 150,
            "activity_low_flag": False, "sleep_avg_h": 7.0, "sodium_risk_score": 1, "stress_score": 2,
            "family_htn": False, "diabetes_flag": False}
    base.update(over)
    return base


def test_output_contract(predictor):
    out = predictor.predict(person())
    for k in ("risk_index", "risk_level", "calibrated_p", "model_id", "model_version", "feature_version",
              "data_quality", "missing_features", "reason_codes", "expected_sbp", "disclaimer_key"):
        assert k in out, k
    assert 0 <= out["risk_index"] <= 100 and out["risk_index"] == round(out["calibrated_p"] * 100)
    assert out["risk_level"] == T.risk_level(out["calibrated_p"])
    assert out["model_id"] == C.MODEL_FULL and out["data_quality"] == "ok"
    assert 1 <= len(out["reason_codes"]) <= 3
    assert all(r["code"] in C.REASON_CODES and r["direction"] in ("up", "down") for r in out["reason_codes"])
    assert out["disclaimer_key"] == DISCLAIMER_KEY and out["expected_sbp"] is None
    assert not any(w in json.dumps(out, ensure_ascii=False) for w in ("진단", "발병 확률", "고혈압입니다"))


def test_reason_codes_follow_inputs(predictor):
    out = predictor.predict(person(bmi=33.0, waist_cm=105.0, smoking_status="current", activity_minutes_week=0,
                                   sleep_avg_h=5.0, sodium_risk_score=2))
    codes = [r["code"] for r in out["reason_codes"]]
    assert len(codes) == 3 and all(r["direction"] == "up" for r in out["reason_codes"])
    assert set(codes) <= {"bmi_high", "waist_high", "smoking_current", "activity_low", "sleep_short", "sodium_high", "age"}
    # contribution 은 내림차순
    cs = [r["contribution"] for r in out["reason_codes"]]
    assert cs == sorted(cs, reverse=True)


def test_lifestyle_evidence_field(predictor):
    out = predictor.predict(person(sodium_risk_score=2, activity_minutes_week=30, activity_low_flag=True))
    codes = [e["code"] for e in out["lifestyle_evidence"]]
    assert codes[:2] == ["activity_low", "sodium_high"] and out["evidence_version"] == "v1"
    # 결측(대치)된 피처로는 근거를 내지 않는다
    p = person(sodium_risk_score=2)
    p.pop("activity_minutes_week"); p.pop("activity_low_flag")
    out = predictor.predict(p)
    assert "activity_low" not in [e["code"] for e in out["lifestyle_evidence"]]
    assert predictor.predict({**person(), "age": 16})["lifestyle_evidence"] == []


def test_sleep_long_code(predictor):
    out = predictor.predict(person(sleep_avg_h=11.0))
    codes = {r["code"] for r in out["reason_codes"]}
    assert "sleep_short" not in codes  # 11h 는 long 쪽만 가능


def test_monotonic_bmi_and_activity(predictor):
    r = [predictor.predict(person(bmi=b))["risk_index"] for b in (22, 24, 26, 28, 30)]
    assert r == sorted(r)
    a = [predictor.predict(person(activity_minutes_week=m, activity_low_flag=m < 150))["risk_index"] for m in (0, 75, 150, 300)]
    assert a == sorted(a, reverse=True)


def test_lite_fallback_and_rejections(predictor):
    p = person()
    for k in ("alcohol_units_week", "activity_minutes_week", "activity_low_flag", "sleep_avg_h",
              "sodium_risk_score", "stress_score", "family_htn", "diabetes_flag"):
        p.pop(k)
    out = predictor.predict(p)
    assert out["model_id"] == C.MODEL_LITE and out["data_quality"] == "partial" and out["risk_index"] is not None

    p = person(); p.pop("age")
    out = predictor.predict(p)
    assert out["data_quality"] == "insufficient" and out["risk_index"] is None and out["reason_codes"] == []

    out = predictor.predict(person(bmi=60.0))
    assert out["data_quality"] == "out_of_range" and out["out_of_range_features"] == ["bmi"]

    assert predictor.predict(person(age=16))["data_quality"] == "not_applicable"
    assert predictor.predict(person(sex="female", pregnancy_status="pregnant"))["data_quality"] == "not_applicable"


def test_bp_values_ignored(predictor):
    a = predictor.predict(person())
    b = predictor.predict({**person(), "sbp": 170, "dbp": 105})
    assert a["risk_index"] == b["risk_index"] and a["reason_codes"] == b["reason_codes"]
    assert any(w.startswith("ignored_never_features") for w in b["warnings"])


def test_deterministic(predictor):
    p = person()
    seq = {json.dumps(predictor.predict(p), sort_keys=True) for _ in range(50)}
    with ThreadPoolExecutor(max_workers=4) as ex:
        par = set(ex.map(lambda _: json.dumps(predictor.predict(p), sort_keys=True), range(40)))
    assert len(seq) == 1 and seq == par


def _synthetic_bp_bundle(seed: int = 1) -> RegressionBundle:
    """예상 혈압 합성 회귀 (SBP ≈ 100 + 0.4·age + 1.5·bmi + 1.0·sodium − 0.01·activity …)."""
    from inference.bundle import MODEL_EXPECTED_BP, RegressionBundle
    from sklearn.linear_model import Ridge
    rng = np.random.default_rng(seed)
    cols = list(C.columns_for(C.MODEL_FULL))
    n = 3000
    X = np.column_stack([rng.uniform(19, 90, n), rng.integers(0, 2, n), rng.uniform(16, 40, n), rng.uniform(60, 120, n),
                         rng.integers(0, 2, n), rng.integers(0, 2, n), rng.uniform(0, 40, n), rng.uniform(0, 600, n), rng.integers(0, 2, n),
                         rng.uniform(4, 10, n), rng.integers(0, 3, n), rng.integers(1, 5, n), rng.integers(0, 2, n), rng.integers(0, 2, n), rng.integers(0, 4, n)])
    w = {"age": 0.4, "sex_female": -3, "bmi": 1.5, "waist_cm": 0.1, "smoking_former": 0, "smoking_current": 0.5, "alcohol_units_week": 0.2,
         "activity_minutes_week": -0.01, "activity_low_flag": 1.0, "sleep_avg_h": 0, "sodium_risk_score": 1.5, "stress_score": 0.3,
         "family_htn": 2, "diabetes_flag": 3, "missing_count": 0}
    base = 85 + sum(w[c] * X[:, i] for i, c in enumerate(cols))
    est = {"sbp": Ridge(alpha=1.0).fit(X, base + rng.normal(0, 5, n)), "dbp": Ridge(alpha=1.0).fit(X, 0.6 * base + rng.normal(0, 4, n))}
    return RegressionBundle(model_id=MODEL_EXPECTED_BP, model_version="0.0.0-stub", estimators=est, imputers=IMP, columns=tuple(cols))


def test_expected_bp_whatif_and_comparison():
    from inference.bundle import RegressionBundle  # noqa: F401
    pred = RiskPredictor(_synthetic_bundle(C.MODEL_FULL), _synthetic_bundle(C.MODEL_LITE), bp=_synthetic_bp_bundle())
    out = pred.predict(person(bmi=31.0, sodium_risk_score=2, activity_minutes_week=30, activity_low_flag=True, measured_sbp=150, measured_dbp=95))
    assert isinstance(out["expected_sbp"], float) and isinstance(out["expected_dbp"], float)
    assert out["bp_model_version"] == "0.0.0-stub"
    assert out["bp_vs_expected"]["sbp_diff"] == round(150 - out["expected_sbp"], 1)
    codes = {w["code"]: w for w in out["whatif"]}
    assert {"bmi_high", "sodium_high", "activity_low"} <= set(codes)
    assert codes["bmi_high"]["delta_sbp_model"] < 0 and codes["bmi_high"]["target"] == {"bmi": 25.0}
    assert codes["sodium_high"]["delta_sbp_literature"] == -3.6 and codes["activity_low"]["delta_sbp_literature"] == -4.6
    # measured 키는 M1 위험지수에 영향을 주지 않는다
    assert out["risk_index"] == pred.predict(person(bmi=31.0, sodium_risk_score=2, activity_minutes_week=30, activity_low_flag=True))["risk_index"]
    # M2 모델이 없으면 전부 null, partial(lite) 이어도 null
    none_out = RiskPredictor(_synthetic_bundle(C.MODEL_FULL), _synthetic_bundle(C.MODEL_LITE)).predict(person())
    assert none_out["expected_sbp"] is None and none_out["whatif"] == [] and none_out["bp_vs_expected"] is None
    p = person()
    for k in ("alcohol_units_week", "sodium_risk_score", "family_htn"):
        p.pop(k)
    assert pred.predict(p)["expected_sbp"] is None


def _synthetic_comorbidity(disease: str, seed: int = 2) -> ModelBundle:
    from features import contract_v2 as C2
    rng = np.random.default_rng(seed)
    cols = C2.columns_for_disease(disease)
    n = 3000
    gen = {"age": lambda: rng.uniform(19, 90, n), "sex_female": lambda: rng.integers(0, 2, n), "bmi": lambda: rng.uniform(16, 40, n),
           "waist_cm": lambda: rng.uniform(60, 120, n), "smoking_former": lambda: rng.integers(0, 2, n), "smoking_current": lambda: rng.integers(0, 2, n),
           "alcohol_units_week": lambda: rng.uniform(0, 40, n), "activity_minutes_week": lambda: rng.uniform(0, 600, n), "activity_low_flag": lambda: rng.integers(0, 2, n),
           "sleep_avg_h": lambda: rng.uniform(4, 10, n), "sodium_risk_score": lambda: rng.integers(0, 3, n), "stress_score": lambda: rng.integers(1, 5, n),
           "family_htn": lambda: rng.integers(0, 2, n), "diabetes_flag": lambda: rng.integers(0, 2, n), "missing_count": lambda: rng.integers(0, 4, n),
           "sbp": lambda: rng.uniform(90, 180, n), "dbp": lambda: rng.uniform(55, 110, n), "htn_medication": lambda: rng.integers(0, 2, n)}
    X = np.column_stack([gen[c]() for c in cols])
    w = {"age": 0.05, "waist_cm": 0.04, "sbp": 0.03, "dbp": 0.02, "htn_medication": 0.6, "diabetes_flag": 0.5, "bmi": 0.05}
    z = sum(w.get(c, 0.0) * X[:, i] for i, c in enumerate(cols)) - 9.0
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype(int)
    pipe = Pipeline([("scale", StandardScaler()), ("lr", LogisticRegression(max_iter=500))]).fit(X, y)
    return ModelBundle(model_id=f"{C2.MODEL_PREFIX}{disease}", model_version="0.0.0-stub", estimator=pipe, imputers=IMP, columns=cols,
                       reference={c: float(v) for c, v in zip(cols, X.mean(axis=0))}, feature_version=C2.FEATURE_VERSION)


def test_comorbidity_block():
    from features import contract_v2 as C2
    como = {d: _synthetic_comorbidity(d) for d in C2.DISEASES}
    pred = RiskPredictor(_synthetic_bundle(C.MODEL_FULL), _synthetic_bundle(C.MODEL_LITE), comorbidity=como)
    # 혈압 없음 → needs_bp
    out = pred.predict(person())
    assert out["comorbidity_risk"] is None and out["comorbidity_status"] == "needs_bp"
    # 혈압 + 복약 → 4개 질환 위험
    out = pred.predict(person(measured_sbp=150, measured_dbp=95, htn_medication=True))
    assert out["comorbidity_status"] == "ok" and set(out["comorbidity_risk"]) == set(C2.DISEASES)
    for d, r in out["comorbidity_risk"].items():
        assert 0 <= r["risk_index"] <= 100 and r["risk_level"] == T.risk_level(r["calibrated_p"])
        assert 1 <= len(r["reason_codes"]) <= 3 and all(c["code"] in C2.REASON_CODES_V2 for c in r["reason_codes"])
    # 혈압이 높고 복약 중이면 bp_high / htn_treated 가 이유에 나올 수 있어야 한다 (합성 모델 가중치 양수)
    codes = {c["code"] for r in out["comorbidity_risk"].values() for c in r["reason_codes"]}
    assert codes & {"bp_high", "htn_treated"}
    # htn_status 문자열로도 복약 판정, 범위 밖 혈압은 상태로 알림, M1 위험지수는 불변
    assert pred.predict(person(measured_sbp=120, measured_dbp=80, htn_status="on_medication"))["comorbidity_status"] == "ok"
    assert pred.predict(person(measured_sbp=300, measured_dbp=80))["comorbidity_status"] == "measured_sbp_out_of_range"
    assert out["risk_index"] == pred.predict(person())["risk_index"]
    # 당뇨 모델은 diabetes_flag 를 피처로 쓰지 않는다
    assert "diabetes_flag" not in como["diabetes"].columns and "diabetes_flag" in como["ckd"].columns


def test_bundle_roundtrip(tmp_path):
    b = _synthetic_bundle(C.MODEL_LITE)
    path = b.save(tmp_path / "htn_risk_lite.joblib")
    loaded = ModelBundle.load(path)
    assert loaded.model_id == C.MODEL_LITE and loaded.columns == C.NUMERIC_COLUMNS_LITE
    x = np.array([[40, 0, 23, 82, 0, 0]], dtype=float)
    assert loaded.predict_proba(x) == b.predict_proba(x)
    assert path.stat().st_size < 5 * 1024 * 1024
    assert "estimator" not in loaded.describe()

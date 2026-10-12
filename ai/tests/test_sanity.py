"""tests/test_sanity.py — 고혈압 위험도 모델 상식·안전 검증 (인수인계 문서 7장)

실행: pytest tests/test_sanity.py -q
전제: inference/predict.py 가 `predict_htn_risk(features: dict) -> dict` 를 제공하고,
      모델 아티팩트는 import 시 1회 로드된다. 아티팩트가 없으면 전체 스킵.

멘토 지침 "몸무게를 올렸는데 위험도가 오르지 않으면 의심하라"를 자동화한 것이다.
모델을 교체할 때마다 CI에서 돌리고, 실패하면 머지하지 않는다.
"""
from __future__ import annotations

import copy
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

try:
    from inference.predict import predict_htn_risk  # AI팀 구현
except Exception:  # 아티팩트 미준비 단계에서는 테스트를 스킵만 한다
    predict_htn_risk = None

from thresholds_kr_v1 import FEATURE_RANGES, RISK_LEVELS, risk_level

pytestmark = pytest.mark.skipif(predict_htn_risk is None, reason="model artifact not available")

GOLDEN = Path(__file__).parent / "golden_cases.json"


def base_person(sex: str = "male", age: int = 40) -> dict:
    """모든 테스트의 출발점이 되는 '평범한' 입력. 값은 contract v1 범위 안."""
    return {
        "feature_version": "v1",
        "age": age, "sex": sex, "bmi": 23.0, "waist_cm": 82.0 if sex == "male" else 76.0,
        "smoking_status": "never", "alcohol_units_week": 2.0,
        "activity_minutes_week": 150, "activity_low_flag": False,
        "sleep_avg_h": 7.0, "sodium_risk_score": 1, "stress_score": 2,
        "family_htn": False, "diabetes_flag": False,
    }


PERSONAS = [(s, a) for s in ("male", "female") for a in (25, 40, 60)]


def risk(features: dict) -> int:
    out = predict_htn_risk(features)
    assert out["data_quality"] in ("ok", "partial"), out
    return out["risk_index"]


# ── 1. 단조성: 위험 요인을 올리면 지수가 내려가면 안 된다 ─────────────────────
@pytest.mark.parametrize("sex,age", PERSONAS)
@pytest.mark.parametrize(
    "field,values,direction",
    [
        ("bmi", [22, 24, 26, 28, 30], "up"),
        ("waist_cm", [78, 83, 88, 93, 98], "up"),
        ("alcohol_units_week", [0, 7, 14, 21], "up"),
        ("sodium_risk_score", [0, 1, 2], "up"),
        ("age", None, "up"),                       # age는 아래에서 별도 처리
        ("activity_minutes_week", [0, 75, 150, 300], "down"),
    ],
)
def test_monotonic(sex, age, field, values, direction):
    p = base_person(sex, age)
    if field == "age":
        values = [age, age + 5, age + 10, age + 15]
        values = [v for v in values if v <= FEATURE_RANGES["age"][1]]
    prev = None
    for v in values:
        q = copy.deepcopy(p)
        q[field] = v
        if field == "activity_minutes_week":
            q["activity_low_flag"] = v < 150
        r = risk(q)
        if prev is not None:
            if direction == "up":
                assert r >= prev, f"{field}={v}: risk {r} < previous {prev} ({sex},{age})"
            else:
                assert r <= prev, f"{field}={v}: risk {r} > previous {prev} ({sex},{age})"
        prev = r


# ── 2. 크기 상식: BMI 22→30 이면 지수가 눈에 띄게 올라야 한다 ────────────────
@pytest.mark.parametrize("sex,age", PERSONAS)
def test_effect_size_bmi(sex, age):
    p = base_person(sex, age)
    lo = risk({**p, "bmi": 22.0})
    hi = risk({**p, "bmi": 30.0})
    assert hi - lo >= 8, f"BMI 22→30 effect too small: {lo}→{hi} ({sex},{age})"


# ── 3. 결정성: 같은 입력은 같은 출력, 병렬에서도 ─────────────────────────────
def test_deterministic_sequential():
    p = base_person()
    outs = {json.dumps(predict_htn_risk(p), sort_keys=True) for _ in range(100)}
    assert len(outs) == 1, "output varies across repeated calls"


def test_deterministic_parallel():
    p = base_person()
    with ThreadPoolExecutor(max_workers=4) as ex:
        outs = list(ex.map(lambda _: json.dumps(predict_htn_risk(p), sort_keys=True), range(40)))
    assert len(set(outs)) == 1, "output varies across threads"


# ── 4. 골든 케이스: 모델 버전이 바뀌지 않았는데 출력이 바뀌면 실패 ───────────
@pytest.mark.skipif(not GOLDEN.exists(), reason="golden_cases.json not yet created")
def test_golden_cases():
    cases = json.loads(GOLDEN.read_text(encoding="utf-8"))
    for c in cases:
        out = predict_htn_risk(c["input"])
        if out["model_version"] == c["expected"]["model_version"]:
            assert out["risk_index"] == c["expected"]["risk_index"], c["name"]
            assert [r["code"] for r in out["reason_codes"]] == c["expected"]["reason_codes"], c["name"]


# ── 5. 결측 처리 ─────────────────────────────────────────────────────────────
def test_lifestyle_all_missing_falls_back_to_lite():
    p = base_person()
    for k in ("alcohol_units_week", "activity_minutes_week", "activity_low_flag",
              "sleep_avg_h", "sodium_risk_score", "stress_score", "family_htn", "diabetes_flag"):
        p.pop(k)
    out = predict_htn_risk(p)
    assert out["model_id"] == "htn_risk_lite"
    assert out["data_quality"] == "partial"


def test_age_missing_is_insufficient():
    p = base_person()
    p.pop("age")
    out = predict_htn_risk(p)
    assert out["data_quality"] == "insufficient"
    assert out.get("risk_index") is None


# ── 6. 범위 밖: 클리핑하지 말고 거부 ─────────────────────────────────────────
@pytest.mark.parametrize("field,value", [("bmi", 60.0), ("age", 150), ("sleep_avg_h", 20.0), ("waist_cm", 10.0)])
def test_out_of_range_rejected(field, value):
    p = base_person()
    p[field] = value
    out = predict_htn_risk(p)
    assert out["data_quality"] == "out_of_range", out


# ── 7. 누수 차단: 혈압값을 넣어도 결과가 달라지면 안 된다 ────────────────────
def test_bp_values_are_ignored():
    p = base_person()
    a = predict_htn_risk(p)["risk_index"]
    b = predict_htn_risk({**p, "sbp": 170, "dbp": 105})["risk_index"]
    assert a == b, "model must not use sbp/dbp"


# ── 8. 미적용 대상 ───────────────────────────────────────────────────────────
def test_minor_not_applicable():
    out = predict_htn_risk({**base_person(), "age": 16})
    assert out["data_quality"] in ("not_applicable", "out_of_range")


def test_pregnant_not_applicable():
    out = predict_htn_risk({**base_person("female", 32), "pregnancy_status": "pregnant"})
    assert out["data_quality"] == "not_applicable"


# ── 9. 출력 계약 ─────────────────────────────────────────────────────────────
def test_output_contract():
    out = predict_htn_risk(base_person())
    for k in ("risk_index", "risk_level", "calibrated_p", "model_id", "model_version",
              "feature_version", "data_quality", "reason_codes", "disclaimer_key"):
        assert k in out, f"missing key {k}"
    assert 0 <= out["risk_index"] <= 100
    assert out["risk_level"] == risk_level(out["calibrated_p"])
    assert out["risk_level"] in {name for name, _ in RISK_LEVELS}
    assert 1 <= len(out["reason_codes"]) <= 3
    assert out["disclaimer_key"] == "risk_not_diagnosis"
    banned = ("진단", "발병 확률", "고혈압입니다")
    assert not any(w in json.dumps(out, ensure_ascii=False) for w in banned)


# ── 10. 지연 예산 ────────────────────────────────────────────────────────────
@pytest.mark.skipif(os.getenv("CI") is None, reason="latency measured in CI only")
def test_latency_p95_under_20ms():
    import time
    p = base_person()
    ts = []
    for _ in range(1000):
        t0 = time.perf_counter(); predict_htn_risk(p); ts.append(time.perf_counter() - t0)
    ts.sort()
    assert ts[int(0.95 * len(ts))] * 1000 <= 20, f"p95 {ts[int(0.95*len(ts))]*1000:.1f} ms"

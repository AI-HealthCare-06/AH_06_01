"""tests/test_evidence.py — "생활습관 요인의 방향·효과 기준은 문헌 근거표" 를 코드로 강제

- 모델 부호 제약(contract_v1.MONOTONE_CONSTRAINTS)이 근거표의 방향과 어긋나면 실패한다.
- 근거표의 출처 키는 전부 papers 에 있어야 하고, 숫자는 팀 문헌표 CSV 에 실제로 적힌 값이어야 한다.
- lifestyle_evidence() 는 개입 대상 구간에서만, 대치되지 않은 피처로만 요인을 낸다.
"""
from __future__ import annotations

import csv
from pathlib import Path

from features import contract_v1 as C
from knowledge import evidence as K

CSV = Path(__file__).resolve().parents[1] / "knowledge" / "lifestyle_evidence_papers.csv"


def test_sign_constraints_follow_evidence():
    ev = K.EVIDENCE_DIRECTION
    enc = {"sodium_risk_score": "sodium_risk_score", "activity_minutes_week": "activity_minutes_week",
           "bmi": "bmi", "waist_cm": "waist_cm", "alcohol_units_week": "alcohol_units_week",
           "stress_score": "stress_score", "smoking_status": "smoking_current"}
    for feat, col in enc.items():
        assert feat in ev, f"evidence table has no direction for {feat}"
        model_sign = C.MONOTONE_CONSTRAINTS[col]
        # 모델 제약은 근거 방향과 같거나(강제) 0(자유)일 수 있지만, 반대 방향이면 안 된다
        assert model_sign in (0, ev[feat]), f"{col}: model sign {model_sign} contradicts evidence {ev[feat]}"
    # 핵심 생활습관 셋은 자유(0)가 아니라 근거 방향으로 강제되어야 한다 (B0 부호 제약의 존재 이유)
    for col in ("sodium_risk_score", "activity_minutes_week", "smoking_current", "alcohol_units_week", "bmi", "waist_cm"):
        assert C.MONOTONE_CONSTRAINTS[col] != 0, col
    # activity_low_flag 는 activity 의 반대 부호여야 한다
    assert C.MONOTONE_CONSTRAINTS["activity_low_flag"] == -C.MONOTONE_CONSTRAINTS["activity_minutes_week"]


def test_all_sources_exist_and_codes_match_contract_vocab():
    e = K.load_evidence()
    papers = set(e["papers"])
    for f in e["factors"]:
        for key in K.factor_sources(f):
            assert key in papers, key
        if f["code"] not in ("sodium_diet_pattern",):
            assert f["code"] in C.REASON_CODES, f["code"]
    for row in K.evidence_summary_table():
        assert row["sources"], row["code"]


def test_numbers_come_from_team_csv():
    """근거표의 핵심 수치가 팀 문헌표 CSV 본문에 실제로 등장하는지 (지어낸 숫자 방지)."""
    text = CSV.read_text(encoding="utf-8")
    fx = K.factors()
    assert "-3.6" in text and fx["sodium_high"]["sbp_reduction_mmhg"]["point"] == -3.6
    assert "-4.6" in text and fx["activity_low"]["sbp_reduction_mmhg"]["point"] == -4.6
    assert "-3.8" in text and fx["alcohol_high"]["sbp_reduction_mmhg"]["point"] == -3.8
    assert "0.23" in text and fx["bmi_high"]["htn_incidence"][0]["value"] == 0.23
    assert "-20.8" in text and fx["sodium_high"]["sbp_reduction_mmhg"]["by_baseline_sbp"][">=150"] == -20.8
    assert "-7.62" in text and fx["sodium_diet_pattern"]["sbp_reduction_mmhg"]["dash"]["sbp"] == -7.62
    assert "-5.2" in text and fx["activity_low"]["sbp_reduction_mmhg"]["korean_diet_plus_exercise"]["sbp"] == -5.2
    assert len(list(csv.DictReader(CSV.open(encoding="utf-8")))) == len(K.load_evidence()["papers"])


def _feats(**over):
    f = {"age": 40, "sex": "male", "bmi": 23.0, "waist_cm": 82.0, "smoking_status": "never", "alcohol_units_week": 2.0,
         "activity_minutes_week": 150, "activity_low_flag": False, "sleep_avg_h": 7.0, "sodium_risk_score": 0,
         "stress_score": 2, "family_htn": False, "diabetes_flag": False, "missing_count": 0}
    f.update(over)
    return f


def test_lifestyle_evidence_flags_only_in_band():
    assert K.lifestyle_evidence(_feats()) == []
    out = K.lifestyle_evidence(_feats(sodium_risk_score=2, activity_minutes_week=30, bmi=31.0, smoking_status="current",
                                      alcohol_units_week=20, stress_score=4, sleep_avg_h=5.0, waist_cm=95.0))
    codes = [o["code"] for o in out]
    assert set(codes) == {"sodium_high", "activity_low", "bmi_high", "smoking_current", "alcohol_high", "stress_high", "sleep_short", "waist_high"}
    by = {o["code"]: o for o in out}
    assert by["sodium_high"]["severity"] == 2 and by["sodium_high"]["expected_sbp_reduction_mmhg"] == -3.6
    assert by["activity_low"]["expected_sbp_reduction_mmhg"] == -4.6 and by["activity_low"]["direction"] == "down"
    assert "dickinson2006_meta" in by["sodium_high"]["sources"]
    # 효과 크기가 있는 요인이 앞에 온다
    assert codes[0] in ("activity_low",) and codes[1] == "alcohol_high" and codes[2] == "sodium_high"


def test_lifestyle_evidence_ignores_imputed_features():
    out = K.lifestyle_evidence(_feats(sodium_risk_score=2, activity_minutes_week=0), missing_features=["sodium_risk_score"])
    assert [o["code"] for o in out] == ["activity_low"]


def test_sex_specific_bands():
    assert K.lifestyle_evidence(_feats(sex="female", alcohol_units_week=10.0, waist_cm=86.0)) and \
        not K.lifestyle_evidence(_feats(sex="male", alcohol_units_week=10.0, waist_cm=86.0))

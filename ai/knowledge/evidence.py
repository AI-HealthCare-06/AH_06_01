"""knowledge/evidence.py — 생활습관 근거표(lifestyle_evidence_v1.yaml) 로더와 사용자별 근거 플래그

두 가지를 제공한다.
  1. EVIDENCE_DIRECTION: 계약 피처 → 문헌이 말하는 방향(+1 위험↑ / −1 위험↓). 모델 부호 제약이 이 표와
     일치하는지 tests/test_evidence.py 가 확인한다 → "방향의 기준은 논문" 을 코드로 강제.
  2. lifestyle_evidence(features, missing): 사용자의 계약 피처가 개입 대상 구간이면 문헌 효과 크기·출처 키를
     돌려준다. 모델의 reason_codes(기여도) 와는 별개 필드로 나가며, 코드·숫자·출처 키만 담고 문장은 만들지 않는다.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

EVIDENCE_PATH = Path(__file__).resolve().parent / "lifestyle_evidence_v1.yaml"
EVIDENCE_VERSION = "v1"

# 개입 대상 구간 — yaml 의 intervention_band 문자열을 실행 가능한 규칙으로 (값은 yaml 과 같아야 한다)
WAIST_ABDOMINAL_CM = {"male": 90.0, "female": 85.0}        # 데이터 사전 P05
ALCOHOL_UPPER_UNITS_WEEK = {"male": 14.0, "female": 8.0}   # 데이터 사전 L02
BMI_OBESE = 25.0                                            # 대한비만학회 성인 비만
SODIUM_BAND_MIN = 1                                         # ≥2,000 mg/일 (ISH <2 g/일 초과)
ACTIVITY_LOW_MINUTES = 150
STRESS_HIGH_MIN = 3
SLEEP_SHORT_MAX, SLEEP_LONG_MIN = 6.0, 8.0


@lru_cache(maxsize=1)
def load_evidence() -> dict[str, Any]:
    with EVIDENCE_PATH.open(encoding="utf-8") as f:
        e = yaml.safe_load(f)
    assert e["evidence_version"] == EVIDENCE_VERSION, e["evidence_version"]
    return e


def factors() -> dict[str, dict[str, Any]]:
    return {f["code"]: f for f in load_evidence()["factors"]}


def _dir(s: str) -> int:
    return 1 if s == "up" else -1


# 계약 피처 → 문헌 방향. sleep 은 U자(short↓/long↑)라 단일 부호를 주지 않는다.
EVIDENCE_DIRECTION: dict[str, int] = {
    f["contract_feature"]: _dir(f["direction"])
    for f in load_evidence()["factors"]
    if f.get("contract_feature") and f["contract_feature"] != "sleep_avg_h"
}


def _band_hit(code: str, feats: dict[str, Any]) -> tuple[bool, int]:
    """(개입 대상 여부, 심각도 1~2)."""
    sex = str(feats.get("sex") or "male")
    if code == "sodium_high":
        s = feats["sodium_risk_score"]
        return s >= SODIUM_BAND_MIN, (2 if s >= 2 else 1)
    if code == "activity_low":
        return feats["activity_minutes_week"] < ACTIVITY_LOW_MINUTES, 1
    if code == "bmi_high":
        b = feats["bmi"]
        return b >= BMI_OBESE, (2 if b >= 30 else 1)
    if code == "waist_high":
        return feats["waist_cm"] >= WAIST_ABDOMINAL_CM.get(sex, 90.0), 1
    if code == "alcohol_high":
        return feats["alcohol_units_week"] > ALCOHOL_UPPER_UNITS_WEEK.get(sex, 14.0), 1
    if code == "smoking_current":
        return feats["smoking_status"] == "current", 1
    if code == "stress_high":
        return feats["stress_score"] >= STRESS_HIGH_MIN, 1
    if code == "sleep_short":
        return feats["sleep_avg_h"] < SLEEP_SHORT_MAX, 1
    if code == "sleep_long":
        return feats["sleep_avg_h"] > SLEEP_LONG_MIN, 1
    return False, 0


def lifestyle_evidence(features: dict[str, Any], missing_features: list[str] | tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """계약 피처(대치 완료) → 개입 대상인 요인 목록. 대치된(결측) 피처로는 판단하지 않는다."""
    out = []
    for code, f in factors().items():
        feat = f.get("contract_feature")
        if not feat or feat in missing_features or feat not in features:
            continue
        hit, severity = _band_hit(code, features)
        if not hit:
            continue
        red = f.get("sbp_reduction_mmhg") or {}
        out.append({
            "code": code,
            "direction": f["direction"],
            "modifiable": bool(f.get("modifiable", True)),
            "severity": severity,
            "expected_sbp_reduction_mmhg": red.get("point"),
            "evidence_level": f.get("evidence_level"),
            "sources": factor_sources(f),
        })
    # 수정 가능한 것 먼저, 그 다음 효과 크기(절대값) 큰 순, 마지막 심각도
    out.sort(key=lambda d: (not d["modifiable"], -abs(d["expected_sbp_reduction_mmhg"] or 0.0), -d["severity"]))
    return out


def factor_sources(f: dict[str, Any]) -> list[str]:
    """요인의 출처 키. shares_evidence_with 가 있으면 그 요인의 출처도 합친다 (waist_high → bmi_high)."""
    keys = set(_source_keys(f))
    shared = f.get("shares_evidence_with")
    if shared:
        keys |= set(_source_keys(factors()[shared]))
    return sorted(keys)


def _source_keys(node: Any) -> list[str]:
    keys = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("source", "point_source", "by_baseline_source", "band_source") and isinstance(v, str) and v in load_evidence()["papers"]:
                keys.append(v)
            else:
                keys += _source_keys(v)
    elif isinstance(node, list):
        for v in node:
            keys += _source_keys(v)
    return keys


def evidence_summary_table() -> list[dict[str, Any]]:
    """모델 카드·리포트용: 요인별 방향·효과·근거 수준·출처."""
    rows = []
    for code, f in factors().items():
        red = f.get("sbp_reduction_mmhg") or {}
        rows.append({"code": code, "contract_feature": f.get("contract_feature"), "direction": f["direction"],
                     "intervention_band": f.get("intervention_band"), "sbp_reduction_point": red.get("point"),
                     "evidence_level": f.get("evidence_level"), "sources": ", ".join(factor_sources(f))})
    return rows

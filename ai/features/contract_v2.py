"""features/contract_v2.py — Feature Contract v2: M3 동반 질환 위험 (혈압·고혈압 복약 포함)

v1(14피처)을 그대로 쓰고 세 개를 더한다. v1 의 혈압 금지는 M1(고혈압 선별)에만 해당하며,
M3 는 라벨이 다른 질환(당뇨·CKD·대사증후군·이상지질)이라 혈압을 피처로 써도 누수가 아니다.

| 추가 피처 | 타입·범위 | 앱 소스 | KNHANES |
|---|---|---|---|
| measured_sbp | int 60~250 (데이터 사전 F01) | 가정혈압 7일 평균 home_sbp_avg_7d (없으면 진료실 값) | HE_sbp (검진 측정) |
| measured_dbp | int 40~150 (F02) | home_dbp_avg_7d | HE_dbp |
| htn_medication | bool | htn_status == on_medication | DI1_2 ∈ {1,2,3,4} |

주의(측정 도메인): KNHANES 는 검진장소 측정, 앱은 가정 측정이다. 가정혈압은 보통 진료실보다 약 5 mmHg 낮다(KSH: 135/85 ↔ 140/90).
v2 는 보정하지 않고 그대로 넣는다 — 영향은 모델 카드에 적고 기획·멘토 결정 항목으로 둔다.
"""
from __future__ import annotations

from typing import Any

from features import contract_v1 as C

FEATURE_VERSION = "v2"
MODEL_PREFIX = "comorbidity_"
DISEASES: tuple[str, ...] = ("diabetes", "ckd", "dyslipidemia", "metsyn")
LABEL_OF = {d: f"label_{d}" for d in DISEASES}

EXTRA_RANGES = {"measured_sbp": (60.0, 250.0), "measured_dbp": (40.0, 150.0)}   # 데이터 사전 F01/F02
EXTRA_COLUMNS: tuple[str, ...] = ("sbp", "dbp", "htn_medication")
NUMERIC_COLUMNS_V2: tuple[str, ...] = C.NUMERIC_COLUMNS_FULL + EXTRA_COLUMNS
MONOTONE_CONSTRAINTS_V2: dict[str, int] = {**C.MONOTONE_CONSTRAINTS, "sbp": 1, "dbp": 1, "htn_medication": 0}
# 질환별로 라벨과 동치인 피처는 뺀다 (당뇨 라벨 ↔ diabetes_flag)
EXCLUDE_FOR: dict[str, tuple[str, ...]] = {"diabetes": ("diabetes_flag",), "ckd": (), "dyslipidemia": (), "metsyn": ()}
# M3 이유 코드: v1 어휘 + 혈압·치료
REASON_CODES_V2: tuple[str, ...] = C.REASON_CODES + ("bp_high", "htn_treated")


def columns_for_disease(disease: str) -> tuple[str, ...]:
    drop = set(EXCLUDE_FOR[disease])
    return tuple(c for c in NUMERIC_COLUMNS_V2 if c not in drop)


def extra_features(raw: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """앱 입력에서 혈압·복약을 꺼내 검사. (피처 dict, 문제 목록). 혈압이 없으면 (None, ['needs_bp'])."""
    problems: list[str] = []
    sbp, dbp = raw.get("measured_sbp"), raw.get("measured_dbp")
    if C._is_missing(sbp) or C._is_missing(dbp):
        return None, ["needs_bp"]
    out: dict[str, Any] = {}
    for key, val, name in (("measured_sbp", sbp, "sbp"), ("measured_dbp", dbp, "dbp")):
        x = C._as_number(val)
        lo, hi = EXTRA_RANGES[key]
        if x is None or not (lo <= x <= hi):
            problems.append(f"{key}_out_of_range")
        else:
            out[name] = float(x)
    med = raw.get("htn_medication")
    if C._is_missing(med):
        med = raw.get("htn_status") == "on_medication" if isinstance(raw.get("htn_status"), str) else False
    b = C._as_bool(med)
    out["htn_medication"] = bool(b) if b is not None else False
    return (out if not problems else None), problems


def encode_numeric_v2(features_v1: dict[str, Any], extra: dict[str, Any], columns: tuple[str, ...]) -> dict[str, float]:
    row = C.encode_numeric(features_v1, C.MODEL_FULL)
    row.update({"sbp": float(extra["sbp"]), "dbp": float(extra["dbp"]), "htn_medication": 1.0 if extra["htn_medication"] else 0.0})
    return {c: row[c] for c in columns}

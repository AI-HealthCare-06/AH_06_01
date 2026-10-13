"""labels.py — KNHANES 라벨 규칙 (인수인계 2장, feature_contract_v1.yaml label 절)

임계값은 thresholds_kr_v1 만 참조한다. 140/90, 130/80 같은 숫자를 이 파일에 쓰지 않는다.
입력은 schema_map 으로 연도별 변수명을 아래 표준 열 이름으로 바꾼 DataFrame 이다.

    age, sex("male"/"female"), HE_ht, HE_wt, HE_sbp, HE_dbp, on_medication(0/1), pregnant(0/1), wt(가중치)

HE_sbp/HE_dbp 가 없고 회차별 값(HE_sbp2, HE_sbp3 …)만 있으면 mean_bp_2_3() 으로 2·3회 평균을 만든다.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

import thresholds_kr_v1 as T

# 표준 열 이름 (schema_map 의 target 열과 같아야 한다)
COL_AGE, COL_SEX, COL_HT, COL_WT = "age", "sex", "HE_ht", "HE_wt"
COL_SBP, COL_DBP, COL_MED, COL_PREG, COL_WEIGHT = "HE_sbp", "HE_dbp", "on_medication", "pregnant", "wt"
LABEL_HTN, LABEL_PREHTN, TARGET_SBP = "label_htn", "label_prehtn_or_above", "expected_sbp"
INCLUSION_REQUIRE = (COL_AGE, COL_SEX, COL_HT, COL_WT, COL_SBP, COL_DBP)   # yaml inclusion.require


def _num(s: "pd.Series | Any") -> pd.Series:
    """문자·결측이 섞인 열을 float Series 로 (변환 불가는 NaN)."""
    return pd.Series(pd.to_numeric(s, errors="coerce"), index=s.index, dtype=float)


def mean_bp_2_3(second: pd.Series, third: pd.Series) -> pd.Series:
    """KNHANES 공식 방식: 2·3회 측정 평균. 둘 중 하나라도 없으면 NaN (1회만 있으면 제외)."""
    s2, s3 = _num(second), _num(third)
    out = (s2 + s3) / 2.0
    return out.where(s2.notna() & s3.notna())


def _bp_label(sbp, dbp, on_medication, cut: T.BP) -> np.ndarray:
    """공식 SAS 와 같은 규칙: 혈압 둘 다 있고 복약 여부가 판정 가능할 때만 0/1, 하나라도 결측이면 NaN.

    결측을 0(정상)으로 바꾸지 않는다 — 공단 데이터처럼 혈압 결측이 있는 자료에서 유병률이 조용히 깎이는 사고 방지.
    """
    sbp, dbp, med = (np.asarray(x, dtype=float) for x in (sbp, dbp, on_medication))
    out = ((sbp >= cut.sbp) | (dbp >= cut.dbp) | (med == 1)).astype(float)
    out[np.isnan(sbp) | np.isnan(dbp) | np.isnan(med)] = np.nan
    return out


def label_htn(sbp, dbp, on_medication) -> np.ndarray:
    """T1: 진료실 고혈압 (OFFICE_HTN) 또는 혈압약 복용 → 1.0, 아니면 0.0, 판정 불가 → NaN.
    thresholds_kr_v1.is_office_htn 과 같은 규칙의 벡터판."""
    return _bp_label(sbp, dbp, on_medication, T.OFFICE_HTN)


def label_prehtn_or_above(sbp, dbp, on_medication) -> np.ndarray:
    """T3(선택): 전단계 이상. 경계는 OFFICE_PREHTN 하한(130/80). 판정 불가 → NaN."""
    return _bp_label(sbp, dbp, on_medication, T.OFFICE_PREHTN[0])


def inclusion_mask(df: pd.DataFrame) -> tuple[pd.Series, dict[str, int]]:
    """포함 기준: 성인(KNHANES_MIN_AGE 이상) → 필수 열 결측 없음 → 임신 아님. 순서대로 적용한 제외 건수도 돌려준다."""
    reasons: dict[str, int] = {}
    keep = pd.Series(True, index=df.index)

    age = _num(df[COL_AGE])
    minor = (age < T.KNHANES_MIN_AGE) | age.isna()
    reasons["under_min_age"] = int(minor.sum())
    keep &= ~minor

    missing = df[list(INCLUSION_REQUIRE)].isna().any(axis=1)
    reasons["missing_required"] = int((missing & keep).sum())
    keep &= ~missing

    if COL_PREG in df:
        preg = _num(df[COL_PREG]) == 1
        reasons["pregnant"] = int((preg & keep).sum())
        keep &= ~preg
    else:
        reasons["pregnant"] = 0

    reasons["kept"] = int(keep.sum())
    return keep, reasons


def make_labels(df: pd.DataFrame) -> pd.DataFrame:
    """포함 기준을 적용한 뒤 label_htn, label_prehtn_or_above, expected_sbp 열을 붙여 돌려준다.

    expected_sbp(T2 회귀 타깃)는 약 미복용자만 값이 있고 복용자는 NaN — 약으로 내려간 혈압은 학습에서 제외.
    on_medication 결측은 0으로 보지 않고 행을 제외한다 (라벨이 틀릴 수 있으므로).
    """
    keep, _ = inclusion_mask(df)
    d = df.loc[keep].copy()
    med = _num(d[COL_MED])
    d = d.loc[med.notna()].copy()
    med = med.loc[d.index].astype(int)

    y1, y3 = label_htn(d[COL_SBP], d[COL_DBP], med), label_prehtn_or_above(d[COL_SBP], d[COL_DBP], med)
    assert not np.isnan(y1).any(), "inclusion_mask should have removed undecidable rows"
    d[LABEL_HTN], d[LABEL_PREHTN] = y1.astype(int), y3.astype(int)
    d[TARGET_SBP] = _num(d[COL_SBP]).where(med == 0)
    return d


def weighted_prevalence(df: pd.DataFrame, label: str = LABEL_HTN, weight: str = COL_WEIGHT) -> float:
    """가중 유병률. 성능 보고 때 전국 고혈압 유병률(약 30%)과 맞는지 확인하는 용도."""
    w = _num(df[weight]).fillna(0.0)
    y = df[label].astype(float)
    return float((w * y).sum() / w.sum()) if w.sum() > 0 else float("nan")


def prevalence_table(df: pd.DataFrame, label: str = LABEL_HTN, weight: str | None = COL_WEIGHT) -> pd.DataFrame:
    """성별 × 연령대(19~39 / 40~59 / 60+) 6개 셀의 n, 양성 수, (가중) 유병률 — 하위군 보고용."""
    bins, names = [T.KNHANES_MIN_AGE - 1, 39, 59, 200], ["19-39", "40-59", "60+"]
    d = df.assign(age_group=pd.cut(_num(df[COL_AGE]), bins=bins, labels=names))
    rows = []
    for (sex, ag), g in d.groupby([COL_SEX, "age_group"], observed=True):
        rows.append({
            "sex": sex, "age_group": str(ag), "n": len(g), "positives": int(g[label].sum()),
            "prevalence": float(g[label].mean()),
            "weighted_prevalence": weighted_prevalence(g, label, weight) if weight and weight in g else float("nan"),
        })
    return pd.DataFrame(rows)

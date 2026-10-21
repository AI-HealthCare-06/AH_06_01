"""
[파일] m1/labels.py
[용도] 측정 혈압(2회 이상 측정의 평균)과 항고혈압제 복약 여부로 4단계 라벨(normal/elevated/prehtn/htn)을 만든다.
[왜 필요한가] 명세 2-2 의 라벨 규칙을 한 곳에서 벡터화해 구현한다. 혈압·복약이 없는 행은 라벨을 만들지 않고 제외한다.
             혈압값은 여기서 라벨을 만드는 데만 쓰이고 피처로는 넘어가지 않는다. 경계값은 thresholds.py 에서만 가져온다.
             복약 컬럼이 없는 데이터는 med_policy="assume_false" 를 명시한 실행에서만 비복약으로 간주한다(명세 2-2 미적용, 보고서에 기록).
             with_stage_column 은 같은 규칙으로 각 행의 단계를 hypertension 옆 열로 붙인다(label_data.py).
[쓰는 곳] m1/pipeline.py, profile_data.py, label_data.py, m1/evaluate.py(stage_index), m1/batch.py, tests/
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

import thresholds as T
from .contract import Contract
from .features import to_bool, to_numeric

MED_POLICIES = ("reject", "assume_false")


def _as_list(x) -> list[str]:
    return [str(v) for v in x] if isinstance(x, (list, tuple)) else [str(x)]


def _first_present(df: pd.DataFrame, candidates) -> str | None:
    return next((c for c in _as_list(candidates) if c in df.columns), None)


def _mean_bp(df: pd.DataFrame, mean_cols, pattern: str) -> tuple[pd.Series, str]:
    """(평균 혈압, 출처 설명). 평균 컬럼이 있으면 우선, 없으면 회차 컬럼 평균(LABEL_MIN_MEASUREMENTS 회 이상)."""
    col = _first_present(df, mean_cols)
    if col:
        return to_numeric(df[col]), f"{col} 컬럼 사용(측정 횟수 검증 불가)"
    cols = [c for c in df.columns if re.match(pattern, str(c))]
    if not cols:
        return pd.Series(np.nan, index=df.index), "없음"
    vals = pd.concat([to_numeric(df[c]) for c in cols], axis=1)
    n = vals.notna().sum(axis=1)
    return vals.mean(axis=1).where(n >= T.LABEL_MIN_MEASUREMENTS), f"{cols} 평균(≥{T.LABEL_MIN_MEASUREMENTS}회)"


def stage_index(sbp: np.ndarray, dbp: np.ndarray, med: np.ndarray) -> np.ndarray:
    """벡터화 단계 규칙 (명세 2-2). 입력에 NaN 이 있으면 NaN."""
    sbp, dbp, med = (np.asarray(a, dtype=float) for a in (sbp, dbp, med))
    out = np.full(sbp.shape, np.nan)
    valid = ~(np.isnan(sbp) | np.isnan(dbp) | np.isnan(med))
    s, d, m = sbp[valid], dbp[valid], med[valid] == 1
    htn = (s >= T.SBP_HTN_MIN) | (d >= T.DBP_HTN_MIN) | m
    pre = ~htn & ((s >= T.SBP_PREHTN_MIN) | (d >= T.DBP_PREHTN_MIN))
    elev = ~htn & ~pre & (s >= T.SBP_ELEVATED_MIN)
    idx = np.zeros(s.shape)
    idx[elev], idx[pre], idx[htn] = T.STAGE_INDEX["elevated"], T.STAGE_INDEX["prehtn"], T.STAGE_INDEX["htn"]
    out[valid] = idx
    return out


def measured_bp(df: pd.DataFrame, contract: Contract) -> tuple[pd.Series, pd.Series]:
    """라벨용 측정 혈압 (수축기, 이완기). 회귀 점검의 정답값으로도 쓴다."""
    li = contract.label_inputs
    return _mean_bp(df, li["sbp_mean"], li["sbp_repeat_pattern"])[0], _mean_bp(df, li["dbp_mean"], li["dbp_repeat_pattern"])[0]


def make_labels(df: pd.DataFrame, contract: Contract, med_policy: str = "reject") -> tuple[pd.Series, dict]:
    """라벨 Series(float, 0~3 또는 NaN)와 요약 정보. 컬럼명은 소문자여야 한다 (features.normalize_columns)."""
    if med_policy not in MED_POLICIES:
        raise ValueError(f"med_policy 는 {MED_POLICIES} 중 하나")
    li = contract.label_inputs
    sbp, how_s = _mean_bp(df, li["sbp_mean"], li["sbp_repeat_pattern"])
    dbp, how_d = _mean_bp(df, li["dbp_mean"], li["dbp_repeat_pattern"])
    med_col = _first_present(df, li["htn_med"])
    if med_col:
        med, how_m = to_bool(df[med_col]), med_col
    elif med_policy == "assume_false":
        med, how_m = pd.Series(0.0, index=df.index), "없음 → 비복약 가정 (명세 2-2 복약 규칙 미적용)"
    else:
        med, how_m = pd.Series(np.nan, index=df.index), "없음"
    y = pd.Series(stage_index(sbp.to_numpy(), dbp.to_numpy(), med.to_numpy()), index=df.index, name="stage")
    info = {
        "sbp_source": how_s,
        "dbp_source": how_d,
        "htn_med_source": how_m,
        "med_policy": med_policy,
        "rows": int(len(df)),
        "rows_labeled": int(y.notna().sum()),
        "rows_unlabeled": int(y.isna().sum()),
        "unlabeled_reasons": {"sbp_missing": int(sbp.isna().sum()), "dbp_missing": int(dbp.isna().sum()), "htn_med_missing": int(med.isna().sum())},
        "stage_counts": {s: int((y == i).sum()) for i, s in enumerate(T.STAGES)},
    }
    return y, info


STAGE_COLUMN = "stage"


def with_stage_column(df: pd.DataFrame, contract: Contract, assume_no_med: bool = False) -> tuple[pd.DataFrame, dict]:
    """각 행의 단계를 계산해 hypertension(없으면 복약·이완기) 바로 뒤에 stage 열로 넣는다. hypertension 열이 있으면 stage=htn 과 일치 검사."""
    from .features import normalize_columns  # noqa: PLC0415 (순환 import 회피)

    df = normalize_columns(df)
    y, info = make_labels(df, contract, med_policy="assume_false" if assume_no_med else "reject")
    stage = pd.Series([T.STAGES[int(v)] if v == v else None for v in y], index=df.index, dtype=object)
    out = df.drop(columns=[STAGE_COLUMN], errors="ignore")
    anchor = next((c for c in ("hypertension", "htn_med", "dbp_mean", "dbp") if c in out.columns), None)
    out.insert(out.columns.get_loc(anchor) + 1 if anchor else len(out.columns), STAGE_COLUMN, stage)
    info["hypertension_check"] = None
    if "hypertension" in out.columns:
        h = to_bool(out["hypertension"])
        both = h.notna() & stage.notna()
        agree = ((h == 1.0) == (stage == "htn"))[both]
        info["hypertension_check"] = {"rows_compared": int(both.sum()), "agree": int(agree.sum()), "disagree": int((~agree).sum()),
                                      "crosstab": pd.crosstab(out.loc[both, "hypertension"], stage[both]).to_dict()}
    info["stage_rule"] = (f"normal: sbp<{T.SBP_ELEVATED_MIN} and dbp<{T.DBP_PREHTN_MIN} | elevated: {T.SBP_ELEVATED_MIN}≤sbp<{T.SBP_PREHTN_MIN} and dbp<{T.DBP_PREHTN_MIN} | "
                          f"prehtn: {T.SBP_PREHTN_MIN}≤sbp<{T.SBP_HTN_MIN} or {T.DBP_PREHTN_MIN}≤dbp<{T.DBP_HTN_MIN} | htn: sbp≥{T.SBP_HTN_MIN} or dbp≥{T.DBP_HTN_MIN} or 복약")
    return out, info

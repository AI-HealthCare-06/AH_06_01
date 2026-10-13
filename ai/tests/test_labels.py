"""tests/test_labels.py — 라벨 규칙이 thresholds_kr_v1 과 일치하고 포함·제외 기준이 지켜지는지."""
from __future__ import annotations

import numpy as np
import pandas as pd

import labels as L
import thresholds_kr_v1 as T


def frame() -> pd.DataFrame:
    return pd.DataFrame({
        "age":  [25, 45, 70, 30, 18, 40, 50, 35],
        "sex":  ["male", "female", "male", "female", "male", "female", "male", "female"],
        "HE_ht": [175, 160, 168, 162, 170, 158, 172, np.nan],
        "HE_wt": [70, 55, 65, 60, 60, 52, 80, 58],
        "HE_sbp": [118, 142, 128, 139, 120, 115, 150, 120],
        "HE_dbp": [76, 88, 91, 80, 70, 70, 95, 80],
        "on_medication": [0, 0, 0, 1, 0, np.nan, 1, 0],
        "pregnant": [0, 0, 0, 0, 0, 0, 0, 0],
        "wt": [1.0, 2.0, 1.0, 1.0, 1.0, 1.0, 3.0, 1.0],
    })


def test_label_htn_matches_scalar_rule():
    df = frame()
    y = L.label_htn(df["HE_sbp"], df["HE_dbp"], df["on_medication"].fillna(0))
    expected = [int(T.is_office_htn(s, d, bool(m))) for s, d, m in zip(df["HE_sbp"], df["HE_dbp"], df["on_medication"].fillna(0))]
    assert list(y) == expected == [0, 1, 1, 1, 0, 0, 1, 0]


def test_label_htn_propagates_missing():
    # 혈압 또는 복약 여부가 결측이면 0(정상)이 아니라 NaN — 공단 데이터 외부 검증에서 유병률이 깎이지 않게
    y = L.label_htn([150, np.nan, 120, 120], [95, 80, np.nan, 80], [0, 0, 0, np.nan])
    assert y[0] == 1.0 and np.isnan(y[1]) and np.isnan(y[2]) and np.isnan(y[3])
    # 약 복용 중이어도 혈압이 없으면 판정 불가 (공식 SAS: HE_SBP·HE_DBP 모두 있어야 함)
    assert np.isnan(L.label_htn([np.nan], [np.nan], [1])[0])


def test_label_prehtn_boundary():
    # 130/80 경계: SBP 139/DBP 80 → 전단계 이상, 128/79 → 아님
    assert list(L.label_prehtn_or_above([139, 128, 129], [80, 79, 85], [0, 0, 0])) == [1, 0, 1]


def test_inclusion_and_make_labels():
    df = frame()
    _, reasons = L.inclusion_mask(df)
    assert reasons["under_min_age"] == 1 and reasons["missing_required"] == 1
    assert reasons["kept"] == 6

    out = L.make_labels(df)
    # on_medication 결측 1행 추가 제외 → 5행
    assert len(out) == 5
    assert set(out.columns) >= {L.LABEL_HTN, L.LABEL_PREHTN, L.TARGET_SBP}
    # T2 타깃: 약 복용자는 NaN
    assert out.loc[out["on_medication"] == 1, L.TARGET_SBP].isna().all()
    assert out.loc[out["on_medication"] == 0, L.TARGET_SBP].notna().all()


def test_pregnant_excluded():
    df = frame()
    df.loc[1, "pregnant"] = 1
    _, reasons = L.inclusion_mask(df)
    assert reasons["pregnant"] == 1


def test_mean_bp_2_3_requires_both():
    s2 = pd.Series([120.0, np.nan, 130.0])
    s3 = pd.Series([124.0, 118.0, np.nan])
    m = L.mean_bp_2_3(s2, s3)
    assert m.iloc[0] == 122.0 and np.isnan(m.iloc[1]) and np.isnan(m.iloc[2])


def test_weighted_prevalence_and_table():
    out = L.make_labels(frame())
    wp = L.weighted_prevalence(out)
    unweighted = out[L.LABEL_HTN].mean()
    assert 0 <= wp <= 1 and wp != unweighted  # 가중치가 실제로 반영됨
    tbl = L.prevalence_table(out)
    assert set(tbl.columns) == {"sex", "age_group", "n", "positives", "prevalence", "weighted_prevalence"}
    assert tbl["n"].sum() == len(out)

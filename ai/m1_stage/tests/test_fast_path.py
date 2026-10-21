"""
[파일] tests/test_fast_path.py
[용도] 단건 고속 경로(fast_path + predict_one)가 배치 경로(Preprocessor.transform + predict_proba/contributions)와 같은 결과를 내는지 검사한다.
      원시 컬럼 입력·명세 컬럼 입력·결측·범위 밖·필수 결측·문자열/불리언/numpy 타입 입력·선택 변수 포함 변형을 모두 포함한다.
[왜 필요한가] 추론은 고속 경로, 학습·엑셀은 배치 경로를 쓰므로 둘이 어긋나면 "학습과 같은 변환" 보장이 깨진다. 규칙을 바꾸면 이 테스트가 먼저 잡는다.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd
import pytest

from m1.contract import Contract
from m1.fast_path import FastTransformer, check_equivalence
from m1.features import VALID_STATUSES, Preprocessor
from m1.labels import make_labels
from m1.models import CANDIDATES
from tests.synth import make_synthetic


@pytest.fixture(scope="module")
def contract():
    return Contract.load()


@pytest.mark.parametrize("raw_components", [True, False])
@pytest.mark.parametrize("optional", [(), ("smoking", "stress_score")])
def test_transform_equivalence(contract, raw_components, optional):
    df = make_synthetic(800, seed=31, missing=True, raw_components=raw_components)
    df.loc[df.index[:5], "age"] = 120                       # 범위 밖
    df.loc[df.index[5:10], "waist_cm"] = np.nan
    if raw_components:
        df.loc[df.index[10:15], "height_cm"] = np.nan       # bmi 산출 불가 → 필수 결측
    else:
        df.loc[df.index[10:15], "bmi"] = np.nan
    pre = Preprocessor(contract, optional).fit(df)
    eq = check_equivalence(pre, df)
    assert eq["ok"], eq


def test_model_equivalence(contract):
    df = make_synthetic(1200, seed=32, missing=True)
    y, _ = make_labels(df, contract)
    df, y = df[y.notna()].reset_index(drop=True), y.dropna().astype(int).to_numpy()
    pre = Preprocessor(contract).fit(df)
    res = pre.transform(df)
    keep = res.status.isin(VALID_STATUSES).to_numpy()
    X, y = res.X[keep].reset_index(drop=True), y[keep]
    n = int(0.7 * len(y))
    for name, cls in CANDIDATES.items():
        m = cls(seed=3).fit(X.iloc[:n], y[:n], X.iloc[n:], y[n:], pre.monotone)
        eq = check_equivalence(pre, df.iloc[np.where(keep)[0][n:]], m)
        assert eq["ok"], (name, eq)


def test_mixed_scalar_types(contract):
    df = make_synthetic(300, seed=33, missing=False)
    pre = Preprocessor(contract, ("smoking", "stress_score")).fit(df)
    rows = [
        {"age": "45", "sex": "M", "bmi": "26.1", "waist_cm": np.float64(91.0), "alcohol_week": 14, "binge": "예", "activity_minutes_week": np.int64(90),
         "family_htn": True, "sodium_risk_score": 2.0, "sleep_short_flag": "false", "fasting_glucose": 101, "resting_hr": None, "education_years": 12,
         "smoking": 3, "stress_score": "2"},
        {"age": 30, "sex": "여", "height_cm": 162, "weight_kg": 55, "alcohol_freq_per_week": 2, "alcohol_drinks_per_occasion": 3,
         "moderate_min_week": 60, "walk_min_week": 120, "family_htn_mother": 1, "sodium_mg_day": 4500, "sleep_hours": 5.5, "dm_dx": 0, "hba1c": 6.7},
        {"age": 70, "sex": "female", "bmi": 22.0},                 # 결측 과다 → insufficient
        {"age": 95, "sex": "male", "bmi": 24.0, "waist_cm": 80},   # 범위 밖
        {"sex": "male", "bmi": 24.0},                               # 필수 결측
    ]
    ft = FastTransformer(pre)
    for r in rows:
        eq = check_equivalence(pre, pd.DataFrame([r]))
        assert eq["ok"], (r, eq)
        assert ft.transform(r).status in {"ok", "partial", "insufficient", "out_of_range"}

"""
[파일] tests/test_features.py
[용도] 원시 컬럼 산출(bmi, alcohol_week 등), 결측 대치·플래그·missing_count, 범위 밖·필수 결측 상태, 결측 과다 insufficient,
      배치 변환과 단건 변환의 일치, 전처리기 저장·복원, 피처에 혈압 컬럼 없음을 검사한다.
[왜 필요한가] "학습과 추론이 같은 변환 함수를 쓴다"는 원칙을 코드로 보증하기 위해서다. 단건 입력이 배치 때와 다른 값을 내면 추론이 어긋난다.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd
import pytest

import thresholds as T
from m1.contract import Contract
from m1.features import STATUS_INSUFFICIENT, STATUS_OK, STATUS_OUT_OF_RANGE, STATUS_PARTIAL, Preprocessor, coerce_spec_table
from tests.synth import make_synthetic


@pytest.fixture(scope="module")
def contract():
    return Contract.load()


def test_derivations(contract):
    df = make_synthetic(500, seed=1, missing=False)
    spec = coerce_spec_table(df, contract)
    exp_bmi = df["weight_kg"] / (df["height_cm"] / 100) ** 2
    assert np.allclose(spec["bmi"], exp_bmi)
    assert np.allclose(spec["alcohol_week"], df["alcohol_freq_per_week"] * df["alcohol_drinks_per_occasion"])
    assert set(spec["sex"].unique()) == {"male", "female"}
    assert spec["diabetes_flag"].isin([0.0, 1.0]).all()


def test_fit_transform_statuses_and_flags(contract):
    df = make_synthetic(800, seed=2, missing=True)
    pre = Preprocessor(contract).fit(df)
    res = pre.transform(df)
    assert list(res.X.columns) == contract.model_columns()
    assert set(res.status.unique()) <= {STATUS_OK, STATUS_PARTIAL, STATUS_INSUFFICIENT, STATUS_OUT_OF_RANGE}
    valid = res.status.isin([STATUS_OK, STATUS_PARTIAL])
    assert not res.X[valid].isna().any().any()
    spec = coerce_spec_table(df, contract)
    assert (res.flags["waist_missing"] == spec["waist_cm"].isna()).all()
    assert (res.raw.loc[res.flags["waist_missing"], "waist_cm"].notna()).all()
    # 활동량 결측 → activity_low_flag true
    miss = spec["activity_minutes_week"].isna()
    assert (res.raw.loc[miss, "activity_low_flag"] == 1.0).all()
    assert (res.raw["missing_count"] == res.flags[contract.base_flags()].sum(axis=1)).all()


def test_single_row_matches_batch(contract):
    df = make_synthetic(600, seed=3, missing=True)
    pre = Preprocessor(contract, ["smoking", "stress_score"]).fit(df)
    batch = pre.transform(df)
    for i in [0, 7, 123, 599]:
        single = pre.transform(df.iloc[[i]])
        assert np.allclose(batch.X.iloc[i].to_numpy(), single.X.iloc[0].to_numpy(), equal_nan=True)
        assert batch.status.iloc[i] == single.status.iloc[0]


def test_out_of_range_and_required(contract):
    df = make_synthetic(300, seed=4, missing=False)
    pre = Preprocessor(contract).fit(df)
    bad = df.iloc[[0, 1, 2]].copy()
    bad.loc[bad.index[0], "age"] = 100
    bad.loc[bad.index[1], "height_cm"] = np.nan      # bmi 산출 불가 → 필수 결측
    bad.loc[bad.index[2], "waist_cm"] = 200
    res = pre.transform(bad)
    assert res.status.tolist() == [STATUS_OUT_OF_RANGE, STATUS_INSUFFICIENT, STATUS_OUT_OF_RANGE]
    assert "age_out_of_range" in res.problems.iloc[0]
    assert "bmi_missing" in res.problems.iloc[1]


def test_missing_count_insufficient(contract):
    df = make_synthetic(300, seed=5, missing=False)
    pre = Preprocessor(contract).fit(df)
    row = {"age": 50, "sex": "female", "bmi": 24.0}   # 그 외 전부 결측
    res = pre.transform(pd.DataFrame([row]))
    assert res.raw["missing_count"].iloc[0] >= T.INSUFFICIENT_MISSING_COUNT
    assert res.status.iloc[0] == STATUS_INSUFFICIENT


def test_save_load_roundtrip(tmp_path, contract):
    df = make_synthetic(400, seed=6, missing=True)
    pre = Preprocessor(contract, ["smoking"]).fit(df)
    pre.save(tmp_path / "pre.json")
    pre2 = Preprocessor.load(tmp_path / "pre.json", contract)
    a, b = pre.transform(df.iloc[:20]).X, pre2.transform(df.iloc[:20]).X
    assert np.allclose(a.to_numpy(), b.to_numpy())


def test_no_bp_in_features(contract):
    df = make_synthetic(200, seed=7, missing=False)
    pre = Preprocessor(contract).fit(df)
    res = pre.transform(df)
    for c in res.X.columns:
        assert not contract.is_forbidden(c)

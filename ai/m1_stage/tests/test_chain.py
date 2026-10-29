"""
[파일] tests/test_chain.py
[용도] m1/chain.py 검증: 전처리 규칙(필수 결측 제외, 음주 0·15 상한·per_day, 활동 최빈값·flag 재계산·600 상한, 상수·최빈값 대치, 허리둘레 회귀 추정, 결측 0),
      추가 데이터 열 구성·결정성, 체인 모델(점 추정·분포) 출력 형태, 단계 함수.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd
import pytest

import thresholds as T
from m1.chain import BASE_COLUMNS, ChainFeatures, ChainModel, ChainPreprocessor, stage_from_bp
from m1.continuous import dispersion_groups


def _frame(n=400, seed=0):
    rng = np.random.default_rng(seed)
    age = rng.integers(19, 81, n).astype(float); male = rng.integers(0, 2, n)
    bmi = rng.normal(24, 3.5, n); waist = 20 + 2.5 * bmi + 0.1 * age + 6 * male + rng.normal(0, 4, n)
    act = np.where(rng.random(n) < 0.3, 0.0, rng.gamma(2, 150, n)).round()
    df = pd.DataFrame({"person_id": [f"P{i}" for i in range(n)], "exam_year": rng.integers(2013, 2023, n), "age": age, "sex": np.where(male == 1, "male", "female"),
                       "bmi": bmi, "waist_cm": waist, "alcohol_week": rng.gamma(1, 4, n).round(1), "alcohol_per_day": 0.0, "binge": rng.integers(0, 2, n).astype(float),
                       "activity_minutes_week": act, "activity_low_flag": (act < 150).astype(int), "family_htn": rng.integers(0, 2, n).astype(float),
                       "sodium_risk_score": rng.integers(0, 3, n).astype(float), "sleep_short_flag": rng.integers(0, 2, n).astype(float), "diabetes_flag": 0.0,
                       "fasting_glucose": rng.normal(96, 15, n).round(), "resting_hr": rng.normal(69, 9, n).round(), "education_years": rng.choice([6, 9, 12, 16], n).astype(float)})
    df["alcohol_per_day"] = (df["alcohol_week"] / 7 >= 2).astype(float)
    df["missing_count"] = 0
    df["sbp"] = 100 + 0.4 * age + 1.2 * bmi + 3 * male + rng.normal(0, 12, n)
    df["dbp"] = 55 + 0.1 * age + 0.6 * bmi + 0.3 * (df["sbp"] - 120) + rng.normal(0, 7, n)
    return df


def test_preprocessing_rules():
    df = _frame()
    # 규칙 검증용 행
    df.loc[0, "bmi"] = np.nan                                   # 제외
    df.loc[1, ["alcohol_week", "alcohol_per_day", "binge"]] = np.nan   # 0
    df.loc[2, "alcohol_week"] = 40; df.loc[2, "alcohol_per_day"] = 0   # 15 상한 + 플래그 + per_day 1
    df.loc[3, "activity_minutes_week"] = np.nan; df.loc[3, "activity_low_flag"] = 1   # flag1 최빈값
    df.loc[4, "activity_minutes_week"] = 900                      # 600 상한 + 플래그
    df.loc[5, "activity_minutes_week"] = 100; df.loc[5, "activity_low_flag"] = 0      # flag 재계산 → 1
    df.loc[6, ["family_htn", "sodium_risk_score", "sleep_short_flag", "diabetes_flag"]] = np.nan
    df.loc[7, ["fasting_glucose", "resting_hr", "education_years"]] = np.nan
    df.loc[8, "waist_cm"] = np.nan
    pre = ChainPreprocessor(exclude=(), required=("age", "sex", "bmi"), max_imputed=None, ranges={}).fit(df)
    X, keep, d = pre.transform(df)
    assert not keep[0] and keep[1:].all() and len(X) == len(df) - 1
    assert list(X.columns) == BASE_COLUMNS and not X.isna().any().any()
    pre2 = ChainPreprocessor().fit(df)   # 기본: 4열 제외, waist 필수, 대치 ≥5 제외, 범위 필터
    X2, keep2, d2 = pre2.transform(df)
    assert not set(X2.columns) & set(pre2.exclude) and len(X2.columns) == len(BASE_COLUMNS) - len(pre2.exclude)
    assert not keep2[8] and d2["__reason"].iloc[8] == "waist_cm_missing"
    df3 = df.copy(); df3.loc[10, ["alcohol_week", "alcohol_per_day", "binge", "activity_minutes_week", "family_htn"]] = np.nan; df3.loc[11, "fasting_glucose"] = 400
    _, keep3, d3 = pre2.transform(df3)
    assert not keep3[10] and d3["__reason"].iloc[10] == "imputed_ge_5" and not keep3[11] and d3["__reason"].iloc[11] == "fasting_glucose_out_of_range"
    r = lambda i: X.loc[i]  # noqa: E731
    assert r(1)["alcohol_week"] == 0 and r(1)["alcohol_per_day"] == 0 and r(1)["binge"] == 0
    assert r(2)["alcohol_week"] == T.ALCOHOL_WEEK_CAP and r(2)["alcohol_15plus"] == 1 and r(2)["alcohol_per_day"] == 1
    assert r(3)["activity_minutes_week"] == pre.stats["activity_mode_low"] and r(3)["activity_low_flag"] == float(pre.stats["activity_mode_low"] < 150)
    assert r(4)["activity_minutes_week"] == T.ACTIVITY_MINUTES_CAP and r(4)["activity_600plus"] == 1 and r(4)["activity_low_flag"] == 0
    assert r(5)["activity_low_flag"] == 1
    assert r(6)["family_htn"] == 0 and r(6)["sodium_risk_score"] == 1 and r(6)["sleep_short_flag"] == 0 and r(6)["diabetes_flag"] == 0
    assert r(7)["fasting_glucose"] == pre.stats["modes"]["fasting_glucose"] and r(7)["resting_hr"] == pre.stats["modes"]["resting_hr"] and r(7)["education_years"] == pre.stats["modes"]["education_years"]
    truth = 20 + 2.5 * df.loc[8, "bmi"] + 0.1 * df.loc[8, "age"] + 6 * (df.loc[8, "sex"] == "male")
    assert abs(r(8)["waist_cm"] - truth) < 3 * pre.stats["waist_rmse"] + 3
    assert pre.stats["waist_rmse"] < 6


def test_stage_from_bp():
    assert stage_from_bp([110, 125, 125, 135, 118, 145, 118], [70, 75, 82, 70, 92, 60, 79]).tolist() == [0, 1, 2, 2, 3, 3, 0]


@pytest.fixture(scope="module")
def fitted():
    df = _frame(600, seed=2)
    pre = ChainPreprocessor(exclude=(), max_imputed=None, ranges={}).fit(df.iloc[:400])
    X, keep, d = pre.transform(df)
    sbp, dbp = d.loc[keep, "sbp"].to_numpy(float), d.loc[keep, "dbp"].to_numpy(float)
    tr, va = np.arange(400), np.arange(400, len(X))
    fs = ChainFeatures(False, center="mean").fit(X.iloc[tr])
    fd = ChainFeatures(True, center="mean").fit(X.iloc[tr], sbp[tr])
    Xs, Xd = fs.transform(X), fd.transform(X, sbp)
    groups = dispersion_groups(X)
    m = ChainModel("linear").fit(Xs.iloc[tr], sbp[tr], Xd.iloc[tr], dbp[tr], Xs.iloc[va], sbp[va], Xd.iloc[va], dbp[va], groups[va])
    return pre, X, sbp, dbp, fs, fd, Xs, groups, m, va


def test_features_and_chain(fitted):
    pre, X, sbp, dbp, fs, fd, Xs, groups, m, va = fitted
    assert len(fs.columns) == 19 + 1 + 2 * 17 and len(fd.columns) == len(fs.columns) + 1 + 19
    assert "sbp" in fd.columns and "sbp_x_bmi" in fd.columns and "sbp" not in fs.columns
    assert fs.transform(X).equals(fs.transform(X))
    s_hat, d_hat, st = m.predict_point(Xs.iloc[va], X.iloc[va], fd)
    assert np.isfinite(s_hat).all() and np.isfinite(d_hat).all() and set(np.unique(st)) <= {0, 1, 2, 3}
    assert np.corrcoef(s_hat, sbp[va])[0, 1] > 0.3 and np.corrcoef(d_hat, dbp[va])[0, 1] > 0.3
    out = m.predict_dist(Xs.iloc[va], X.iloc[va], fd, groups[va], K=50)
    P = out["P"]
    assert P.shape == (len(va), 4) and np.allclose(P.sum(axis=1), 1.0) and (P >= 0).all()
    assert np.allclose(out["sbp_mean"], s_hat)
    out2 = m.predict_dist(Xs.iloc[va], X.iloc[va], fd, groups[va], K=50)
    assert np.allclose(out2["P"], P)   # 같은 seed → 같은 결과


def test_reference_center_and_hinge(fitted):
    pre, X, sbp, dbp, fs, fd, Xs, groups, m, va = fitted
    fr = ChainFeatures(False, center="reference", hinge=True).fit(X)
    Zr = fr.transform(X)
    assert {"bmi_over", "bmi_under", "waist_cm_over", "fasting_glucose_over", "resting_hr_over", "resting_hr_under", "activity_minutes_week_under", "alcohol_week_over"} <= set(Zr.columns)
    assert "age_x_bmi_over" in Zr.columns and len(fr.columns) > len(fs.columns)
    # 기준값 중심: bmi 23 인 사람의 bmi 열은 0, 허리 90 남성은 0
    i = X.index[0]
    Xt = X.loc[[i]].copy(); Xt["bmi"] = 23.0; Xt["male"] = 1.0; Xt["waist_cm"] = 90.0
    Zt = fr.transform(Xt)
    assert abs(Zt["bmi"].iloc[0]) < 1e-9 and abs(Zt["waist_cm"].iloc[0]) < 1e-9
    Xt["bmi"] = 20.0
    assert fr.transform(Xt)["bmi"].iloc[0] < 0

"""
[파일] tests/test_continuous.py
[용도] m1/continuous.py 검증: 이변량 정규 CDF 가 scipy 와 일치, 단계 확률이 합 1·몬테카를로와 일치, 입력 확장이 결정적이며 음주 규칙을 지키는지,
      선형·분포 모델의 학습·저장·복원.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd
import pytest
from scipy.stats import multivariate_normal

import thresholds as T
from m1.continuous import ContinuousBP, Dist, FeatureExpander, bvn_cdf, dispersion_groups, interval_probs, stage_probs
from m1.contract import Contract
from m1.features import Preprocessor, coerce_spec_table
from tests.synth import make_synthetic


def test_bvn_cdf_matches_scipy():
    for rho in (-0.6, 0.0, 0.3, 0.65, 0.85):
        for h in (-1.5, 0.0, 0.7, 2.0):
            for k in (-2.0, -0.3, 1.1):
                ref = multivariate_normal(mean=[0, 0], cov=[[1, rho], [rho, 1]]).cdf([h, k])
                assert abs(float(bvn_cdf(h, k, rho)) - ref) < 1e-5


def test_stage_probs_sum_to_one_and_match_monte_carlo():
    rng = np.random.default_rng(0)
    d = Dist(mu_s=np.array([112.0, 128.0, 141.0]), mu_d=np.array([72.0, 84.0, 80.0]), sig_s=np.array([12.0, 14.0, 16.0]), sig_d=np.array([8.0, 9.0, 10.0]), rho=np.array([0.6, 0.65, 0.5]))
    P = stage_probs(d)
    assert P.shape == (3, 4) and np.allclose(P.sum(axis=1), 1.0)
    for i in range(3):
        cov = [[d.sig_s[i] ** 2, d.rho[i] * d.sig_s[i] * d.sig_d[i]], [d.rho[i] * d.sig_s[i] * d.sig_d[i], d.sig_d[i] ** 2]]
        s, b = rng.multivariate_normal([d.mu_s[i], d.mu_d[i]], cov, size=200_000).T
        mc = np.array([((s < 120) & (b < 80)).mean(), ((s >= 120) & (s < 130) & (b < 80)).mean(),
                       ((s < 140) & (b < 90)).mean() - ((s < 130) & (b < 80)).mean(), ((s >= 140) | (b >= 90)).mean()])
        assert np.abs(P[i] - mc).max() < 0.01
    ip = interval_probs(d)
    assert np.allclose(ip.filter(like="sbp_").sum(axis=1), 1.0) and np.allclose(ip.filter(like="dbp_").sum(axis=1), 1.0)


@pytest.fixture(scope="module")
def expanded():
    contract = Contract.load()
    spec = coerce_spec_table(make_synthetic(1500, seed=3), contract)
    pre = Preprocessor(contract).fit(spec)
    res = pre.transform(spec)
    ex = FeatureExpander(contract).fit(res.X, res.raw)
    return contract, pre, res, ex


def test_expander_alcohol_rule_and_determinism(expanded):
    contract, pre, res, ex = expanded
    Xe = ex.transform(res.X, res.raw)
    assert list(Xe.columns) == ex.columns and "drinker" in Xe.columns and "age_x_bmi" in Xe.columns and "male_x_alcohol_week" in Xe.columns and "age_sq" in Xe.columns
    alc = res.raw["alcohol_week"].to_numpy(float)
    assert np.array_equal(Xe["drinker"].to_numpy(), (alc > 0).astype(float))
    capped = Xe["alcohol_week"].to_numpy()
    assert np.allclose(capped[alc >= T.ALCOHOL_WEEK_CAP], capped[alc >= T.ALCOHOL_WEEK_CAP][0]) if (alc >= T.ALCOHOL_WEEK_CAP).sum() > 1 else True
    assert Xe.equals(ex.transform(res.X, res.raw))
    mono = ex.monotone()
    assert len(mono) == len(ex.columns) and all(m == 0 for c, m in zip(ex.columns, mono) if c.startswith(("age_x_", "male_x_", "age_sq", "drinker")))


def test_continuous_fit_predict_roundtrip(expanded, tmp_path):
    contract, pre, res, ex = expanded
    Xe = ex.transform(res.X, res.raw)
    rng = np.random.default_rng(1)
    sbp = 115 + 8 * Xe["age"].to_numpy() + 4 * Xe["bmi"].to_numpy() + rng.normal(0, 12, len(Xe))
    dbp = 75 + 3 * Xe["bmi"].to_numpy() + 0.4 * (sbp - 115) + rng.normal(0, 7, len(Xe))
    groups = dispersion_groups(res.raw)
    tr, va = np.arange(0, 1000), np.arange(1000, 1500)
    m = ContinuousBP("linear").fit(Xe.iloc[tr], sbp[tr], dbp[tr], Xe.iloc[va], sbp[va], dbp[va], groups[va], ex.monotone())
    P = m.predict_proba(Xe.iloc[va], groups[va])
    assert P.shape == (500, 4) and np.allclose(P.sum(axis=1), 1.0) and (P >= 0).all()
    d = m.predict_dist(Xe.iloc[va], groups[va])
    assert abs(float(np.corrcoef(d.mu_s, sbp[va])[0, 1])) > 0.4 and (d.sig_s > 0).all() and (np.abs(d.rho) < 1).all()
    m.save(tmp_path / "m.pkl")
    m2 = ContinuousBP.load(tmp_path / "m.pkl")
    assert np.allclose(m2.predict_proba(Xe.iloc[va], groups[va]), P)
    assert set(m.coefficients().columns) == {"sbp_coef", "dbp_coef"}

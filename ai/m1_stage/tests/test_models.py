"""
[파일] tests/test_models.py
[용도] 순서형·이진 로지스틱의 해석적 기울기 검증(check_grad), 누적 확률 합성의 합=1·양수, 후보 3종 fit/predict 형태, 부호 제약 준수를 검사한다.
[왜 필요한가] 직접 구현한 최적화 목적함수의 기울기가 틀리면 수렴이 안 되거나 엉뚱한 계수가 나온다. 부호 제약이 실제로 걸렸는지 계수로 확인한다.
[쓰는 곳] pytest
"""

import numpy as np
from scipy.optimize import check_grad

from m1.contract import Contract
from m1.features import STATUS_OK, STATUS_PARTIAL, Preprocessor
from m1.labels import make_labels
from m1.models import CANDIDATES
from m1.models.calibration import compose_stage_probs, cumulative_probs
from m1.models.linear import _logistic_obj, _ordinal_obj
from tests.synth import make_synthetic


def test_gradients():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(60, 5))
    y4 = rng.integers(0, 4, 60)
    yb = rng.integers(0, 2, 60).astype(float)
    p0 = np.concatenate([rng.normal(scale=0.3, size=5), [-0.5, 0.0, 0.2]])
    err = check_grad(lambda p: _ordinal_obj(p, X, y4, 0.01)[0], lambda p: _ordinal_obj(p, X, y4, 0.01)[1], p0)
    assert err < 1e-5
    p1 = np.concatenate([rng.normal(scale=0.3, size=5), [0.1]])
    err2 = check_grad(lambda p: _logistic_obj(p, X, yb, 0.01)[0], lambda p: _logistic_obj(p, X, yb, 0.01)[1], p1)
    assert err2 < 1e-5


def test_compose_probs():
    Q = np.array([[0.9, 0.5, 0.2], [0.3, 0.6, 0.1]])   # 두 번째 행은 비단조 → 강제
    P = compose_stage_probs(Q)
    assert P.shape == (2, 4) and np.allclose(P.sum(axis=1), 1) and (P > 0).all()
    assert np.allclose(cumulative_probs(P)[0], Q[0], atol=1e-5)


def _data(n=1500, seed=11):
    c = Contract.load()
    df = make_synthetic(n, seed=seed, missing=True)
    y, _ = make_labels(df, c)
    df, y = df[y.notna()].reset_index(drop=True), y[y.notna()].astype(int).to_numpy()
    pre = Preprocessor(c).fit(df)
    res = pre.transform(df)
    keep = res.status.isin([STATUS_OK, STATUS_PARTIAL]).to_numpy()
    X, y = res.X[keep].reset_index(drop=True), y[keep]
    n_tr = int(0.7 * len(y))
    return X.iloc[:n_tr], y[:n_tr], X.iloc[n_tr:], y[n_tr:], pre.monotone


def test_candidates_fit_predict_and_signs():
    Xtr, ytr, Xva, yva, mono = _data()
    for name, cls in CANDIDATES.items():
        m = cls(seed=1).fit(Xtr, ytr, Xva, yva, mono)
        P = m.predict_proba(Xva)
        assert P.shape == (len(yva), 4) and np.allclose(P.sum(axis=1), 1)
        C = m.contributions(Xva)
        assert C.shape == (len(yva), Xva.shape[1])
        if name == "ordinal":
            for b, mo in zip(m.beta, mono):
                assert (mo <= 0 or b >= -1e-9) and (mo >= 0 or b <= 1e-9)
        if name == "nested":
            for beta in m.betas:
                for b, mo in zip(beta, mono):
                    assert (mo <= 0 or b >= -1e-9) and (mo >= 0 or b <= 1e-9)

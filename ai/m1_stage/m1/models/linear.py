"""
[파일] m1/models/linear.py
[용도] 부호 제약 선형 후보 2종. (1) OrdinalLogit: 누적 링크 순서형 로지스틱 + L2. (2) NestedBinary: P(≥k) 이진 로지스틱 3개 + Platt → 단계 확률 합성.
      부호 제약은 L-BFGS-B 경계(상승 β≥0, 하강 β≤0)로 걸고, L2 λ 는 검증 로그손실로 고른다.
[왜 필요한가] 명세 2-4 후보 "순서형 로지스틱(누적 링크, 부호 제약, L2)"과 "중첩 이진 2개(부호 제약 + Platt)"의 구현이다.
             계수를 그대로 읽을 수 있어 단조 방향이 지켜졌는지 확인 가능하다. 명세의 이진 2개로는 normal 과 elevated 를 가를 수 없어
             P(≥elevated) 이진을 하나 더 두었다(결정 대기 항목에 기록).
[쓰는 곳] m1/models/__init__.py, tests/test_models.py(기울기 검증)
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, log_expit
from sklearn.metrics import log_loss

import thresholds as T
from .base import StageModel
from .calibration import PlattScaler, compose_stage_probs

N_STAGES = len(T.STAGES)
L2_GRID = (1e-4, 1e-3, 1e-2, 1e-1, 1.0)
PROB_EPS = 1e-12


def _beta_bounds(monotone: list[int]) -> list[tuple]:
    out = []
    for m in monotone:
        if m > 0:
            out.append((0.0, None))
        elif m < 0:
            out.append((None, 0.0))
        else:
            out.append((None, None))
    return out


# ---------------------------------------------------------------------------
# 이진 로지스틱 (부호 제약, L2)
# ---------------------------------------------------------------------------
def _logistic_obj(params, X, y, lam):
    p = X.shape[1]
    beta, b = params[:p], params[p]
    z = X @ beta + b
    nll = -(y * log_expit(z) + (1 - y) * log_expit(-z)).mean()
    r = (expit(z) - y) / len(y)
    g = np.concatenate([X.T @ r + 2 * lam * beta, [r.sum()]])
    return nll + lam * (beta @ beta), g


def fit_constrained_logistic(X: np.ndarray, y: np.ndarray, monotone: list[int], lam: float, max_iter: int = 2000):
    n, p = X.shape
    prev = float(np.clip(y.mean(), 1e-3, 1 - 1e-3))
    x0 = np.concatenate([np.zeros(p), [np.log(prev / (1 - prev))]])
    bounds = _beta_bounds(monotone) + [(None, None)]
    res = minimize(_logistic_obj, x0, args=(X, y, lam), jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": max_iter})
    return res.x[:p], float(res.x[p]), res


# ---------------------------------------------------------------------------
# 순서형 로지스틱 (누적 링크): P(Y ≤ k) = σ(θ_k − xβ)
# ---------------------------------------------------------------------------
def _unpack_ordinal(params, p):
    beta = params[:p]
    t1, d2, d3 = params[p], params[p + 1], params[p + 2]
    theta = np.array([t1, t1 + np.exp(d2), t1 + np.exp(d2) + np.exp(d3)])
    return beta, theta


def _ordinal_probs(eta: np.ndarray, theta: np.ndarray) -> np.ndarray:
    F = expit(theta[None, :] - eta[:, None])                     # (n,3) P(Y ≤ k), k=0..2
    Fpad = np.column_stack([np.zeros(len(eta)), F, np.ones(len(eta))])
    return np.diff(Fpad, axis=1)                                 # (n,4)


def _ordinal_obj(params, X, y, lam):
    n, p = X.shape
    beta, theta = _unpack_ordinal(params, p)
    eta = X @ beta
    A = theta[None, :] - eta[:, None]
    F = expit(A)
    f = F * (1 - F)                                              # (n,3)
    Fpad = np.column_stack([np.zeros(n), F, np.ones(n)])
    P = np.diff(Fpad, axis=1)
    Py = np.clip(P[np.arange(n), y], PROB_EPS, None)
    nll = -np.log(Py).mean() + lam * (beta @ beta)
    # dP_y/dη = −f_k + f_{k−1}  (f_{-1} = f_3 = 0)
    fpad = np.column_stack([np.zeros(n), f, np.zeros(n)])        # 인덱스 j+1 ↔ f_j
    dP_deta = -fpad[np.arange(n), y + 1] + fpad[np.arange(n), y]
    g_eta = -(dP_deta / Py) / n
    g_beta = X.T @ g_eta + 2 * lam * beta
    # dP_y/dθ_j: j == y → +f_j ; j == y−1 → −f_j
    g_theta = np.zeros(3)
    for j in range(3):
        d = np.where(y == j, f[:, j], 0.0) - np.where(y == j + 1, f[:, j], 0.0)
        g_theta[j] = -(d / Py).sum() / n
    d2, d3 = params[p + 1], params[p + 2]
    g_t1 = g_theta.sum()
    g_d2 = (g_theta[1] + g_theta[2]) * np.exp(d2)
    g_d3 = g_theta[2] * np.exp(d3)
    return nll, np.concatenate([g_beta, [g_t1, g_d2, g_d3]])


def fit_ordinal(X: np.ndarray, y: np.ndarray, monotone: list[int], lam: float, max_iter: int = 2000):
    n, p = X.shape
    cum = np.array([(y <= k).mean() for k in range(N_STAGES - 1)])
    cum = np.clip(cum, 1e-3, 1 - 1e-3)
    th = np.log(cum / (1 - cum))
    th = np.maximum.accumulate(th + np.arange(3) * 1e-3)
    x0 = np.concatenate([np.zeros(p), [th[0], np.log(max(th[1] - th[0], 1e-3)), np.log(max(th[2] - th[1], 1e-3))]])
    bounds = _beta_bounds(monotone) + [(None, None), (-12.0, 8.0), (-12.0, 8.0)]
    res = minimize(_ordinal_obj, x0, args=(X, y, lam), jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": max_iter})
    beta, theta = _unpack_ordinal(res.x, p)
    return beta, theta, res


class OrdinalLogit(StageModel):
    name = "ordinal"

    def __init__(self, seed: int = 42, l2_grid=L2_GRID):
        super().__init__(seed)
        self.l2_grid = tuple(l2_grid)
        self.beta = None
        self.theta = None
        self.lam = None

    def fit(self, X, y, X_val, y_val, monotone):
        self.columns = list(X.columns)
        Xa, ya = X.to_numpy(dtype=float), np.asarray(y).astype(int)
        Xv, yv = X_val.to_numpy(dtype=float), np.asarray(y_val).astype(int)
        best = None
        trials = []
        for lam in self.l2_grid:
            beta, theta, res = fit_ordinal(Xa, ya, monotone, lam)
            Pv = _ordinal_probs(Xv @ beta, theta)
            ll = log_loss(yv, Pv, labels=list(range(N_STAGES)))
            trials.append({"lam": lam, "val_logloss": float(ll), "converged": bool(res.success), "iters": int(res.nit)})
            if best is None or ll < best[0]:
                best = (ll, lam, beta, theta)
        _, self.lam, self.beta, self.theta = best
        self.fit_info = {"l2_trials": trials, "lam": self.lam, "theta": self.theta.tolist(), "coef": dict(zip(self.columns, self.beta.tolist()))}
        return self

    def predict_proba(self, X):
        Xa = self._check(X)
        return _ordinal_probs(Xa @ self.beta, self.theta)

    def contributions(self, X):
        Xa = self._check(X)
        return Xa * self.beta[None, :]

    def predict_one(self, x):
        return _ordinal_probs(np.array([x @ self.beta]), self.theta)[0], x * self.beta


# ---------------------------------------------------------------------------
# 중첩 이진: P(≥k), k=1,2,3 각각 부호 제약 로지스틱 + Platt → 단계 확률 합성
# 명세는 ≥130/80, ≥140/90 두 개를 적시. 4단계 출력에는 '정상 vs 주의혈압 이상' 경계(P(≥elevated))가 추가로 필요해 3개로 구현.
# ---------------------------------------------------------------------------
class NestedBinary(StageModel):
    name = "nested"

    def __init__(self, seed: int = 42, l2_grid=L2_GRID):
        super().__init__(seed)
        self.l2_grid = tuple(l2_grid)
        self.betas: list[np.ndarray] = []
        self.intercepts: list[float] = []
        self.platts: list[PlattScaler] = []

    def fit(self, X, y, X_val, y_val, monotone):
        self.columns = list(X.columns)
        Xa, ya = X.to_numpy(dtype=float), np.asarray(y).astype(int)
        Xv, yv = X_val.to_numpy(dtype=float), np.asarray(y_val).astype(int)
        self.betas, self.intercepts, self.platts = [], [], []
        info = []
        for k in range(1, N_STAGES):
            yb, yvb = (ya >= k).astype(float), (yv >= k).astype(float)
            if len(np.unique(yb)) < 2:
                prev = float(np.clip(yb.mean(), 1e-3, 1 - 1e-3))
                beta, b, lam, trials = np.zeros(Xa.shape[1]), float(np.log(prev / (1 - prev))), None, []
            else:
                best, trials = None, []
                for lam in self.l2_grid:
                    beta_, b_, res = fit_constrained_logistic(Xa, yb, monotone, lam)
                    ll = log_loss(yvb, expit(Xv @ beta_ + b_), labels=[0, 1])
                    trials.append({"lam": lam, "val_logloss": float(ll), "converged": bool(res.success)})
                    if best is None or ll < best[0]:
                        best = (ll, lam, beta_, b_)
                _, lam, beta, b = best
            platt = PlattScaler().fit(Xv @ beta + b, yvb)
            self.betas.append(beta)
            self.intercepts.append(b)
            self.platts.append(platt)
            info.append({"threshold": f"ge_{k}", "lam": lam, "l2_trials": trials, "platt": platt.to_dict(), "coef": dict(zip(self.columns, beta.tolist())), "intercept": b})
        self.fit_info = {"binaries": info}
        return self

    def _cumulative(self, Xa: np.ndarray) -> np.ndarray:
        return np.column_stack([pl.transform(Xa @ b + c) for b, c, pl in zip(self.betas, self.intercepts, self.platts)])

    def predict_proba(self, X):
        return compose_stage_probs(self._cumulative(self._check(X)))

    def contributions(self, X):
        Xa = self._check(X)
        return sum(Xa * b[None, :] for b in self.betas)

    def predict_one(self, x):
        Q = np.array([pl.transform(x @ b + c) for b, c, pl in zip(self.betas, self.intercepts, self.platts)])
        return compose_stage_probs(Q[None, :])[0], sum(x * b for b in self.betas)

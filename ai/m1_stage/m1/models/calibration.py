"""
[파일] m1/models/calibration.py
[용도] Platt 보정기(검증 집합에서 a·z+b 적합)와 누적 확률 P(≥k) ↔ 단계 확률 변환(compose_stage_probs, cumulative_probs).
[왜 필요한가] 명세 2-4 의 "Platt 보정 … 단계 확률로 합성"과 "보정기 포함"을 구현한다. 누적 확률이 비단조(q2 > q1)로 나오면
             단계 확률이 음수가 되므로 단조 강제 후 합성한다. 평가·그림도 같은 누적 변환을 써야 하므로 공용 모듈로 둔다.
[쓰는 곳] m1/models/linear.py, m1/models/lgbm.py, m1/evaluate.py, m1/plots.py, m1/predict.py
"""

from __future__ import annotations

import numpy as np
from scipy.special import expit
from sklearn.linear_model import LogisticRegression

PROB_FLOOR = 1e-6


class PlattScaler:
    """p = sigmoid(a·z + b). 검증 집합에서 적합. 한 클래스뿐이면 항등."""

    def __init__(self):
        self.a = 1.0
        self.b = 0.0
        self.fitted_on = 0

    def fit(self, z: np.ndarray, y: np.ndarray) -> "PlattScaler":
        z = np.asarray(z, dtype=float).reshape(-1, 1)
        y = np.asarray(y).astype(int)
        self.fitted_on = int(len(y))
        if len(np.unique(y)) < 2:
            return self
        lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000).fit(z, y)
        self.a = float(lr.coef_[0, 0])
        self.b = float(lr.intercept_[0])
        return self

    def transform(self, z: np.ndarray) -> np.ndarray:
        return expit(self.a * np.asarray(z, dtype=float) + self.b)

    def to_dict(self) -> dict:
        return {"a": self.a, "b": self.b, "fitted_on": self.fitted_on}


def compose_stage_probs(Q: np.ndarray) -> np.ndarray:
    """누적 확률 Q[:, k-1] = P(stage ≥ k), k=1..3 → 단계 확률 (n, 4). 단조(q1 ≥ q2 ≥ q3) 강제 후 합성."""
    Q = np.asarray(Q, dtype=float)
    Q = np.minimum.accumulate(np.clip(Q, 0.0, 1.0), axis=1)
    P = np.column_stack([1.0 - Q[:, 0], Q[:, 0] - Q[:, 1], Q[:, 1] - Q[:, 2], Q[:, 2]])
    P = np.clip(P, PROB_FLOOR, None)
    return P / P.sum(axis=1, keepdims=True)


def cumulative_probs(P: np.ndarray) -> np.ndarray:
    """단계 확률 (n,4) → 누적 확률 (n,3): P(≥1), P(≥2), P(≥3)."""
    P = np.asarray(P, dtype=float)
    return np.column_stack([P[:, 1:].sum(axis=1), P[:, 2:].sum(axis=1), P[:, 3]])

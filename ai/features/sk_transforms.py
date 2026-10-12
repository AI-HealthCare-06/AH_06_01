"""features/sk_transforms.py — sklearn 파이프라인용 작은 변환기 (학습·추론 양쪽에서 import 가능해야 pickle 이 풀린다)

B0 요구사항 "age 는 선형 + 제곱항 허용" 을 ColumnTransformer 로 구현한다. 입력은 contract_v1.columns_for()
순서의 numpy 행렬이고, 출력 열 이름은 'age__age', 'age__age^2', 'remainder__bmi' … 형태라
inference/predictor._origin_column 이 원래 계약 열로 되돌릴 수 있다.
"""
from __future__ import annotations

from typing import Sequence

import numpy as np
from scipy.optimize import minimize
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import FunctionTransformer


class SignConstrainedLogisticRegression(BaseEstimator, ClassifierMixin):
    """L2 로지스틱 회귀 + 계수 부호 경계 (B0 베이스라인).

    목적함수는 sklearn LogisticRegression 과 같은 척도: sum(logloss) + ||w||² / (2C). 절편은 정규화하지 않는다.
    signs[j] = +1 이면 w_j ≥ 0, −1 이면 w_j ≤ 0, 0 이면 자유. 상식과 반대 방향으로 추정되는 계수는 경계 0 에
    붙는다 — 즉 '그 피처는 이 데이터에서 독립 신호가 없다'고 모델이 말하는 것이고, 단조성은 구조적으로 보장된다.
    coef_ / intercept_ / predict_proba 인터페이스가 sklearn 과 같아 predictor 의 선형 설명 경로를 그대로 쓴다.
    """

    def __init__(self, signs: Sequence[int] | None = None, C: float = 1.0, max_iter: int = 5000, tol: float = 1e-8) -> None:
        self.signs = signs
        self.C = C
        self.max_iter = max_iter
        self.tol = tol

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).reshape(-1)
        n, d = X.shape
        signs = np.zeros(d, dtype=int) if self.signs is None else np.asarray(self.signs, dtype=int)
        if len(signs) != d:
            raise ValueError(f"signs length {len(signs)} != n_features {d}")
        bounds = [(0.0, None) if s > 0 else (None, 0.0) if s < 0 else (None, None) for s in signs] + [(None, None)]
        lam = 1.0 / (2.0 * self.C)

        def f(wb):
            w, b = wb[:-1], wb[-1]
            z = X @ w + b
            # 안정적인 log(1+exp(z)) 와 로짓 손실
            loss = np.sum(np.logaddexp(0.0, z) - y * z) + lam * np.dot(w, w)
            p = 1.0 / (1.0 + np.exp(-z))
            r = p - y
            grad = np.concatenate([X.T @ r + 2.0 * lam * w, [r.sum()]])
            return loss, grad

        w0 = np.zeros(d + 1)
        w0[-1] = np.log(max(y.mean(), 1e-6) / max(1 - y.mean(), 1e-6))
        res = minimize(f, w0, jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": self.max_iter, "ftol": self.tol, "gtol": 1e-6})
        self.coef_ = res.x[:-1].reshape(1, -1)
        self.intercept_ = res.x[-1:]
        self.classes_ = np.array([0, 1])
        self.n_features_in_ = d
        self.n_iter_ = np.array([res.nit])
        self.converged_ = bool(res.success)
        self.signs_ = signs
        return self

    def decision_function(self, X):
        return np.asarray(X, dtype=float) @ self.coef_[0] + self.intercept_[0]

    def predict_proba(self, X):
        p = 1.0 / (1.0 + np.exp(-self.decision_function(X)))
        return np.column_stack([1.0 - p, p])

    def predict(self, X):
        return (self.decision_function(X) >= 0).astype(int)


def with_square(X):
    X = np.asarray(X, dtype=float)
    return np.hstack([X, X ** 2])


def with_square_names(_transformer, input_features):
    return list(input_features) + [f"{f}^2" for f in input_features]


def age_square_preprocessor(columns: Sequence[str]) -> ColumnTransformer:
    """age 열만 (age, age²) 로 늘리고 나머지는 그대로 통과."""
    i = list(columns).index("age")
    return ColumnTransformer(
        [("age", FunctionTransformer(with_square, feature_names_out=with_square_names), [i])],
        remainder="passthrough",
        verbose_feature_names_out=True,
    )

"""
[파일] m1/models/bp_regression.py
[용도] 점검용 보조 혈압 회귀. 단계 모델과 같은 피처·같은 부호 제약으로 수축기·이완기 mmHg 를 회귀한다.
      후보 2종: 부호 제약 능형 선형(linear), 단조 제약 LightGBM(lgbm).
[왜 필요한가] 명세 2-1 은 mmHg 점 추정을 제품 출력에서 제외한다(RMSE 약 13.5 mmHg > 단계 폭 10 mmHg). 이 모듈은 사용자가 정답 혈압과
             비교해 오차를 확인하는 점검용이며 M1 출력(명세 2-6)에는 들어가지 않는다. 예측 혈압에서 환산한 단계·hypertension 도 점검용으로만 낸다.
[쓰는 곳] train.py, evaluate_cli.py, predict_cli.py(배치 추론 bp_ 시트)
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from .linear import L2_GRID, _beta_bounds

TARGETS = ("sbp", "dbp")


class BPRegressor:
    name = "bp_base"

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.columns: list[str] = []
        self.fit_info: dict = {}

    def fit(self, X: pd.DataFrame, Y: np.ndarray, X_val: pd.DataFrame, Y_val: np.ndarray, monotone: list[int]) -> "BPRegressor":
        raise NotImplementedError

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """(n, 2) = [sbp, dbp] mmHg."""
        raise NotImplementedError

    def _check(self, X: pd.DataFrame) -> np.ndarray:
        if list(X.columns) != self.columns:
            raise ValueError("입력 열 순서가 학습 때와 다름")
        return X.to_numpy(dtype=float)

    def save(self, path: Path | str) -> None:
        with open(path, "wb") as fh:
            pickle.dump(self, fh)

    @staticmethod
    def load(path: Path | str) -> "BPRegressor":
        with open(path, "rb") as fh:
            return pickle.load(fh)


def _ridge_obj(params, X, y, lam):
    p = X.shape[1]
    beta, b = params[:p], params[p]
    r = X @ beta + b - y
    n = len(y)
    return (r @ r) / n + lam * (beta @ beta), np.concatenate([2 * (X.T @ r) / n + 2 * lam * beta, [2 * r.sum() / n]])


class LinearBP(BPRegressor):
    """부호 제약 능형 회귀 (L-BFGS-B 경계). λ 는 검증 RMSE 로 선택."""
    name = "linear"

    def __init__(self, seed: int = 42, l2_grid=L2_GRID):
        super().__init__(seed)
        self.l2_grid = tuple(l2_grid)
        self.betas: dict[str, np.ndarray] = {}
        self.intercepts: dict[str, float] = {}

    def fit(self, X, Y, X_val, Y_val, monotone):
        self.columns = list(X.columns)
        Xa, Xv = X.to_numpy(dtype=float), X_val.to_numpy(dtype=float)
        bounds = _beta_bounds(monotone) + [(None, None)]
        info = {}
        for j, t in enumerate(TARGETS):
            y, yv = Y[:, j].astype(float), Y_val[:, j].astype(float)
            best, trials = None, []
            for lam in self.l2_grid:
                x0 = np.concatenate([np.zeros(Xa.shape[1]), [float(y.mean())]])
                res = minimize(_ridge_obj, x0, args=(Xa, y, lam), jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": 2000})
                rmse = float(np.sqrt(np.mean((Xv @ res.x[:-1] + res.x[-1] - yv) ** 2)))
                trials.append({"lam": lam, "val_rmse": rmse, "converged": bool(res.success)})
                if best is None or rmse < best[0]:
                    best = (rmse, lam, res.x[:-1], float(res.x[-1]))
            _, lam, self.betas[t], self.intercepts[t] = best
            info[t] = {"lam": lam, "l2_trials": trials, "coef": dict(zip(self.columns, self.betas[t].tolist())), "intercept": self.intercepts[t]}
        self.fit_info = info
        return self

    def predict(self, X):
        Xa = self._check(X)
        return np.column_stack([Xa @ self.betas[t] + self.intercepts[t] for t in TARGETS])


class LGBMBP(BPRegressor):
    """단조 제약 LightGBM 회귀. 검증 집합 RMSE 로 조기 종료."""
    name = "lgbm"
    PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=7, max_depth=3, min_child_samples=20, subsample=0.8, subsample_freq=1,
                  colsample_bytree=0.8, reg_lambda=1.0, n_estimators=2000, monotone_constraints_method="advanced", deterministic=True,
                  force_row_wise=True, verbose=-1)
    EARLY_STOPPING_ROUNDS = 50

    def __init__(self, seed: int = 42):
        super().__init__(seed)
        self.models: dict = {}

    def fit(self, X, Y, X_val, Y_val, monotone):
        import lightgbm as lgb

        self.columns = list(X.columns)
        info = {}
        for j, t in enumerate(TARGETS):
            m = lgb.LGBMRegressor(**dict(self.PARAMS, monotone_constraints=list(monotone), random_state=self.seed))
            m.fit(X, Y[:, j], eval_set=[(X_val, Y_val[:, j])], callbacks=[lgb.early_stopping(self.EARLY_STOPPING_ROUNDS, verbose=False)])
            self.models[t] = m
            info[t] = {"best_iteration": int(m.best_iteration_ or m.n_estimators)}
        self.fit_info = info
        return self

    def predict(self, X):
        self._check(X)
        return np.column_stack([self.models[t].predict(X) for t in TARGETS])


BP_CANDIDATES: dict[str, type[BPRegressor]] = {"linear": LinearBP, "lgbm": LGBMBP}

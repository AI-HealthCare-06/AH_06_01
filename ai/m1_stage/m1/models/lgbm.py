"""
[파일] m1/models/lgbm.py
[용도] 단조 제약 LightGBM 후보. P(≥k) 이진 모델 3개(작은 트리, 조기 종료) + Platt 보정 → 단계 확률 합성. 기여도는 pred_contrib(SHAP) 합.
[왜 필요한가] 명세 2-4 후보 "단조 제약 LightGBM, 작은 트리, 보정기 포함"의 구현이다. multiclass 목적함수에 단조 제약을 걸면
             클래스별 점수에만 제약이 걸려 누적 확률의 단조성이 보장되지 않으므로 누적 이진 구조로 만들었다.
[쓰는 곳] m1/models/__init__.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import thresholds as T
from .base import StageModel
from .calibration import PlattScaler, compose_stage_probs

N_STAGES = len(T.STAGES)

DEFAULT_PARAMS = dict(
    objective="binary",
    learning_rate=0.05,
    num_leaves=7,
    max_depth=3,
    min_child_samples=20,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    n_estimators=2000,
    monotone_constraints_method="advanced",
    deterministic=True,
    force_row_wise=True,
    verbose=-1,
)
EARLY_STOPPING_ROUNDS = 50
FALLBACK_ESTIMATORS = 200


class _ConstantBinary:
    def __init__(self, prev: float):
        self.z = float(np.log(prev / (1 - prev)))

    def predict(self, X, raw_score=False, pred_contrib=False):
        n = len(X)
        if pred_contrib:
            return np.column_stack([np.zeros((n, X.shape[1])), np.full(n, self.z)])
        return np.full(n, self.z)


class MonotoneLGBM(StageModel):
    name = "lgbm"

    def __init__(self, seed: int = 42, params: dict | None = None):
        super().__init__(seed)
        self.params = dict(DEFAULT_PARAMS, **(params or {}))
        self.models: list = []
        self.platts: list[PlattScaler] = []

    def fit(self, X, y, X_val, y_val, monotone):
        import lightgbm as lgb

        self.columns = list(X.columns)
        ya, yv = np.asarray(y).astype(int), np.asarray(y_val).astype(int)
        self.models, self.platts = [], []
        info = []
        for k in range(1, N_STAGES):
            yb, yvb = (ya >= k).astype(int), (yv >= k).astype(int)
            if len(np.unique(yb)) < 2:
                m = _ConstantBinary(float(np.clip(yb.mean(), 1e-3, 1 - 1e-3)))
                best_iter = 0
            else:
                params = dict(self.params, monotone_constraints=list(monotone), random_state=self.seed)
                m = lgb.LGBMClassifier(**params)
                if len(np.unique(yvb)) < 2:
                    m.set_params(n_estimators=FALLBACK_ESTIMATORS)
                    m.fit(X, yb)
                    best_iter = FALLBACK_ESTIMATORS
                else:
                    m.fit(X, yb, eval_set=[(X_val, yvb)], callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)])
                    best_iter = int(m.best_iteration_ or m.n_estimators)
            z_val = m.predict(X_val, raw_score=True)
            platt = PlattScaler().fit(z_val, yvb)
            self.models.append(m)
            self.platts.append(platt)
            info.append({"threshold": f"ge_{k}", "best_iteration": best_iter, "platt": platt.to_dict()})
        self.fit_info = {"binaries": info, "params": {k_: v for k_, v in self.params.items()}}
        return self

    def _cumulative(self, X: pd.DataFrame) -> np.ndarray:
        return np.column_stack([pl.transform(m.predict(X, raw_score=True)) for m, pl in zip(self.models, self.platts)])

    def predict_proba(self, X):
        self._check(X)
        return compose_stage_probs(self._cumulative(X))

    def contributions(self, X):
        self._check(X)
        p = len(self.columns)
        return sum(np.asarray(m.predict(X, pred_contrib=True))[:, :p] for m in self.models)

    def _raw_predictors(self):
        """sklearn 래퍼 검증 비용을 피하려고 Booster 를 직접 쓴다. num_iteration 은 래퍼와 같이 best_iteration 기본값을 따른다."""
        if not hasattr(self, "_boosters"):
            self._boosters = [getattr(m, "booster_", m) for m in self.models]
        return self._boosters

    def predict_one(self, x):
        x2 = x[None, :]
        p = len(self.columns)
        zs, contrib = [], np.zeros(p)
        for b in self._raw_predictors():
            zs.append(float(np.asarray(b.predict(x2, raw_score=True))[0]))
            contrib += np.asarray(b.predict(x2, pred_contrib=True))[0, :p]
        Q = np.array([pl.transform(z) for z, pl in zip(zs, self.platts)])
        return compose_stage_probs(Q[None, :])[0], contrib

"""
[파일] m1/models/base.py
[용도] 모델 후보 공통 인터페이스(StageModel): fit, predict_proba(n×4 단계 확률), contributions(이유 코드용 기여도), save/load.
[왜 필요한가] 후보 3종이 같은 입출력 규약을 지켜야 train.py 와 predict.py 가 후보를 구분하지 않고 쓸 수 있다.
             입력 열 순서가 학습 때와 다르면 즉시 오류를 내 학습·추론 불일치를 막는다.
[쓰는 곳] m1/models/linear.py, m1/models/lgbm.py, m1/predict.py
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd


class StageModel:
    name: str = "base"

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.columns: list[str] = []
        self.fit_info: dict = {}
        self.stage_thresholds: dict | None = None   # 검증 분할에서 고른 누적 임계값 {"accuracy": [τ1,τ2,τ3], "balanced": [...]} (decision.fit_thresholds)

    def fit(self, X: pd.DataFrame, y: np.ndarray, X_val: pd.DataFrame, y_val: np.ndarray, monotone: list[int]) -> "StageModel":
        raise NotImplementedError

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """(n, 4) 보정 단계 확률."""
        raise NotImplementedError

    def contributions(self, X: pd.DataFrame) -> np.ndarray:
        """(n, p) 로짓 척도 피처 기여도 (이유 코드 정렬용)."""
        raise NotImplementedError

    def predict_one(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """단건 고속 경로: x (p,) → (단계 확률 (4,), 기여도 (p,)). predict_proba/contributions 와 같은 값이어야 한다(fast_path.check_equivalence)."""
        raise NotImplementedError

    def _check(self, X: pd.DataFrame) -> np.ndarray:
        if list(X.columns) != self.columns:
            raise ValueError("입력 열 순서가 학습 때와 다름")
        return X.to_numpy(dtype=float)

    def save(self, path: Path | str) -> None:
        with open(path, "wb") as fh:
            pickle.dump(self, fh)

    @staticmethod
    def load(path: Path | str) -> "StageModel":
        with open(path, "rb") as fh:
            return pickle.load(fh)

"""inference/bundle.py — 모델 아티팩트 한 파일의 형식

학습 스크립트(train_baseline.py / train_boost.py)가 저장하고 inference/predictor.py 가 읽는다.
모델·보정기·대치값·열 순서·버전이 한 파일(joblib)에 들어가 "모델만 바뀌고 대치값은 옛것" 같은 불일치가 없다.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from features.contract_v1 import FEATURE_VERSION, Imputers, columns_for
import thresholds_kr_v1 as T


@dataclass
class ModelBundle:
    model_id: str                    # htn_risk_full | htn_risk_lite
    model_version: str               # 예: 2026.10.13-b0
    estimator: Any                   # fitted sklearn Pipeline (predict_proba) 또는 LGBM 래퍼
    imputers: Imputers
    calibrator: Any | None = None    # .predict(p: ndarray) -> ndarray, 없으면 항등
    columns: tuple[str, ...] = ()    # 숫자 입력 열 순서. 비우면 contract 기본값
    reference: dict[str, float] | None = None   # 설명 기준점(학습 세트 평균). 없으면 스케일러 중심
    feature_version: str = FEATURE_VERSION
    thresholds_version: str = T.THRESHOLDS_VERSION
    metadata: dict[str, Any] = field(default_factory=dict)   # 학습 연도, 지표, 시드 등 (모델 카드 재료)

    def __post_init__(self) -> None:
        if not self.columns:
            self.columns = columns_for(self.model_id)
        self.columns = tuple(self.columns)

    # ── 추론 ──
    def predict_raw_proba(self, X: np.ndarray) -> np.ndarray:
        """보정 전 확률. LightGBM 은 booster 로 직접 예측한다 — sklearn 래퍼의 feature-name 검증(경고)을 피하고 더 가볍다."""
        booster = getattr(self.estimator, "booster_", None)
        if booster is not None:
            best = getattr(self.estimator, "best_iteration_", None)
            return np.asarray(booster.predict(np.asarray(X, dtype=float), num_iteration=best)).reshape(-1)
        return np.asarray(self.estimator.predict_proba(X))[:, 1]

    def calibrate(self, p: np.ndarray) -> np.ndarray:
        if self.calibrator is None:
            return p
        return np.clip(np.asarray(self.calibrator.predict(np.asarray(p).reshape(-1))), 0.0, 1.0)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return self.calibrate(self.predict_raw_proba(X))

    # ── 저장/로드 ──
    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path, compress=3)
        return path

    @staticmethod
    def load(path: str | Path) -> "ModelBundle":
        b = joblib.load(path)
        if not isinstance(b, ModelBundle):
            raise TypeError(f"{path} is not a ModelBundle")
        if b.feature_version != FEATURE_VERSION:
            raise ValueError(f"{path}: feature_version {b.feature_version} != {FEATURE_VERSION}")
        return b

    def describe(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("estimator")
        d.pop("calibrator")
        d["imputers"] = {"source": self.imputers.source}
        return d

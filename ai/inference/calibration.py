"""inference/calibration.py — 확률 보정기 (검증 세트에서 적합, 아티팩트에 모델과 함께 저장)

둘 다 .predict(p_raw) -> p_calibrated 인터페이스만 가진다 (ModelBundle.calibrate 가 부른다).
- PlattCalibrator: sigmoid(a·logit(p) + b). 매개변수 2개라 안정적이고 단조 증가가 보장된다 (기본값).
- IsotonicCalibrator: 비모수 단조 회귀. 유연하지만 계단형이라 risk_index 가 구간에서 멈출 수 있다.
"""
from __future__ import annotations

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

EPS = 1e-6


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.asarray(z, dtype=float)))


class PlattCalibrator:
    kind = "platt"

    def __init__(self) -> None:
        self.a, self.b = 1.0, 0.0

    def fit(self, p_raw: np.ndarray, y: np.ndarray) -> "PlattCalibrator":
        lr = LogisticRegression(C=np.inf, max_iter=1000).fit(logit(p_raw).reshape(-1, 1), np.asarray(y).astype(int))
        self.a, self.b = float(lr.coef_[0][0]), float(lr.intercept_[0])
        return self

    def predict(self, p_raw: np.ndarray) -> np.ndarray:
        return sigmoid(self.a * logit(p_raw) + self.b)

    def describe(self) -> dict:
        return {"kind": self.kind, "a": round(self.a, 4), "b": round(self.b, 4)}


class IsotonicCalibrator:
    kind = "isotonic"

    def __init__(self) -> None:
        self.iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip", increasing=True)

    def fit(self, p_raw: np.ndarray, y: np.ndarray) -> "IsotonicCalibrator":
        self.iso.fit(np.asarray(p_raw, dtype=float), np.asarray(y).astype(float))
        return self

    def predict(self, p_raw: np.ndarray) -> np.ndarray:
        return self.iso.predict(np.asarray(p_raw, dtype=float))

    def describe(self) -> dict:
        return {"kind": self.kind, "n_thresholds": int(len(self.iso.X_thresholds_))}


def make_calibrator(kind: str):
    if kind == "platt":
        return PlattCalibrator()
    if kind == "isotonic":
        return IsotonicCalibrator()
    raise ValueError(f"unknown calibrator: {kind}")

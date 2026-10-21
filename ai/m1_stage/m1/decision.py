"""
[파일] m1/decision.py
[용도] 단계 판정 규칙의 유일한 정의 위치. 4단계 확률 → 단계 인덱스. stage_top, risk_level, 평가 지표(정확도·혼동행렬), 배치 step 열이 모두 이 함수를 쓴다.
      규칙: argmax(최대 확률) | cumulative(누적 확률 임계값: P(≥elevated)≥τ1, P(≥prehtn)≥τ2, P(≥htn)≥τ3 중 넘는 가장 높은 단계).
      τ 는 모델마다 검증 분할에서 fit_thresholds 로 고른다(목적: accuracy = 전체 정확도 최대, balanced = 단계별 재현율 평균 최대).
[왜 필요한가] 규칙을 바꿀 때 추론과 평가가 함께 바뀌어야 정확도 비교가 맞다. 사용자 결정(2026-10-20): 누적 임계값 규칙(2번)을 시험.
[쓰는 곳] m1/predict.py, m1/evaluate.py, train.py
"""

from __future__ import annotations

import itertools

import numpy as np

STAGE_RULE = "cumulative"        # argmax | cumulative  (사용자: 2번 누적 임계값 규칙 시험)
STAGE_OBJECTIVE = "accuracy"     # cumulative 규칙의 τ 선택 목적: accuracy | balanced
N_STAGES = 4
COARSE_GRID = np.round(np.arange(0.05, 0.96, 0.05), 3)
FINE_STEP = 0.01


def cumulative(P: np.ndarray) -> np.ndarray:
    P = np.asarray(P, dtype=float)
    return np.column_stack([P[..., 1:].sum(axis=-1), P[..., 2:].sum(axis=-1), P[..., 3]])


def _apply(Q: np.ndarray, tau) -> np.ndarray:
    s = (Q[:, 0] >= tau[0]).astype(int)
    s = np.where(Q[:, 1] >= tau[1], 2, s)
    return np.where(Q[:, 2] >= tau[2], 3, s)


def decide_stage(P: np.ndarray, thresholds: dict | None = None) -> np.ndarray:
    """(n,4) 또는 (4,) 단계 확률 → 단계 인덱스. thresholds = {"accuracy": [τ1,τ2,τ3], "balanced": [...]} (모델 메타)."""
    P = np.asarray(P, dtype=float)
    single = P.ndim == 1
    P2 = P[None, :] if single else P
    if STAGE_RULE == "argmax" or not thresholds or STAGE_OBJECTIVE not in thresholds:
        s = P2.argmax(axis=1)
    else:
        s = _apply(cumulative(P2), thresholds[STAGE_OBJECTIVE])
    return s[0] if single else s


def _score(s: np.ndarray, y: np.ndarray, objective: str) -> float:
    if objective == "accuracy":
        return float((s == y).mean())
    recalls = [((s == k) & (y == k)).sum() / max((y == k).sum(), 1) for k in range(N_STAGES)]
    return float(np.mean(recalls))


def fit_thresholds(P_val: np.ndarray, y_val: np.ndarray) -> dict:
    """검증 분할에서 목적함수별 τ 격자 탐색(0.05 간격) 후 0.01 간격으로 국소 정밀화. 결과: {목적: [τ1,τ2,τ3]} + 검증 점수."""
    Q, y = cumulative(P_val), np.asarray(y_val).astype(int)
    out = {}
    for objective in ("accuracy", "balanced"):
        best, best_tau = -1.0, None
        for tau in itertools.product(COARSE_GRID, repeat=3):
            sc = _score(_apply(Q, tau), y, objective)
            if sc > best:
                best, best_tau = sc, tau
        fine = [np.round(np.arange(t - 0.04, t + 0.041, FINE_STEP), 3) for t in best_tau]
        for tau in itertools.product(*fine):
            if min(tau) <= 0 or max(tau) >= 1:
                continue
            sc = _score(_apply(Q, tau), y, objective)
            if sc > best:
                best, best_tau = sc, tau
        out[objective] = [float(t) for t in best_tau]
        out[f"val_{objective}_score"] = best
    return out

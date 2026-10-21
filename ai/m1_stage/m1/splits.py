"""
[파일] m1/splits.py
[용도] 학습/검증/테스트 분할. 시간 컬럼이 있으면 과거 학습·중간 검증·최근 테스트, 없으면 라벨 층화 무작위 70/15/15.
[왜 필요한가] 명세 2-4 의 분할 규칙이다. 검증 집합은 L2·조기 종료·Platt 보정에, 테스트 집합은 최종 지표에만 써야 하므로
             분할을 한 함수에서 seed 고정으로 만들어 조합 12개가 같은 분할을 공유하게 한다.
[쓰는 곳] train.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split


def make_splits(
    y: np.ndarray,
    time: pd.Series | np.ndarray | None = None,
    ratios: tuple[float, float, float] = (0.70, 0.15, 0.15),
    seed: int = 42,
) -> tuple[dict[str, np.ndarray], dict]:
    y = np.asarray(y)
    n = len(y)
    if abs(sum(ratios) - 1.0) > 1e-9:
        raise ValueError("ratios 합은 1")
    idx = np.arange(n)
    if time is not None:
        t = pd.to_numeric(pd.Series(np.asarray(time)), errors="coerce")
        if t.isna().any():
            raise ValueError("시간 컬럼에 숫자로 변환되지 않는 값이 있음")
        order = np.argsort(t.to_numpy(), kind="stable")
        n_tr = int(round(n * ratios[0]))
        n_va = int(round(n * ratios[1]))
        tr, va, te = order[:n_tr], order[n_tr : n_tr + n_va], order[n_tr + n_va :]
        method = "time_order"
    elif ratios[2] == 0:
        tr, va = train_test_split(idx, test_size=ratios[1], stratify=y, random_state=seed)
        te = np.array([], dtype=int)
        method = "stratified_random"
    else:
        tr, rest = train_test_split(idx, test_size=ratios[1] + ratios[2], stratify=y, random_state=seed)
        va_share = ratios[1] / (ratios[1] + ratios[2])
        va, te = train_test_split(rest, test_size=1 - va_share, stratify=y[rest], random_state=seed)
        method = "stratified_random"
    splits = {"train": np.sort(tr), "val": np.sort(va), "test": np.sort(te)}
    info = {"method": method, "ratios": list(ratios), "sizes": {k: int(len(v)) for k, v in splits.items()}}
    return splits, info

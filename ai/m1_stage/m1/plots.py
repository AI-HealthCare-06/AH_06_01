"""
[파일] m1/plots.py
[용도] 보정 곡선(신뢰도 다이어그램) PNG 생성. 임계값 3개 패널에 검증 집합과 테스트 집합을 같은 축에 그린다.
[왜 필요한가] 명세 2-5 "보정 곡선 그림"과 "검증 보정 곡선과 테스트 결과 비교" 항목이다. 기울기·ECE 숫자만으로는 어느 확률 구간에서
             과대·과소 추정이 나는지 보이지 않으므로 그림을 조합마다 남긴다.
[쓰는 곳] train.py
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

import thresholds as T  # noqa: E402
from .evaluate import reliability_table  # noqa: E402
from .models.calibration import cumulative_probs  # noqa: E402

# dataviz 참조 팔레트 (라이트 서피스): 계열 1 파랑 = 검증, 계열 2 주황 = 테스트
COLORS = {"val": "#2a78d6", "test": "#eb6834"}
TEXT = "#0b0b0b"
MUTED = "#52514e"
GRID = "#e4e3df"
SURFACE = "#fcfcfb"
THRESHOLD_TITLES = {"ge_elevated": "P(stage >= elevated)", "ge_130_80": "P(>= 130/80)", "ge_140_90": "P(>= 140/90)"}


def plot_reliability(curves: dict[str, tuple[np.ndarray, np.ndarray]], title: str, path: Path | str) -> None:
    """curves: {"val": (y, P), "test": (y, P)}. 임계값별 패널."""
    names = list(T.CUMULATIVE_THRESHOLDS)
    fig, axes = plt.subplots(1, len(names), figsize=(4.2 * len(names), 4.2), facecolor=SURFACE)
    for ax, name in zip(np.atleast_1d(axes), names):
        k = T.CUMULATIVE_THRESHOLDS[name]
        ax.set_facecolor(SURFACE)
        ax.plot([0, 1], [0, 1], color=MUTED, linewidth=1, linestyle="--", label="ideal")
        for split, (y, P) in curves.items():
            q = cumulative_probs(P)[:, k - 1]
            yb = (np.asarray(y).astype(int) >= k).astype(float)
            tab = reliability_table(yb, q).dropna(subset=["mean_pred"])
            ax.plot(tab["mean_pred"], tab["frac_pos"], color=COLORS.get(split, TEXT), linewidth=1.5, marker="o",
                    markersize=6, label=f"{split} (n={len(yb)})")
        ax.set_title(THRESHOLD_TITLES.get(name, name), color=TEXT, fontsize=10)
        ax.set_xlabel("Predicted probability", color=MUTED, fontsize=9)
        ax.set_ylabel("Observed fraction", color=MUTED, fontsize=9)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.grid(color=GRID, linewidth=0.6)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color(GRID)
        ax.tick_params(colors=MUTED, labelsize=8)
        ax.legend(frameon=False, fontsize=8, loc="upper left")
    fig.suptitle(title, color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)

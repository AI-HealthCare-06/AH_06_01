"""Optional static research figure from reviewed aggregate evidence only.

Requires matplotlib, not an inference dependency. No patient rows are read.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, default=Path(".cache/bp-forecast-design/results.json")
    )
    parser.add_argument(
        "--out", type=Path, default=Path(".cache/bp-forecast-design/baseline-mae.png")
    )
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    assert data["subjects"] == 1 and not data["clinical_performance_claim"]
    metrics = data["weekly"]
    labels = {
        "last_daily": "최근 일평균",
        "mean_7d": "7일 평균",
        "median_7d": "7일 중앙값",
        "mean_28d": "28일 평균",
        "ewma_7d": "날짜 가중 평균",
        "damped_trend_28d": "감쇠 추세",
    }
    plt.rcParams.update(
        {"font.family": "Malgun Gothic", "font.size": 11, "axes.unicode_minus": False}
    )
    fig, ax = plt.subplots(figsize=(11, 5.8))
    fig.patch.set_facecolor("white")
    positions = list(range(len(metrics)))
    for offset, measure, label, color, hatch in (
        (-0.18, "systolic", "수축기", "#35576b", None),
        (0.18, "diastolic", "이완기", "#d1ae55", "//"),
    ):
        values = [m[measure]["mae_mmHg"] for m in metrics.values()]
        ax.barh(
            [p + offset for p in positions],
            values,
            height=0.30,
            label=label,
            color=color,
            edgecolor="#334137",
            linewidth=0.5,
            hatch=hatch,
        )
        for p, v in zip(positions, values):
            ax.text(
                v + 0.05,
                p + offset,
                f"{v:.3f}",
                va="center",
                fontsize=10,
                color="#203b32",
            )
    ax.set_yticks(positions, [labels[k] for k in metrics])
    ax.invert_yaxis()
    ax.set_xlim(0, 4.1)
    ax.set_xticks([0, 1, 2, 3, 4])
    ax.set_xlabel("미래 7일 기록일 평균의 MAE (mmHg)", labelpad=10)
    ax.grid(axis="x", alpha=0.2)
    ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, loc="lower right", bbox_to_anchor=(1, 1.01), ncols=2)
    fig.suptitle(
        "합성 시연 데이터의 대조군 오차",
        x=0.05,
        y=0.97,
        ha="left",
        fontsize=18,
        fontweight="bold",
        color="#203b32",
    )
    fig.text(
        0.05, 0.90, "1명 · 90일 · 주간 기점 8개 · 임상 성능 검증 아님", color="#5e604f"
    )
    fig.text(
        0.05,
        0.025,
        "대상 창은 겹치지 않지만 같은 사람의 입력 창은 겹침. 독립 환자 성능·오탐 감소·예측 범위 검증으로 해석하지 않음.",
        fontsize=9,
        color="#5e604f",
    )
    fig.subplots_adjust(left=0.17, right=0.96, top=0.84, bottom=0.16)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.out, dpi=160, facecolor="white")
    plt.close(fig)
    print(args.out)


if __name__ == "__main__":
    main()

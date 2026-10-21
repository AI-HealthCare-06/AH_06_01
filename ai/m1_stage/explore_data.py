"""
[파일] explore_data.py
[용도] 학습 데이터 탐색 그림·표. 단계별로 겹친 변수 히스토그램, 범주형 변수의 단계 구성비, 변수 간 Spearman 상관 행렬, 연령대×성별·BMI 구간별 단계 구성비를
      reports/explore_<시각>/ 에 PNG 와 summary.md 로 만든다(학습 안 함).
[왜 필요한가] 단계 결정 규칙을 손보기 전에 어떤 변수가 단계와 함께 움직이는지, 단계 간 분포가 얼마나 겹치는지를 눈으로 확인하기 위해서다.
             라벨 규칙·범위·대치는 학습과 같은 함수(m1.pipeline.load_labeled, Preprocessor)를 쓴다.
[쓰는 곳] 사용자가 직접 실행.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

import thresholds as T  # noqa: E402
from m1.contract import Contract  # noqa: E402
from m1.evaluate import age_groups  # noqa: E402
from m1.features import VALID_STATUSES, Preprocessor  # noqa: E402
from m1.pipeline import load_labeled  # noqa: E402
from m1.report import md_table  # noqa: E402

# dataviz 참조 팔레트. 단계는 순서형이므로 파랑 한 계열의 단계(250/350/450/600). 상관 행렬은 파랑↔빨강 발산, 중간 회색.
STAGE_COLORS = ["#86b6ef", "#5598e7", "#2a78d6", "#184f95"]
DIVERGING = LinearSegmentedColormap.from_list("m1_div", ["#e34948", "#f0efec", "#2a78d6"])
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
CONTINUOUS = ["age", "bmi", "waist_cm", "alcohol_week", "activity_minutes_week", "fasting_glucose", "resting_hr", "education_years", "__sbp", "__dbp"]
CATEGORICAL = ["sex", "alcohol_per_day", "binge", "activity_low_flag", "family_htn", "sleep_short_flag", "diabetes_flag"]
LABELS = {"__sbp": "sbp (label only)", "__dbp": "dbp (label only)"}
N_BINS = 30


def _style(ax, title: str) -> None:
    ax.set_facecolor(SURFACE)
    ax.set_title(title, color=TEXT, fontsize=10)
    ax.grid(color=GRID, linewidth=0.6)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8)


def fig_histograms(df: pd.DataFrame, path: Path) -> None:
    cols = [c for c in CONTINUOUS if c in df.columns and df[c].notna().any()]
    n = len(cols)
    fig, axes = plt.subplots(2, (n + 1) // 2, figsize=(3.6 * ((n + 1) // 2), 6.4), facecolor=SURFACE)
    for ax, col in zip(axes.ravel(), cols):
        v = df[col].dropna()
        bins = np.linspace(v.quantile(0.005), v.quantile(0.995), N_BINS + 1)
        for k, s in enumerate(T.STAGES):
            ax.hist(df.loc[df["stage"] == s, col].dropna(), bins=bins, density=True, histtype="step", linewidth=1.5, color=STAGE_COLORS[k], label=s)
        _style(ax, LABELS.get(col, col))
        ax.set_ylabel("density", color=MUTED, fontsize=8)
    for ax in axes.ravel()[n:]:
        ax.set_visible(False)
    axes.ravel()[0].legend(frameon=False, fontsize=8)
    fig.suptitle("Distribution by stage (density, train rows used for training)", color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def _stacked_share(ax, table: pd.DataFrame, title: str) -> None:
    """table: index = 범주, columns = 단계(순서), 값 = 구성비. 100% 누적 가로막대, 2px 흰 간격."""
    left = np.zeros(len(table))
    for k, s in enumerate(T.STAGES):
        vals = table[s].to_numpy()
        ax.barh(table.index.astype(str), vals, left=left, color=STAGE_COLORS[k], edgecolor=SURFACE, linewidth=1.5, label=s)
        for i, (l, v) in enumerate(zip(left, vals)):
            if v >= 0.08:
                ax.text(l + v / 2, i, f"{v:.0%}", ha="center", va="center", fontsize=7, color=SURFACE if k >= 2 else TEXT)
        left += vals
    _style(ax, title)
    ax.set_xlim(0, 1)
    ax.set_xlabel("share of rows", color=MUTED, fontsize=8)
    ax.grid(False)


def share_table(df: pd.DataFrame, by: str) -> pd.DataFrame:
    t = pd.crosstab(df[by], df["stage"], normalize="index").reindex(columns=list(T.STAGES), fill_value=0.0)
    t["n"] = df[by].value_counts().reindex(t.index).to_numpy()
    return t


def fig_categorical(df: pd.DataFrame, path: Path) -> None:
    cols = [c for c in CATEGORICAL if c in df.columns and df[c].notna().any()]
    fig, axes = plt.subplots(2, (len(cols) + 1) // 2, figsize=(3.8 * ((len(cols) + 1) // 2), 6.0), facecolor=SURFACE)
    for ax, col in zip(axes.ravel(), cols):
        _stacked_share(ax, share_table(df, col).drop(columns="n"), col)
    for ax in axes.ravel()[len(cols):]:
        ax.set_visible(False)
    handles, labels = axes.ravel()[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=8, loc="lower center", ncol=4)
    fig.suptitle("Stage share within each category", color=TEXT, fontsize=11)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_groups(df: pd.DataFrame, path: Path) -> dict[str, pd.DataFrame]:
    g = df.assign(age_group=age_groups(df["age"].to_numpy()), bmi_class=pd.cut(df["bmi"], [-np.inf, *T.BMI_BINS, np.inf], right=False).astype(str))
    g["sex_age"] = g["sex"] + " " + g["age_group"]
    tables = {"sex_age": share_table(g, "sex_age"), "bmi_class": share_table(g, "bmi_class")}
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), facecolor=SURFACE)
    _stacked_share(axes[0], tables["sex_age"].drop(columns="n"), "sex x age group")
    _stacked_share(axes[1], tables["bmi_class"].drop(columns="n"), f"BMI class (cuts {T.BMI_BINS})")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=8, loc="lower center", ncol=4)
    fig.suptitle("Stage share by age/sex and BMI", color=TEXT, fontsize=11)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return tables


def fig_correlation(df: pd.DataFrame, path: Path) -> pd.DataFrame:
    cols = [c for c in CONTINUOUS + ["male", "stage_index"] if c in df.columns]
    corr = df[cols].corr(method="spearman")
    names = [LABELS.get(c, c) for c in cols]
    fig, ax = plt.subplots(figsize=(0.62 * len(cols) + 2, 0.62 * len(cols) + 1.5), facecolor=SURFACE)
    im = ax.imshow(corr.to_numpy(), cmap=DIVERGING, vmin=-1, vmax=1)
    ax.set_xticks(range(len(cols)), names, rotation=45, ha="right", fontsize=8, color=MUTED)
    ax.set_yticks(range(len(cols)), names, fontsize=8, color=MUTED)
    for i in range(len(cols)):
        for j in range(len(cols)):
            v = corr.iat[i, j]
            ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=7, color=SURFACE if abs(v) > 0.55 else TEXT)
    ax.set_title("Spearman correlation (train rows)", color=TEXT, fontsize=10)
    cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cb.ax.tick_params(labelsize=7, colors=MUTED)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return corr


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="학습 데이터 탐색: 단계별 히스토그램·범주 구성비·상관 행렬")
    ap.add_argument("--data", required=True)
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    contract = Contract.load()
    spec, y, load_info, label_info = load_labeled(a.data, contract, sheet=int(a.sheet) if str(a.sheet).isdigit() else a.sheet, max_rows=a.max_rows, assume_no_med=a.assume_no_med)
    res = Preprocessor(contract).fit(spec).transform(spec)
    keep = res.status.isin(VALID_STATUSES).to_numpy()
    df = spec[keep].reset_index(drop=True).copy()
    df["stage_index"] = y[keep]
    df["stage"] = [T.STAGES[i] for i in y[keep]]
    df["male"] = (df["sex"] == "male").astype(float)
    out = Path(a.out) / f"explore_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)

    fig_histograms(df, out / "hist_by_stage.png")
    fig_categorical(df, out / "stage_share_by_category.png")
    tables = fig_groups(df, out / "stage_share_by_group.png")
    corr = fig_correlation(df, out / "correlation.png")

    L = [f"# 학습 데이터 탐색 — {out.name}\n",
         f"- 데이터 `{load_info['path']}` {load_info['rows_loaded']}행 → 라벨 {label_info['rows_labeled']}행 → 범위·결측 검증 통과 {len(df)}행 (학습에 쓰이는 행과 같은 규칙)",
         f"- 단계 분포: " + ", ".join(f"{s} {int((df['stage'] == s).sum())} ({(df['stage'] == s).mean():.1%})" for s in T.STAGES),
         "- 그림: `hist_by_stage.png`(연속 변수 단계별 밀도), `stage_share_by_category.png`(범주별 단계 구성비), `stage_share_by_group.png`(연령대×성별·BMI), `correlation.png`(Spearman)\n",
         "## 1. 단계별 연속 변수 중앙값\n"]
    cont = [c for c in CONTINUOUS if c in df.columns]
    med = df.groupby("stage")[cont].median().reindex(list(T.STAGES)).rename(columns=LABELS).reset_index()
    L.append(md_table(med, nd=1))
    L.append("\n## 2. 범주별 단계 구성비 (행 비율)\n")
    for col in [c for c in CATEGORICAL if c in df.columns]:
        L.append(f"### {col}\n\n" + md_table(share_table(df, col).reset_index().rename(columns={"index": col}), nd=3) + "\n")
    L.append("## 3. 연령대×성별, BMI 구간별 단계 구성비\n")
    for name, t in tables.items():
        L.append(f"### {name}\n\n" + md_table(t.reset_index(), nd=3) + "\n")
    L.append("## 4. 단계 인덱스(0~3)와의 Spearman 상관 (절대값 순)\n")
    c = corr["stage_index"].drop("stage_index").rename(index=LABELS)
    L.append(md_table(c.reindex(c.abs().sort_values(ascending=False).index).reset_index().rename(columns={"index": "variable", "stage_index": "spearman_with_stage"}), nd=3))
    L.append("\n__sbp/__dbp 는 라벨을 만든 측정 혈압이며 피처가 아니다. 상관은 선형·단조 관계의 세기만 보여주고 인과를 뜻하지 않는다.\n")
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"완료: {out}/ (그림 4개, summary.md)")
    return out


if __name__ == "__main__":
    main()

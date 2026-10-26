"""
[파일] feature_importance.py
[용도] 변수별 전체 기여도. 내부 테스트 분할에서 행별 로짓 기여도(선형: 계수×표준화값, LightGBM: SHAP, 누적 이진 3개 합)를 모아
      변수마다 평균 절대 기여도(영향 크기)·평균 기여도(방향)·전체 대비 비중을 모델별로 계산하고, 이유 코드 단위로도 묶는다. 그림 1장 + md + csv(features_*.csv, groups_*.csv).
[왜 필요한가] 사용자 요청(2026-10-20): 어떤 변수가 단계 확률 계산에 가장 크게 기여하는지 전체 수준에서 보기 위해서.
[쓰는 곳] 사용자가 직접 실행. 결과 reports/feature_importance_<시각>/
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

from m1.contract import Contract  # noqa: E402
from m1.features import Preprocessor  # noqa: E402
from m1.pipeline import filter_valid, input_columns, load_labeled, resolve_run, stage_combos  # noqa: E402
from m1.predict import M1Predictor  # noqa: E402
from m1.reasons import CODE_FEATURES  # noqa: E402
from m1.report import md_table  # noqa: E402
from m1.splits import make_splits  # noqa: E402

COLORS = {"ordinal__base": "#2a78d6", "nested__base": "#eb6834", "lgbm__base": "#1baf7a"}   # dataviz 참조 팔레트 1~3
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
TOP_N = 14


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--time-col", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--run", default=None)
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    contract = Contract.load()
    run_dir = Path(a.artifacts) / resolve_run(a.artifacts, a.run)
    spec, y, _, _ = load_labeled(a.data, contract, seed=a.seed, assume_no_med=a.assume_no_med)
    spec, y, _, _ = filter_valid(Preprocessor(contract).fit(spec), spec, y)
    splits, _ = make_splits(y, spec[a.time_col.strip().lower()] if a.time_col else None, seed=a.seed)
    df = spec.iloc[splits["test"]].reset_index(drop=True)
    out = Path(a.out) / f"feature_importance_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)

    tables, groups = {}, {}
    for combo in stage_combos(run_dir):
        pr = M1Predictor.load(run_dir / combo, contract)
        res = pr.pre.transform(df[input_columns(pr.pre, df)])
        C = pd.DataFrame(pr.model.contributions(res.X), columns=pr.model.columns)
        t = pd.DataFrame({"mean_abs": C.abs().mean(), "mean": C.mean(), "std": C.std(), "share": C.abs().mean() / C.abs().mean().sum()})
        if hasattr(pr.model, "beta"):
            t["coef"] = pd.Series(pr.model.beta, index=pr.model.columns)
        elif hasattr(pr.model, "betas"):
            t["coef_mean3"] = pd.Series(np.mean(pr.model.betas, axis=0), index=pr.model.columns)
        else:
            imp = sum(np.asarray(m.booster_.feature_importance("gain")) for m in pr.model.models if hasattr(m, "booster_"))
            t["gain_share"] = pd.Series(imp / imp.sum(), index=pr.model.columns)
        tables[combo] = t.sort_values("mean_abs", ascending=False)
        g = {code: C[[f for f in feats if f in C.columns]].sum(axis=1) for code, feats in CODE_FEATURES.items()}
        g["sex(male)"] = C["male"]
        gd = pd.DataFrame(g)
        groups[combo] = pd.DataFrame({"mean_abs": gd.abs().mean(), "mean": gd.mean(), "share": gd.abs().mean() / gd.abs().mean().sum()}).sort_values("mean_abs", ascending=False)

    # 그림: 모델별 평균 절대 기여도 상위 TOP_N (가로 막대, 소형 다중)
    fig, axes = plt.subplots(1, len(tables), figsize=(4.6 * len(tables), 5.2), facecolor=SURFACE, sharex=False)
    for ax, (combo, t) in zip(np.atleast_1d(axes), tables.items()):
        top = t.head(TOP_N).iloc[::-1]
        ax.barh(top.index, top["mean_abs"], color=COLORS.get(combo, TEXT), edgecolor=SURFACE, linewidth=1)
        for i, (name, v) in enumerate(zip(top.index, top["mean_abs"])):
            ax.text(v, i, f" {v:.2f}", va="center", fontsize=7, color=MUTED)
        ax.set_facecolor(SURFACE)
        ax.set_title(combo, color=TEXT, fontsize=10)
        ax.set_xlabel("mean |contribution| (logit)", color=MUTED, fontsize=8)
        ax.tick_params(colors=MUTED, labelsize=8)
        ax.grid(axis="x", color=GRID, linewidth=0.6)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color(GRID)
    fig.suptitle("Global contribution by feature (internal test split)", color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(out / "feature_importance.png", dpi=130)
    plt.close(fig)

    L = [f"# 변수별 전체 기여도 — {out.name}\n", f"- 모델 {run_dir}, 내부 테스트 분할 {len(df)}행. 기여도는 로짓 척도(선형: 계수×표준화값, LightGBM: SHAP, nested·lgbm 은 이진 3개 합).",
         "- mean_abs = 평균 절대 기여도(영향 크기), mean = 평균 기여도(양수면 평균적으로 확률을 올림), share = 전체 절대 기여도 중 비중\n"]
    for combo, t in tables.items():
        t.to_csv(out / f"features_{combo}.csv")
        groups[combo].to_csv(out / f"groups_{combo}.csv")
        L.append(f"## {combo} — 변수\n\n" + md_table(t.reset_index().rename(columns={"index": "feature"}), nd=3) + "\n")
        L.append(f"## {combo} — 이유 코드 묶음\n\n" + md_table(groups[combo].reset_index().rename(columns={"index": "code"}), nd=3) + "\n")
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"완료: {out}/summary.md, feature_importance.png")
    return out


if __name__ == "__main__":
    main()

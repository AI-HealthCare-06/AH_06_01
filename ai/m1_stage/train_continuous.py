"""
[파일] train_continuous.py
[용도] M1-C(연속형 혈압 분포 모델, m1/continuous.py) 학습·평가 CLI. train.py 와 같은 로드·라벨·행 검증·시간 분할·완전한 행 규칙을 쓰되 목표는 단계가 아니라
      측정 sbp·dbp 다. 학습자 2종(linear, lgbm)을 학습하고 테스트 분할에서 ① 4단계 확률 지표(기존 평가 함수 그대로: AUROC·보정·정확도·하위군·판정 규칙 비교),
      ② 회귀 지표(RMSE·R²·편향), ③ 분포 보정(PIT 피복률, 혈압 구간 확률 vs 실제 비율, 단계 비율), ④ 입력별 영향(선형 계수: 나이·성별 상호작용 포함,
      LightGBM gain)을 내고, 같은 테스트 행에서 기존 후보(artifacts/LATEST 의 ordinal/nested/lgbm)와 나란히 비교한다.
      결과 reports/continuous_<run>/(summary.md, results.xlsx, calibration.png), 산출물 artifacts/continuous_<run>/.
[왜 필요한가] 사용자 결정(2026-10-23): 입력 확장(나이·성별×변수), 음주 0 분리·15잔 상한, 단계 라벨 대신 연속형 혈압 학습. 기존 후보와 같은 잣대로 비교하기 위해.
[주의] 단건 추론 경로(fast_path)·배치 추론 CLI 는 아직 없다(실험 단계). mmHg 는 내부 중간값이며 제품 출력이 아니다(명세 2-1).
[쓰는 곳] python3 train_continuous.py --data train/ --time-col exam_year --assume-no-med
"""

from __future__ import annotations

import argparse
import json
import pickle
import time
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from openpyxl.styles import Alignment  # noqa: E402

_KO_FONTS = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO_FONTS:
    plt.rcParams["font.family"] = _KO_FONTS[0]
plt.rcParams["axes.unicode_minus"] = False
from scipy.stats import norm  # noqa: E402

import thresholds as T  # noqa: E402
from analysis_pack import style  # noqa: E402
from m1 import decision as D  # noqa: E402
from m1.continuous import DBP_CUTS, SBP_CUTS, ContinuousBP, Dist, FeatureExpander, dispersion_groups, interval_bins, interval_probs, stage_probs  # noqa: E402
from m1.contract import Contract  # noqa: E402
from m1.evaluate import evaluate_split, reliability_table, stage_metrics  # noqa: E402
from m1.features import STATUS_OK, Preprocessor  # noqa: E402
from m1.pipeline import filter_valid, input_columns, load_labeled, log, resolve_run, stage_combos  # noqa: E402
from m1.predict import M1Predictor  # noqa: E402
from m1.report import md_table  # noqa: E402
from m1.splits import make_splits  # noqa: E402

COMPARE_KEYS = [("auroc_ge_140_90", "AUROC ≥140/90"), ("auroc_ge_130_80", "AUROC ≥130/80"), ("auprc_ge_140_90", "AUPRC ≥140/90"),
                ("cal_slope_ge_140_90", "보정 기울기 ≥140/90"), ("cal_intercept_ge_140_90", "보정 절편 ≥140/90"), ("ece_ge_140_90", "ECE ≥140/90"),
                ("ece_top", "ECE(top)"), ("accuracy", "정확도"), ("adjacent_accuracy", "인접 정확도"), ("balanced_accuracy", "균형 정확도"),
                ("recall_normal", "재현 normal"), ("recall_elevated", "재현 elevated"), ("recall_prehtn", "재현 prehtn"), ("recall_htn", "재현 htn"),
                ("sex_ece_gap_ge_140_90", "성별 ECE 차 ≥140/90")]
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#8e6cc9", "#c9a227", "#52514e"]


def rule_table(y: np.ndarray, P: np.ndarray, thresholds: dict) -> pd.DataFrame:
    """train.py 와 같은 판정 규칙 비교(argmax / cumulative-accuracy / cumulative-balanced)."""
    rows, saved = [], (D.STAGE_RULE, D.STAGE_OBJECTIVE)
    for rule, obj in (("argmax", "accuracy"), ("cumulative", "accuracy"), ("cumulative", "balanced")):
        D.STAGE_RULE, D.STAGE_OBJECTIVE = rule, obj
        m, _ = stage_metrics(y, P, thresholds)
        rows.append({"rule": rule if rule == "argmax" else f"{rule}/{obj}", "tau": "-" if rule == "argmax" else str([round(t, 2) for t in thresholds[obj]]),
                     **{k: m[k] for k in ("accuracy", "adjacent_accuracy", "balanced_accuracy") + tuple(f"recall_{s}" for s in T.STAGES)}})
    D.STAGE_RULE, D.STAGE_OBJECTIVE = saved
    return pd.DataFrame(rows)


def regression_table(d: Dist, sbp: np.ndarray, dbp: np.ndarray, fit_info: dict) -> pd.DataFrame:
    rows = []
    for name, mu, sig, yv in (("sbp", d.mu_s, d.sig_s, sbp), ("dbp", d.mu_d, d.sig_d, dbp)):
        e = yv - mu
        pit = norm.cdf(e / sig)
        rows.append({"target": name, "val_rmse": fit_info[name].get("val_rmse"), "test_rmse": float(np.sqrt((e ** 2).mean())), "test_mae": float(np.abs(e).mean()),
                     "test_bias(pred-actual)": float(-e.mean()), "test_r2": float(1 - (e ** 2).sum() / ((yv - yv.mean()) ** 2).sum()),
                     "coverage_50": float((np.abs(pit - 0.5) < 0.25).mean()), "coverage_90": float((np.abs(pit - 0.5) < 0.45).mean()), "mean_sigma": float(sig.mean()),
                     **{k: v for k, v in fit_info[name].items() if k != "val_rmse"}})
    return pd.DataFrame(rows)


def interval_table(d: Dist, sbp: np.ndarray, dbp: np.ndarray) -> pd.DataFrame:
    ip = interval_probs(d)
    rows = []
    for name, cuts, yv in (("sbp", SBP_CUTS, sbp), ("dbp", DBP_CUTS, dbp)):
        for col, lo, hi in interval_bins(name, cuts):
            rows.append({"구간": col, "예측 평균 확률": float(ip[col].mean()), "실제 비율": float(((yv >= lo) & (yv < hi)).mean()), "n 실제": int(((yv >= lo) & (yv < hi)).sum())})
    return pd.DataFrame(rows)


def stage_share_table(P: np.ndarray, y: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame({"stage": list(T.STAGES), "예측 평균 확률": P.mean(axis=0), "실제 비율": [float((y == k).mean()) for k in range(len(T.STAGES))]})


def fig_calibration(results: dict, y: np.ndarray, first: str, sbp: np.ndarray, dbp: np.ndarray, path: Path) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.3), facecolor=SURFACE)
    ax = axes[0]
    for i, (name, r) in enumerate(results.items()):
        rt = reliability_table(y >= 3, r["P"][:, 3])
        ax.plot(rt["mean_pred"], rt["frac_pos"], marker="o", markersize=3, linewidth=1.4, color=COLORS[i % len(COLORS)], label=name)
    ax.plot([0, 1], [0, 1], color=GRID, linewidth=1)
    ax.set_xlabel("predicted P(≥140/90)", color=MUTED, fontsize=8); ax.set_ylabel("observed", color=MUTED, fontsize=8)
    ax.legend(frameon=False, fontsize=7); ax.set_title("Reliability P(≥140/90), test", color=TEXT, fontsize=10)
    ax = axes[1]
    d = results[first]["dist"]
    for mu, sig, yv, lab, c in ((d.mu_s, d.sig_s, sbp, "sbp", COLORS[0]), (d.mu_d, d.sig_d, dbp, "dbp", COLORS[1])):
        ax.hist(norm.cdf((yv - mu) / sig), bins=20, range=(0, 1), density=True, histtype="step", linewidth=1.6, color=c, label=lab)
    ax.axhline(1.0, color=GRID, linewidth=1)
    ax.set_title(f"PIT histogram ({first}); flat = calibrated", color=TEXT, fontsize=10); ax.legend(frameon=False, fontsize=8)
    ax = axes[2]
    it = results[first]["intervals"]
    x = np.arange(len(it))
    ax.bar(x - 0.2, it["예측 평균 확률"], width=0.4, color=COLORS[0], label="predicted")
    ax.bar(x + 0.2, it["실제 비율"], width=0.4, color=COLORS[2], label="observed")
    ax.set_xticks(x, [c.replace("sbp_", "S ").replace("dbp_", "D ") for c in it["구간"]], rotation=35, ha="right", fontsize=7)
    ax.set_title(f"Interval probability vs observed share ({first})", color=TEXT, fontsize=10); ax.legend(frameon=False, fontsize=8)
    for a in axes:
        a.set_facecolor(SURFACE); a.grid(color=GRID, linewidth=0.6); a.tick_params(colors=MUTED, labelsize=8)
        for s in ("top", "right"):
            a.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="M1-C 연속형 혈압 분포 모델 학습·평가")
    ap.add_argument("--data", required=True)
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--time-col", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--learners", default="linear,lgbm")
    ap.add_argument("--compare-run", default=None, help="비교할 기존 run (기본 artifacts/LATEST)")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--keep-imputed-rows", action="store_true")
    a = ap.parse_args(argv)
    contract = Contract.load()
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    rep, art = Path(a.out) / f"continuous_{run_id}", Path(a.artifacts) / f"continuous_{run_id}"
    rep.mkdir(parents=True, exist_ok=True)
    art.mkdir(parents=True, exist_ok=True)

    spec, y, load_info, label_info = load_labeled(a.data, contract, sheet=int(a.sheet) if str(a.sheet).isdigit() else a.sheet, max_rows=a.max_rows, seed=a.seed, assume_no_med=a.assume_no_med)
    pre0 = Preprocessor(contract).fit(spec)
    spec, y, row_status, excluded = filter_valid(pre0, spec, y)
    log(f"[1/4] 데이터 {load_info['rows_loaded']}행 → 라벨 {label_info['rows_labeled']}행 → 검증 통과 {len(y)}행 {row_status}")
    time_vals = spec[a.time_col.strip().lower()] if a.time_col else None
    splits, split_info = make_splits(y, time_vals, seed=a.seed)
    if not a.keep_imputed_rows:
        complete = (pre0.transform(spec).status == STATUS_OK).to_numpy()
        for s in ("train", "val"):
            splits[s] = splits[s][complete[splits[s]]]
    tr, va, te = splits["train"], splits["val"], splits["test"]
    sizes = {k: int(len(v)) for k, v in splits.items()}
    log(f"[2/4] 분할 {split_info['method']}: {sizes} (학습·검증은 완전한 행만)" if not a.keep_imputed_rows else f"[2/4] 분할 {sizes}")

    pre = Preprocessor(contract).fit(spec.iloc[tr])
    res = pre.transform(spec)
    ex = FeatureExpander(contract).fit(res.X.iloc[tr], res.raw.iloc[tr])
    Xe = ex.transform(res.X, res.raw)
    groups = dispersion_groups(res.raw)
    sbp, dbp = spec["__sbp"].to_numpy(float), spec["__dbp"].to_numpy(float)
    male, age = res.raw["male"].to_numpy(float), res.raw["age"].to_numpy(float)
    n_new = len(ex.columns) - len(ex.base_columns)
    log(f"       입력 {len(ex.columns)}열 = 계약 {len(ex.base_columns)} + 확장 {n_new} (drinker, age², 나이×{sum(c.startswith('age_x_') for c in ex.columns) - 1}, 성별×{sum(c.startswith('male_x_') for c in ex.columns)}); 음주 상한 {T.ALCOHOL_WEEK_CAP:g}잔/주")
    pre.save(art / "preprocessor.json")
    with open(art / "expander.pkl", "wb") as f:
        pickle.dump(ex, f)

    results: dict[str, dict] = {}
    learners = [s.strip() for s in a.learners.split(",") if s.strip()]
    for i, learner in enumerate(learners, 1):
        t0 = time.perf_counter()
        m = ContinuousBP(learner, a.seed).fit(Xe.iloc[tr], sbp[tr], dbp[tr], Xe.iloc[va], sbp[va], dbp[va], groups[va], ex.monotone())
        fit_s = time.perf_counter() - t0
        m.stage_thresholds = D.fit_thresholds(m.predict_proba(Xe.iloc[va], groups[va]), y[va])
        d_te = m.predict_dist(Xe.iloc[te], groups[te])
        P_te = stage_probs(d_te)
        ev = evaluate_split(y[te], P_te, male[te], age[te], m.stage_thresholds)
        name = f"continuous_{learner}"
        results[name] = {"metrics": ev["metrics"], "confusion": ev["confusion"], "subgroups": ev["subgroups"], "rules": rule_table(y[te], P_te, m.stage_thresholds), "P": P_te, "dist": d_te,
                         "regression": regression_table(d_te, sbp[te], dbp[te], m.fit_info), "intervals": interval_table(d_te, sbp[te], dbp[te]), "shares": stage_share_table(P_te, y[te]),
                         "coef": m.coefficients(), "disp": pd.DataFrame(m.disp).T.reset_index().rename(columns={"index": "group"}), "fit_s": fit_s}
        (art / learner).mkdir(exist_ok=True)
        m.save(art / learner / "model.pkl")
        (art / learner / "meta.json").write_text(json.dumps({"model_version": f"M1-C-{run_id}-{learner}", "feature_version": contract.version, "learner": learner, "columns": ex.columns,
                                                             "stage_thresholds": m.stage_thresholds, "fit_info": m.fit_info, "alcohol_week_cap": T.ALCOHOL_WEEK_CAP}, ensure_ascii=False, indent=2), encoding="utf-8")
        mt, rg = ev["metrics"], results[name]["regression"].set_index("target")
        log(f"[3/4] ({i}/{len(learners)}) {name}: AUROC≥140/90 {mt['auroc_ge_140_90']:.3f}, ≥130/80 {mt['auroc_ge_130_80']:.3f}, 정확도 {mt['accuracy']:.3f}, "
            f"RMSE sbp {rg.loc['sbp', 'test_rmse']:.2f} / dbp {rg.loc['dbp', 'test_rmse']:.2f}, 피복률90 {rg.loc['sbp', 'coverage_90']:.2f}/{rg.loc['dbp', 'coverage_90']:.2f}, 학습 {fit_s:.1f}s")

    run_dir = Path(a.artifacts) / resolve_run(a.artifacts, a.compare_run)
    df_te = spec.iloc[te]
    for combo in stage_combos(run_dir):
        pr = M1Predictor.load(run_dir / combo, contract)
        Pb = pr.model.predict_proba(pr.pre.transform(df_te[input_columns(pr.pre, df_te)]).X)
        ev = evaluate_split(y[te], Pb, male[te], age[te], pr.model.stage_thresholds)
        results[f"{combo} (기존)"] = {"metrics": ev["metrics"], "confusion": ev["confusion"], "subgroups": ev["subgroups"], "rules": rule_table(y[te], Pb, pr.model.stage_thresholds), "P": Pb}
    log(f"       기존 후보 비교: {run_dir.name} {stage_combos(run_dir)}")

    first = f"continuous_{learners[0]}"
    fig_calibration(results, y[te], first, sbp[te], dbp[te], rep / "calibration.png")
    write_report(rep, results, y[te], ex, sizes, split_info, load_info, run_dir, learners, a)
    log(f"[4/4] 완료: {rep}/summary.md, results.xlsx, calibration.png | 산출물 {art}")
    return rep


def write_report(rep: Path, results: dict, y_te: np.ndarray, ex: FeatureExpander, sizes: dict, split_info: dict, load_info: dict, run_dir: Path, learners: list[str], a) -> None:
    cmp = pd.DataFrame([{"model": n, **{lab: r["metrics"].get(k) for k, lab in COMPARE_KEYS}} for n, r in results.items()])
    rules = pd.concat([r["rules"].assign(model=n) for n, r in results.items()], ignore_index=True)[["model", "rule", "tau", "accuracy", "adjacent_accuracy", "balanced_accuracy", *(f"recall_{s}" for s in T.STAGES)]]
    sub = pd.concat([r["subgroups"].assign(model=n) for n, r in results.items()], ignore_index=True)
    sub_piv = sub[sub["age_group"] != "all"].pivot_table(index=["sex", "age_group"], columns="model", values="auroc_ge_140_90").reset_index()
    cont = {n: r for n, r in results.items() if "regression" in r}
    reg = pd.concat([r["regression"].assign(model=n) for n, r in cont.items()], ignore_index=True)
    reg = reg[["model", *[c for c in reg.columns if c != "model"]]]
    ints = pd.concat([r["intervals"].assign(model=n) for n, r in cont.items()], ignore_index=True)[["model", "구간", "예측 평균 확률", "실제 비율", "n 실제"]]
    shares = pd.concat([r["shares"].assign(model=n) for n, r in cont.items()], ignore_index=True)[["model", "stage", "예측 평균 확률", "실제 비율"]]
    conf = pd.concat([pd.DataFrame(r["confusion"], index=[f"actual_{s}" for s in T.STAGES], columns=[f"pred_{s}" for s in T.STAGES]).reset_index().rename(columns={"index": "actual"}).assign(model=n) for n, r in results.items()], ignore_index=True)
    coef_lin = next((r["coef"] for n, r in cont.items() if "sbp_coef" in r["coef"].columns), None)
    coef_lgb = next((r["coef"] for n, r in cont.items() if "sbp_gain_share" in r["coef"].columns), None)
    disp = next(iter(cont.values()))["disp"]

    L = [f"# M1-C 연속형 혈압 분포 모델 — {rep.name}\n",
         f"- 데이터 `{a.data}` {load_info['rows_loaded']}행, 분할 {split_info['method']} {sizes}(학습·검증은 완전한 행만, 테스트는 전체). 기존 후보 비교: `{run_dir.name}`",
         f"- 목표: 측정 sbp·dbp(연속). 평균 모델 {learners} + 집단(10세 나이대×성별)별 검증 잔차 σ·ρ → (sbp, dbp) 결합 정규 분포 → 단계·구간 확률은 분포 적분",
         f"- 입력 {len(ex.columns)}열 = 계약 {len(ex.base_columns)} + 확장 {len(ex.columns) - len(ex.base_columns)}: drinker(음주 여부), alcohol_week 는 {T.ALCOHOL_WEEK_CAP:g}잔/주 상한, age², "
         f"나이×변수 {sum(c.startswith('age_x_') for c in ex.columns) - 1}개, 성별×변수 {sum(c.startswith('male_x_') for c in ex.columns)}개. 혈압은 입력에 없음",
         "- 단조 제약: 주효과는 계약 방향 유지(LightGBM), 확장 열은 제약 없음. 선형은 릿지(λ 검증 선택), 제약 없음\n",
         "## 1. 기존 후보와 비교 (테스트 분할, 같은 행)\n", md_table(cmp, nd=3),
         "\n## 2. 판정 규칙 비교\n", md_table(rules, nd=3),
         "\n## 3. 회귀·분포 보정 (M1-C)\n", md_table(reg, nd=3),
         "\ncoverage_50/90 = 예측 분포의 중앙 50%/90% 구간에 실제 값이 들어간 비율(목표 0.50/0.90).\n",
         "### 단계 비율: 예측 평균 확률 vs 실제\n", md_table(shares, nd=3),
         "\n### 혈압 구간 확률 vs 실제 비율\n", md_table(ints, nd=3),
         "\n## 4. 하위군 AUROC ≥140/90\n", md_table(sub_piv, nd=3)]
    if coef_lin is not None:
        c = coef_lin.copy()
        c["abs_sbp"] = c["sbp_coef"].abs()
        c = c.sort_values("abs_sbp", ascending=False).drop(columns="abs_sbp").reset_index().rename(columns={"index": "feature"})
        L += ["\n## 5. 선형 계수 (표준화 1단위 또는 플래그 0→1 당 mmHg; 상호작용은 두 표준화 값의 곱 1단위당)\n", md_table(c, nd=3)]
    if coef_lgb is not None:
        g = coef_lgb.sort_values("sbp_gain_share", ascending=False).head(25).reset_index().rename(columns={"index": "feature"})
        L += ["\n## 6. LightGBM gain 비중 (상위 25)\n", md_table(g, nd=3)]
    L += ["\n## 7. 산포 집단 (검증 잔차)\n", md_table(disp, nd=3),
          "\n## 8. 혼동행렬 (현재 판정 규칙)\n", md_table(conf, nd=0),
          "\n주의: mmHg 는 내부 중간값이며 제품 출력이 아니다(명세 2-1). 단건 추론 경로·배치 CLI 는 아직 없다. 복약 컬럼이 없어 라벨은 비복약 가정이다.\n"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    sheets = {"비교": cmp, "규칙비교": rules, "회귀분포": reg, "단계비율": shares, "구간보정": ints, "하위군": sub_piv, "혼동행렬": conf, "산포": disp}
    if coef_lin is not None:
        sheets["계수_linear"] = coef_lin.reset_index().rename(columns={"index": "feature"})
    if coef_lgb is not None:
        sheets["중요도_lgbm"] = coef_lgb.reset_index().rename(columns={"index": "feature"})
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name, index=False)
        for name in sheets:
            style(w.book[name], nd=3, freeze="B2")
            for row in w.book[name].iter_rows(min_row=2, max_col=1):
                row[0].alignment = Alignment(vertical="top")


if __name__ == "__main__":
    main()

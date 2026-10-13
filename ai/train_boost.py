"""train_boost.py — B1: 단조 제약 LightGBM 후보 (인수인계 5장)

실행:  cd ai && python train_boost.py [--split time] [--calibration platt] [--adopt auto|yes|no]

- 제약: monotone_constraints = contract_v1.MONOTONE_CONSTRAINTS (문헌 근거표 방향과 일치, tests/test_evidence.py)
- 구조: max_depth ≤ 4, n_estimators ≤ 300 (검증 세트 조기 종료), 작은 그리드를 검증 logloss 로 선택
- 보정: 검증 세트 Platt(기본). 설명: LightGBM pred_contrib(TreeSHAP) → predictor 의 이유 코드 경로 그대로
- 채택 규칙(인수인계): 검증 AUROC 가 B0 보다 +0.02 이상 이고 보정(기울기 0.9~1.1, ECE 악화 ≤0.01)이 나쁘지 않을 때만
  artifacts/htn_risk_{full,lite}.joblib 을 교체. 아니면 artifacts/candidates/ 에만 저장하고 B0 를 유지한다.
- 기록: experiments.md, reports/b1_vs_b0.md, 하위군·중요도·보정 곡선
결정성: deterministic=True, n_jobs=1, force_row_wise=True, seed 고정.
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from datetime import date
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

import evaluation as E  # noqa: E402
import labels as L  # noqa: E402
import thresholds_kr_v1 as T  # noqa: E402
from features import contract_v1 as C  # noqa: E402
from inference.bundle import ModelBundle  # noqa: E402
from inference.calibration import make_calibrator  # noqa: E402
from inference.predictor import RiskPredictor  # noqa: E402
from train_baseline import ARTIFACTS, DATA, PASS_AUROC, PASS_SLOPE, REPORTS, append_experiment, fmt, prepare, sanity_probe  # noqa: E402

AI_ROOT = Path(__file__).resolve().parent
CANDIDATES = ARTIFACTS / "candidates"
MAX_DEPTH, MAX_TREES, EARLY_STOP = 4, 300, 30
ADOPT_AUROC_GAIN, ADOPT_ECE_TOL = 0.02, 0.01
GRID = {"learning_rate": [0.03, 0.06], "num_leaves": [7, 15], "min_child_samples": [50, 200]}


def monotone_vector(columns: tuple[str, ...]) -> list[int]:
    return [C.MONOTONE_CONSTRAINTS[c] for c in columns]


def make_model(columns: tuple[str, ...], seed: int, **hp) -> lgb.LGBMClassifier:
    return lgb.LGBMClassifier(
        objective="binary", n_estimators=MAX_TREES, max_depth=MAX_DEPTH,
        learning_rate=hp.get("learning_rate", 0.05), num_leaves=hp.get("num_leaves", 15),
        min_child_samples=hp.get("min_child_samples", 100), subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
        reg_lambda=1.0, monotone_constraints=monotone_vector(columns), monotone_constraints_method="advanced",
        deterministic=True, force_row_wise=True, n_jobs=1, random_state=seed, verbose=-1,
    )


def lgb_proba(model: lgb.LGBMClassifier, X: np.ndarray) -> np.ndarray:
    """booster 직접 예측 (조기 종료 지점). sklearn 래퍼의 feature-name 경고를 피한다 — 추론(bundle.py)과 같은 경로."""
    return np.asarray(model.booster_.predict(X, num_iteration=model.best_iteration_)).reshape(-1)


def fit_with_early_stop(model: lgb.LGBMClassifier, Xtr, ytr, Xva, yva) -> lgb.LGBMClassifier:
    model.fit(Xtr, ytr, eval_set=[(Xva, yva)], eval_metric="binary_logloss",
              callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
    return model


def search(columns, Xtr, ytr, Xva, yva, seed: int) -> tuple[dict, list[dict]]:
    """작은 그리드를 검증 logloss(조기 종료 지점)로 비교. 결과 표도 돌려준다."""
    rows = []
    for lr, nl, mcs in itertools.product(GRID["learning_rate"], GRID["num_leaves"], GRID["min_child_samples"]):
        hp = {"learning_rate": lr, "num_leaves": nl, "min_child_samples": mcs}
        m = fit_with_early_stop(make_model(columns, seed, **hp), Xtr, ytr, Xva, yva)
        p = lgb_proba(m, Xva)
        ev = E.evaluate(yva, p)
        rows.append({**hp, "best_iteration": int(m.best_iteration_ or MAX_TREES), "val_logloss": ev["logloss"], "val_auroc": ev["auroc"]})
    rows.sort(key=lambda r: r["val_logloss"])
    best = {k: rows[0][k] for k in GRID}
    return best, rows


def b0_reference(model_id: str) -> dict | None:
    """출시 아티팩트(B0)의 검증·테스트 지표. 없으면 None."""
    path = ARTIFACTS / f"{model_id}.joblib"
    if not path.exists():
        return None
    b = ModelBundle.load(path)
    m = b.metadata.get("metrics", {})
    return {"version": b.model_version, "algorithm": b.metadata.get("algorithm"),
            "val": m.get("val_cal", {}), "test": m.get("test_cal", {})}


def feature_importance(model: lgb.LGBMClassifier, X: np.ndarray, columns: tuple[str, ...]) -> pd.DataFrame:
    gain = model.booster_.feature_importance(importance_type="gain")
    contrib = model.booster_.predict(X, pred_contrib=True)[:, : len(columns)]
    return pd.DataFrame({"feature": columns, "gain": gain, "gain_share": gain / max(gain.sum(), 1e-9),
                         "mean_abs_shap_logit": np.abs(contrib).mean(axis=0),
                         "monotone": [C.MONOTONE_CONSTRAINTS[c] for c in columns]}).sort_values("gain", ascending=False)


def run(split: str, df: pd.DataFrame, args, version: str) -> tuple[dict[str, ModelBundle], dict]:
    X_full, meta, imp = prepare(df, split)
    tr, va, te = ((meta["split"] == s).to_numpy() for s in ("train", "val", "test"))
    y, w = meta[L.LABEL_HTN].to_numpy(int), meta["wt"].to_numpy(float)
    y_adj = meta[L.LABEL_HTN + "_devadj"].to_numpy(int)
    bundles, summary = {}, {}

    for model_id in (C.MODEL_FULL, C.MODEL_LITE):
        cols = C.columns_for(model_id)
        X = X_full[list(cols)].to_numpy(float)
        best_hp, grid_rows = search(cols, X[tr], y[tr], X[va], y[va], args.seed)
        model = fit_with_early_stop(make_model(cols, args.seed, **best_hp), X[tr], y[tr], X[va], y[va])
        n_trees = int(model.best_iteration_ or MAX_TREES)

        p_raw = {k: lgb_proba(model, X[m]) for k, m in (("train", tr), ("val", va), ("test", te))}
        cal = make_calibrator(args.calibration).fit(p_raw["val"], y[va])
        p_cal = {k: cal.predict(v) for k, v in p_raw.items()}
        m = {f"{k}_raw": E.evaluate(y[mask], p_raw[k], w[mask]) for k, mask in (("train", tr), ("val", va), ("test", te))}
        m.update({f"{k}_cal": E.evaluate(y[mask], p_cal[k], w[mask]) for k, mask in (("val", va), ("test", te))})
        test, val = m["test_cal"], m["val_cal"]
        devadj = E.evaluate(y_adj[te], p_cal["test"], w[te])
        gates = {"auroc>=0.80": test["auroc"] >= PASS_AUROC, "slope 0.9~1.1": PASS_SLOPE[0] <= test["cal_slope"] <= PASS_SLOPE[1]}

        sub = E.subgroup_table(y[te], p_cal["test"], meta.loc[te, "sex"], meta.loc[te, "age"], w[te])
        sex_ece_gap = E.fairness_gap(sub, "ece10")
        imp_tbl = feature_importance(model, X[te], cols)
        tag = f"b1_{model_id}_{split}"
        sub.to_csv(REPORTS / f"subgroups_{tag}.csv", index=False)
        imp_tbl.to_csv(REPORTS / f"importance_{tag}.csv", index=False)
        pd.DataFrame(grid_rows).to_csv(REPORTS / f"grid_{tag}.csv", index=False)
        E.set_korean_font()
        E.plot_calibration(y[te], p_raw["test"], p_cal["test"], REPORTS / f"calibration_{tag}.png",
                           f"B1 {model_id} · {split} · 테스트 세트 보정 곡선")

        # B0 와 비교 (검증 세트 기준 채택 판단, 테스트는 보고)
        ref = b0_reference(model_id)
        d_val = val["auroc"] - ref["val"]["auroc"] if ref else float("nan")
        d_test = test["auroc"] - ref["test"]["auroc"] if ref else float("nan")
        cal_ok = gates["slope 0.9~1.1"] and (not ref or val["ece10"] <= ref["val"]["ece10"] + ADOPT_ECE_TOL)
        adopt_rule = bool(ref) and d_val >= ADOPT_AUROC_GAIN and cal_ok

        print(f"\n===== B1 {model_id} [{split}]  hp={best_hp} trees={n_trees}  n_train={tr.sum():,} n_val={va.sum():,} n_test={te.sum():,}")
        print(f"  train raw : {fmt(m['train_raw'])}")
        print(f"  val   cal : {fmt(val)}")
        print(f"  test  cal : {fmt(test)}   pred_mean={test['pred_mean']:.3f} vs prevalence={test['prevalence']:.3f} (가중 AUROC {test['auroc_w']:.3f})")
        print(f"  devadj    : auroc={devadj['auroc']:.3f} slope={devadj['cal_slope']:.2f}")
        if ref:
            print(f"  vs B0 {ref['version']}: ΔAUROC val {d_val:+.3f} (B0 {ref['val']['auroc']:.3f}) · test {d_test:+.3f} (B0 {ref['test']['auroc']:.3f}) "
                  f"· ECE val {val['ece10']:.3f} vs {ref['val']['ece10']:.3f}")
        print(f"  gates     : {gates}   성별 ECE 차={sex_ece_gap:.3f}   채택 규칙(Δval≥{ADOPT_AUROC_GAIN:+.2f} & 보정 OK) → {'채택' if adopt_rule else 'B0 유지'}")
        print("  importance (gain share / mean|SHAP| logit):")
        for r in imp_tbl.itertuples():
            print(f"    {r.feature:24} {r.gain_share:6.1%}   {r.mean_abs_shap_logit:.3f}   mono={r.monotone:+d}")
        print("  subgroups (test, calibrated):")
        for r in sub.itertuples():
            print(f"    {r.sex:6} {r.age_group:5} n={r.n:5d} prev={r.prevalence:.3f} pred={r.pred_mean:.3f} AUROC={r.auroc:.3f} AUPRC={r.auprc:.3f} ECE={r.ece10:.3f}")

        bundle = ModelBundle(
            model_id=model_id, model_version=version, estimator=model, imputers=imp, calibrator=cal, columns=cols,
            reference=None,
            metadata={
                "algorithm": f"B1 LightGBM monotone (max_depth={MAX_DEPTH}, trees={n_trees}/{MAX_TREES}, early stop on val)",
                "hyperparameters": best_hp, "monotone_constraints": dict(zip(cols, monotone_vector(cols))),
                "split": split, "train_years": sorted(meta.loc[tr, "year"].unique().tolist()),
                "val_years": sorted(meta.loc[va, "year"].unique().tolist()), "test_years": sorted(meta.loc[te, "year"].unique().tolist()),
                "n_train": int(tr.sum()), "n_val": int(va.sum()), "n_test": int(te.sum()), "seed": args.seed,
                "calibration": cal.describe(), "metrics": {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in m.items()},
                "metrics_test_devadj_label": {kk: round(vv, 4) for kk, vv in devadj.items()},
                "gates": gates, "sex_ece_gap": round(sex_ece_gap, 4), "lightgbm": lgb.__version__,
                "b0_reference": ref, "delta_auroc_val": None if ref is None else round(d_val, 4),
                "delta_auroc_test": None if ref is None else round(d_test, 4), "adopt_rule": adopt_rule,
                "trained_on": date.today().isoformat(), "label": "label_htn = HE_sbp>=140 or HE_dbp>=90 or DI1_2 in (1,2,3,4)",
                "note": "val 은 조기 종료·그리드 선택·보정에 모두 쓰여 val 지표는 낙관적일 수 있음. 테스트(2021~22)가 공정한 수치",
            })
        bundles[model_id] = bundle
        summary[model_id] = {"val": val, "test": test, "ref": ref, "d_val": d_val, "d_test": d_test, "adopt_rule": adopt_rule,
                             "gates": gates, "sex_ece_gap": sex_ece_gap, "hp": best_hp, "trees": n_trees, "imp": imp_tbl, "sub": sub, "devadj": devadj}

    probe = sanity_probe(RiskPredictor(bundles[C.MODEL_FULL], bundles[C.MODEL_LITE]))
    print(f"\n  sanity probe [{split}]: monotonic violations={len(probe['monotonic_violations'])}  BMI 22→30 Δrisk_index={probe['bmi_22_to_30_delta']}")
    for v in probe["monotonic_violations"][:10]:
        print("    !", v)
    for b in bundles.values():
        b.metadata["sanity_probe"] = probe
    return bundles, summary


def write_report(split: str, summary: dict, probe: dict, decision: str, version: str) -> Path:
    L_ = ["# B1 (단조 LightGBM) vs B0 (부호 제약 로지스틱) — 채택 판단\n",
          f"버전 {version} · 분할 {split} · 생성 {date.today().isoformat()}\n",
          "채택 규칙(인수인계 5장): 검증 AUROC Δ ≥ +0.02 이고 보정(테스트 기울기 0.9~1.1, 검증 ECE 악화 ≤ 0.01)이 나쁘지 않을 때만 B1 채택.\n",
          f"**결정: {decision}**\n",
          "| 모델 | 지표 | B0 검증 | B1 검증 | Δ | B0 테스트 | B1 테스트 | Δ |", "|---|---|---|---|---|---|---|---|"]
    for mid, s in summary.items():
        ref = s["ref"] or {"val": {}, "test": {}}
        for k, name in (("auroc", "AUROC"), ("auprc", "AUPRC"), ("brier", "Brier"), ("ece10", "ECE"), ("cal_slope", "보정 기울기")):
            bv, bt = ref["val"].get(k, float("nan")), ref["test"].get(k, float("nan"))
            L_.append(f"| {mid} | {name} | {bv:.3f} | {s['val'][k]:.3f} | {s['val'][k] - bv:+.3f} | {bt:.3f} | {s['test'][k]:.3f} | {s['test'][k] - bt:+.3f} |")
    L_ += ["\n## B1 설정\n"]
    for mid, s in summary.items():
        L_.append(f"- {mid}: {s['hp']}, trees {s['trees']}/{MAX_TREES}, depth ≤{MAX_DEPTH}, 성별 ECE 차 {s['sex_ece_gap']:.3f}, "
                  f"전환식 라벨 AUROC {s['devadj']['auroc']:.3f}, gates {s['gates']}")
    L_ += [f"\n단조성 probe 위반 {len(probe['monotonic_violations'])}건, BMI 22→30 Δrisk_index {probe['bmi_22_to_30_delta']}\n",
           "## 피처 중요도 (full, gain 비중 / 테스트 세트 mean|SHAP| logit)\n", "| 피처 | gain | mean\\|SHAP\\| | 단조 |", "|---|---|---|---|"]
    for r in summary[C.MODEL_FULL]["imp"].itertuples():
        L_.append(f"| {r.feature} | {r.gain_share:.1%} | {r.mean_abs_shap_logit:.3f} | {r.monotone:+d} |")
    L_ += ["\n## 해석\n",
           "- 단조 제약 덕에 sodium/activity/smoking 은 B0 처럼 '반대 방향'이 아니라 0 또는 근거표 방향으로만 기여한다. "
           "mean|SHAP| 가 0 에 가까우면 B1 도 그 피처에서 독립 신호를 찾지 못한 것이다.",
           "- 검증 세트는 조기 종료·그리드 선택·보정에 모두 쓰여 검증 Δ 는 낙관적일 수 있다. 테스트(2021~22) Δ 가 더 공정하다.",
           "- 60+ 하위군 AUROC 는 두 모델 모두 낮다(나이가 판별력의 대부분). 연령대 안 판별은 B1 로도 크게 좋아지지 않으면 피처 한계로 본다."]
    path = REPORTS / f"b1_vs_b0_{split}.md"
    path.write_text("\n".join(L_) + "\n", encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["time", "random721"], default="time")
    ap.add_argument("--calibration", choices=["platt", "isotonic"], default="platt")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--adopt", choices=["auto", "yes", "no"], default="auto",
                    help="auto: 채택 규칙 충족 시 출시 아티팩트 교체 / yes: 강제 교체 / no: 후보 폴더에만 저장")
    ap.add_argument("--version", default=f"{date.today().strftime('%Y.%m.%d')}-b1")
    args = ap.parse_args()

    C.check_ranges_match_thresholds()
    df = pd.read_parquet(DATA)
    REPORTS.mkdir(exist_ok=True); CANDIDATES.mkdir(parents=True, exist_ok=True)
    print(f"data: {DATA.name}  rows={len(df):,}  thresholds={T.THRESHOLDS_VERSION}  feature={C.FEATURE_VERSION}  version={args.version}  lightgbm={lgb.__version__}")

    bundles, summary = run(args.split, df, args, args.version)
    probe = bundles[C.MODEL_FULL].metadata["sanity_probe"]
    rule_full = summary[C.MODEL_FULL]["adopt_rule"]
    adopt = {"auto": rule_full and len(probe["monotonic_violations"]) == 0, "yes": True, "no": False}[args.adopt]
    decision = ("B1 채택 — 출시 아티팩트 교체" if adopt else
                f"B0 유지 — B1 은 artifacts/candidates/ 에 보관 (full ΔAUROC val {summary[C.MODEL_FULL]['d_val']:+.3f}, 규칙 미달)" if args.adopt != "no"
                else "B0 유지 (--adopt no)")
    print(f"\n>>> {decision}")

    for model_id, b in bundles.items():
        p = b.save(CANDIDATES / f"{model_id}_b1.joblib")
        print(f"  saved {p.relative_to(AI_ROOT)} ({p.stat().st_size / 1024:.0f} KB)")
        if adopt and args.split == "time":
            b.save(ARTIFACTS / f"{model_id}.joblib")
            print(f"  → replaced artifacts/{model_id}.joblib")
    report = write_report(args.split, summary, probe, decision, args.version)
    print(f"  report: {report.relative_to(AI_ROOT)}")
    (REPORTS / "b1_bundle_metadata.json").write_text(
        json.dumps({k: b.describe() for k, b in bundles.items()}, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    for model_id, s in summary.items():
        append_experiment({
            "date": date.today().isoformat(), "exp_id": f"{args.version}/{args.split}", "model": f"B1 LGBM mono ({model_id})",
            "features": "full 14" if model_id == C.MODEL_FULL else "lite 5", "data": DATA.name, "seed": args.seed,
            "auroc": s["test"]["auroc"], "auroc_val": s["val"]["auroc"], "auprc": s["test"]["auprc"], "brier": s["test"]["brier"],
            "slope": s["test"]["cal_slope"], "intercept": s["test"]["cal_intercept"], "ece": s["test"]["ece10"],
            "note": (f"{args.calibration} 보정, hp {s['hp']}, trees {s['trees']}, ΔAUROC vs B0 val {s['d_val']:+.3f} / test {s['d_test']:+.3f}, "
                     f"성별 ECE 차 {s['sex_ece_gap']:.3f}, 단조 위반 {len(probe['monotonic_violations'])}, "
                     f"{'채택' if adopt else 'B0 유지'}"),
        })


if __name__ == "__main__":
    main()

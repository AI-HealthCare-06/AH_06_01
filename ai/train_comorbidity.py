"""train_comorbidity.py — M3: 동반 질환 위험 4개 (당뇨·CKD·대사증후군·이상지질), 혈압·복약 포함 (계약 v2)

실행:  cd ai && python train_comorbidity.py [--split time] [--no-gbm] [--no-save]

- 피처: v1 14개 + sbp, dbp, htn_medication (features/contract_v2.py). 당뇨 모델은 diabetes_flag(라벨 동치)를 뺀다.
- 라벨: labels_m3.py (판정 불가 NaN 은 그 질환 학습에서 제외). 분할은 M1 과 같은 시간 분할.
- 모델: 부호 제약 L2 로지스틱(기본, MONOTONE_CONSTRAINTS_V2) + LightGBM 단조 비교. 검증 AUROC +0.02 이상이면 GBM 채택.
- 보정: 검증 세트 Platt. 산출: artifacts/comorbidity_<disease>.joblib (ModelBundle, feature_version v2), reports/, experiments.md
용도: 혈압을 재는 사용자에게 "검진 받으면 당뇨/CKD/대사증후군/이상지질일 참고 위험" — 검진 유도·목표 혈압(130/80) 분기 보조.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))

import evaluation as E  # noqa: E402
import labels_m3 as L3  # noqa: E402
import thresholds_kr_v1 as T  # noqa: E402
from features import contract_v1 as C  # noqa: E402
from features import contract_v2 as C2  # noqa: E402
from features.sk_transforms import SignConstrainedLogisticRegression, age_square_preprocessor, origin_of  # noqa: E402
from inference.bundle import ModelBundle  # noqa: E402
from inference.calibration import make_calibrator  # noqa: E402
from train_baseline import ARTIFACTS, DATA, EXPERIMENTS, REPORTS, fmt, prepare  # noqa: E402
from train_boost import lgb_proba  # noqa: E402

AI_ROOT = Path(__file__).resolve().parent
ADOPT_AUROC_GAIN, TARGET_AUROC = 0.02, 0.75
MAX_TREES, MAX_DEPTH, EARLY_STOP = 300, 4, 30


def linear_model(columns: tuple[str, ...], X_train: np.ndarray) -> Pipeline:
    pre = age_square_preprocessor(columns).fit(X_train)
    names = list(pre.get_feature_names_out(list(columns)))
    signs = [0 if n.endswith("^2") else C2.MONOTONE_CONSTRAINTS_V2.get(origin_of(n, list(columns)), 0) for n in names]
    return Pipeline([("pre", pre), ("scale", StandardScaler()), ("lr", SignConstrainedLogisticRegression(signs=signs, C=1.0))])


def gbm_model(columns: tuple[str, ...], seed: int) -> lgb.LGBMClassifier:
    return lgb.LGBMClassifier(objective="binary", n_estimators=MAX_TREES, max_depth=MAX_DEPTH, num_leaves=15, learning_rate=0.03,
                              min_child_samples=200, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
                              monotone_constraints=[C2.MONOTONE_CONSTRAINTS_V2[c] for c in columns], monotone_constraints_method="advanced",
                              deterministic=True, force_row_wise=True, n_jobs=1, random_state=seed, verbose=-1)


def append_experiment(rows: list[dict]) -> None:
    text = EXPERIMENTS.read_text(encoding="utf-8").rstrip("\n")
    header = ("\n\n## M3 동반 질환 위험 (comorbidity_*, 계약 v2: 혈압·복약 포함)\n\n"
              "| 날짜 | 실험 ID | 질환 | 모델 | 학습 n (양성%) | AUROC 테스트 (검증) | AUPRC | Brier | 보정 기울기 | ECE | 비고 |\n|---|---|---|---|---|---|---|---|---|---|---|")
    if "## M3 동반 질환 위험" not in text:
        text += header
    for r in rows:
        text += ("\n| {date} | {exp_id} | {disease} | {model} | {n:,} ({prev:.1%}) | {auroc:.3f} ({auroc_val:.3f}) | {auprc:.3f} | {brier:.3f} | "
                 "{slope:.2f} | {ece:.3f} | {note} |").format(**r)
    EXPERIMENTS.write_text(text + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["time", "random721"], default="time")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-gbm", dest="gbm", action="store_false")
    ap.add_argument("--no-save", dest="save", action="store_false")
    ap.add_argument("--version", default=f"{date.today().strftime('%Y.%m.%d')}-m3")
    args = ap.parse_args()

    C.check_ranges_match_thresholds()
    df = pd.read_parquet(DATA)
    REPORTS.mkdir(exist_ok=True)
    X_full, meta, imp = prepare(df, args.split)
    X2 = X_full.copy()
    X2["sbp"], X2["dbp"] = meta["HE_sbp"].to_numpy(float), meta["HE_dbp"].to_numpy(float)
    X2["htn_medication"] = meta["on_medication"].to_numpy(float)
    labels = df.loc[X2.index, list(L3.LABELS_M3)]
    print(f"data: {DATA.name}  rows={len(X2):,}  version={args.version}")

    exp_rows, summary = [], {}
    for disease in C2.DISEASES:
        cols = C2.columns_for_disease(disease)
        y_all = labels[C2.LABEL_OF[disease]].to_numpy(float)
        ok = ~np.isnan(y_all)
        X = X2[list(cols)].to_numpy(float)
        y = np.nan_to_num(y_all).astype(int)   # NaN(판정 불가)은 ok 마스크로 제외된다
        w = meta["wt"].to_numpy(float)
        tr, va, te = ((meta["split"] == s).to_numpy() & ok for s in ("train", "val", "test"))

        lin = linear_model(cols, X[tr]).fit(X[tr], y[tr])
        cands = {"linear": lin}
        if args.gbm:
            g = gbm_model(cols, args.seed)
            g.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], eval_metric="binary_logloss", callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
            cands["gbm"] = g
        raw_val = {k: (lgb_proba(m, X[va]) if k == "gbm" else m.predict_proba(X[va])[:, 1]) for k, m in cands.items()}
        auc_val = {k: E.evaluate(y[va], p)["auroc"] for k, p in raw_val.items()}
        chosen = "gbm" if args.gbm and auc_val["gbm"] - auc_val["linear"] >= ADOPT_AUROC_GAIN else "linear"
        model = cands[chosen]
        proba = (lambda Xs: lgb_proba(model, Xs)) if chosen == "gbm" else (lambda Xs: model.predict_proba(Xs)[:, 1])
        p_raw = {k: proba(X[m]) for k, m in (("train", tr), ("val", va), ("test", te))}
        cal = make_calibrator("platt").fit(p_raw["val"], y[va])
        p_cal = {k: cal.predict(v) for k, v in p_raw.items()}
        m = {f"{k}_raw": E.evaluate(y[mask], p_raw[k], w[mask]) for k, mask in (("train", tr), ("val", va), ("test", te))}
        m.update({f"{k}_cal": E.evaluate(y[mask], p_cal[k], w[mask]) for k, mask in (("val", va), ("test", te))})
        test, val = m["test_cal"], m["val_cal"]
        sub = E.subgroup_table(y[te], p_cal["test"], meta.loc[te, "sex"], meta.loc[te, "age"], w[te])
        gap = E.fairness_gap(sub, "ece10")
        tag = f"m3_{disease}_{args.split}"
        sub.to_csv(REPORTS / f"subgroups_{tag}.csv", index=False)
        E.set_korean_font()
        E.plot_calibration(y[te], p_raw["test"], p_cal["test"], REPORTS / f"calibration_{tag}.png", f"M3 {disease} · {args.split} · 테스트 세트")
        coef = E.coefficient_table(lin, list(cols), C2.MONOTONE_CONSTRAINTS_V2)
        coef.to_csv(REPORTS / f"coefficients_{tag}.csv", index=False)

        print(f"\n===== M3 {disease} [{args.split}]  chosen={chosen}  n_train={tr.sum():,} (양성 {y[tr].mean():.1%})  n_test={te.sum():,}  val AUROC {auc_val}")
        print(f"  test cal : {fmt(test)}  pred_mean={test['pred_mean']:.3f} vs prevalence={test['prevalence']:.3f}  가중 AUROC {test['auroc_w']:.3f}  성별 ECE 차 {gap:.3f}")
        top = coef[coef.term != "intercept"].assign(a=lambda d: d.coef_std.abs()).sort_values("a", ascending=False).head(6)
        print("  top |coef| (linear):", ", ".join(f"{r.term.split('__')[-1]} {r.coef_std:+.2f}" for r in top.itertuples()))
        for r in sub.itertuples():
            print(f"    {r.sex:6} {r.age_group:5} n={r.n:5d} prev={r.prevalence:.3f} pred={r.pred_mean:.3f} AUROC={r.auroc:.3f} AUPRC={r.auprc:.3f}")

        bundle = ModelBundle(
            model_id=f"{C2.MODEL_PREFIX}{disease}", model_version=args.version, estimator=model, imputers=imp, calibrator=cal, columns=cols,
            reference={c: float(v) for c, v in zip(cols, X[tr].mean(axis=0))} if chosen == "linear" else None, feature_version=C2.FEATURE_VERSION,
            metadata={"algorithm": "B0 sign-constrained L2 logistic (age²)" if chosen == "linear" else "LightGBM monotone (early stop)",
                      "disease": disease, "label_rule": L3.__doc__.split("|")[0].strip()[:0] or f"labels_m3.label_{disease}", "split": args.split,
                      "n_train": int(tr.sum()), "n_val": int(va.sum()), "n_test": int(te.sum()), "prevalence_train": round(float(y[tr].mean()), 4),
                      "metrics": {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in m.items()}, "val_auroc_candidates": auc_val,
                      "sex_ece_gap": round(gap, 4), "target_auroc": TARGET_AUROC, "calibration": cal.describe(), "trained_on": date.today().isoformat(),
                      "note": "KNHANES 검진 측정 혈압으로 학습. 앱 가정혈압은 약 5 mmHg 낮을 수 있음(보정 없음)."})
        summary[disease] = {"bundle": bundle, "test": test, "val": val, "chosen": chosen, "gap": gap}
        exp_rows.append({"date": date.today().isoformat(), "exp_id": f"{args.version}/{args.split}", "disease": disease,
                         "model": "M3 LR(부호 제약)" if chosen == "linear" else "M3 LGBM mono", "n": int(tr.sum()), "prev": float(y[tr].mean()),
                         "auroc": test["auroc"], "auroc_val": val["auroc"], "auprc": test["auprc"], "brier": test["brier"],
                         "slope": test["cal_slope"], "ece": test["ece10"],
                         "note": f"val AUROC lin {auc_val['linear']:.3f}" + (f" / gbm {auc_val['gbm']:.3f}" if 'gbm' in auc_val else "") + f", 성별 ECE 차 {gap:.3f}"})

    if args.save and args.split == "time":
        for disease, s in summary.items():
            p = s["bundle"].save(ARTIFACTS / f"{C2.MODEL_PREFIX}{disease}.joblib")
            print(f"  saved {p.relative_to(AI_ROOT)} ({p.stat().st_size / 1024:.0f} KB)")
        (REPORTS / "m3_bundle_metadata.json").write_text(json.dumps({d: s["bundle"].describe() for d, s in summary.items()}, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    append_experiment(exp_rows)


if __name__ == "__main__":
    main()

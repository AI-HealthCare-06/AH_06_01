"""train_baseline.py — B0: 로지스틱 회귀 베이스라인 (인수인계 5장)

실행:  cd ai && python train_baseline.py [--split both|time|random721] [--calibration platt|isotonic] [--no-save]

- 입력: data/processed/knhanes_contract_v1.parquet (build_dataset.py 산출물)
- 분할: split_time(주) = 학습 2013~2019 / 검증 2020 / 테스트 2021~2022, split_random_721(보조)
- 모델: StandardScaler → LogisticRegression. age 는 선형 + 제곱항. full(14피처)·lite(5피처) 둘 다 학습
- 보정: 검증 세트에서 Platt(기본) 또는 isotonic 적합. 지표는 보정 후 테스트 세트 기준
- 저장: 시간 분할 모델만 artifacts/htn_risk_{full,lite}.joblib (ModelBundle, 보정기·대치값 포함)
- 기록: experiments.md 1행/모델, reports/ 에 계수표·하위군표·보정 곡선 PNG
학습은 비가중, 성능 보고는 가중 유병률·가중 AUROC 를 함께 낸다.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))

import evaluation as E  # noqa: E402
import labels as L  # noqa: E402
import thresholds_kr_v1 as T  # noqa: E402
from features import contract_v1 as C  # noqa: E402
from features.sk_transforms import SignConstrainedLogisticRegression, age_square_preprocessor  # noqa: E402
from inference.bundle import ModelBundle  # noqa: E402
from inference.calibration import make_calibrator  # noqa: E402
from inference.predictor import RiskPredictor  # noqa: E402

AI_ROOT = Path(__file__).resolve().parent
DATA = AI_ROOT / "data" / "processed" / "knhanes_contract_v1.parquet"
ARTIFACTS, REPORTS, EXPERIMENTS = AI_ROOT / "artifacts", AI_ROOT / "reports", AI_ROOT / "experiments.md"
SPLIT_COL = {"time": "split_time", "random721": "split_random_721"}
PASS_AUROC, PASS_SLOPE = 0.80, (0.9, 1.1)


def build_pipeline(columns: tuple[str, ...], X_train: np.ndarray, age_square: bool, C_reg: float, constrained: bool) -> Pipeline:
    """StandardScaler → 로지스틱. constrained=True 면 MONOTONE_CONSTRAINTS 부호 경계를 건 L2 로지스틱."""
    steps = []
    names = list(columns)
    if age_square:
        pre = age_square_preprocessor(columns).fit(X_train)
        names = list(pre.get_feature_names_out(list(columns)))
        steps.append(("pre", pre))
    steps.append(("scale", StandardScaler()))
    if constrained:
        # 변환 열 → 원 계약 열 → 부호. 제곱항(^2)은 자유.
        signs = [0 if n.endswith("^2") else C.MONOTONE_CONSTRAINTS.get(E._origin(n, list(columns)), 0) for n in names]
        steps.append(("lr", SignConstrainedLogisticRegression(signs=signs, C=C_reg)))
    else:
        steps.append(("lr", LogisticRegression(C=C_reg, max_iter=5000, solver="lbfgs")))
    return Pipeline(steps)


def prepare(df: pd.DataFrame, split: str) -> tuple[pd.DataFrame, pd.DataFrame, C.Imputers]:
    """대치값은 학습 세트에서만 계산. 계약 변환으로 범위 밖 행은 제외된다."""
    col = SPLIT_COL[split]
    imp = C.fit_imputers(df[df[col] == "train"], source=f"knhanes_{split}_train")
    X_full, results = C.transform_frame(df.drop(columns=[c for c in df.columns if c.startswith("_")]), imp, C.MODEL_FULL)
    meta = df.loc[X_full.index, ["year", "sex", "age", "wt", L.LABEL_HTN, L.LABEL_HTN + "_devadj", col]].rename(columns={col: "split"})
    n_rej = sum(1 for r in results if not r.accepted)
    print(f"[prepare:{split}] rows={len(df):,} accepted={len(X_full):,} rejected(out_of_range)={n_rej:,}  imputers={imp.source}")
    return X_full, meta, imp


def sanity_probe(predictor: RiskPredictor) -> dict:
    """test_sanity 의 단조성·BMI 효과 크기를 학습 직후 미리 확인 (실패해도 학습은 계속, 결과만 보고)."""
    base = {"feature_version": "v1", "bmi": 23.0, "smoking_status": "never", "alcohol_units_week": 2.0,
            "activity_minutes_week": 150, "activity_low_flag": False, "sleep_avg_h": 7.0, "sodium_risk_score": 1,
            "stress_score": 2, "family_htn": False, "diabetes_flag": False}
    violations, bmi_effect = [], {}
    for sex in ("male", "female"):
        for age in (25, 40, 60):
            p = {**base, "age": age, "sex": sex, "waist_cm": 82.0 if sex == "male" else 76.0}
            r = lambda **o: predictor.predict({**p, **o})["risk_index"]  # noqa: E731
            seqs = {
                "bmi": [r(bmi=v) for v in (22, 24, 26, 28, 30)],
                "waist_cm": [r(waist_cm=v) for v in (78, 83, 88, 93, 98)],
                "alcohol_units_week": [r(alcohol_units_week=v) for v in (0, 7, 14, 21)],
                "sodium_risk_score": [r(sodium_risk_score=v) for v in (0, 1, 2)],
                "age": [r(age=v) for v in (age, age + 5, age + 10, age + 15) if v <= 90],
                "activity_minutes_week": [r(activity_minutes_week=v, activity_low_flag=v < 150) for v in (0, 75, 150, 300)],
            }
            for k, s in seqs.items():
                ok = all(a <= b for a, b in zip(s, s[1:])) if k != "activity_minutes_week" else all(a >= b for a, b in zip(s, s[1:]))
                if not ok:
                    violations.append(f"{sex}/{age} {k}: {s}")
            bmi_effect[f"{sex}/{age}"] = seqs["bmi"][-1] - seqs["bmi"][0]
    return {"monotonic_violations": violations, "bmi_22_to_30_delta": bmi_effect}


def fmt(m: dict, keys=("auroc", "auprc", "brier", "ece10", "cal_slope", "cal_intercept")) -> str:
    return "  ".join(f"{k}={m[k]:.3f}" for k in keys if k in m)


def append_experiment(row: dict) -> None:
    line = ("| {date} | {exp_id} | {model} | {features} | {data} | {seed} | {auroc:.3f} ({auroc_val:.3f}) | {auprc:.3f} | {brier:.3f} | "
            "{slope:.2f} / {intercept:+.2f} | {ece:.3f} | {note} |").format(**row)
    EXPERIMENTS.write_text(EXPERIMENTS.read_text(encoding="utf-8").rstrip("\n") + "\n" + line + "\n", encoding="utf-8")


def run(split: str, df: pd.DataFrame, args, version: str) -> dict[str, ModelBundle]:
    X_full, meta, imp = prepare(df, split)
    tr, va, te = ((meta["split"] == s).to_numpy() for s in ("train", "val", "test"))
    y, w = meta[L.LABEL_HTN].to_numpy(int), meta["wt"].to_numpy(float)
    bundles: dict[str, ModelBundle] = {}
    summary = {}

    for model_id in (C.MODEL_FULL, C.MODEL_LITE):
        cols = C.columns_for(model_id)
        X = X_full[list(cols)].to_numpy(float)
        pipe = build_pipeline(cols, X[tr], args.age_square, args.C, args.constrained).fit(X[tr], y[tr])
        p_raw = {k: pipe.predict_proba(X[m])[:, 1] for k, m in (("train", tr), ("val", va), ("test", te))}
        cal = make_calibrator(args.calibration).fit(p_raw["val"], y[va])
        p_cal = {k: cal.predict(v) for k, v in p_raw.items()}

        m = {f"{k}_raw": E.evaluate(y[mask], p_raw[k], w[mask]) for k, mask in (("train", tr), ("val", va), ("test", te))}
        m.update({f"{k}_cal": E.evaluate(y[mask], p_cal[k], w[mask]) for k, mask in (("val", va), ("test", te))})
        test = m["test_cal"]
        gates = {"auroc>=0.80": test["auroc"] >= PASS_AUROC, "slope 0.9~1.1": PASS_SLOPE[0] <= test["cal_slope"] <= PASS_SLOPE[1]}

        sub = E.subgroup_table(y[te], p_cal["test"], meta.loc[te, "sex"], meta.loc[te, "age"], w[te])
        sex_ece_gap = E.fairness_gap(sub, "ece10")
        coef = E.coefficient_table(pipe, list(cols), C.MONOTONE_CONSTRAINTS)
        tag = f"b0_{model_id}_{split}"
        sub.to_csv(REPORTS / f"subgroups_{tag}.csv", index=False)
        coef.to_csv(REPORTS / f"coefficients_{tag}.csv", index=False)
        E.set_korean_font()
        E.plot_calibration(y[te], p_raw["test"], p_cal["test"], REPORTS / f"calibration_{tag}.png",
                           f"B0 {model_id} · {split} · 테스트 세트 보정 곡선")

        # 혈압계 변경 민감도 (전환식 라벨로 테스트 세트 재평가)
        y_adj = meta[L.LABEL_HTN + "_devadj"].to_numpy(int)
        devadj = E.evaluate(y_adj[te], p_cal["test"], w[te])

        print(f"\n===== B0 {model_id} [{split}]  n_train={tr.sum():,} n_val={va.sum():,} n_test={te.sum():,}")
        print(f"  train raw : {fmt(m['train_raw'])}")
        print(f"  val   raw : {fmt(m['val_raw'])}   → cal: {fmt(m['val_cal'])}")
        print(f"  test  raw : {fmt(m['test_raw'])}")
        print(f"  test  cal : {fmt(test)}   pred_mean={test['pred_mean']:.3f} vs prevalence={test['prevalence']:.3f} "
              f"(가중 {test['pred_mean_w']:.3f} vs {test['prevalence_w']:.3f}, 가중 AUROC {test['auroc_w']:.3f})")
        print(f"  devadj    : auroc={devadj['auroc']:.3f} brier={devadj['brier']:.3f} slope={devadj['cal_slope']:.2f} "
              f"(전환식 라벨 유병률 {devadj['prevalence']:.3f})")
        print(f"  gates     : {gates}   성별 ECE 차={sex_ece_gap:.3f} (≤0.05)   calibrator={cal.describe()}")
        print("  coefficients (standardized):")
        for r in coef.itertuples():
            flag = "" if r.sign_ok else "  ← 부호 불일치"
            print(f"    {r.term:28} {r.coef_std:+.3f}  OR/SD={r.odds_ratio_per_sd:.2f}{flag}")
        print("  subgroups (test, calibrated):")
        for r in sub.itertuples():
            print(f"    {r.sex:6} {r.age_group:5} n={r.n:5d} pos={r.positives:4d} prev={r.prevalence:.3f} pred={r.pred_mean:.3f} "
                  f"AUROC={r.auroc:.3f} AUPRC={r.auprc:.3f} ECE={r.ece10:.3f}")

        bundle = ModelBundle(
            model_id=model_id, model_version=version, estimator=pipe, imputers=imp, calibrator=cal, columns=cols,
            reference={c: float(v) for c, v in zip(cols, X[tr].mean(axis=0))},
            metadata={
                "algorithm": ("B0 " + ("sign-constrained " if args.constrained else "") + "L2 logistic regression (StandardScaler"
                              + (", age linear+square)" if args.age_square else ")")),
                "sign_constraints": C.MONOTONE_CONSTRAINTS if args.constrained else None,
                "split": split, "train_years": sorted(meta.loc[tr, "year"].unique().tolist()),
                "val_years": sorted(meta.loc[va, "year"].unique().tolist()), "test_years": sorted(meta.loc[te, "year"].unique().tolist()),
                "n_train": int(tr.sum()), "n_val": int(va.sum()), "n_test": int(te.sum()), "seed": args.seed, "C": args.C,
                "calibration": cal.describe(), "metrics": {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in m.items()},
                "metrics_test_devadj_label": {kk: round(vv, 4) for kk, vv in devadj.items()},
                "gates": gates, "sex_ece_gap": round(sex_ece_gap, 4), "sklearn": sklearn.__version__,
                "trained_on": date.today().isoformat(), "label": "label_htn = HE_sbp>=140 or HE_dbp>=90 or DI1_2 in (1,2,3,4)",
            })
        bundles[model_id] = bundle
        summary[model_id] = {"test": test, "val": m["val_cal"], "gates": gates, "coef": coef, "sub": sub, "sex_ece_gap": sex_ece_gap, "devadj": devadj}

    probe = sanity_probe(RiskPredictor(bundles[C.MODEL_FULL], bundles[C.MODEL_LITE]))
    print(f"\n  sanity probe [{split}]: monotonic violations={len(probe['monotonic_violations'])}  "
          f"BMI 22→30 Δrisk_index={probe['bmi_22_to_30_delta']}")
    for v in probe["monotonic_violations"][:10]:
        print("    !", v)
    for model_id, b in bundles.items():
        b.metadata["sanity_probe"] = probe

    for model_id, s in summary.items():
        append_experiment({
            "date": date.today().isoformat(), "exp_id": f"{version}/{split}", "model": f"B0 LR ({model_id})",
            "features": ("full 14" if model_id == C.MODEL_FULL else "lite 5") + ("" if args.constrained else " (부호 제약 없음)"),
            "data": DATA.name, "seed": args.seed,
            "auroc": s["test"]["auroc"], "auroc_val": s["val"]["auroc"], "auprc": s["test"]["auprc"], "brier": s["test"]["brier"],
            "slope": s["test"]["cal_slope"], "intercept": s["test"]["cal_intercept"], "ece": s["test"]["ece10"],
            "note": (f"{args.calibration} 보정, 테스트={'2021~22' if split == 'time' else '무작위 10%'}, "
                     f"가중 AUROC {s['test']['auroc_w']:.3f}, 성별 ECE 차 {s['sex_ece_gap']:.3f}, "
                     f"gates {'통과' if all(s['gates'].values()) else '미달 ' + ','.join(k for k, v in s['gates'].items() if not v)}, "
                     f"단조 위반 {len(probe['monotonic_violations'])}, 전환식 라벨 AUROC {s['devadj']['auroc']:.3f}"),
        })
    return bundles


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["both", "time", "random721"], default="both")
    ap.add_argument("--calibration", choices=["platt", "isotonic"], default="platt")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--C", type=float, default=1.0, help="LogisticRegression 역정규화 강도")
    ap.add_argument("--no-age-square", dest="age_square", action="store_false")
    ap.add_argument("--unconstrained", dest="constrained", action="store_false",
                    help="부호 경계 없는 보통 로지스틱 (계수 부호 진단용). 기본은 MONOTONE_CONSTRAINTS 부호 제약")
    ap.add_argument("--no-save", dest="save", action="store_false")
    ap.add_argument("--version", default=f"{date.today().strftime('%Y.%m.%d')}-b0")
    args = ap.parse_args()

    C.check_ranges_match_thresholds()
    np.random.seed(args.seed)
    df = pd.read_parquet(DATA)
    REPORTS.mkdir(exist_ok=True)
    print(f"data: {DATA.name}  rows={len(df):,}  thresholds={T.THRESHOLDS_VERSION}  feature={C.FEATURE_VERSION}  version={args.version}")

    splits = ["time", "random721"] if args.split == "both" else [args.split]
    saved = None
    for split in splits:
        bundles = run(split, df, args, args.version)
        if split == "time" and args.save:
            for model_id, b in bundles.items():
                path = b.save(ARTIFACTS / f"{model_id}.joblib")
                print(f"  saved {path.relative_to(AI_ROOT)}  ({path.stat().st_size / 1024:.0f} KB)")
            saved = {k: b.describe() for k, b in bundles.items()}
    if saved:
        (REPORTS / "b0_bundle_metadata.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()

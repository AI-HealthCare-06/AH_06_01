"""train_sbp.py — M2: 예상 혈압 회귀 (T2) — 생활·신체 14피처 → SBP·DBP (mmHg), 혈압약 미복용자만

실행:  cd ai && python train_sbp.py [--split time] [--alpha 1.0] [--no-gbm] [--no-save]

- 학습 대상: on_medication == 0 (약으로 내려간 혈압은 제외). 분할은 M1 과 같은 시간 분할.
- 모델 A(기본): StandardScaler → 부호 제약 릿지 (방향 = 문헌 근거표, MONOTONE_CONSTRAINTS). 설명·what-if 가 선형이라 명확.
- 모델 B(비교): LightGBM 회귀 + 같은 단조 제약, 검증 조기 종료. 검증 RMSE 가 A 보다 ADOPT_RMSE_GAIN(1.0 mmHg) 이상 좋을 때만 채택.
- 산출: artifacts/expected_bp.joblib (RegressionBundle, sbp·dbp 두 추정기), reports/expected_bp_*.csv/png, experiments.md
- 용도: 대시보드 '예상 혈압 참고치', what-if(체중·나트륨·활동 바꾸면 SBP?), 실측 − 예상 차이(M2 residual).
한계: KNHANES 는 1인 1회 측정이라 '개인의 혈압 변화'를 배우는 게 아니라 '이 생활·신체 조건이면 보통 혈압이 얼마'를 배운다.
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
import thresholds_kr_v1 as T  # noqa: E402
from features import contract_v1 as C  # noqa: E402
from features.sk_transforms import SignConstrainedRidge, age_square_preprocessor, origin_of  # noqa: E402
from inference.bundle import MODEL_EXPECTED_BP, RegressionBundle  # noqa: E402
from inference.predictor import RiskPredictor  # noqa: E402
from inference.bundle import ModelBundle  # noqa: E402
from train_baseline import ARTIFACTS, DATA, EXPERIMENTS, REPORTS, prepare  # noqa: E402

AI_ROOT = Path(__file__).resolve().parent
TARGETS = {"sbp": "HE_sbp", "dbp": "HE_dbp"}
ADOPT_RMSE_GAIN = 1.0   # mmHg
MAX_TREES, MAX_DEPTH, EARLY_STOP = 300, 4, 30


def linear_model(columns: tuple[str, ...], X_train: np.ndarray, alpha: float) -> Pipeline:
    pre = age_square_preprocessor(columns).fit(X_train)
    names = list(pre.get_feature_names_out(list(columns)))
    signs = [0 if n.endswith("^2") else C.MONOTONE_CONSTRAINTS.get(origin_of(n, list(columns)), 0) for n in names]
    return Pipeline([("pre", pre), ("scale", StandardScaler()), ("ridge", SignConstrainedRidge(signs=signs, alpha=alpha))])


def gbm_model(columns: tuple[str, ...], seed: int) -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(objective="regression", n_estimators=MAX_TREES, max_depth=MAX_DEPTH, num_leaves=15,
                             learning_rate=0.05, min_child_samples=200, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                             reg_lambda=1.0, monotone_constraints=[C.MONOTONE_CONSTRAINTS[c] for c in columns],
                             monotone_constraints_method="advanced", deterministic=True, force_row_wise=True, n_jobs=1,
                             random_state=seed, verbose=-1)


class GbmRegressor:
    """RegressionBundle 안에서 booster 로 직접 예측하는 얇은 래퍼 (sklearn feature-name 경고 회피)."""

    def __init__(self, model: lgb.LGBMRegressor) -> None:
        self.booster = model.booster_
        self.best_iteration = model.best_iteration_

    def predict(self, X):
        return self.booster.predict(np.asarray(X, dtype=float), num_iteration=self.best_iteration)


def coef_table_mmhg(pipe: Pipeline, columns: tuple[str, ...]) -> pd.DataFrame:
    """표준화 계수 → 원 단위 mmHg (1 단위 증가당). what-if 와 KSH 상식(체중 1 kg ≈ SBP 1.1) 대조용."""
    pre, scale, ridge = pipe.named_steps["pre"], pipe.named_steps["scale"], pipe.named_steps["ridge"]
    names = list(pre.get_feature_names_out(list(columns)))
    rows = []
    for name, c, sd in zip(names, ridge.coef_, scale.scale_):
        rows.append({"term": name, "origin": origin_of(name, list(columns)), "coef_std": float(c), "mmhg_per_unit": float(c / sd) if sd > 0 else 0.0,
                     "sign_constraint": 0 if name.endswith("^2") else C.MONOTONE_CONSTRAINTS.get(origin_of(name, list(columns)), 0)})
    return pd.DataFrame(rows)


def sanity_probe(bp: RegressionBundle) -> dict:
    """페르소나별 what-if: BMI 22→30, 나트륨 0→2, 활동 300→0 의 예상 SBP 변화. 방향이 근거표와 맞는지."""
    base = {"feature_version": "v1", "bmi": 23.0, "smoking_status": "never", "alcohol_units_week": 2.0, "activity_minutes_week": 150,
            "activity_low_flag": False, "sleep_avg_h": 7.0, "sodium_risk_score": 1, "stress_score": 2, "family_htn": False, "diabetes_flag": False}
    out = {}
    for sex in ("male", "female"):
        for age in (25, 40, 60):
            p = {**base, "age": age, "sex": sex, "waist_cm": 82.0 if sex == "male" else 76.0}
            def sbp(**o):
                cr = C.build_features({**p, **o}, bp.imputers)
                row = C.encode_numeric(cr.features, C.MODEL_FULL)
                return float(bp.predict(np.array([[row[c] for c in bp.columns]]))["sbp"][0])
            out[f"{sex}/{age}"] = {"sbp_base": round(sbp(), 1), "bmi_22_to_30": round(sbp(bmi=30) - sbp(bmi=22), 1),
                                   "sodium_0_to_2": round(sbp(sodium_risk_score=2) - sbp(sodium_risk_score=0), 1),
                                   "activity_300_to_0": round(sbp(activity_minutes_week=0, activity_low_flag=True) - sbp(activity_minutes_week=300), 1),
                                   "alcohol_0_to_21": round(sbp(alcohol_units_week=21) - sbp(alcohol_units_week=0), 1)}
    return out


def append_experiment(rows: list[dict]) -> None:
    text = EXPERIMENTS.read_text(encoding="utf-8").rstrip("\n")
    header = "\n\n## M2 예상 혈압 회귀 (expected_bp)\n\n| 날짜 | 실험 ID | 모델 | 타깃 | 학습 n | RMSE 테스트 (검증) | MAE | R² | 보정 기울기 | 잔차 평균 2021~22 | 비고 |\n|---|---|---|---|---|---|---|---|---|---|---|"
    if "## M2 예상 혈압 회귀" not in text:
        text += header
    for r in rows:
        text += ("\n| {date} | {exp_id} | {model} | {target} | {n:,} | {rmse:.2f} ({rmse_val:.2f}) | {mae:.2f} | {r2:.3f} | {slope:.2f} | {resid:+.2f} | {note} |").format(**r)
    EXPERIMENTS.write_text(text + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["time", "random721"], default="time")
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-gbm", dest="gbm", action="store_false")
    ap.add_argument("--no-save", dest="save", action="store_false")
    ap.add_argument("--version", default=f"{date.today().strftime('%Y.%m.%d')}-m2")
    args = ap.parse_args()

    C.check_ranges_match_thresholds()
    df = pd.read_parquet(DATA)
    REPORTS.mkdir(exist_ok=True)
    X_full, meta, imp = prepare(df, args.split)
    cols = C.columns_for(C.MODEL_FULL)
    X = X_full[list(cols)].to_numpy(float)
    nm = (meta["on_medication"] == 0).to_numpy()
    tr, va, te = ((meta["split"] == s).to_numpy() & nm for s in ("train", "val", "test"))
    print(f"data: {DATA.name}  미복용자 train={tr.sum():,} val={va.sum():,} test={te.sum():,}  version={args.version}")

    estimators, summary, exp_rows = {}, {}, []
    for tgt, col in TARGETS.items():
        y = meta[col].to_numpy(float)
        y_adj = meta[f"{col}_devadj"].to_numpy(float)
        lin = linear_model(cols, X[tr], args.alpha).fit(X[tr], y[tr])
        cands = {"linear": lin}
        if args.gbm:
            g = gbm_model(cols, args.seed)
            g.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], eval_metric="rmse", callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
            cands["gbm"] = GbmRegressor(g)
        val_rmse = {k: E.evaluate_regression(y[va], m.predict(X[va]))["rmse"] for k, m in cands.items()}
        chosen = "gbm" if args.gbm and val_rmse["linear"] - val_rmse["gbm"] >= ADOPT_RMSE_GAIN else "linear"
        model = cands[chosen]
        pred = {k: model.predict(X[m]) for k, m in (("train", tr), ("val", va), ("test", te))}
        m_te = E.evaluate_regression(y[te], pred["test"], meta.loc[te, "wt"].to_numpy(float))
        m_va = E.evaluate_regression(y[va], pred["val"])
        m_adj = E.evaluate_regression(y_adj[te], pred["test"])
        resid_year = pd.Series(y[te] - pred["test"]).groupby(meta.loc[te, "year"].to_numpy()).mean().round(2).to_dict()
        sub = E.regression_subgroups(y[te], pred["test"], meta.loc[te, "sex"], meta.loc[te, "age"])
        tag = f"m2_{tgt}_{args.split}"
        sub.to_csv(REPORTS / f"subgroups_{tag}.csv", index=False)
        E.set_korean_font()
        E.plot_regression_calibration(y[te], pred["test"], REPORTS / f"calibration_{tag}.png", f"M2 {tgt.upper()} · {args.split} · 테스트 세트")
        coef = coef_table_mmhg(lin, cols)
        coef.to_csv(REPORTS / f"coefficients_{tag}.csv", index=False)

        print(f"\n===== M2 {tgt.upper()} [{args.split}]  chosen={chosen}  val RMSE {val_rmse}")
        print(f"  test: RMSE {m_te['rmse']:.2f} (가중 {m_te.get('rmse_w', float('nan')):.2f})  MAE {m_te['mae']:.2f}  R² {m_te['r2']:.3f}  "
              f"기울기 {m_te['cal_slope']:.2f}  잔차 평균 {m_te['mean_residual']:+.2f}  | val RMSE {m_va['rmse']:.2f} R² {m_va['r2']:.3f}")
        print(f"  전환식 라벨 기준 테스트: RMSE {m_adj['rmse']:.2f} 잔차 평균 {m_adj['mean_residual']:+.2f}   | 연도별 잔차 평균 {resid_year}")
        print("  linear coefficients (mmHg per unit):")
        for r in coef.itertuples():
            print(f"    {r.term:28} {r.mmhg_per_unit:+7.3f}   std {r.coef_std:+.3f}   sign {r.sign_constraint:+d}")
        print("  subgroups:")
        for r in sub.itertuples():
            print(f"    {r.sex:6} {r.age_group:5} n={r.n:5d} obs={r.y_mean:6.1f} pred={r.pred_mean:6.1f} RMSE={r.rmse:5.2f} resid={r.mean_residual:+5.2f}")

        estimators[tgt] = model
        summary[tgt] = {"chosen": chosen, "val_rmse": val_rmse, "test": m_te, "val": m_va, "test_devadj": m_adj, "resid_by_year": resid_year,
                        "coefficients_mmhg": coef.set_index("term")["mmhg_per_unit"].round(3).to_dict()}
        exp_rows.append({"date": date.today().isoformat(), "exp_id": f"{args.version}/{args.split}", "model": f"M2 {chosen} (부호 제약)" if chosen == "linear" else "M2 LGBM mono",
                         "target": tgt.upper(), "n": int(tr.sum()), "rmse": m_te["rmse"], "rmse_val": m_va["rmse"], "mae": m_te["mae"], "r2": m_te["r2"],
                         "slope": m_te["cal_slope"], "resid": m_te["mean_residual"],
                         "note": f"미복용자, alpha {args.alpha}, 전환식 라벨 RMSE {m_adj['rmse']:.2f}, 연도별 잔차 {resid_year}"})

    bundle = RegressionBundle(model_id=MODEL_EXPECTED_BP, model_version=args.version, estimators=estimators, imputers=imp, columns=cols,
                              metadata={"algorithm": {k: v["chosen"] for k, v in summary.items()}, "split": args.split, "alpha": args.alpha,
                                        "n_train": int(tr.sum()), "n_val": int(va.sum()), "n_test": int(te.sum()), "population": "on_medication == 0",
                                        "metrics": {k: {"test": {kk: round(vv, 4) for kk, vv in v["test"].items()}, "val": {kk: round(vv, 4) for kk, vv in v["val"].items()},
                                                        "test_devadj": {kk: round(vv, 4) for kk, vv in v["test_devadj"].items()}, "resid_by_year": v["resid_by_year"]} for k, v in summary.items()},
                                        "coefficients_mmhg": {k: v["coefficients_mmhg"] for k, v in summary.items()}, "trained_on": date.today().isoformat(),
                                        "rmse_test": {k: round(v["test"]["rmse"], 1) for k, v in summary.items()},   # predictor 가 ±띠로 출력
                                        "note": "KNHANES 단면: '이 조건이면 보통 혈압이 얼마'. 개인의 변화 예측이 아님. what-if 변화량은 반사실 예측 차이"})
    probe = sanity_probe(bundle)
    bundle.metadata["sanity_probe"] = probe
    print("\n  sanity probe (예상 SBP 변화, mmHg):")
    for k, v in probe.items():
        print(f"    {k:12} base {v['sbp_base']:6.1f}  BMI22→30 {v['bmi_22_to_30']:+5.1f}  Na0→2 {v['sodium_0_to_2']:+5.1f}  "
              f"활동300→0 {v['activity_300_to_0']:+5.1f}  술0→21 {v['alcohol_0_to_21']:+5.1f}")

    # 전체 예측기 통합 확인 (M1 + M2)
    full_b, lite_b = ModelBundle.load(ARTIFACTS / "htn_risk_full.joblib"), ModelBundle.load(ARTIFACTS / "htn_risk_lite.joblib")
    pred = RiskPredictor(full_b, lite_b, bp=bundle)
    demo = pred.predict({"feature_version": "v1", "age": 45, "sex": "male", "bmi": 27.5, "waist_cm": 94, "smoking_status": "current",
                         "alcohol_units_week": 18, "activity_minutes_week": 60, "activity_low_flag": True, "sleep_avg_h": 6.5,
                         "sodium_risk_score": 2, "stress_score": 3, "family_htn": True, "diabetes_flag": False, "measured_sbp": 138, "measured_dbp": 88})
    print("\n  demo:", json.dumps({k: demo[k] for k in ("risk_index", "expected_sbp", "expected_dbp", "bp_vs_expected", "whatif")}, ensure_ascii=False))

    if args.save and args.split == "time":
        p = bundle.save(ARTIFACTS / f"{MODEL_EXPECTED_BP}.joblib")
        print(f"\n  saved {p.relative_to(AI_ROOT)} ({p.stat().st_size / 1024:.0f} KB)")
        (REPORTS / "m2_bundle_metadata.json").write_text(json.dumps(bundle.describe(), ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    append_experiment(exp_rows)


if __name__ == "__main__":
    main()

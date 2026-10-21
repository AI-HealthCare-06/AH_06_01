"""
[파일] tests/test_pipeline.py
[용도] 엔드투엔드 검사. 합성 데이터를 엑셀 2개로 저장 → train.run() → 보고서·모델 산출물 존재, 지표 결측 없음, 추론 출력 형식(2-6),
      데이터 품질 상태(ok/partial/insufficient/out_of_range/not_applicable), max_rows·sample_frac 동작을 검사한다.
[왜 필요한가] 모듈이 각각 맞아도 연결에서 깨질 수 있다. 사용자가 실제로 쓰는 경로(엑셀 → 학습 → 추론)를 그대로 재현해 확인한다.
[쓰는 곳] pytest
"""

import json

import numpy as np
import pandas as pd
import pytest

import thresholds as T
from m1.data_io import load_table
from m1.predict import M1Predictor
from tests.synth import make_synthetic
from train import TrainConfig, run


@pytest.fixture(scope="module")
def run_dir(tmp_path_factory):
    root = tmp_path_factory.mktemp("m1")
    data_dir = root / "train"
    data_dir.mkdir()
    df = make_synthetic(1500, seed=21, missing=True)
    df.iloc[:900].to_excel(data_dir / "part1.xlsx", index=False)
    df.iloc[900:].to_excel(data_dir / "part2.xlsx", index=False)
    cfg = TrainConfig(data=str(data_dir), out_root=str(root / "reports"), artifacts_root=str(root / "artifacts"),
                      variants=("base", "smoking_stress"), latency_iters=30, run_id="test_run")
    report_dir = run(cfg)
    return root, report_dir


def test_outputs_exist(run_dir):
    root, report_dir = run_dir
    assert (report_dir / "summary.md").exists()
    xlsx = report_dir / "test_results.xlsx"
    summary = pd.read_excel(xlsx, sheet_name="summary")
    assert len(summary) == 6
    assert set(summary["combo"]) == {f"{c}__{v}" for c in ("ordinal", "nested", "lgbm") for v in ("base", "smoking_stress")}
    for col in ("auroc_ge_140_90", "auroc_ge_130_80", "cal_slope_ge_140_90", "ece_top", "accuracy", "adjacent_accuracy", "latency_p95_ms"):
        assert summary[col].notna().all()
    assert (report_dir / "calibration_ordinal__base.png").exists()
    assert (root / "artifacts" / "LATEST").read_text().strip() == "test_run"
    sub = pd.read_excel(xlsx, sheet_name="subgroups")
    assert set(sub["age_group"]) == set(T.AGE_GROUP_LABELS) | {"all"}
    sizes = json.loads((report_dir / "data_summary.json").read_text())["split"]["sizes"]
    pred = pd.read_excel(xlsx, sheet_name="pred_ordinal__base")
    assert len(pred) == sizes["test"]
    assert {"true_stage", "p_normal", "p_htn", "stage_top", "correct", "risk_level", "reason_codes", "data_quality", "age", "sex"} <= set(pred.columns)
    assert pred["data_quality"].isin(["ok", "partial"]).all()
    assert abs(pred[[f"p_{s}" for s in T.STAGES]].sum(axis=1) - 1).max() < 1e-3
    assert set(pd.ExcelFile(xlsx).sheet_names) >= {"info", "summary", "pass_check", "val_vs_test", "subgroups", "confusion", "htn_binary", "bp_regression"}
    assert {"accuracy_htn_0.5", "sensitivity_htn_youden", "htn_threshold_youden"} <= set(summary.columns)
    bp = pd.read_excel(xlsx, sheet_name="bp_regression")
    assert set(bp["candidate"]) == {"linear", "lgbm"} and bp["rmse_sbp_test"].notna().all()
    assert (root / "artifacts" / "test_run" / "bp_regression__linear" / "model.pkl").exists()


def test_predict_output_schema(run_dir):
    root, _ = run_dir
    for combo in ("ordinal__base", "nested__smoking_stress", "lgbm__base"):
        pred = M1Predictor.load(root / "artifacts" / "test_run" / combo)
        out = pred.predict({"age": 52, "sex": "male", "bmi": 27.5, "waist_cm": 95, "alcohol_week": 21, "binge": 1,
                            "activity_minutes_week": 60, "family_htn": 1, "sodium_risk_score": 2, "sleep_short_flag": 1,
                            "fasting_glucose": 102, "resting_hr": 78, "education_years": 12, "smoking": "current", "stress_score": 3})
        assert set(out) >= {"stage_probs", "stage_top", "risk_level", "reason_codes", "data_quality", "model_version", "feature_version"}
        assert out["data_quality"] == "ok" and out["stage_top"] in T.STAGES
        assert abs(sum(out["stage_probs"].values()) - 1) < 1e-3
        assert set(out["reason_codes"]) <= {"bmi_high", "waist_high", "age", "alcohol_high", "activity_low", "sleep_short", "family_htn", "diabetes"}
        assert {"bmi_high", "waist_high", "alcohol_high", "activity_low", "sleep_short", "family_htn"} <= set(out["reason_codes"])
        assert out["risk_level"] == out["stage_top"] and out["risk_level"] in T.RISK_LEVELS
        json.dumps(out)


def test_predict_quality_states(run_dir):
    root, _ = run_dir
    pred = M1Predictor.load(root / "artifacts" / "test_run" / "ordinal__base")
    base = {"age": 40, "sex": "female", "bmi": 22.0, "waist_cm": 75, "alcohol_week": 0, "activity_minutes_week": 200, "family_htn": 0,
            "sodium_risk_score": 1, "sleep_short_flag": 0, "fasting_glucose": 90, "resting_hr": 65, "education_years": 16}
    assert pred.predict(base)["data_quality"] == "ok"
    partial = dict(base)
    partial.pop("waist_cm")
    assert pred.predict(partial)["data_quality"] == "partial"
    assert pred.predict({**base, "sbp": 128})["data_quality"] == "not_applicable"
    assert pred.predict({**base, "htn_med": True})["data_quality"] == "not_applicable"
    oor = pred.predict({**base, "age": 95})
    assert oor["data_quality"] == "out_of_range" and oor["stage_probs"] is None
    insuff = pred.predict({"age": 40, "sex": "female"})
    assert insuff["data_quality"] == "insufficient"


def test_row_controls(run_dir):
    root, _ = run_dir
    df, info = load_table(root / "train", max_rows=100)
    assert len(df) == 100 and info["rows_loaded"] == 1500
    df2, info2 = load_table(root / "train", sample_frac=0.2)
    assert abs(len(df2) - 300) <= 1


def test_external_test_file(run_dir, tmp_path):
    import evaluate_cli

    root, _ = run_dir
    tdir = tmp_path / "test"
    tdir.mkdir()
    make_synthetic(400, seed=41, missing=True).to_excel(tdir / "external.xlsx", index=False)
    # (1) 학습된 모델 평가만
    rep = evaluate_cli.main(["--data", str(tdir), "--run", "test_run", "--artifacts", str(root / "artifacts"), "--out", str(root / "reports"),
                             "--latency-iters", "5", "--combo", "ordinal__base,lgbm__base"])
    x = pd.ExcelFile(rep / "test_results.xlsx")
    summary = pd.read_excel(x, sheet_name="summary")
    assert list(summary["combo"]) == ["ordinal__base", "lgbm__base"] and summary["auroc_ge_140_90"].notna().all()
    assert "val_vs_test" not in x.sheet_names and (rep / "summary.md").exists()
    pred = pd.read_excel(x, sheet_name="pred_ordinal__base")
    assert 0 < len(pred) <= 400 and (pred["data_quality"].isin(["ok", "partial"])).all()
    # (2) 학습 파일은 학습/검증, 테스트는 외부 파일
    cfg = TrainConfig(data=str(root / "train"), test_data=str(tdir), out_root=str(root / "reports"), artifacts_root=str(root / "artifacts"),
                      candidates=("ordinal",), variants=("base",), latency_iters=5, run_id="test_run_ext")
    rd = run(cfg)
    ds = json.loads((rd / "data_summary.json").read_text())
    assert ds["split"]["sizes"]["test"] == len(pred) and ds["split"]["sizes"]["test"] == ds["test_load"]["rows_used"]
    assert "외부 테스트 파일" in ds["split"]["method"]


def test_batch_predict_unlabeled(run_dir, tmp_path):
    import predict_cli

    root, _ = run_dir
    tdir = tmp_path / "unlabeled"
    tdir.mkdir()
    df = make_synthetic(300, seed=51, missing=True)
    df[["sbp_1", "sbp_2", "dbp_1", "dbp_2", "htn_med"]] = np.nan          # 혈압·복약 비움
    df.loc[df.index[:2], "sbp_1"] = 130.0                                   # 값이 있으면 not_applicable
    df.to_excel(tdir / "unlabeled.xlsx", index=False)
    out = predict_cli.main(["--data", str(tdir), "--run", "test_run", "--artifacts", str(root / "artifacts"), "--out", str(root / "reports"), "--combo", "all"])
    x = pd.ExcelFile(out / "predictions.xlsx")
    assert {"info", "summary", "pred_ordinal__base", "pred_lgbm__base"} <= set(x.sheet_names)
    pred = pd.read_excel(x, sheet_name="pred_nested__base")
    assert len(pred) == 300 and (pred["data_quality"].iloc[:2] == "not_applicable").all()
    scored = pred[pred["data_quality"].isin(["ok", "partial"])]
    assert len(scored) > 250 and abs(scored[[f"p_{s}" for s in T.STAGES]].sum(axis=1) - 1).max() < 1e-3
    summary = pd.read_excel(x, sheet_name="summary")
    assert int(summary.loc[summary.combo == "nested__base", "dq_not_applicable"].iloc[0]) == 2
    assert scored["pred_hypertension"].isin([0, 1]).all() and {"bp_linear", "bp_lgbm"} <= set(x.sheet_names)
    bp = pd.read_excel(x, sheet_name="bp_linear")
    assert len(bp) == 300 and bp["pred_sbp"].iloc[:2].isna().all() and bp["pred_sbp"].notna().sum() == len(scored)
    assert bp.loc[bp["pred_sbp"].notna(), "pred_stage_from_bp"].isin(T.STAGES).all()
    # 혈압이 전부 비어 있는 파일(실제 검증 형태)도 돌아야 한다
    df2 = df.copy()
    df2[["sbp_1", "sbp_2", "dbp_1", "dbp_2", "htn_med"]] = np.nan
    d2 = tmp_path / "unlabeled2"
    d2.mkdir()
    df2.to_excel(d2 / "u2.xlsx", index=False)
    out2 = predict_cli.main(["--data", str(d2), "--run", "test_run", "--artifacts", str(root / "artifacts"), "--out", str(root / "reports"), "--combo", "nested__base"])
    s2 = pd.read_excel(out2 / "step_filled.xlsx", sheet_name="step_nested__base")
    assert len(s2) == 300 and not s2["step"].eq("not_applicable").any()
    step = pd.read_excel(out / "step_filled.xlsx", sheet_name="step_nested__base")
    assert len(step) == 300 and list(step.columns) == ["row", "step"] and step["step"].iloc[:2].eq("not_applicable").all()
    assert step["step"].iloc[2:].isin(list(T.STAGES) + ["insufficient", "out_of_range"]).all()
    assert (step["step"].to_numpy()[pred["stage_top"].notna().to_numpy()] == pred["stage_top"].dropna().to_numpy()).all()


def test_label_data(tmp_path):
    import label_data

    d = tmp_path / "lab"
    d.mkdir()
    df = make_synthetic(200, seed=61, missing=False)
    df["sbp"], df["dbp"] = df[["sbp_1", "sbp_2"]].mean(axis=1), df[["dbp_1", "dbp_2"]].mean(axis=1)
    df["hypertension"] = ((df["sbp"] >= T.SBP_HTN_MIN) | (df["dbp"] >= T.DBP_HTN_MIN)).astype(int)
    df = df.drop(columns=["sbp_1", "sbp_2", "dbp_1", "dbp_2", "htn_med"])
    df.to_csv(d / "x.csv", index=False)
    out = label_data.main(["--data", str(d), "--assume-no-med", "--out", str(tmp_path / "x_with_stage.xlsx")])
    lab = pd.read_excel(out)
    cols = list(lab.columns)
    assert cols[cols.index("hypertension") + 1] == "stage" and lab["stage"].isin(T.STAGES).all()
    assert ((lab["hypertension"] == 1) == (lab["stage"] == "htn")).all()


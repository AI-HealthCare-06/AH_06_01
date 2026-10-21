"""
[파일] evaluate_cli.py
[용도] 이미 학습된 모델(artifacts/<run>)을 혈압 컬럼이 채워진 외부 테스트 파일로 평가만 한다(재학습 없음).
      reports/eval_<run>_<시각>/ 에 summary.md·test_results.xlsx(행 단위 예측 포함)·보정 곡선을 만든다. 보조 혈압 회귀가 있으면 그 오차도 낸다.
[왜 필요한가] 모델을 고정한 채 새 라벨 데이터에서 지표·보정·하위군을 확인하는 용도다. 단건 추론 경로의 동등성도 이 데이터 전체로 다시 검증한다.
             혈압을 비운(라벨 없는) 파일은 predict_cli.py --data 로 돌린다.
[쓰는 곳] 사용자가 직접 실행. tests/test_pipeline.py 가 main() 을 호출한다.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

import thresholds as T
from m1.contract import Contract
from m1.evaluate import HTN_THRESHOLD_DEFAULT, bp_derived_metrics, evaluate_split, htn_binary_summary
from m1.fast_path import check_equivalence
from m1.features import VALID_STATUSES, Preprocessor
from m1.models.bp_regression import BPRegressor
from m1.pipeline import BP_REGRESSION_PREFIX, input_columns, load_labeled, log, measure_latency, resolve_run, sample_input, select_combos, stage_counts
from m1.plots import plot_reliability
from m1.predict import M1Predictor
from m1.report import ComboResult, fmt, predictions_frame, write_reports


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="학습된 M1 모델을 외부 테스트 파일로 평가 (재학습 없음)")
    ap.add_argument("--data", required=True, help="테스트용 엑셀/CSV 파일 또는 폴더 (혈압 컬럼 필요)")
    ap.add_argument("--run", default=None, help="artifacts 안의 run_id (기본: LATEST)")
    ap.add_argument("--latest", action="store_true", help="artifacts/LATEST 사용 (기본 동작)")
    ap.add_argument("--combo", default="all", help="쉼표 구분 조합 이름 또는 all")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--sample-frac", type=float, default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--latency-iters", type=int, default=300)
    ap.add_argument("--assume-no-med", action="store_true", help="복약 컬럼이 없을 때 비복약으로 간주해 라벨 생성 (명세 2-2 미적용)")
    a = ap.parse_args(argv)
    sheet = int(a.sheet) if str(a.sheet).isdigit() else a.sheet

    contract = Contract.load()
    run_id = resolve_run(a.artifacts, a.run)
    run_dir = Path(a.artifacts) / run_id
    combos = select_combos(run_dir, a.combo)
    eval_id = f"eval_{run_id}_{datetime.now():%Y%m%d_%H%M%S}"
    report_dir = Path(a.out) / eval_id
    report_dir.mkdir(parents=True, exist_ok=True)

    spec, y, load_info, label_info = load_labeled(a.data, contract, sheet=sheet, max_rows=a.max_rows, sample_frac=a.sample_frac, seed=a.seed, assume_no_med=a.assume_no_med)
    log(f"[1/3] 테스트 데이터 {load_info['rows_loaded']}행 로드 → 사용 {load_info['rows_used']}행, 라벨 {label_info['rows_labeled']}행 {label_info['stage_counts']}")
    log(f"[2/3] 평가할 모델: artifacts/{run_id} {combos}")

    results: list[ComboResult] = []
    row_status, excluded, n_valid, y_valid = {}, {}, 0, None
    for combo in combos:
        predictor = M1Predictor.load(run_dir / combo, contract)
        pre, model, meta = predictor.pre, predictor.model, predictor.meta
        res = pre.transform(spec)
        keep = res.status.isin(VALID_STATUSES).to_numpy()
        if not row_status:   # 행 상태는 첫 조합 기준으로 보고 (범위·필수 결측 규칙은 조합 간 동일, 선택 변수 범위만 다를 수 있음)
            row_status = {k: int(v) for k, v in res.status.value_counts().items()}
            excluded = {str(k): int(v) for k, v in res.problems[~keep].str.split(";").explode().value_counts().items()} if (~keep).any() else {}
            n_valid, y_valid = int(keep.sum()), y[keep]
        sp, yk = spec[keep].reset_index(drop=True), y[keep]
        if len(yk) == 0:
            raise ValueError("검증을 통과한 테스트 행이 없음")
        P = model.predict_proba(res.X[keep])
        ev = evaluate_split(yk, P, res.raw["male"][keep].to_numpy(), res.raw["age"][keep].to_numpy(), getattr(model, "stage_thresholds", None))
        ev["metrics"].update(htn_binary_summary(yk, P, float(meta.get("htn_threshold_youden", HTN_THRESHOLD_DEFAULT))))
        eq = check_equivalence(pre, sp, model)
        if not eq["ok"]:
            raise RuntimeError(f"{combo}: 단건 추론 경로가 배치 경로와 불일치 {eq}")
        inputs = sp[input_columns(pre, sp)]
        predictions = predictions_frame(inputs, yk, predictor.predict_frame(inputs), res.raw["missing_count"][keep].reset_index(drop=True))
        latency = measure_latency(predictor, sample_input(sp.iloc[0], contract), a.latency_iters)
        plot_reliability({"test": (yk, P)}, combo, report_dir / f"calibration_{combo}.png")
        confusion = pd.DataFrame(ev["confusion"], index=[f"true_{s}" for s in T.STAGES], columns=[f"pred_{s}" for s in T.STAGES])
        results.append(ComboResult(combo, meta["candidate"], meta["variant"], float(meta.get("fit_seconds", float("nan"))), {"test": ev["metrics"]},
                                   ev["subgroups"].assign(split="test"), confusion, predictions, latency, eq))
        mt = ev["metrics"]
        log(f"[3/3] {combo}: {len(yk)}행 | AUROC≥140/90 {fmt(mt['auroc_ge_140_90'])} | AUROC≥130/80 {fmt(mt['auroc_ge_130_80'])} | 기울기 {fmt(mt['cal_slope_ge_140_90'])} | "
            f"ECE(top) {fmt(mt['ece_top'])} | 정확도 {fmt(mt['accuracy'])} | p95 {fmt(latency['latency_p95_ms'], 2)} ms | 단건경로 동등성 {'일치' if eq['ok'] else '불일치'}")

    # 점검용 보조 혈압 회귀 평가 (있으면)
    bp_results = []
    for d in sorted(run_dir.glob(f"{BP_REGRESSION_PREFIX}*")):
        pre = Preprocessor.load(d / "preprocessor.json", contract)
        res = pre.transform(spec)
        keep = res.status.isin(VALID_STATUSES).to_numpy()
        m = bp_derived_metrics(y[keep], spec["__sbp"].to_numpy()[keep], spec["__dbp"].to_numpy()[keep], BPRegressor.load(d / "model.pkl").predict(res.X[keep]))
        bp_results.append({"model": d.name, "candidate": d.name[len(BP_REGRESSION_PREFIX):], **{f"{k}_test": (str(v) if isinstance(v, dict) else v) for k, v in m.items()}})
        log(f"[보조] {d.name}: RMSE sbp {m['rmse_sbp']:.2f} / dbp {m['rmse_dbp']:.2f} mmHg | 환산 단계 정확도 {m['stage_accuracy_from_bp']:.3f} | 환산 hypertension 정확도 {m['accuracy_htn_from_bp']:.3f}")

    cfg = {"data": a.data, "sheet": sheet, "max_rows": a.max_rows, "sample_frac": a.sample_frac, "seed": a.seed, "assume_no_med": a.assume_no_med,
           "candidates": list(dict.fromkeys(c.split("__")[0] for c in combos)), "variants": list(dict.fromkeys(c.split("__", 1)[1] for c in combos)),
           "model_run": run_id, "combos": combos, "eval_id": eval_id}
    ds = {"title": "M1 외부 테스트 평가", "model_run": run_id, "load": load_info, "labels": label_info, "row_status": row_status, "excluded_problems": excluded,
          "split": {"method": "external_test_file", "sizes": {"test": n_valid}}, "stage_by_split": {"test": stage_counts(y_valid)}, "skipped_variants": {}}
    write_reports(report_dir, eval_id, cfg, contract.version, ds, results, bp_results)
    (report_dir / "data_summary.json").write_text(json.dumps(ds, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (report_dir / "run_config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    log(f"완료: 보고서 {report_dir}/summary.md, 엑셀 {report_dir}/test_results.xlsx")
    return report_dir


if __name__ == "__main__":
    main()

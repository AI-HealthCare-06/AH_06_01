"""
[파일] train.py
[용도] 학습 실행 명령. --data 로 지정한 엑셀/CSV 를 읽어 라벨을 만들고(복약 컬럼이 없으면 --assume-no-med), 행을 검증·분할한 뒤
      후보 3종(ordinal, nested, lgbm) × 흡연/스트레스 변형(데이터에 없으면 생략)을 학습·평가한다. 점검용 보조 혈압 회귀 2종도 함께 학습한다.
      출력: reports/<run_id>/summary.md·test_results.xlsx·보정 곡선, artifacts/<run_id>/<조합>/ 모델. --test-data 를 주면 테스트는 외부 파일로 한다.
      학습·검증 행은 대치 없는 완전한 행만 쓴다(사용자 결정 2026-10-20, --keep-imputed-rows 로 되돌림). 테스트 분할은 대치 행 포함 전체.
[왜 필요한가] 명세 2-4(조합 비교)·2-5(평가 항목)를 한 번의 실행으로 재현 가능하게 묶는다. 데이터는 지정한 경로만 읽고 --max-rows / --sample-frac 로
             사용자가 양을 조절한다. seed 고정으로 같은 입력이면 같은 결과가 나온다. 단건 추론 경로의 동등성을 테스트 집합 전체로 검증하고 다르면 중단한다.
[쓰는 곳] 사용자가 직접 실행. tests/test_pipeline.py 가 run() 을 호출한다.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from m1.contract import Contract
from m1 import decision as D
from m1.evaluate import bp_derived_metrics, evaluate_split, htn_binary_summary, stage_metrics, youden_threshold
from m1.fast_path import check_equivalence
from m1.features import STATUS_OK, Preprocessor
from m1.models import CANDIDATES
from m1.models.bp_regression import BP_CANDIDATES
from m1.pipeline import BP_REGRESSION_PREFIX, VARIANTS, filter_valid, input_columns, load_labeled, log, measure_latency, sample_input, stage_counts
from m1.plots import plot_reliability
from m1.predict import M1Predictor
from m1.report import ComboResult, fmt, predictions_frame, write_reports
from m1.splits import make_splits

MIN_ROWS_WARNING = 50
VAL_SHARE_EXTERNAL_TEST = 0.15   # 외부 테스트 파일을 쓸 때 학습 파일 안에서 검증으로 떼는 비율


@dataclass
class TrainConfig:
    data: str
    sheet: int | str = 0
    max_rows: int | None = None
    sample_frac: float | None = None
    time_col: str | None = None
    seed: int = 42
    candidates: tuple[str, ...] = tuple(CANDIDATES)
    variants: tuple[str, ...] = tuple(VARIANTS)
    out_root: str = "reports"
    artifacts_root: str = "artifacts"
    latency_iters: int = 300
    run_id: str | None = None
    assume_no_med: bool = False   # 복약 컬럼이 없을 때 비복약 가정 (명세 2-2 미적용, 보고서에 기록)
    test_data: str | None = None  # 외부 테스트 파일/폴더 (있으면 학습 파일은 학습/검증에만 사용)
    complete_case_training: bool = True   # 학습·검증은 대치 없는 행(상태 ok)만 사용 (사용자 결정 2026-10-20). 테스트 분할은 전체


def _save_model(cdir: Path, model, pre: Preprocessor, meta: dict) -> None:
    cdir.mkdir(parents=True, exist_ok=True)
    model.save(cdir / "model.pkl")
    pre.save(cdir / "preprocessor.json")
    (cdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


# ---------------------------------------------------------------------------
# 단계 모델 조합 하나: 학습 → 평가 → 동등성 검증 → 저장 → 행 단위 결과·지연
# ---------------------------------------------------------------------------
def fit_combo(cname: str, vname: str, pre: Preprocessor, parts: dict, spec: pd.DataFrame, y: np.ndarray, splits: dict,
              contract: Contract, run_id: str, art_dir: Path, report_dir: Path, cfg: TrainConfig) -> ComboResult:
    combo = f"{cname}__{vname}"
    t0 = time.perf_counter()
    model = CANDIDATES[cname](seed=cfg.seed).fit(parts["train"].X, y[splits["train"]], parts["val"].X, y[splits["val"]], pre.monotone)
    fit_s = time.perf_counter() - t0
    P = {s: model.predict_proba(parts[s].X) for s in ("val", "test")}
    # 단계 판정 규칙(decision.py): 누적 임계값 τ 를 검증 분할에서 고르고, 규칙별 테스트 지표를 비교표로 남긴다
    model.stage_thresholds = D.fit_thresholds(P["val"], y[splits["val"]])
    rule_compare = []
    saved = (D.STAGE_RULE, D.STAGE_OBJECTIVE)
    for rule, obj in (("argmax", "accuracy"), ("cumulative", "accuracy"), ("cumulative", "balanced")):
        D.STAGE_RULE, D.STAGE_OBJECTIVE = rule, obj
        m, _ = stage_metrics(y[splits["test"]], P["test"], model.stage_thresholds)
        rule_compare.append({"rule": rule if rule == "argmax" else f"{rule}/{obj}", "tau": "-" if rule == "argmax" else str(model.stage_thresholds[obj]),
                             **{k: m[k] for k in ("accuracy", "adjacent_accuracy", "balanced_accuracy") + tuple(f"recall_{st}" for st in T.STAGES) + tuple(f"pred_share_{st}" for st in T.STAGES)}})
    D.STAGE_RULE, D.STAGE_OBJECTIVE = saved
    evals = {s: evaluate_split(y[splits[s]], P[s], parts[s].raw["male"].to_numpy(), parts[s].raw["age"].to_numpy(), model.stage_thresholds) for s in P}
    # 점검용 hypertension 이진 판정: P(htn) 을 0.5 와 검증 집합 Youden 임계값으로 이진화
    thr = youden_threshold(y[splits["val"]] == T.STAGE_INDEX["htn"], P["val"][:, T.STAGE_INDEX["htn"]])
    for s in P:
        evals[s]["metrics"].update(htn_binary_summary(y[splits[s]], P[s], thr))
    # 단건 경로(fast_path + predict_one)가 배치 경로와 같은지 테스트 집합 전체로 검증. 다르면 산출물을 쓰면 안 되므로 중단.
    eq = check_equivalence(pre, spec.iloc[splits["test"]], model)
    if not eq["ok"]:
        raise RuntimeError(f"{combo}: 단건 추론 경로가 배치 경로와 불일치 {eq}")

    cdir = art_dir / combo
    _save_model(cdir, model, pre, {
        "model_version": f"M1-{run_id}-{combo}", "feature_version": contract.version, "candidate": cname, "variant": vname,
        "optional_features": list(pre.optional), "run_id": run_id, "columns": pre.columns, "monotone": pre.monotone,
        "train_size": int(len(splits["train"])), "fit_seconds": fit_s, "fit_info": model.fit_info, "fast_path_check": eq, "htn_threshold_youden": thr,
        "stage_rule": D.STAGE_RULE, "stage_objective": D.STAGE_OBJECTIVE, "stage_thresholds": model.stage_thresholds,
    })
    # 저장된 산출물을 다시 읽어 실제 추론 경로로 테스트 집합 행 단위 결과와 단건 지연을 낸다
    predictor = M1Predictor.load(cdir, contract)
    test_inputs = spec.iloc[splits["test"]][input_columns(pre, spec)]
    predictions = predictions_frame(test_inputs, y[splits["test"]], predictor.predict_frame(test_inputs), parts["test"].raw["missing_count"])
    latency = measure_latency(predictor, sample_input(spec.iloc[splits["test"][0]], contract), cfg.latency_iters)

    plot_reliability({s: (y[splits[s]], P[s]) for s in P}, combo, report_dir / f"calibration_{combo}.png")
    subgroups = pd.concat([evals[s]["subgroups"].assign(split=s) for s in P], ignore_index=True)
    confusion = pd.DataFrame(evals["test"]["confusion"], index=[f"true_{s}" for s in T.STAGES], columns=[f"pred_{s}" for s in T.STAGES])
    return ComboResult(combo, cname, vname, fit_s, {s: evals[s]["metrics"] for s in P}, subgroups, confusion, predictions, latency, eq, rule_compare)


# ---------------------------------------------------------------------------
# 점검용 보조 혈압 회귀 (명세 2-1 에 따라 제품 출력 아님)
# ---------------------------------------------------------------------------
def fit_bp_regression(pre: Preprocessor, parts: dict, spec: pd.DataFrame, y: np.ndarray, splits: dict, contract: Contract,
                      run_id: str, art_dir: Path, seed: int) -> list[dict]:
    Y = {s: spec.iloc[idx][["__sbp", "__dbp"]].to_numpy(dtype=float) for s, idx in splits.items()}
    rows = []
    for cname, cls in BP_CANDIDATES.items():
        name = f"{BP_REGRESSION_PREFIX}{cname}"
        t0 = time.perf_counter()
        model = cls(seed=seed).fit(parts["train"].X, Y["train"], parts["val"].X, Y["val"], pre.monotone)
        fit_s = time.perf_counter() - t0
        metrics = {s: bp_derived_metrics(y[splits[s]], Y[s][:, 0], Y[s][:, 1], model.predict(parts[s].X)) for s in ("val", "test")}
        _save_model(art_dir / name, model, pre, {
            "model_version": f"M1aux-{run_id}-{name}", "feature_version": contract.version, "kind": "bp_regression", "candidate": cname,
            "purpose": "점검용 — 명세 2-1 에 따라 제품 출력 아님", "run_id": run_id, "columns": pre.columns, "monotone": pre.monotone,
            "fit_seconds": fit_s, "fit_info": model.fit_info, "metrics": metrics,
        })
        row = {"model": name, "candidate": cname, "fit_seconds": fit_s}
        for sp, m in metrics.items():
            row.update({f"{k}_{sp}": (str(v) if isinstance(v, dict) else v) for k, v in m.items()})
        rows.append(row)
        mt = metrics["test"]
        log(f"[보조] {name}: RMSE sbp {mt['rmse_sbp']:.2f} / dbp {mt['rmse_dbp']:.2f} mmHg | 환산 단계 정확도 {mt['stage_accuracy_from_bp']:.3f} | "
            f"환산 hypertension 정확도 {mt['accuracy_htn_from_bp']:.3f} 민감도 {mt['sensitivity_htn_from_bp']:.3f}")
    return rows


# ---------------------------------------------------------------------------
def run(cfg: TrainConfig) -> Path:
    contract = Contract.load()
    run_id = cfg.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    report_dir, art_dir = Path(cfg.out_root) / run_id, Path(cfg.artifacts_root) / run_id
    report_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)

    # 1~3. 학습 파일: 로드 → 라벨 → 행 검증
    spec, y, load_info, label_info = load_labeled(cfg.data, contract, sheet=cfg.sheet, max_rows=cfg.max_rows, sample_frac=cfg.sample_frac,
                                                  seed=cfg.seed, assume_no_med=cfg.assume_no_med)
    log(f"[1/5] 데이터 {load_info['rows_loaded']}행 로드 → 사용 {load_info['rows_used']}행 (파일 {len(load_info['files'])}개)")
    log(f"[2/5] 라벨 생성: {label_info['rows_labeled']}행 (제외 {label_info['rows_unlabeled']}행) 단계 분포 {label_info['stage_counts']}")
    pre0 = Preprocessor(contract).fit(spec)
    spec, y, row_status, excluded = filter_valid(pre0, spec, y)
    log(f"[3/5] 행 검증: 사용 {len(y)}행, 제외 {sum(row_status.values()) - len(y)}행 {row_status}")
    if len(y) < MIN_ROWS_WARNING:
        log(f"   경고: 사용 가능한 행이 {MIN_ROWS_WARNING} 미만 — 결과를 신뢰할 수 없음")
    data_summary = {"load": load_info, "labels": label_info, "row_status": row_status, "excluded_problems": excluded}

    # 4. 분할 (외부 테스트 파일이 있으면 학습 파일은 학습/검증만)
    time_vals = spec[cfg.time_col.strip().lower()] if cfg.time_col else None
    if cfg.test_data:
        spec_te, y_te, tload, tlabel = load_labeled(cfg.test_data, contract, sheet=cfg.sheet, seed=cfg.seed, assume_no_med=cfg.assume_no_med)
        spec_te, y_te, t_status, t_excluded = filter_valid(pre0, spec_te, y_te)
        tv, split_info = make_splits(y, time_vals, ratios=(1 - VAL_SHARE_EXTERNAL_TEST, VAL_SHARE_EXTERNAL_TEST, 0.0), seed=cfg.seed)
        splits = {"train": tv["train"], "val": tv["val"], "test": np.arange(len(y), len(y) + len(y_te))}
        spec, y = pd.concat([spec, spec_te], ignore_index=True), np.concatenate([y, y_te])
        split_info = {"method": f"{split_info['method']} (학습/검증) + 외부 테스트 파일", "sizes": {k: int(len(v)) for k, v in splits.items()}}
        data_summary.update({"test_load": {**tload, "rows_used": int(len(y_te))}, "test_labels": tlabel, "test_row_status": t_status, "test_excluded_problems": t_excluded})
        log(f"   외부 테스트 파일: {tload['rows_loaded']}행 → 라벨 {tlabel['rows_labeled']}행 → 검증 후 {len(y_te)}행 {t_status}")
    else:
        splits, split_info = make_splits(y, time_vals, seed=cfg.seed)
    if cfg.complete_case_training:
        complete = (pre0.transform(spec).status == STATUS_OK).to_numpy()
        before = {s: int(len(splits[s])) for s in ("train", "val")}
        for s in ("train", "val"):
            splits[s] = splits[s][complete[splits[s]]]
        split_info = {**split_info, "sizes": {k: int(len(v)) for k, v in splits.items()},
                      "complete_case_training": {"train_dropped": before["train"] - len(splits["train"]), "val_dropped": before["val"] - len(splits["val"])}}
        log(f"   완전한 행만 학습: train {before['train']}→{len(splits['train'])}, val {before['val']}→{len(splits['val'])} (대치 행 제외, 테스트는 전체 유지)")
    data_summary["split"] = split_info
    data_summary["stage_by_split"] = {s: stage_counts(y[idx]) for s, idx in splits.items()}
    log(f"[4/5] 분할 {split_info['method']}: {split_info['sizes']}")

    # 데이터에 아예 없는 선택 변수(smoking, stress_score)의 변형은 상수 열만 늘리므로 생략한다
    variants = [v for v in cfg.variants if all(spec[f].notna().any() for f in VARIANTS[v])]
    data_summary["skipped_variants"] = {v: [f for f in VARIANTS[v] if not spec[f].notna().any()] for v in cfg.variants if v not in variants}
    for v, absent in data_summary["skipped_variants"].items():
        log(f"   변형 {v} 생략: 데이터에 {absent} 없음")

    # 5. 조합 학습
    results: list[ComboResult] = []
    n_total = len(variants) * len(cfg.candidates)
    base_pre = base_parts = None
    for vname in variants:
        pre = Preprocessor(contract, VARIANTS[vname]).fit(spec.iloc[splits["train"]])
        parts = {s: pre.transform(spec.iloc[idx]) for s, idx in splits.items()}
        if vname == "base":
            base_pre, base_parts = pre, parts
        for cname in cfg.candidates:
            r = fit_combo(cname, vname, pre, parts, spec, y, splits, contract, run_id, art_dir, report_dir, cfg)
            results.append(r)
            mt, eq = r.metrics["test"], r.fast_path_check
            log(f"[5/5] ({len(results)}/{n_total}) {r.combo}: AUROC≥140/90 {fmt(mt['auroc_ge_140_90'])} | AUROC≥130/80 {fmt(mt['auroc_ge_130_80'])} | "
                f"기울기 {fmt(mt['cal_slope_ge_140_90'])} | ECE(top) {fmt(mt['ece_top'])} | 정확도 {fmt(mt['accuracy'])} ({D.STAGE_RULE}/{D.STAGE_OBJECTIVE}, 균형 {fmt(mt['balanced_accuracy'])}) | p95 {fmt(r.latency['latency_p95_ms'], 2)} ms | "
                f"단건경로 동등성 {'일치' if eq['ok'] else '불일치'} (max|Δx| {eq['max_abs_dx']:.1e}, {eq['rows']}행)")

    # 점검용 보조 혈압 회귀 (기본 변형 전처리)
    if base_pre is None:
        base_pre = Preprocessor(contract).fit(spec.iloc[splits["train"]])
        base_parts = {s: base_pre.transform(spec.iloc[idx]) for s, idx in splits.items()}
    bp_results = fit_bp_regression(base_pre, base_parts, spec, y, splits, contract, run_id, art_dir, cfg.seed)
    data_summary["bp_regression"] = bp_results

    write_reports(report_dir, run_id, asdict(cfg), contract.version, data_summary, results, bp_results)
    (report_dir / "data_summary.json").write_text(json.dumps(data_summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (report_dir / "run_config.json").write_text(json.dumps({**asdict(cfg), "run_id": run_id, "feature_version": contract.version}, ensure_ascii=False, indent=2), encoding="utf-8")
    (Path(cfg.artifacts_root) / "LATEST").write_text(run_id, encoding="utf-8")
    log(f"완료: 보고서 {report_dir}/summary.md, 엑셀 {report_dir}/test_results.xlsx, 모델 {art_dir}/")
    return report_dir


def parse_args(argv=None) -> TrainConfig:
    ap = argparse.ArgumentParser(description="M1 학습 (데이터는 --data 경로만 읽음)")
    ap.add_argument("--data", required=True, help="학습용 엑셀/CSV 파일 또는 폴더")
    ap.add_argument("--test-data", default=None, help="외부 테스트 파일/폴더. 주면 --data 는 학습/검증(85/15)에만 쓴다")
    ap.add_argument("--sheet", default=0, help="엑셀 시트 이름 또는 번호")
    ap.add_argument("--max-rows", type=int, default=None, help="학습 파일에서 앞에서부터 사용할 최대 행 수")
    ap.add_argument("--sample-frac", type=float, default=None, help="학습 파일 무작위 표본 비율 (0~1]")
    ap.add_argument("--time-col", default=None, help="시간 순서 컬럼 (있으면 과거/중간/최근 분할)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--candidates", default=",".join(CANDIDATES), help="쉼표 구분: ordinal,nested,lgbm")
    ap.add_argument("--variants", default=",".join(VARIANTS), help="쉼표 구분: base,smoking,stress,smoking_stress")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--latency-iters", type=int, default=300)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--assume-no-med", action="store_true", help="복약 컬럼이 없을 때 비복약으로 간주해 라벨 생성 (명세 2-2 복약 규칙 미적용)")
    ap.add_argument("--keep-imputed-rows", action="store_true", help="학습·검증에 대치된 행도 포함 (기본: 완전한 행만)")
    a = ap.parse_args(argv)
    return TrainConfig(data=a.data, sheet=int(a.sheet) if str(a.sheet).isdigit() else a.sheet, max_rows=a.max_rows, sample_frac=a.sample_frac,
                       time_col=a.time_col, seed=a.seed, candidates=tuple(c.strip() for c in a.candidates.split(",") if c.strip()),
                       variants=tuple(v.strip() for v in a.variants.split(",") if v.strip()), out_root=a.out, artifacts_root=a.artifacts,
                       latency_iters=a.latency_iters, run_id=a.run_id, assume_no_med=a.assume_no_med, test_data=a.test_data,
                       complete_case_training=not a.keep_imputed_rows)


if __name__ == "__main__":
    run(parse_args())

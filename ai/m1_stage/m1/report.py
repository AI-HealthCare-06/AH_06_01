"""
[파일] m1/report.py
[용도] 학습·평가 보고서 작성. 조합별 결과(ComboResult)를 모아 summary.md 와 test_results.xlsx 를 만든다.
      엑셀 시트: info, summary(테스트 지표 전체), pass_check(합격선), htn_binary(점검용 hypertension 이진), bp_regression(점검용 보조 회귀),
      val_vs_test(보정 비교, 학습 실행만), subgroups, confusion, fast_path_check(단건 경로 동등성), pred_<조합>(테스트 집합 행 단위).
[왜 필요한가] train.py 는 학습 흐름만 맡고 표·문서 형식은 여기로 분리해 둘 다 읽기 쉽게 한다. 테스트 집합의 행 단위 결과를 엑셀로 남겨
             사용자가 어떤 입력에서 어떤 확률이 나왔는지 직접 확인할 수 있게 한다.
[쓰는 곳] train.py, evaluate_cli.py, profile_data.py·predict_cli.py(md_table)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from .decision import STAGE_OBJECTIVE, STAGE_RULE

# 합격선. auroc_ge_140_90 ≥ 0.70 은 사용자 확정(2026-10-19). 나머지는 명세 2-5 의 '예' 값 그대로(미확정).
# 모델 선택은 사용자가 한다 — 코드는 충족/미충족만 표시한다.
PASS_CRITERIA = {
    "auroc_ge_140_90": (">=", 0.70),
    "cal_slope_ge_140_90": ("between", 0.9, 1.1),
    "sex_ece_gap_ge_140_90": ("<=", 0.05),
    "latency_p95_ms": ("<=", 20.0),
}
SUMMARY_COLUMNS = [
    "combo", "auroc_ge_130_80", "auprc_ge_130_80", "auroc_ge_140_90", "auprc_ge_140_90",
    "cal_slope_ge_140_90", "cal_intercept_ge_140_90", "ece_ge_130_80", "ece_ge_140_90", "ece_top",
    "accuracy", "adjacent_accuracy", "sex_ece_gap_ge_140_90", "latency_p95_ms", "fit_seconds",
]
CALIB_METRICS = ("auroc", "cal_slope", "cal_intercept", "ece")
HTN_COLUMNS = ["combo", "prevalence_ge_140_90", "accuracy_htn_all_negative", "htn_threshold_youden",
               "accuracy_htn_0.5", "sensitivity_htn_0.5", "specificity_htn_0.5", "ppv_htn_0.5", "n_pred_pos_htn_0.5",
               "accuracy_htn_youden", "sensitivity_htn_youden", "specificity_htn_youden", "ppv_htn_youden", "n_pred_pos_htn_youden"]
BP_COLUMNS = ["model", "rmse_sbp_val", "rmse_sbp_test", "mae_sbp_test", "bias_sbp_test", "r2_sbp_test", "rmse_dbp_val", "rmse_dbp_test", "mae_dbp_test",
              "bias_dbp_test", "r2_dbp_test", "stage_accuracy_from_bp_test", "stage_adjacent_accuracy_from_bp_test",
              "accuracy_htn_from_bp_test", "sensitivity_htn_from_bp_test", "specificity_htn_from_bp_test", "stage_counts_from_bp_test"]
MAX_COL_WIDTH = 40


@dataclass
class ComboResult:
    combo: str
    candidate: str
    variant: str
    fit_seconds: float
    metrics: dict[str, dict]       # split → 지표
    subgroups: pd.DataFrame        # split 열 포함
    confusion: pd.DataFrame        # 테스트 집합
    predictions: pd.DataFrame      # 테스트 집합 행 단위
    latency: dict
    fast_path_check: dict          # 단건 경로 vs 배치 경로 동등성 (fast_path.check_equivalence)
    rule_compare: list[dict] | None = None   # 단계 판정 규칙별(argmax / cumulative-accuracy / cumulative-balanced) 테스트 지표


# ---------------------------------------------------------------------------
# 표 도우미
# ---------------------------------------------------------------------------
def fmt(v, nd: int = 3) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "n/a"
    if isinstance(v, (bool, np.bool_)):
        return str(bool(v))
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return f"{v:.{nd}f}" if nd < 6 else f"{v:.2e}"
    return str(v)


def md_table(df: pd.DataFrame, nd: int = 3) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(fmt(r[c], nd) for c in cols) + " |" for _, r in df.iterrows()]
    return "\n".join(lines)


def check_criteria(row: dict) -> dict[str, str]:
    out = {}
    for k, rule in PASS_CRITERIA.items():
        v = row.get(k)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out[k] = "n/a"
        elif rule[0] == ">=":
            out[k] = "충족" if v >= rule[1] else "미충족"
        elif rule[0] == "<=":
            out[k] = "충족" if v <= rule[1] else "미충족"
        else:
            out[k] = "충족" if rule[1] <= v <= rule[2] else "미충족"
    return out


def predictions_frame(inputs: pd.DataFrame, y_true: np.ndarray, outputs: list[dict], missing_count: pd.Series) -> pd.DataFrame:
    """테스트 집합 행 단위 결과: 입력값 + 실제 단계 + 확률 + 예측 단계 + 이유 코드."""
    df = inputs.reset_index(drop=True).copy()
    df.insert(0, "row", np.arange(len(df)))
    df["true_stage"] = [T.STAGES[i] for i in y_true]
    for s in T.STAGES:
        df[f"p_{s}"] = [(o["stage_probs"] or {}).get(s, np.nan) for o in outputs]
    df["stage_top"] = [o["stage_top"] for o in outputs]
    df["correct"] = df["stage_top"] == df["true_stage"]
    df["risk_level"] = [o["risk_level"] for o in outputs]
    df["reason_codes"] = [",".join(o["reason_codes"]) for o in outputs]
    df["data_quality"] = [o["data_quality"] for o in outputs]
    df["missing_count"] = missing_count.to_numpy()
    return df


# ---------------------------------------------------------------------------
# 집계 표
# ---------------------------------------------------------------------------
def summary_table(results: list[ComboResult]) -> pd.DataFrame:
    rows = [{"combo": r.combo, "candidate": r.candidate, "variant": r.variant, **r.metrics["test"], **r.latency, "fit_seconds": r.fit_seconds} for r in results]
    return pd.DataFrame(rows)


def pass_table(summary: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame([{"combo": r["combo"], **check_criteria(r.to_dict())} for _, r in summary.iterrows()])


def calibration_table(results: list[ComboResult]) -> pd.DataFrame:
    rows = []
    for r in results:
        if "val" not in r.metrics:
            continue
        mv, mt = r.metrics["val"], r.metrics["test"]
        for name in T.CUMULATIVE_THRESHOLDS:
            for m in CALIB_METRICS:
                k = f"{m}_{name}"
                rows.append({"combo": r.combo, "threshold": name, "metric": m, "val": mv[k], "test": mt[k], "test_minus_val": mt[k] - mv[k]})
    return pd.DataFrame(rows)


def confusion_table(results: list[ComboResult]) -> pd.DataFrame:
    parts = []
    for r in results:
        cm = r.confusion.reset_index().rename(columns={"index": "true"})
        cm.insert(0, "combo", r.combo)
        parts.append(cm)
    return pd.concat(parts, ignore_index=True)


def rule_table(results: list[ComboResult]) -> pd.DataFrame:
    rows = [{"combo": r.combo, **row} for r in results for row in (r.rule_compare or [])]
    return pd.DataFrame(rows)


def fast_path_table(results: list[ComboResult]) -> pd.DataFrame:
    return pd.DataFrame([{"combo": r.combo, **r.fast_path_check} for r in results])


def subgroup_table(results: list[ComboResult], split: str = "test") -> pd.DataFrame:
    parts = []
    for r in results:
        sub = r.subgroups[r.subgroups["split"] == split].copy()
        sub.insert(0, "combo", r.combo)
        parts.append(sub)
    return pd.concat(parts, ignore_index=True)


# ---------------------------------------------------------------------------
# 출력
# ---------------------------------------------------------------------------
def _autowidth(ws) -> None:
    for col in ws.columns:
        width = max((len(str(c.value)) for c in col if c.value is not None), default=8)
        ws.column_dimensions[col[0].column_letter].width = min(width + 2, MAX_COL_WIDTH)


def write_excel(path: Path, info: list[tuple[str, str]], results: list[ComboResult], summary: pd.DataFrame, calib: pd.DataFrame,
                bp_results: list[dict] | None = None) -> None:
    sheets = {
        "info": pd.DataFrame(info, columns=["항목", "값"]),
        "summary": summary,          # 전체 지표(검증 집합 지표 포함 안 함; val_vs_test 참조)
        "pass_check": pass_table(summary),
        "htn_binary": summary[[c for c in HTN_COLUMNS if c in summary.columns]],
        **({"bp_regression": pd.DataFrame(bp_results)} if bp_results else {}),
        **({"val_vs_test": calib} if len(calib) else {}),
        "subgroups": subgroup_table(results),
        "confusion": confusion_table(results),
        "fast_path_check": fast_path_table(results),
        **({"stage_rules": rule_table(results)} if any(r.rule_compare for r in results) else {}),
        **{f"pred_{r.combo}"[:31]: r.predictions for r in results},
    }
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        for name, df in sheets.items():
            df.to_excel(xw, sheet_name=name, index=False)
            ws = xw.sheets[name]
            ws.freeze_panes = "A2"
            _autowidth(ws)


def write_summary_md(path: Path, run_id: str, cfg: dict, feature_version: str, ds: dict, results: list[ComboResult], summary: pd.DataFrame, calib: pd.DataFrame,
                     bp_results: list[dict] | None = None) -> None:
    lb, ld = ds["labels"], ds["load"]
    L = [f"# {ds.get('title', 'M1 학습 보고')} — run {run_id}\n", "## 1. 실행 정보\n"]
    L.append(f"- 데이터 경로: `{ld['path']}` ({len(ld['files'])}개 파일, {sum(int(f['rows']) for f in ld['files'])}행; 파일 이름은 기록하지 않음)")
    L.append(f"- 로드 {ld['rows_loaded']}행 → 사용 {ld['rows_used']}행 (max_rows={ld['max_rows']}, sample_frac={ld['sample_frac']})")
    if ds.get("test_load"):
        tl = ds["test_load"]
        L.append(f"- 외부 테스트 파일: `{tl['path']}` ({len(tl['files'])}개 파일, {sum(int(f['rows']) for f in tl['files'])}행) → 사용 {tl['rows_used']}행")
    if ds.get("model_run"):
        L.append(f"- 평가한 모델: artifacts/{ds['model_run']} (재학습 없음)")
    L.append(f"- seed {cfg['seed']}, 피처 계약 v{feature_version}, 분할 {ds['split']['method']} {ds['split']['sizes']}")
    if ds["split"].get("complete_case_training"):
        cc = ds["split"]["complete_case_training"]
        L.append(f"- 학습·검증은 대치 없는 행만 사용: train 에서 {cc['train_dropped']}행, val 에서 {cc['val_dropped']}행 제외(테스트 분할은 대치 행 포함 전체)")
    L.append(f"- 후보 {list(cfg['candidates'])} × 변형 {list(cfg['variants'])}" + (f" (생략: {ds['skipped_variants']})" if ds.get("skipped_variants") else ""))
    L.append("- 행 단위 테스트 결과·전체 표: `test_results.xlsx`\n")
    L.append("## 2. 라벨·행 검증\n")
    L.append(f"- 수축기 출처: {lb['sbp_source']} / 이완기 출처: {lb['dbp_source']} / 복약 출처: {lb['htn_med_source']}")
    if lb.get("med_policy") == "assume_false":
        L.append("- **주의**: 복약 컬럼이 없어 전원 비복약으로 가정했다. 명세 2-2 의 '복약 → 고혈압' 규칙이 적용되지 않았으므로 약으로 조절된 사람은 측정 혈압 단계로 라벨링되었다.")
    L.append(f"- 라벨 생성 {lb['rows_labeled']}행, 제외 {lb['rows_unlabeled']}행 (혈압·복약 결측: {lb['unlabeled_reasons']})")
    L.append(f"- 단계 분포(라벨 생성 행): {lb['stage_counts']}")
    L.append(f"- 행 상태(기본 변형 기준): {ds['row_status']} / 제외 사유: {ds['excluded_problems']}")
    L.append(f"- 분할별 단계 분포: {ds['stage_by_split']}\n")
    L.append("## 3. 테스트 집합 지표 (조합별)\n")
    L.append(md_table(summary[[c for c in SUMMARY_COLUMNS if c in summary.columns]]))
    L.append("\n임계값별 유병률(AUPRC 기준선): " + ", ".join(f"{n} {fmt(summary.iloc[0][f'prevalence_{n}'])}" for n in T.CUMULATIVE_THRESHOLDS) + "\n")
    L.append("## 4. 합격선 점검 (AUROC ≥140/90 ≥ 0.70 은 사용자 확정, 나머지는 명세 2-5 예시값 — 미확정)\n")
    L.append(md_table(pass_table(summary)))
    L.append("\n기준: " + "; ".join(f"{k} {' '.join(map(str, v))}" for k, v in PASS_CRITERIA.items()) + "\n")
    L.append("## 5. 검증 vs 테스트 보정 비교\n")
    if len(calib) == 0:
        L.append("검증 집합 지표 없음(학습된 모델을 외부 파일로 평가한 실행). 학습 당시 검증 지표는 그 run 의 보고서를 본다.\n")
    else:
        L.append("주의: nested·lgbm 은 Platt 보정기를 검증 집합에서 적합하므로 검증 집합의 기울기 1.000·절편 0.000 은 구조상 나오는 값이다. 보정 판단은 테스트 열을 본다.\n")
    for name in (T.CUMULATIVE_THRESHOLDS if len(calib) else ()):
        sub = calib[calib["threshold"] == name].pivot(index="combo", columns="metric", values=["val", "test"])
        sub.columns = [f"{a}_{b}" for a, b in sub.columns]
        sub = sub.reset_index()[["combo"] + [f"{s}_{m}" for m in CALIB_METRICS for s in ("val", "test")]]
        L.append(f"### {name}\n\n" + md_table(sub) + "\n")
    L.append("## 6. 하위군 (성별 × 연령대, 테스트 집합)\n")
    st = subgroup_table(results)
    st = st[st["age_group"] != "all"].assign(cell=lambda d: d["sex"] + "/" + d["age_group"])
    for metric in ("auroc_ge_140_90", "ece_ge_140_90", "auroc_ge_130_80", "ece_ge_130_80"):
        L.append(f"### {metric}\n\n" + md_table(st.pivot(index="combo", columns="cell", values=metric).reset_index()) + "\n")
    ncell = st.pivot(index="combo", columns="cell", values="n").iloc[0]
    L.append("셀 표본 수: " + ", ".join(f"{c} {int(v)}" for c, v in ncell.items()) + "\n")
    L.append("## 7. 혼동행렬 (테스트 집합, 행=실제, 열=예측 최상위 단계)\n")
    for r in results:
        L.append(f"### {r.combo}\n\n" + md_table(r.confusion.reset_index().rename(columns={"index": ""}), nd=0) + "\n")
    L.append("## 8. 보정 곡선 그림\n")
    L += [f"- `calibration_{r.combo}.png`" for r in results]
    L.append("\n## 9. 단건 추론 경로 동등성 검증 (테스트 집합 전체, 배치 경로 vs fast_path)\n")
    L.append(md_table(fast_path_table(results)[["combo", "rows", "max_abs_dx", "max_abs_dp", "max_abs_dcontrib", "status_mismatch", "problems_mismatch",
                                                 "flags_mismatch", "observed_mismatch", "raw_mismatch", "ok"]], nd=12))
    L.append("\n## 10. 사용자 결정이 필요한 항목 (근거 없음 또는 명세 미정의 — 임시값 사용 중)\n")
    L += [
        f"- 단계 판정 규칙 m1/decision.py STAGE_RULE = {STAGE_RULE}, 목적 {STAGE_OBJECTIVE} (stage_top·risk_level·정확도·step 공통). 10b 절 비교 후 확정",
        f"- insufficient 판정 결측 플래그 수 INSUFFICIENT_MISSING_COUNT = {T.INSUFFICIENT_MISSING_COUNT}",
        f"- age·alcohol 이유 코드 경계: 데이터 기반 확정(REASON_RULE={T.REASON_RULE}; age {T.AGE_HIGH_YEARS[T.REASON_RULE]}, 음주 잔/일 {T.ALCOHOL_HIGH_DRINKS_PER_DAY[T.REASON_RULE]} 또는 폭음). 여성 음주 코드는 테스트 집합에서 RR 0.76(사용자 인지 후 유지)",
        "- sodium_risk_score 피처 제거(계약 1.2.0) — 명세 2-3 과 다름",
        f"- 허리둘레 대치 BMI 구간 BMI_BINS = {T.BMI_BINS} (≥25 외 경계 근거 없음)",
        "- fasting_glucose / resting_hr / education_years 범위 미정의 → 범위 검사 생략",
        "- smoking / stress_score 결측 처리(명세 미정의): never 대치 / 중앙값 대치 + 플래그",
        "- 중첩 이진·LightGBM: 4단계 출력을 위해 P(≥elevated) 이진을 추가(명세는 ≥130/80, ≥140/90 두 개)",
        "- Platt 보정과 조기 종료(LightGBM)·L2 선택이 같은 검증 집합을 사용",
        "- 합격선·최종 모델 선택: 사용자 결정",
    ]
    if any(r.rule_compare for r in results):
        L.append(f"\n## 10b. 단계 판정 규칙 비교 (테스트 집합; 적용 중: {STAGE_RULE}/{STAGE_OBJECTIVE})\n")
        L.append("argmax = 최대 확률. cumulative = P(≥elevated)≥τ1 / P(≥prehtn)≥τ2 / P(≥htn)≥τ3 중 넘는 가장 높은 단계, τ 는 검증 분할에서 목적함수별로 탐색.\n")
        L.append(md_table(rule_table(results), nd=3))
    if "accuracy_htn_0.5" in summary.columns:
        L.append("\n## 11. hypertension 이진 판정 (점검용)\n")
        L.append("hypertension(= 측정 혈압 ≥140/90, 비복약 가정에서 stage htn 과 동일)을 P(htn) 으로 이진화한 결과. "
                 "accuracy_htn_all_negative 는 전부 0 으로 판정했을 때의 정확도(= 1 − 유병률)이므로 정확도만으로는 판정 성능을 읽을 수 없다. "
                 "Youden 임계값은 검증 집합에서 민감도+특이도−1 을 최대로 하는 값이다.\n")
        L.append(md_table(summary[[c for c in HTN_COLUMNS if c in summary.columns]]))
    if bp_results:
        L.append("\n## 12. 보조 혈압 회귀 (점검용 — 명세 2-1 에 따라 mmHg 점 추정은 제품 출력이 아님)\n")
        L.append("같은 피처·같은 부호 제약으로 수축기·이완기를 회귀한 결과와, 그 예측 혈압으로 환산한 단계·hypertension 의 점검 지표. "
                 "정답 혈압과 비교해 오차를 확인하는 용도로만 쓴다.\n")
        L.append(md_table(pd.DataFrame(bp_results)[[c for c in BP_COLUMNS if c in bp_results[0]]], nd=3))
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def write_reports(report_dir: Path, run_id: str, cfg: dict, feature_version: str, ds: dict, results: list[ComboResult],
                  bp_results: list[dict] | None = None) -> None:
    summary, calib = summary_table(results), calibration_table(results)
    ld = ds["load"]
    info = [
        ("run_id", run_id), ("데이터 경로", ld["path"]), ("파일", f"{len(ld['files'])}개 ({sum(int(f['rows']) for f in ld['files'])}행; 이름 비공개)"),
        ("로드 행", ld["rows_loaded"]), ("사용 행", ld["rows_used"]), ("max_rows", ld["max_rows"]), ("sample_frac", ld["sample_frac"]),
        ("seed", cfg["seed"]), ("feature_version", feature_version), ("분할", f"{ds['split']['method']} {ds['split']['sizes']}"),
        ("라벨 분포", str(ds["labels"]["stage_counts"])), ("행 상태", str(ds["row_status"])), ("제외 사유", str(ds["excluded_problems"])),
        ("후보", ", ".join(cfg["candidates"])), ("변형", ", ".join(cfg["variants"])), ("생략 변형", str(ds.get("skipped_variants", {}))),
        ("복약 처리", ds["labels"]["htn_med_source"]),
    ]
    if ds.get("test_load"):
        info.append(("외부 테스트 파일", f"{ds['test_load']['path']} ({ds['test_load']['rows_used']}행)"))
    if ds.get("model_run"):
        info.append(("평가한 모델 run", ds["model_run"]))
    write_excel(report_dir / "test_results.xlsx", info, results, summary, calib, bp_results)
    write_summary_md(report_dir / "summary.md", run_id, cfg, feature_version, ds, results, summary, calib, bp_results)

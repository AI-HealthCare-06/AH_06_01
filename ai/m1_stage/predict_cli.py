"""
[파일] predict_cli.py
[용도] 추론 명령. (1) 단건: 사용자 입력 JSON → 혈압 단계 확률(명세 2-6). (2) 배치: 혈압·복약을 비운 라벨 없는 엑셀/CSV →
      reports/predict_<run>_<시각>/ 에 step_filled.xlsx(person_id + step, 조합별 시트), predictions.xlsx(행 단위 상세·분포 요약·점검용 열), summary.md.
[왜 필요한가] 최종 산출물은 "사용자가 정보를 입력하면 단계를 내는 모델"이다. 앱 연동 전에 단건 경로를 그대로 확인하고,
             사용자가 정답을 가진 테스트 파일의 혈압을 비워 넘기면 모델이 step 을 채워 정답률을 확인할 수 있게 한다.
             혈압값이 채워진 행이나 복약 행은 단건과 같은 규칙으로 not_applicable 처리한다.
[쓰는 곳] 사용자가 직접 실행. tests/test_pipeline.py 가 main() 을 호출한다.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

import thresholds as T
from m1 import decision as D
from m1.batch import DATA_QUALITIES, bp_frames, output_frame, step_frame, summarize, write_sheets
from m1.contract import Contract
from m1.data_io import load_table
from m1.evaluate import HTN_THRESHOLD_DEFAULT
from m1.features import normalize_columns
from m1.pipeline import log, resolve_run, select_combos
from m1.predict import M1Predictor
from m1.report import md_table


def predict_batch(a) -> Path:
    contract = Contract.load()
    run_id = resolve_run(a.artifacts, a.run)
    run_dir = Path(a.artifacts) / run_id
    combos = select_combos(run_dir, a.combo)
    df, load_info = load_table(a.data, sheet=a.sheet, max_rows=a.max_rows, sample_frac=a.sample_frac, seed=a.seed)
    df = normalize_columns(df)
    out_dir = Path(a.out) / f"predict_{run_id}_{datetime.now():%Y%m%d_%H%M%S}"
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"[1/2] 데이터 {load_info['rows_loaded']}행 로드 → 사용 {load_info['rows_used']}행 | 모델 artifacts/{run_id} {combos}")

    detail, steps, rows = {}, {}, []
    predictor = None
    for combo in combos:
        predictor = M1Predictor.load(run_dir / combo, contract)
        frame = output_frame(df, predictor.predict_frame(df), float(predictor.meta.get("htn_threshold_youden", HTN_THRESHOLD_DEFAULT)))
        detail[f"pred_{combo}"], steps[f"step_{combo}"] = frame, step_frame(df, frame)
        r = summarize(combo, frame)
        rows.append(r)
        log(f"[2/2] {combo}: 산출 {r['scored']}/{r['rows']}행 | 품질 " + ", ".join(f"{q} {r[f'dq_{q}']}" for q in DATA_QUALITIES if r[f"dq_{q}"])
            + " | 예측 단계 " + ", ".join(f"{s} {r[f'top_{s}']}" for s in ("normal", "elevated", "prehtn", "htn")))
    bp = bp_frames(run_dir, contract, df, predictor)
    for name, f in bp.items():
        log(f"[보조] {name}: 예측 혈압 평균 sbp {f['pred_sbp'].mean():.1f} / dbp {f['pred_dbp'].mean():.1f} mmHg ({int(f['pred_sbp'].notna().sum())}행)")

    summary = pd.DataFrame(rows)
    info = [("model_run", run_id), ("데이터 경로", load_info["path"]), ("파일", "; ".join(f"{f['file']} ({f['rows']}행)" for f in load_info["files"])),
            ("로드 행", load_info["rows_loaded"]), ("사용 행", load_info["rows_used"]), ("max_rows", load_info["max_rows"]), ("sample_frac", load_info["sample_frac"]),
            ("조합", ", ".join(combos)), ("feature_version", contract.version), ("이유 코드 규칙", T.REASON_RULE), ("단계 판정 규칙", f"{D.STAGE_RULE}/{D.STAGE_OBJECTIVE}"), ("라벨", "없음 (추론 전용 — 지표 계산 안 함)")]
    write_sheets(out_dir / "step_filled.xlsx", steps)
    write_sheets(out_dir / "predictions.xlsx", {"info": pd.DataFrame(info, columns=["항목", "값"]), "summary": summary, **detail, **bp})
    L = [f"# M1 배치 추론 — {out_dir.name}\n",
         "라벨이 없는 데이터이므로 지표는 계산하지 않는다. `step_filled.xlsx` 는 person_id 와 step(= stage_top) 두 열(조합별 시트), "
         "`predictions.xlsx` 는 행 단위 상세다. `pred_hypertension`(P(htn) ≥ 0.5)·`pred_hypertension_youden` 과 `bp_<후보>` 시트의 "
         "`pred_sbp`/`pred_dbp`/`pred_stage_from_bp` 는 점검용이며 명세 2-1 에 따라 mmHg 점 추정은 제품 출력이 아니다.\n",
         "## 실행 정보\n", *[f"- {k}: {v}" for k, v in info], "\n## 조합별 분포\n", md_table(summary.drop(columns=["top_reason_codes"]), nd=3),
         "\n## 이유 코드 상위 빈도 (산출 행 기준)\n", *[f"- {r['combo']}: {r['top_reason_codes']}" for r in rows]]
    (out_dir / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    log(f"완료: {out_dir}/step_filled.xlsx (person_id + step), {out_dir}/predictions.xlsx (상세), {out_dir}/summary.md")
    return out_dir


def predict_single(a) -> dict:
    contract = Contract.load()
    run_dir = Path(a.model_dir).parent if a.model_dir else Path(a.artifacts) / resolve_run(a.artifacts, a.run)
    combos = [Path(a.model_dir).name] if a.model_dir else select_combos(run_dir, a.combo)
    payload = json.loads(a.input) if a.input else json.loads(Path(a.input_file).read_text(encoding="utf-8"))
    result = {}
    for combo in combos:
        predictor = M1Predictor.load(run_dir / combo, contract)
        result[combo] = [predictor.predict(p) for p in payload] if isinstance(payload, list) else predictor.predict(payload)
    out = result if len(combos) > 1 else result[combos[0]]
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="M1 추론: 단건(JSON) 또는 배치(라벨 없는 엑셀/CSV)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--input", help="단건: JSON 문자열")
    g.add_argument("--input-file", help="단건: JSON 파일 (객체 하나 또는 객체 배열)")
    g.add_argument("--data", help="배치: 엑셀/CSV 파일 또는 폴더 (혈압·복약 비움)")
    ap.add_argument("--model-dir", default=None, help="단건: 조합 폴더 직접 지정 (artifacts/<run>/<조합>)")
    ap.add_argument("--run", default=None, help="artifacts 안의 run_id (기본: LATEST)")
    ap.add_argument("--latest", action="store_true", help="artifacts/LATEST 사용 (기본 동작)")
    ap.add_argument("--combo", default="all", help="쉼표 구분 조합 이름 또는 all")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--sample-frac", type=float, default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--reason-rule", default=None, choices=list(T.AGE_HIGH_YEARS), help="이유 코드 경계 규칙 (기본 thresholds.REASON_RULE)")
    ap.add_argument("--stage-rule", default=None, choices=["argmax", "cumulative"], help="단계 판정 규칙 (기본 decision.STAGE_RULE)")
    ap.add_argument("--stage-objective", default=None, choices=["accuracy", "balanced"], help="cumulative 규칙의 τ 목적 (기본 decision.STAGE_OBJECTIVE)")
    a = ap.parse_args(argv)
    a.sheet = int(a.sheet) if str(a.sheet).isdigit() else a.sheet
    if a.reason_rule:
        T.REASON_RULE = a.reason_rule
    if a.stage_rule:
        D.STAGE_RULE = a.stage_rule
    if a.stage_objective:
        D.STAGE_OBJECTIVE = a.stage_objective
    return predict_batch(a) if a.data else predict_single(a)


if __name__ == "__main__":
    main()

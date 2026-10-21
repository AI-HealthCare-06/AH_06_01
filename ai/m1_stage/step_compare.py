"""
[파일] step_compare.py
[용도] 라벨 없는 테스트 파일에 대해 단계 판정 규칙 세 가지(argmax, cumulative/accuracy, cumulative/balanced)의 step 을 한 파일에 나란히 낸다.
      모델별 시트: person_id, step_argmax, step_cum_accuracy, step_cum_balanced (+ 산출 불가 사유).
[왜 필요한가] 사용자가 정답과 비교해 규칙별 정답률·단계별 정답률을 한 번에 계산할 수 있게 하기 위해서.
[쓰는 곳] 사용자가 직접 실행. 결과 reports/step_compare_<시각>/step_by_rule.xlsx
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import pandas as pd

from m1 import decision as D
from m1.batch import ID_COLUMN, write_sheets
from m1.contract import Contract
from m1.data_io import load_table
from m1.features import normalize_columns
from m1.pipeline import log, resolve_run, select_combos
from m1.predict import M1Predictor

RULES = (("argmax", "accuracy"), ("cumulative", "accuracy"), ("cumulative", "balanced"))


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--run", default=None)
    ap.add_argument("--latest", action="store_true", help="artifacts/LATEST 사용 (기본 동작)")
    ap.add_argument("--combo", default="all")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--sheet", default=0)
    a = ap.parse_args(argv)
    contract = Contract.load()
    run_id = resolve_run(a.artifacts, a.run)
    run_dir = Path(a.artifacts) / run_id
    combos = select_combos(run_dir, a.combo)
    df, info = load_table(a.data, sheet=int(a.sheet) if str(a.sheet).isdigit() else a.sheet)
    df = normalize_columns(df)
    ids = df[ID_COLUMN] if ID_COLUMN in df.columns else pd.Series(range(len(df)), name="row")
    out = Path(a.out) / f"step_compare_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    sheets, summary = {}, []
    saved = (D.STAGE_RULE, D.STAGE_OBJECTIVE)
    for combo in combos:
        pr = M1Predictor.load(run_dir / combo, contract)
        table = pd.DataFrame({ids.name or ID_COLUMN: ids.to_numpy()})
        for rule, obj in RULES:
            D.STAGE_RULE, D.STAGE_OBJECTIVE = rule, obj
            outs = pr.predict_frame(df)
            col = "step_argmax" if rule == "argmax" else f"step_cum_{obj}"
            table[col] = [o["stage_top"] if o["stage_top"] else o["data_quality"] for o in outs]
            counts = table[col].value_counts()
            summary.append({"combo": combo, "rule": col, **{s: int(counts.get(s, 0)) for s in ("normal", "elevated", "prehtn", "htn")},
                            "unscored": int(len(table) - counts.reindex(["normal", "elevated", "prehtn", "htn"]).fillna(0).sum())})
        table["tau_cum_accuracy"] = str(pr.model.stage_thresholds["accuracy"])
        table["tau_cum_balanced"] = str(pr.model.stage_thresholds["balanced"])
        sheets[f"steps_{combo}"[:31]] = table
        log(f"{combo}: 완료 ({len(table)}행)")
    D.STAGE_RULE, D.STAGE_OBJECTIVE = saved
    sm = pd.DataFrame(summary)
    write_sheets(out / "step_by_rule.xlsx", {"summary": sm, **sheets})
    print(sm.to_string(index=False))
    print(f"완료: {out}/step_by_rule.xlsx")
    return out


if __name__ == "__main__":
    main()

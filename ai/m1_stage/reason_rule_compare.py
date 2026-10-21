"""
[파일] reason_rule_compare.py
[용도] 이유 코드 경계 규칙(thresholds.REASON_RULE: youden / rr125)을 내부 테스트 분할에서 비교한다. 규칙별 코드 빈도, 행당 코드 수,
      age·alcohol 코드가 붙은 집단과 안 붙은 집단의 실제 ≥130/80 비율(성별)을 표로 낸다. 모델 확률은 바뀌지 않으므로 재학습 없음.
[왜 필요한가] 사용자 결정(2026-10-20): 문헌 경계가 없는 age·alcohol 은 데이터 경계를 쓰되 두 규칙을 시험해 고른다.
[쓰는 곳] 사용자가 직접 실행. 결과 reports/reason_rules_<시각>/.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from m1.contract import Contract
from m1.features import Preprocessor
from m1.pipeline import filter_valid, input_columns, load_labeled, resolve_run
from m1.predict import M1Predictor
from m1.report import md_table
from m1.splits import make_splits


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="이유 코드 규칙 비교 (내부 테스트 분할)")
    ap.add_argument("--data", required=True)
    ap.add_argument("--time-col", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--run", default=None)
    ap.add_argument("--combo", default="nested__base")
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    contract = Contract.load()
    run_id = resolve_run(a.artifacts, a.run)
    predictor = M1Predictor.load(Path(a.artifacts) / run_id / a.combo, contract)
    spec, y, _, _ = load_labeled(a.data, contract, seed=a.seed, assume_no_med=a.assume_no_med)
    spec, y, _, _ = filter_valid(Preprocessor(contract).fit(spec), spec, y)
    splits, info = make_splits(y, spec[a.time_col.strip().lower()] if a.time_col else None, seed=a.seed)
    te = splits["test"]
    df, y = spec.iloc[te].reset_index(drop=True), y[te]
    inputs = df[input_columns(predictor.pre, df)]
    ge130, htn = y >= T.STAGE_INDEX["prehtn"], y == T.STAGE_INDEX["htn"]
    sex = df["sex"].to_numpy()
    out = Path(a.out) / f"reason_rules_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    L = [f"# 이유 코드 규칙 비교 — {out.name}\n", f"- 모델 artifacts/{run_id}/{a.combo}, 내부 테스트 분할 {len(y)}행 ({info['method']}), ≥130/80 비율 {ge130.mean():.3f}\n",
         "- 규칙별 경계: " + "; ".join(f"{r}: age {T.AGE_HIGH_YEARS[r]}, 음주 잔/일 {T.ALCOHOL_HIGH_DRINKS_PER_DAY[r]}" for r in T.AGE_HIGH_YEARS) + "\n"]
    freq_rows, detail_rows, count_rows = [], [], []
    for rule in T.AGE_HIGH_YEARS:
        T.REASON_RULE = rule
        outs = predictor.predict_frame(inputs)
        codes = pd.Series([",".join(o["reason_codes"]) for o in outs])
        n_codes = codes.map(lambda s: 0 if s == "" else len(s.split(",")))
        count_rows.append({"rule": rule, "mean_codes": n_codes.mean(), **{f"n{k}": int((n_codes == k).sum()) for k in range(0, 8)}})
        ex = codes.str.split(",").explode()
        f = (ex[ex != ""].value_counts() / len(codes)).to_dict()
        freq_rows.append({"rule": rule, **{c: f.get(c, 0.0) for c in ("age", "alcohol_high", "bmi_high", "waist_high", "activity_low", "sleep_short", "family_htn", "diabetes")}})
        for code in ("age", "alcohol_high"):
            has = codes.str.split(",").map(lambda l: code in l).to_numpy()
            for s_ in ("all", "male", "female"):
                m = np.ones(len(y), bool) if s_ == "all" else (sex == s_)
                hm, nm = has & m, (~has) & m
                detail_rows.append({"rule": rule, "code": code, "sex": s_, "fires": hm.sum() / max(m.sum(), 1),
                                    "ge130_if_fires": ge130[hm].mean() if hm.any() else np.nan, "ge130_if_not": ge130[nm].mean() if nm.any() else np.nan,
                                    "rr": (ge130[hm].mean() / ge130[nm].mean()) if hm.any() and nm.any() and ge130[nm].mean() > 0 else np.nan,
                                    "htn_if_fires": htn[hm].mean() if hm.any() else np.nan, "htn_if_not": htn[nm].mean() if nm.any() else np.nan})
    freq, detail, counts = pd.DataFrame(freq_rows), pd.DataFrame(detail_rows), pd.DataFrame(count_rows)
    for name, d in (("code_frequency", freq), ("age_alcohol_detail", detail), ("codes_per_row", counts)):
        d.to_csv(out / f"{name}.csv", index=False)
    L += ["## 코드 빈도 (행 비율)\n", md_table(freq, nd=3), "\n## 행당 코드 수\n", md_table(counts, nd=2),
          "\n## age·alcohol 코드 유무별 실제 ≥130/80 비율 (테스트 분할)\n", md_table(detail, nd=3)]
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[3:]))
    print(f"완료: {out}/summary.md")
    return out


if __name__ == "__main__":
    main()

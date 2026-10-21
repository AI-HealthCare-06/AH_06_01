"""
[파일] reason_audit.py
[용도] 이유 코드 계산 과정의 2단계(관측값 규칙)·3단계(기여도 정렬·개수)를 내부 테스트 분할에서 점검한다.
      (2) 대치된 값에 코드가 붙은 행 수(0 이어야 함), 관측 규칙이 지운 코드 수, 규칙이 없었다면 붙었을 코드 수
      (3) 모델 간 첫 코드·전체 순서 일치율, 기여도 ≤0 인 채 붙은 코드 수, 개수 상한(3개) 적용 시 잘리는 코드, 단건 경로 vs 배치 경로 코드 일치
[왜 필요한가] 사용자 요청(2026-10-20): 1단계(조건·근거) 확정 뒤 2·3단계에 이상이 없는지 확인.
[쓰는 곳] 사용자가 직접 실행. 결과 reports/reason_audit_<시각>/summary.md
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
from m1.pipeline import filter_valid, input_columns, load_labeled, resolve_run, sample_input, stage_combos
from m1.predict import M1Predictor
from m1.reasons import CODE_FEATURES, REASON_CODES, reason_codes
from m1.report import md_table
from m1.splits import make_splits

# 코드가 참조하는 명세 변수 (관측 규칙 점검용)
CODE_SOURCE = {"bmi_high": "bmi", "waist_high": "waist_cm", "age": "age", "alcohol_high": "alcohol_week", "activity_low": "activity_minutes_week",
               "sleep_short": "sleep_short_flag", "family_htn": "family_htn", "diabetes": "diabetes_flag"}
CAP = 3
N_SINGLE = 1500


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--time-col", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--run", default=None)
    ap.add_argument("--artifacts", default="artifacts")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    contract = Contract.load()
    run_dir = Path(a.artifacts) / resolve_run(a.artifacts, a.run)
    spec, y, _, _ = load_labeled(a.data, contract, seed=a.seed, assume_no_med=a.assume_no_med)
    spec, y, _, _ = filter_valid(Preprocessor(contract).fit(spec), spec, y)
    splits, _ = make_splits(y, spec[a.time_col.strip().lower()] if a.time_col else None, seed=a.seed)
    df = spec.iloc[splits["test"]].reset_index(drop=True)
    out = Path(a.out) / f"reason_audit_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    L = [f"# 이유 코드 2·3단계 점검 — {out.name}\n", f"- 모델 {run_dir}, 내부 테스트 분할 {len(df)}행, 규칙 {T.REASON_RULE}\n"]

    combos = stage_combos(run_dir)
    codes_by_model, contrib_by_model = {}, {}
    res = None
    for combo in combos:
        pr = M1Predictor.load(run_dir / combo, contract)
        inputs = df[input_columns(pr.pre, df)]
        res = pr.pre.transform(inputs)
        P, C = pr.model.predict_proba(res.X), pr.model.contributions(res.X)
        outs = pr.predict_frame(inputs)
        codes_by_model[combo] = [o["reason_codes"] for o in outs]
        contrib_by_model[combo] = pd.DataFrame(C, columns=pr.model.columns)

    # ---------------- 2단계: 관측값 규칙 ----------------
    ref = combos[0]
    codes = codes_by_model[ref]
    raw, obs = res.raw, res.observed
    rows2 = []
    for code in REASON_CODES:
        src = CODE_SOURCE[code]
        has = np.array([code in c for c in codes])
        not_obs = ~obs[src].to_numpy()
        # 규칙이 없었다면: 대치값으로 조건을 다시 평가
        would = np.array([code in reason_codes({**raw.iloc[i].to_dict()}, {**{k: True for k in obs.columns}}, {}) for i in range(len(df))])
        rows2.append({"code": code, "source": src, "imputed_rows": int(not_obs.sum()), "imputed_share": not_obs.mean(),
                      "code_on_imputed(should be 0)": int((has & not_obs).sum()),
                      "suppressed_by_rule": int((would & not_obs).sum()), "fires_now": int(has.sum()), "would_fire_without_rule": int(would.sum())})
    t2 = pd.DataFrame(rows2)
    L += ["## 2단계 — 관측값 규칙\n", md_table(t2, nd=3),
          "\n`code_on_imputed` 가 0 이면 규칙이 지켜진 것. `suppressed_by_rule` 은 대치값이 조건을 만족해 규칙 때문에 붙지 않은 코드 수(= 규칙의 효과).\n"]

    # ---------------- 3단계: 정렬·개수 ----------------
    rows3 = []
    for i, c1 in enumerate(combos):
        for c2 in combos[i + 1:]:
            a1, a2 = codes_by_model[c1], codes_by_model[c2]
            both = [(x, z) for x, z in zip(a1, a2) if x and z]
            rows3.append({"pair": f"{c1} vs {c2}", "same_set": np.mean([set(x) == set(z) for x, z in zip(a1, a2)]),
                          "same_first": np.mean([x[0] == z[0] for x, z in both]), "same_order": np.mean([x == z for x, z in both])})
    L += ["## 3단계 — 모델 간 정렬 일치율 (집합은 조건 기반이라 같아야 하고, 순서는 기여도라 다를 수 있음)\n", md_table(pd.DataFrame(rows3), nd=3)]

    rows4 = []
    for combo in combos:
        Cdf = contrib_by_model[combo]
        for code in REASON_CODES:
            score = Cdf[[f for f in CODE_FEATURES[code] if f in Cdf.columns]].sum(axis=1).to_numpy()
            has = np.array([code in c for c in codes_by_model[combo]])
            rows4.append({"model": combo, "code": code, "fires": int(has.sum()), "contrib_le_0_when_fires": int((has & (score <= 1e-9)).sum()),
                          "share_le_0": (has & (score <= 1e-9)).sum() / max(has.sum(), 1), "median_contrib_when_fires": float(np.median(score[has])) if has.any() else np.nan,
                          "rank1_share": np.mean([c[0] == code for c in codes_by_model[combo] if c]) if any(codes_by_model[combo]) else 0.0})
    t4 = pd.DataFrame(rows4)
    L += ["\n## 3단계 — 기여도 ≤0 인 채 붙은 코드 (조건 기반이라 모델이 쓰지 않은 요인도 붙는다)\n", md_table(t4, nd=3)]

    rows5 = []
    for combo in combos:
        cl = codes_by_model[combo]
        n = pd.Series([len(c) for c in cl])
        dropped = pd.Series([x for c in cl for x in c[CAP:]]).value_counts()
        rows5.append({"model": combo, "mean_codes": n.mean(), "rows_over_cap": int((n > CAP).sum()), "share_over_cap": (n > CAP).mean(),
                      **{f"dropped_{k}": int(dropped.get(k, 0)) for k in REASON_CODES}})
    L += [f"\n## 3단계 — 개수 상한 {CAP}개를 두면 잘리는 코드 (기여도 순 하위)\n", md_table(pd.DataFrame(rows5), nd=3)]

    # 단건 경로 vs 배치 경로
    rows6 = []
    for combo in combos:
        pr = M1Predictor.load(run_dir / combo, contract)
        idx = np.linspace(0, len(df) - 1, min(N_SINGLE, len(df))).astype(int)
        mism = 0
        for i in idx:
            single = pr.predict(sample_input(df.iloc[i], contract))["reason_codes"]
            mism += single != codes_by_model[combo][i]
        rows6.append({"model": combo, "rows_checked": len(idx), "mismatch": int(mism)})
    L += ["\n## 단건 경로(predict) vs 배치 경로(predict_frame) 이유 코드 일치\n", md_table(pd.DataFrame(rows6), nd=0)]
    L += ["\n## 알려진 불일치\n",
          f"- 피처 alcohol_per_day 는 명세 2-3 정의(하루 {T.ALCOHOL_DRINKS_PER_DAY_HIGH}잔 초과)로 산출되고, 이유 코드 alcohol_high 는 데이터 경계({T.ALCOHOL_HIGH_DRINKS_PER_DAY[T.REASON_RULE]})를 쓴다. 둘은 역할이 다르지만 같은 변수에 두 경계가 있다."]
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[2:]))
    print(f"완료: {out}/summary.md")
    return out


if __name__ == "__main__":
    main()

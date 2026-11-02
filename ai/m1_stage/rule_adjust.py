"""
[파일] rule_adjust.py
[용도] 사용자 제안(2026-10-21) 실험: 모델 선형 점수에서 연령·BMI 기여분에 배수(w_age, w_bmi)를 곱해 키우고, 생활·위험 플래그가 정상이면
      그 몫을 d 만큼 깎는 후처리 규칙. 파라미터는 검증 분할에서 정확도 최대로 고르고 테스트 분할에서 기준 모델과 비교한다(재학습 없음).
      변형: binary = 플래그가 전부 정상일 때만 깎음 / graded = 정상 플래그 수에 비례해 깎음.
[왜 필요한가] "가중치를 손으로 조정하면 정답률이 오르는가"를 같은 분할·같은 지표로 확인하기 위해서. 결과 reports/rule_adjust_<시각>/.
[쓰는 곳] 사용자가 직접 실행.
"""

from __future__ import annotations

import argparse
import itertools
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from m1 import decision as D
from m1.contract import Contract
from m1.evaluate import auroc
from m1.features import Preprocessor
from m1.models.calibration import cumulative_probs
from m1.models.linear import _ordinal_probs
from m1.pipeline import filter_valid, input_columns, load_labeled, resolve_run
from m1.predict import M1Predictor
from m1.report import md_table
from m1.splits import make_splits

W_GRID = (1.0, 1.25, 1.5, 2.0)
D_GRID = (0.0, 0.25, 0.5, 0.75, 1.0)
FLAG_COLS = ("alcohol_per_day", "binge", "activity_low_flag", "sleep_short_flag", "family_htn", "diabetes_flag")


def stage_recalls(s, y):
    return {f"recall_{st}": float(((s == k) & (y == k)).sum() / max((y == k).sum(), 1)) for k, st in enumerate(T.STAGES)}


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
    run_id = resolve_run(a.artifacts, a.run)
    pr = M1Predictor.load(Path(a.artifacts) / run_id / "ordinal__base", contract)
    m, cols = pr.model, pr.model.columns
    spec, y, _, _ = load_labeled(a.data, contract, seed=a.seed, assume_no_med=a.assume_no_med)
    spec, y, _, _ = filter_valid(Preprocessor(contract).fit(spec), spec, y)
    splits, _ = make_splits(y, spec[a.time_col.strip().lower()] if a.time_col else None, seed=a.seed)
    parts = {s: pr.pre.transform(spec.iloc[idx][input_columns(pr.pre, spec)]) for s, idx in splits.items()}
    X = {s: p.X.to_numpy() for s, p in parts.items()}
    Y = {s: y[idx] for s, idx in splits.items()}
    i_age = [cols.index("age"), cols.index("age_x_male")]
    i_bmi = [cols.index("bmi")]
    # 생활·위험 플래그 수(원 척도, 대치 후) → 정상 플래그 비율
    nflag = {s: p.raw[list(FLAG_COLS)].fillna(0).astype(float).sum(axis=1).to_numpy() for s, p in parts.items()}
    normal_share = {s: (len(FLAG_COLS) - nflag[s]) / len(FLAG_COLS) for s in parts}
    all_normal = {s: (nflag[s] == 0).astype(float) for s in parts}

    def adjusted_probs(s, w_age, w_bmi, d, variant):
        eta = X[s] @ m.beta
        c_age = X[s][:, i_age] @ m.beta[i_age]
        c_bmi = X[s][:, i_bmi] @ m.beta[i_bmi]
        hi = w_age * c_age + w_bmi * c_bmi
        disc = all_normal[s] if variant == "binary" else normal_share[s]
        eta2 = (eta - c_age - c_bmi) + hi * (1.0 - d * disc)
        return _ordinal_probs(eta2, m.theta)

    rows = []
    for variant in ("binary", "graded"):
        for w_age, w_bmi, d in itertools.product(W_GRID, W_GRID, D_GRID):
            if d == 0 and variant == "graded":
                continue   # d=0 은 binary 와 동일
            Pv = adjusted_probs("val", w_age, w_bmi, d, variant)
            thr = D.fit_thresholds(Pv, Y["val"])
            rows.append({"variant": variant, "w_age": w_age, "w_bmi": w_bmi, "d": d,
                         "val_acc_argmax": float((Pv.argmax(1) == Y["val"]).mean()), "val_acc_cum": thr["val_accuracy_score"], "thr": thr})
    grid = pd.DataFrame(rows)
    base = grid[(grid.w_age == 1) & (grid.w_bmi == 1) & (grid.d == 0)].iloc[0]
    best_arg = grid.loc[grid["val_acc_argmax"].idxmax()]
    best_cum = grid.loc[grid["val_acc_cum"].idxmax()]

    def test_row(label, r):
        P = adjusted_probs("test", r.w_age, r.w_bmi, r.d, r.variant)
        Q = cumulative_probs(P)
        s_arg = P.argmax(1)
        D.STAGE_RULE, D.STAGE_OBJECTIVE = "cumulative", "accuracy"
        s_cum = D.decide_stage(P, r.thr)
        return {"설정": label, "variant": r.variant, "w_age": r.w_age, "w_bmi": r.w_bmi, "d": r.d,
                "val_acc_argmax": r.val_acc_argmax, "val_acc_cum": r.val_acc_cum,
                "test_auroc_140": auroc(Y["test"] >= 3, Q[:, 2]), "test_auroc_130": auroc(Y["test"] >= 2, Q[:, 1]),
                "test_acc_argmax": float((s_arg == Y["test"]).mean()), "test_acc_cum": float((s_cum == Y["test"]).mean()),
                "test_adjacent_argmax": float((np.abs(s_arg - Y["test"]) <= 1).mean()),
                **{k + "_argmax": v for k, v in stage_recalls(s_arg, Y["test"]).items()}}

    summary = pd.DataFrame([test_row("기준(모델 그대로)", base), test_row("검증 argmax 최적", best_arg), test_row("검증 cumulative 최적", best_cum)])
    out = Path(a.out) / f"rule_adjust_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    grid.drop(columns="thr").to_csv(out / "grid.csv", index=False)
    summary.to_csv(out / "summary.csv", index=False)
    top = grid.drop(columns="thr").sort_values("val_acc_argmax", ascending=False).head(10)
    L = [f"# 규칙 기반 가감점 실험 — {out.name}\n",
         f"- 모델 ordinal__base (run {run_id}), 분할 train/val/test = {len(Y['train'])}/{len(Y['val'])}/{len(Y['test'])}, 플래그 {FLAG_COLS}",
         "- 규칙: η' = (η − c_age − c_bmi) + (w_age·c_age + w_bmi·c_bmi)·(1 − d·정상도), 정상도 = 전부 정상(binary) 또는 정상 플래그 비율(graded)\n",
         "## 기준 vs 검증 최적 설정의 테스트 성적\n", md_table(summary, nd=3),
         "\n## 검증 정확도(argmax) 상위 10 설정\n", md_table(top, nd=3)]
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(md_table(summary, nd=3)); print(); print(md_table(top, nd=3)); print(f"완료: {out}/summary.md")
    return out


if __name__ == "__main__":
    main()

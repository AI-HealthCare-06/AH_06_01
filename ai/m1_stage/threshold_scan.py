"""
[파일] threshold_scan.py
[용도] 문헌 경계가 없는 변수의 이유 코드 임계값을 학습 분할 데이터로 구하는 스캔. 변수마다 후보 경계 t 를 훑으며
      x ≥ t 군과 < t 군의 ≥130/80·htn 비율, 상대위험(RR), Youden J, 정보이득을 계산해 세 규칙의 경계를 낸다.
      (1) Youden J 최대, (2) 정보이득 최대, (3) RR(≥130/80) ≥ RR_MIN 이 되는 최초 경계(고위험군 비율 ≥ MIN_SHARE).
[왜 필요한가] 사용자 결정(2026-10-20): 문헌을 못 찾은 경계는 데이터로 직접 구한다. 테스트 분할은 쓰지 않고 train.py 와 같은 분할(시간 순서)의 학습 부분만 쓴다.
[쓰는 곳] 사용자가 직접 실행. 결과는 reports/threshold_scan_<시각>/ (md + csv).
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
from m1.pipeline import filter_valid, load_labeled
from m1.report import md_table
from m1.splits import make_splits

RR_MIN = 1.25       # 규칙 (3): 문헌에서 '위험 요인'으로 보고되는 최소 효과 크기 수준(아시아 남성 저용량 음주 RR 1.25, 가족력 RR 1.23)
MIN_SHARE = 0.05    # 고위험군이 전체의 5% 이상일 때만 경계로 인정
GRIDS = {
    "age": np.arange(20, 80, 1.0),
    "alcohol_per_day_drinks": np.round(np.arange(0.25, 8.01, 0.25), 2),
    "alcohol_week": np.arange(1, 50, 1.0),
    "bmi": np.round(np.arange(18.0, 35.01, 0.5), 1),
    "waist_cm": np.arange(60, 111, 1.0),
    "activity_minutes_week": np.arange(0, 1001, 30.0),      # 하강 변수: x < t 가 고위험
    "fasting_glucose": np.arange(80, 141, 2.0),
    "resting_hr": np.arange(50, 101, 2.0),
}
FALLING = {"activity_minutes_week"}


def _entropy(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return -(p * np.log2(p) + (1 - p) * np.log2(1 - p))


def scan(x: np.ndarray, y130: np.ndarray, yhtn: np.ndarray, grid: np.ndarray, falling: bool) -> pd.DataFrame:
    rows = []
    base = y130.mean()
    for t in grid:
        hi = (x < t) if falling else (x >= t)
        n_hi = int(hi.sum())
        if n_hi == 0 or n_hi == len(x):
            continue
        r_hi, r_lo = y130[hi].mean(), y130[~hi].mean()
        tp, fn = y130[hi].sum(), y130[~hi].sum()
        fp, tn = (~y130[hi]).sum(), (~y130[~hi]).sum()
        sens, spec = tp / (tp + fn), tn / (tn + fp)
        ig = _entropy(np.array([base]))[0] - (hi.mean() * _entropy(np.array([r_hi]))[0] + (1 - hi.mean()) * _entropy(np.array([r_lo]))[0])
        rows.append({"threshold": float(t), "share_high": n_hi / len(x), "rate_ge130_high": r_hi, "rate_ge130_low": r_lo, "rr_ge130": r_hi / r_lo if r_lo > 0 else np.nan,
                     "rr_vs_all": r_hi / base,
                     "rate_htn_high": yhtn[hi].mean(), "rate_htn_low": yhtn[~hi].mean(), "rr_htn": yhtn[hi].mean() / yhtn[~hi].mean() if yhtn[~hi].mean() > 0 else np.nan,
                     "youden_j": sens + spec - 1, "info_gain": ig})
    return pd.DataFrame(rows)


def pick(df: pd.DataFrame) -> dict:
    out = {}
    out["youden"] = float(df.loc[df["youden_j"].idxmax(), "threshold"])
    out["info_gain"] = float(df.loc[df["info_gain"].idxmax(), "threshold"])
    ok = df[(df["rr_vs_all"] >= RR_MIN) & (df["share_high"] >= MIN_SHARE)]
    out["rr_first"] = float(ok["threshold"].iloc[0]) if len(ok) else float("nan")
    return out


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="학습 분할로 이유 코드 임계값 스캔")
    ap.add_argument("--data", required=True)
    ap.add_argument("--time-col", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    contract = Contract.load()
    spec, y, load_info, _ = load_labeled(a.data, contract, seed=a.seed, assume_no_med=a.assume_no_med)
    spec, y, _, _ = filter_valid(Preprocessor(contract).fit(spec), spec, y)
    time_vals = spec[a.time_col.strip().lower()] if a.time_col else None
    splits, split_info = make_splits(y, time_vals, seed=a.seed)
    tr = splits["train"]
    df, y = spec.iloc[tr].reset_index(drop=True), y[tr]
    df["alcohol_per_day_drinks"] = df["alcohol_week"] / 7.0
    y130 = y >= T.STAGE_INDEX["prehtn"]
    yhtn = y == T.STAGE_INDEX["htn"]
    out = Path(a.out) / f"threshold_scan_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)
    L = [f"# 이유 코드 임계값 스캔 — {out.name}\n",
         f"- 학습 분할만 사용: {len(y)}행 ({split_info['method']}), ≥130/80 비율 {y130.mean():.3f}, htn 비율 {yhtn.mean():.3f}",
         f"- 규칙: Youden J 최대 / 정보이득 최대 / 고위험군 ≥130/80 비율이 전체의 {RR_MIN}배 이상이 되는 최초 경계(고위험군 ≥ {MIN_SHARE:.0%}). 하강 변수(activity)는 x < t 가 고위험\n"]
    summary = []
    for var, grid in GRIDS.items():
        for sex in ("all", "male", "female"):
            m = np.ones(len(df), dtype=bool) if sex == "all" else (df["sex"] == sex).to_numpy()
            x = df.loc[m, var].to_numpy(dtype=float)
            ok = ~np.isnan(x)
            if ok.sum() < 200:
                continue
            res = scan(x[ok], y130[m][ok], yhtn[m][ok], grid, var in FALLING)
            res.to_csv(out / f"scan_{var}_{sex}.csv", index=False)
            p = pick(res)
            row = {"variable": var, "sex": sex, "n": int(ok.sum()), "youden": p["youden"], "info_gain": p["info_gain"], f"rr_first(≥{RR_MIN})": p["rr_first"]}
            for key, t in (("youden", p["youden"]), ("rr_first", p["rr_first"])):
                if t == t:
                    r = res[res["threshold"] == t].iloc[0]
                    row[f"{key}_share"] = r["share_high"]; row[f"{key}_rate_hi"] = r["rate_ge130_high"]; row[f"{key}_rr_vs_all"] = r["rr_vs_all"]
            summary.append(row)
            if sex == "all":
                L.append(f"## {var}\n")
                show = res[res["threshold"].isin(sorted(set([p["youden"], p["info_gain"], p["rr_first"]] + list(grid[::max(1, len(grid) // 8)]))))]
                L.append(md_table(show[["threshold", "share_high", "rate_ge130_high", "rate_ge130_low", "rr_vs_all", "rate_htn_high", "rr_htn", "youden_j", "info_gain"]], nd=3) + "\n")
    sm = pd.DataFrame(summary)
    sm.to_csv(out / "summary.csv", index=False)
    L.insert(3, "## 요약 (변수 × 성별 → 규칙별 경계)\n\n" + md_table(sm, nd=2) + "\n")
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(sm.to_string(index=False))
    print(f"완료: {out}/summary.md")
    return out


if __name__ == "__main__":
    main()

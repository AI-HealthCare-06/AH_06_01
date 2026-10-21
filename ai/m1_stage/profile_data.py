"""
[파일] profile_data.py
[용도] 데이터 프로파일 명령. 학습하지 않고 원시 컬럼 현황, 명세 변수 매핑(직접 컬럼/산출 가능/없음), 라벨 생성 가능 행 수,
      범위 밖·결측 현황만 보고서(reports/profile_*.md)로 낸다.
[왜 필요한가] 학습 전에 컬럼명이 규약과 맞는지, 혈압·복약 컬럼으로 라벨을 만들 수 있는지, 결측이 어느 변수에 몰려 있는지를
             먼저 확인해야 train.py 결과를 해석할 수 있다. 데이터 양 조절(--max-rows)도 같은 방식으로 쓴다.
[쓰는 곳] 사용자가 직접 실행. 표 출력은 m1/report.md_table 을 쓴다.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import pandas as pd

from m1.contract import Contract
from m1.data_io import load_table
from m1.features import DERIVERS, Preprocessor, coerce_spec_table, normalize_columns
from m1.labels import make_labels
from m1.report import md_table


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    sheet = int(a.sheet) if str(a.sheet).isdigit() else a.sheet
    contract = Contract.load()
    df, info = load_table(a.data, sheet=sheet, max_rows=a.max_rows)
    raw = normalize_columns(df)
    L = [f"# 데이터 프로파일 — {datetime.now():%Y-%m-%d %H:%M}\n", f"- 경로 `{info['path']}`, 파일 {len(info['files'])}개, 로드 {info['rows_loaded']}행, 사용 {info['rows_used']}행\n"]
    L.append("## 1. 원시 컬럼\n")
    rows = []
    for c in raw.columns:
        s = raw[c]
        num = pd.to_numeric(s, errors="coerce")
        r = {"column": c, "dtype": str(s.dtype), "non_null": int(s.notna().sum()), "non_null_pct": round(100 * s.notna().mean(), 1), "n_unique": int(s.nunique())}
        if num.notna().sum() > 0:
            r["min"], r["max"] = float(num.min()), float(num.max())
        else:
            r["examples"] = ", ".join(map(str, s.dropna().astype(str).unique()[:5]))
        rows.append(r)
    L.append(md_table(pd.DataFrame(rows), nd=2) + "\n")
    L.append("## 2. 명세 변수 매핑\n")
    spec = coerce_spec_table(raw, contract)
    rows = []
    for f in contract.all_features():
        if f.name == "missing_count":
            continue
        direct = f.name in raw.columns
        derivable = f.name in DERIVERS
        filled = int(spec[f.name].notna().sum())
        rng = ""
        oor = ""
        if f.range and f.type not in ("bool", "category"):
            v = spec[f.name]
            oor = int(((v < f.range[0]) | (v > f.range[1])).sum())
            rng = f"{f.range[0]}~{f.range[1]}"
        rows.append({"feature": f.name, "optional": f.optional, "direct_column": direct, "derivable": derivable, "non_null_after_derive": filled,
                     "non_null_pct": round(100 * filled / max(len(spec), 1), 1), "range": rng, "out_of_range_n": oor, "missing_policy": f.method})
    L.append(md_table(pd.DataFrame(rows), nd=1) + "\n")
    L.append("## 3. 라벨 가능 여부\n")
    y, li = make_labels(spec, contract)
    L.append(f"- 수축기: {li['sbp_source']} / 이완기: {li['dbp_source']} / 복약: {li['htn_med_source']}")
    L.append(f"- 라벨 생성 가능 {li['rows_labeled']}행, 불가 {li['rows_unlabeled']}행 {li['unlabeled_reasons']}")
    L.append(f"- 단계 분포: {li['stage_counts']}\n")
    L.append("## 4. 행 상태 (기본 변형 기준)\n")
    try:
        pre = Preprocessor(contract).fit(spec[y.notna()] if y.notna().any() else spec)
        res = pre.transform(spec)
        L.append(f"- 상태: {res.status.value_counts().to_dict()}")
        probs = res.problems[res.problems != ""].str.split(";").explode().value_counts()
        L.append(f"- 문제 코드: {probs.to_dict()}")
        L.append(f"- 결측 플래그 비율(%): { {c: round(100 * float(res.flags[c].mean()), 1) for c in res.flags.columns} }")
        L.append(f"- missing_count 분포: {res.raw['missing_count'].value_counts().sort_index().to_dict()}\n")
    except Exception as e:  # noqa: BLE001
        L.append(f"- Preprocessor 적합 실패: {e}\n")
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"profile_{datetime.now():%Y%m%d_%H%M%S}.md"
    out.write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L))
    print(f"\n저장: {out}")
    return out


if __name__ == "__main__":
    main()

"""scripts/apply_data.py — 4단계: 데이터 적용 보고.

순서: 컬럼 명세 대조 → 결측률·범위 위반 → 상태별 판정 분포 → 상태 간 동시 발생표.
- 데이터 파일은 커밋하지 않는다. 데이터의 출처·조사명·연도를 추정하거나 적지 않는다.
- 평탄 표는 한 행 = subject 하나, 컬럼 "<변수>__<필드>" 를 가정한다(feature_contract.yaml conventions.table_layout).
  실제 컬럼이 다르면 --aliases 로 {실제컬럼: 계약컬럼} JSON 을 준다. 행 키(subject_id)가 없으면 대조 결과만 보고하고 멈춘다.

usage:
  python3 scripts/apply_data.py <data_path> [--aliases aliases.json] [--subject-col subject_id]
                                [--sheet NAME] [--limit N] [--out docs/data_report.md]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

import feature_contract as fc  # noqa: E402
import thresholds as T  # noqa: E402
from inference.judge_m2 import judge  # noqa: E402

STATUSES = (T.STATUS_POSITIVE, T.STATUS_NEGATIVE, T.STATUS_NOT_EVALUABLE, T.STATUS_NOT_APPLICABLE,
            T.STATUS_NOT_EVALUATED)


def load_table(path: Path, sheet: str | None) -> pd.DataFrame:
    ext = path.suffix.lower()
    if ext in (".csv", ".txt"):
        return pd.read_csv(path)
    if ext == ".tsv":
        return pd.read_csv(path, sep="\t")
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(path, sheet_name=sheet or 0)
    if ext == ".parquet":
        return pd.read_parquet(path)
    if ext == ".json":
        return pd.read_json(path)
    raise SystemExit(f"unsupported extension: {ext}")


def md_table(header: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(map(str, header)) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(map(str, r)) + " |" for r in rows]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_path")
    ap.add_argument("--aliases")
    ap.add_argument("--subject-col", default="subject_id")
    ap.add_argument("--sheet")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", default=str(ROOT / "docs" / "data_report.md"))
    a = ap.parse_args()

    df = load_table(Path(a.data_path), a.sheet)
    aliases = json.loads(Path(a.aliases).read_text(encoding="utf-8")) if a.aliases else {}
    if aliases:
        df = df.rename(columns=aliases)
    contract = fc.load_contract()
    lines = ["# 데이터 적용 보고", "", f"- 계약 버전 {contract['version']}, thresholds {T.THRESHOLDS_VERSION}",
             f"- 행 {len(df)}, 열 {len(df.columns)}", ""]

    # 1) 컬럼 대조
    rep = fc.compare_columns(df.columns, contract)
    missing_lines = [f"- `{c}`" for c in rep["missing"]] or ["- 없음"]
    extra_lines = [f"- `{c}`" for c in rep["extra"]] or ["- 없음"]
    lines += ["## 1. 컬럼 명세 대조", "",
              f"- 일치 {len(rep['matched'])} / 기대 {rep['n_expected']}, 누락 {len(rep['missing'])}, 계약 밖 {len(rep['extra'])}",
              f"- 필수 변수 중 핵심 필드가 누락된 변수: {', '.join(rep['missing_required_vars']) or '없음'}", "",
              "누락 컬럼:", "", *missing_lines, "", "계약 밖 컬럼:", "", *extra_lines, ""]
    key_ok = a.subject_col in df.columns
    if not key_ok:
        lines += [f"행 키 컬럼(`{a.subject_col}`)이 없어 변환을 할 수 없다. 형식 확인 필요. 여기서 멈춤.", ""]
        Path(a.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
        return 2

    # 2) 결측률·범위 위반 (컬럼 단위)
    by_name = fc.variables_by_name(contract)
    rows = []
    for col in rep["matched"]:
        if fc.SEP not in col:
            continue
        var, fld = col.split(fc.SEP, 1)
        spec = next((f for f in by_name[var]["fields"] if f["name"] == fld), None)
        s = df[col]
        n = len(s)
        miss = sum(fc.is_missing(v) for v in s)
        oor = inv = 0
        if spec and spec["type"] in ("int", "float", "bool", "date", "time", "enum"):
            for v in s:
                if fc.is_missing(v):
                    continue
                try:
                    nv = fc._coerce(spec["type"], v, spec)
                except fc.ParseError:
                    inv += 1
                    continue
                rng = spec.get("range")
                if rng and isinstance(nv, (int, float)) and (nv < rng[0] or nv > rng[1]):
                    oor += 1
        rows.append([f"`{col}`", n, f"{miss / n:.1%}" if n else "-", oor, inv, spec.get("range") if spec else ""])
    lines += ["## 2. 결측률·범위 위반 (컬럼 단위)", "", "범위는 feature_contract.yaml 의 임시값(D-10).", "",
              *md_table(["컬럼", "n", "결측률", "범위 밖", "타입 오류", "range"], rows), ""]

    # 3) 판정
    subjects = list(pd.unique(df[a.subject_col]))
    if a.limit:
        subjects = subjects[: a.limit]
    dq = Counter()
    step_dist = Counter()
    treated_step_not_htn = 0
    dist: dict[str, Counter] = defaultdict(Counter)
    co = defaultdict(Counter)
    presence_rate = Counter()
    for sid in subjects:
        payload = fc.from_table(df, sid, contract, subject_col=a.subject_col)
        out = judge(payload)
        dq[out["data_quality"]] += 1
        for k, v in out["presence"].items():
            presence_rate[k] += int(bool(v))
        step = out["m1_bp_step"]["step"]
        step_dist[step] += 1
        med = (payload.get("medication") or {}).get("status")
        if str(med) == str(T.MED_ON_TREATMENT) and step not in (None, T.STEP_HTN):
            treated_step_not_htn += 1          # M1 정의(복약자 → htn)와 어긋나는 행 (D-30)
        st = {k: v["status"] for k, v in out["states"].items()}
        pos = [c for c, v in st.items() if v == T.STATUS_POSITIVE]
        for c, v in st.items():
            dist[c][v] += 1
        for c1 in pos:
            for c2 in pos:
                co[c1][c2] += 1
    n = len(subjects)
    lines += ["## 3. 판정 분포", "", f"- 대상 subject {n}",
              f"- data_quality: " + ", ".join(f"{k} {v}" for k, v in dq.items()),
              f"- step 분포: " + ", ".join(f"{k} {v}" for k, v in step_dist.items()),
              f"- 복약자(11=3)인데 step≠htn 인 subject: {treated_step_not_htn}", "",
              "변수 존재율(presence):", "",
              *md_table(["변수", "존재율"], [[k, f"{presence_rate[k] / n:.1%}" if n else "-"] for k in by_name]), "",
              "상태별 판정 분포:", "",
              *md_table(["상태", *STATUSES], [[c, *[dist[c][s] for s in STATUSES]] for c in T.STATE_CODES]), ""]
    lines += ["## 4. 상태 간 동시 발생표 (positive 끼리, 대각선 = 단독 positive 수)", "",
              *md_table(["", *T.STATE_CODES], [[c1, *[co[c1][c2] for c2 in T.STATE_CODES]] for c1 in T.STATE_CODES]), ""]
    Path(a.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

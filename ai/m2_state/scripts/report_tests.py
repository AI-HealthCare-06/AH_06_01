"""scripts/report_tests.py — pytest 를 실행하고 규칙별 × 테스트 종류별 결과표를 docs/test_results.md 로 쓴다."""
from __future__ import annotations

import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import thresholds as T  # noqa: E402

JUNIT = ROOT / "reports" / "junit.xml"
DOC = ROOT / "docs" / "test_results.md"

CATEGORY_BY_FILE = {
    "test_rules_step": "step 값별(4단계)",
    "test_rules_missing": "결측(필수 제거)",
    "test_rules_medication": "복약 상태(①②③)",
    "test_contract": "계약 검증·변환",
    "test_output_wording": "출력 표현",
    "test_golden": "골든 회귀",
}


def classify(classname: str, name: str) -> tuple[str, str]:
    file = classname.split(".")[-1]
    cat = CATEGORY_BY_FILE.get(file, file)
    base, _, param = name.partition("[")
    param = param.rstrip("]")
    for code in T.STATE_CODES:                       # 함수명 또는 파라미터 id 에 상태 코드가 있으면 그 상태로
        if f"_{code}_" in f"{base}_" or f"_{code}_" in f"_{param}_" or param.startswith(f"{code}-"):
            return code, cat
    return "공통", cat


def main() -> int:
    JUNIT.parent.mkdir(exist_ok=True)
    proc = subprocess.run([sys.executable, "-m", "pytest", f"--junitxml={JUNIT}"], cwd=ROOT,
                          capture_output=True, text=True)
    root = ET.parse(JUNIT).getroot()
    cells: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])   # passed, failed
    failures: list[str] = []
    cats: list[str] = []
    for tc in root.iter("testcase"):
        state, cat = classify(tc.get("classname", ""), tc.get("name", ""))
        if cat not in cats:
            cats.append(cat)
        failed = any(child.tag in ("failure", "error") for child in tc)
        cells[(state, cat)][1 if failed else 0] += 1
        if failed:
            failures.append(f"{tc.get('classname')}::{tc.get('name')}")
    order = ["step 값별(4단계)", "결측(필수 제거)", "복약 상태(①②③)", "골든 회귀", "계약 검증·변환", "출력 표현"]
    cats = [c for c in order if c in cats] + [c for c in cats if c not in order]
    states = list(T.STATE_CODES) + ["공통"]

    def fmt(p, f):
        if p == 0 and f == 0:
            return "·"
        return f"{p} 통과" + (f" / **{f} 실패**" if f else "")

    lines = ["# 규칙별 테스트 결과표", "",
             f"- 실행: `python3 scripts/report_tests.py` (pytest, 결과 {JUNIT.relative_to(ROOT)})",
             f"- 총 {sum(v[0] for v in cells.values())} 통과 / {sum(v[1] for v in cells.values())} 실패",
             "- v0.2.0 (M1 step 기반). mmHg 경계값·측정일·결측 비율 테스트는 M1 역할로 넘어가 여기 없다.",
             "- M1 대기 상태(HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, RESISTANT_SUSPECT)는 지금 결정 가능한 부분과 not_evaluable 고정만 검증한다.", "",
             "| 규칙 | " + " | ".join(cats) + " | 합계 |", "|---|" + "---|" * (len(cats) + 1)]
    for st in states:
        row = [fmt(*cells[(st, c)]) for c in cats]
        tot_p = sum(cells[(st, c)][0] for c in cats)
        tot_f = sum(cells[(st, c)][1] for c in cats)
        lines.append(f"| {st} | " + " | ".join(row) + f" | {fmt(tot_p, tot_f)} |")
    lines += ["", "## 실패 목록", ""]
    lines += [f"- {f}" for f in failures] or ["없음"]
    lines += ["", "## pytest 요약", "", "```", proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-500:], "```"]
    DOC.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())

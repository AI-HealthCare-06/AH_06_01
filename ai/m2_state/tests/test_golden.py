"""골든 케이스 회귀 테스트. tests/golden/*.json 의 expected 와 현재 출력을 비교한다."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import thresholds as T
from inference.judge_m2 import judge

FILES = sorted(Path(__file__).with_name("golden").glob("G*.json"))


@pytest.mark.parametrize("path", FILES, ids=[f.stem for f in FILES])
def test_golden(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    out = judge(case["input"])
    assert out["data_quality"] == case["expected"]["data_quality"]
    got = {k: v["status"] for k, v in out["states"].items()}
    assert got == case["expected"]["states"]
    missing = {k: v["missing_required"] for k, v in out["states"].items()}
    assert missing == case["expected"]["missing_required"]
    assert out["m1_bp_step"]["step"] == case["expected"]["step"]
    assert out["target_bp"] == case["expected"]["target_bp"]
    for code, want in case["intended"].items():
        assert got[code] == want


def test_golden_has_two_cases_per_state():
    by_state: dict[str, int] = {}
    for f in FILES:
        st = json.loads(f.read_text(encoding="utf-8"))["state"]
        by_state[st] = by_state.get(st, 0) + 1
    assert by_state == {c: 2 for c in T.STATE_CODES}

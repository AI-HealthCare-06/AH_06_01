from __future__ import annotations

import pytest

import thresholds as T
from inference.judge_m2 import judge


def statuses(payload: dict) -> dict[str, str]:
    out = judge(payload)
    return {c: s["status"] for c, s in out["states"].items()}


def state(payload: dict, code: str) -> dict:
    return judge(payload)["states"][code]


@pytest.fixture
def pending(monkeypatch):
    """결정 대기 값을 주입하는 픽스처: pending(NAME, value)"""
    def _set(name: str, value):
        assert hasattr(T, name), name
        monkeypatch.setattr(T, name, value)
    return _set

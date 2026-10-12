"""tests/conftest.py — `ai/` 를 import 경로에 올린다.

test_sanity.py 는 `from inference.predict import ...`, `from thresholds_kr_v1 import ...` 처럼
ai/ 기준 절대 경로로 import 하므로, 어느 디렉터리에서 pytest 를 실행해도 동작하게 한다.
"""
from __future__ import annotations

import sys
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))

"""
[파일] m1/models/__init__.py
[용도] 모델 후보 레지스트리. 이름(ordinal, nested, lgbm) → 클래스 매핑.
[왜 필요한가] train.py 가 --candidates 문자열로 후보를 고를 수 있게 하고, 후보를 추가할 때 이 한 곳만 고치면 되게 한다.
[쓰는 곳] train.py, tests/test_models.py
"""

from .base import StageModel
from .linear import NestedBinary, OrdinalLogit
from .lgbm import MonotoneLGBM

CANDIDATES: dict[str, type[StageModel]] = {
    "ordinal": OrdinalLogit,
    "nested": NestedBinary,
    "lgbm": MonotoneLGBM,
}

__all__ = ["StageModel", "OrdinalLogit", "NestedBinary", "MonotoneLGBM", "CANDIDATES"]

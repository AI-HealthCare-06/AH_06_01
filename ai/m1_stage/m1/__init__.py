"""
[파일] m1/__init__.py
[용도] m1 패키지 초기화. 프로젝트 루트(thresholds.py, feature_contract.yaml 위치)를 import 경로에 넣는다.
[왜 필요한가] m1 안의 모듈이 어디서 실행되든(train.py, pytest, VSCode 디버거) `import thresholds` 가 같은 파일을 가리키게 하기 위해서다.
[쓰는 곳] m1 패키지를 import 하는 모든 코드.
"""

import sys
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


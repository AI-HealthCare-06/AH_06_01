"""inference/predict.py — 개발팀이 부르는 함수 하나: predict_htn_risk(features: dict) -> dict

- 아티팩트는 import 시 1회 로드한다 (요청 스레드에서 로드하지 않는다).
- 아티팩트가 없으면 import 자체가 FileNotFoundError 로 실패한다 → tests/test_sanity.py 는 전체 스킵.
- 아티팩트 위치는 환경변수 HTN_RISK_ARTIFACT_DIR 로 바꿀 수 있다 (기본 ai/artifacts/).
- 네트워크·큐·DB 없음. 같은 입력이면 바이트 단위로 같은 출력.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from features.contract_v1 import MODEL_FULL, MODEL_LITE
from inference.bundle import ModelBundle
from inference.predictor import RiskPredictor

ARTIFACT_DIR = Path(os.environ.get("HTN_RISK_ARTIFACT_DIR", Path(__file__).resolve().parents[1] / "artifacts"))
ARTIFACT_FILES = {MODEL_FULL: ARTIFACT_DIR / f"{MODEL_FULL}.joblib", MODEL_LITE: ARTIFACT_DIR / f"{MODEL_LITE}.joblib"}


def load_predictor(artifact_dir: Path = ARTIFACT_DIR) -> RiskPredictor:
    files = {k: artifact_dir / f"{k}.joblib" for k in (MODEL_FULL, MODEL_LITE)}
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        raise FileNotFoundError(f"model artifacts not found: {missing}")
    return RiskPredictor(full=ModelBundle.load(files[MODEL_FULL]), lite=ModelBundle.load(files[MODEL_LITE]))


_PREDICTOR = load_predictor()


def predict_htn_risk(features: dict[str, Any]) -> dict[str, Any]:
    """인수인계 6장 인터페이스. 입력 JSON(snake_case) → 출력 JSON. 예외 대신 data_quality 로 거부를 알린다."""
    return _PREDICTOR.predict(features)


def model_info() -> dict[str, Any]:
    """운영 로그·헬스체크용: 로드된 모델 버전."""
    return {k: b.describe() for k, b in ((MODEL_FULL, _PREDICTOR.full), (MODEL_LITE, _PREDICTOR.lite))}

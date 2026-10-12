"""inference/predictor.py — 계약 피처 → 위험지수 + 이유 코드 (순수 함수, 네트워크·DB 없음)

predict.py 가 아티팩트를 1회 로드해 RiskPredictor 를 만들고, 요청마다 .predict(features) 만 부른다.
이 모듈은 아티팩트를 스스로 읽지 않으므로 테스트에서 작은 모델을 끼워 넣어 검증할 수 있다.
"""
from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np

import thresholds_kr_v1 as T
from features.contract_v1 import (
    FEATURE_VERSION, MODEL_FULL, MODEL_LITE, ORIGIN_OF_COLUMN, REASON_CODES, SLEEP_BAND_EDGES,
    Imputers, ContractResult, build_features, encode_numeric,
)
from inference.bundle import ModelBundle
from knowledge.evidence import EVIDENCE_VERSION, lifestyle_evidence

log = logging.getLogger(__name__)

DISCLAIMER_KEY = "risk_not_diagnosis"
MAX_REASON_CODES = 3

# 계약 피처 → reason_codes 고정 어휘. None 은 설명에 쓰지 않는 피처.
# sleep 은 값에 따라 sleep_short / sleep_long 으로 갈린다.
_CODE_OF_FEATURE: dict[str, str | None] = {
    "bmi": "bmi_high", "waist_cm": "waist_high", "age": "age", "smoking_status": "smoking_current",
    "alcohol_units_week": "alcohol_high", "activity_minutes_week": "activity_low", "activity_low_flag": "activity_low",
    "sleep_avg_h": None, "sodium_risk_score": "sodium_high", "stress_score": "stress_high",
    "family_htn": "family_htn", "diabetes_flag": "diabetes", "sex": None, "missing_count": None,
}


def _sigmoid(z: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-z))


def _logit(p: float) -> float:
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


class RiskPredictor:
    def __init__(self, full: ModelBundle, lite: ModelBundle) -> None:
        if full.model_id != MODEL_FULL or lite.model_id != MODEL_LITE:
            raise ValueError(f"bundle ids: full={full.model_id} lite={lite.model_id}")
        if full.imputers != lite.imputers:
            log.warning("full/lite imputers differ; using full's for contract transform")
        self.full, self.lite = full, lite
        self.imputers: Imputers = full.imputers

    # ── 공개 API ──
    def predict(self, features: dict[str, Any]) -> dict[str, Any]:
        cr = build_features(features, self.imputers)
        if not cr.accepted:
            return self._rejected(cr)

        bundle = self.full if cr.model_id == MODEL_FULL else self.lite
        row = encode_numeric(cr.features, bundle.model_id)
        x = np.array([[row[c] for c in bundle.columns]], dtype=float)

        p = float(bundle.predict_proba(x)[0])
        p = min(max(p, 0.0), 1.0)
        risk_index = int(round(p * 100))
        reasons = self._reason_codes(bundle, x, cr.features)

        return {
            "risk_index": risk_index,
            "risk_level": T.risk_level(p),
            "calibrated_p": round(p, 4),
            "model_id": bundle.model_id,
            "model_version": bundle.model_version,
            "feature_version": FEATURE_VERSION,
            "thresholds_version": bundle.thresholds_version,
            "data_quality": cr.data_quality,
            "missing_features": list(cr.missing_features),
            "reason_codes": reasons,
            # 모델 기여도(reason_codes)와 별개로, 문헌 근거표 기준 '개입 대상' 요인. 대치된 피처로는 판단하지 않는다.
            # 생활습관의 방향·효과 크기는 KNHANES 계수가 아니라 knowledge/lifestyle_evidence_v1.yaml 이 기준.
            "lifestyle_evidence": lifestyle_evidence(cr.features, cr.missing_features),
            "evidence_version": EVIDENCE_VERSION,
            "expected_sbp": None,  # T2 회귀 모델 연결 전까지 항상 null
            "disclaimer_key": DISCLAIMER_KEY,
            "warnings": list(cr.warnings),
        }

    # ── 거부 응답 ──
    def _rejected(self, cr: ContractResult) -> dict[str, Any]:
        return {
            "risk_index": None,
            "risk_level": None,
            "calibrated_p": None,
            "model_id": None,
            "model_version": self.full.model_version,
            "feature_version": FEATURE_VERSION,
            "thresholds_version": self.full.thresholds_version,
            "data_quality": cr.data_quality,
            "missing_features": list(cr.missing_features),
            "out_of_range_features": list(cr.out_of_range),
            "reason_codes": [],
            "lifestyle_evidence": [],
            "evidence_version": EVIDENCE_VERSION,
            "expected_sbp": None,
            "disclaimer_key": DISCLAIMER_KEY,
            "warnings": list(cr.warnings),
        }

    # ── 설명: 피처별 로짓 기여 → 확률 단위 → 고정 어휘 상위 3개 ──
    def _reason_codes(self, bundle: ModelBundle, x: np.ndarray, feats: dict[str, Any]) -> list[dict[str, Any]]:
        contrib_by_col = self._logit_contributions(bundle, x)
        # 열 → 계약 피처 → 코드 로 합산
        by_code: dict[str, float] = {}
        for col, c in contrib_by_col.items():
            feat = ORIGIN_OF_COLUMN.get(col, col)
            code = self._code_for(feat, feats)
            if code is None:
                continue
            by_code[code] = by_code.get(code, 0.0) + c

        z = _logit(float(bundle.predict_raw_proba(x)[0]))
        p_full = float(_sigmoid(z))
        # 확률 단위 기여: 그 요인을 빼면 확률이 얼마나 내려가는가 (보정 전 확률 기준, 결정적)
        prob_contrib = {code: p_full - float(_sigmoid(z - c)) for code, c in by_code.items()}

        ups = sorted(((k, v) for k, v in prob_contrib.items() if v > 0), key=lambda kv: -kv[1])
        downs = sorted(((k, v) for k, v in prob_contrib.items() if v <= 0), key=lambda kv: kv[1])
        picked = ups[:MAX_REASON_CODES]
        if not picked:  # 올리는 요인이 하나도 없으면 가장 크게 내리는 요인 1개를 direction=down 으로
            picked = downs[:1]
        out = [{"code": k, "direction": "up" if v > 0 else "down", "contribution": round(abs(v), 4)} for k, v in picked]
        assert all(o["code"] in REASON_CODES for o in out)
        return out

    @staticmethod
    def _code_for(feat: str, feats: dict[str, Any]) -> str | None:
        if feat == "sleep_avg_h":
            lo, hi = SLEEP_BAND_EDGES
            h = feats["sleep_avg_h"]
            return "sleep_short" if h < lo else ("sleep_long" if h > hi else None)
        if feat == "smoking_status":
            return "smoking_current" if feats["smoking_status"] == "current" else None
        return _CODE_OF_FEATURE.get(feat)

    @staticmethod
    def _logit_contributions(bundle: ModelBundle, x: np.ndarray) -> dict[str, float]:
        """열별 로짓 기여. 선형 모델은 coef×(변환값−기준점), 트리 모델은 pred_contrib(TreeSHAP)."""
        est = bundle.estimator
        steps = getattr(est, "steps", None)
        final = steps[-1][1] if steps else est
        cols = list(bundle.columns)

        if hasattr(final, "coef_"):
            pre = est[:-1] if steps and len(steps) > 1 else None
            xt = np.asarray(pre.transform(x) if pre is not None else x, dtype=float)
            if bundle.reference is not None:
                ref = np.array([[bundle.reference[c] for c in cols]], dtype=float)
                rt = np.asarray(pre.transform(ref) if pre is not None else ref, dtype=float)
            else:
                rt = np.zeros_like(xt)
            coef = np.asarray(final.coef_).reshape(-1)
            per_col = coef * (xt - rt)[0]
            names = list(pre.get_feature_names_out(cols)) if pre is not None and hasattr(pre, "get_feature_names_out") else cols
            out: dict[str, float] = {}
            for name, c in zip(names, per_col):
                origin = _origin_column(name, cols)
                out[origin] = out.get(origin, 0.0) + float(c)
            return out

        booster = getattr(final, "booster_", None) or final
        if hasattr(booster, "predict"):
            pre = est[:-1] if steps and len(steps) > 1 else None
            xt = pre.transform(x) if pre is not None else x
            contrib = np.asarray(booster.predict(xt, pred_contrib=True))[0]
            return {c: float(v) for c, v in zip(cols, contrib[: len(cols)])}  # 마지막 값은 bias

        raise TypeError(f"cannot explain estimator of type {type(final)}")


def _origin_column(transformed_name: str, cols: list[str]) -> str:
    """'num__age', 'poly__age^2', 'age' 처럼 변환된 열 이름에서 원래 계약 열을 찾는다."""
    for c in sorted(cols, key=len, reverse=True):
        if transformed_name == c or transformed_name.endswith("__" + c) or (c in transformed_name.split("__")[-1]):
            return c
    return transformed_name

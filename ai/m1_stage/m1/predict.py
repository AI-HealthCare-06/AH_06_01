"""
[파일] m1/predict.py
[용도] 추론 API. 저장된 모델·전처리기·메타를 읽어 M1Predictor 를 만들고 명세 2-6 출력
      (stage_probs, stage_top, risk_level, reason_codes, data_quality, model_version, feature_version)을 낸다.
      predict(dict) 는 단건 고속 경로(fast_path + model.predict_one), predict_frame(DataFrame) 은 배치 경로(pandas)를 쓴다.
[왜 필요한가] 최종 모델의 실제 사용 형태다. 혈압값이 입력되거나 항고혈압제 복용이면 not_applicable, 필수 결측이면 insufficient,
             범위 밖이면 out_of_range 로 거부하고 확률을 내지 않는다. stage_top 과 risk_level 은 같은 4단계이며 판정 규칙은 m1/decision.py.
[쓰는 곳] predict_cli.py, evaluate_cli.py, train.py(행 단위 결과·지연 측정), m1/batch.py, tests/
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from .contract import Contract
from .decision import decide_stage
from .fast_path import FastTransformer
from .features import STATUS_NOT_APPLICABLE, VALID_STATUSES, Preprocessor, normalize_columns, to_bool
from .models.base import StageModel
from .reasons import reason_codes


class M1Predictor:
    def __init__(self, model: StageModel, preprocessor: Preprocessor, contract: Contract, meta: dict):
        self.model = model
        self.pre = preprocessor
        self.contract = contract
        self.meta = meta
        self.fast = FastTransformer(preprocessor)   # 단건 경로 (배치 경로와의 동등성은 train.py 가 검증)

    @classmethod
    def load(cls, model_dir: Path | str, contract: Contract | None = None) -> "M1Predictor":
        d = Path(model_dir)
        contract = contract or Contract.load()
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        return cls(StageModel.load(d / "model.pkl"), Preprocessor.load(d / "preprocessor.json", contract), contract, meta)

    # ----- 출력 조립 -----
    def _finish(self, out: dict, problems: str) -> dict:
        """명세 2-6 키만 기본 출력. problems(거부 사유 코드)는 비어 있지 않을 때만 덧붙인다."""
        if problems:
            out["problems"] = problems
        return out

    def _empty(self, status: str, problems: str = "") -> dict:
        return self._finish({"stage_probs": None, "stage_top": None, "risk_level": None, "reason_codes": [], "data_quality": status,
                             "model_version": self.meta["model_version"], "feature_version": self.contract.version}, problems)

    def _output(self, P: np.ndarray, contrib: np.ndarray, raw: dict, observed: dict, status: str, problems: str) -> dict:
        stage = T.STAGES[int(decide_stage(P, getattr(self.model, 'stage_thresholds', None)))]
        raw = {key: (None if isinstance(v, float) and np.isnan(v) else v) for key, v in raw.items()}
        return self._finish({
            "stage_probs": {s: round(float(P[j]), 4) for j, s in enumerate(T.STAGES)},
            "stage_top": stage,
            "risk_level": stage,   # 위험 등급 = 4단계 (사용자 결정). 판정 규칙은 m1/decision.py
            "reason_codes": reason_codes(raw, observed, dict(zip(self.model.columns, contrib.tolist()))),
            "data_quality": status,
            "model_version": self.meta["model_version"],
            "feature_version": self.contract.version,
        }, problems)

    # ----- 대상 아님 판정: 혈압값 입력 또는 항고혈압제 복용 -----
    def not_applicable_mask(self, df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        reason = pd.Series("", index=df.index, dtype=object)
        bp_cols = [c for c in df.columns if self.contract.is_forbidden(c) and c != "htn_med"]
        if bp_cols:
            present = pd.DataFrame({c: df[c].notna() & (df[c].astype(str).str.strip() != "") for c in bp_cols})
            has = present.any(axis=1)
            if has.any():
                reason[has] = ["bp_input_present:" + ",".join(c for c in bp_cols if row[c]) for _, row in present[has].iterrows()]
        if "htn_med" in df.columns:
            med = to_bool(df["htn_med"]) == 1.0
            reason[med] = reason[med].where(reason[med] == "", reason[med] + ";") + "htn_med_true"
        return reason != "", reason

    # ----- 배치 경로 -----
    def predict_frame(self, df: pd.DataFrame) -> list[dict]:
        df = normalize_columns(df)
        na_mask, na_reason = self.not_applicable_mask(df)
        res = self.pre.transform(df.drop(columns=["htn_med"], errors="ignore"))
        P, C = self.model.predict_proba(res.X), self.model.contributions(res.X)
        out = []
        for i, idx in enumerate(df.index):
            if na_mask.loc[idx]:
                out.append(self._empty(STATUS_NOT_APPLICABLE, na_reason.loc[idx]))
            elif res.status.loc[idx] not in VALID_STATUSES:
                out.append(self._empty(res.status.loc[idx], res.problems.loc[idx]))
            else:
                out.append(self._output(P[i], C[i], res.raw.loc[idx].to_dict(), {k: bool(v) for k, v in res.observed.loc[idx].items()},
                                        res.status.loc[idx], str(res.problems.loc[idx])))
        return out

    # ----- 단건 경로 -----
    def predict(self, user_input: dict) -> dict:
        row = {str(k).strip().lower(): v for k, v in user_input.items()}
        bp_keys = sorted(k for k, v in row.items() if self.contract.is_forbidden(k) and k != "htn_med" and v is not None and v == v and str(v).strip() != "")
        if bp_keys:
            return self._empty(STATUS_NOT_APPLICABLE, "bp_input_present:" + ",".join(bp_keys))
        if to_bool(pd.Series([row.pop("htn_med", None)])).iloc[0] == 1.0:
            return self._empty(STATUS_NOT_APPLICABLE, "htn_med_true")
        one = self.fast.transform(row)
        if one.status not in VALID_STATUSES:
            return self._empty(one.status, one.problems)
        P, C = self.model.predict_one(one.x)
        return self._output(P, C, one.raw, one.observed, one.status, one.problems)

"""
[파일] m1/batch.py
[용도] 라벨 없는 파일의 배치 추론 결과표: 조합별 행 단위 표(확률·단계·이유 코드·점검용 hypertension 이진), 분포 요약,
      person_id+step 파일, 점검용 보조 혈압 회귀 표.
[왜 필요한가] 사용자의 검증 방식(테스트 파일의 혈압을 비우고 step 을 모델이 채움 → 정답률 확인)을 지원한다. 표 형식을 CLI 와 분리해 둔다.
[쓰는 곳] predict_cli.py, tests/test_pipeline.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from .contract import Contract
from .evaluate import HTN_THRESHOLD_DEFAULT
from .features import VALID_STATUSES, Preprocessor
from .labels import stage_index
from .models.bp_regression import BPRegressor
from .pipeline import BP_REGRESSION_PREFIX
from .predict import M1Predictor

DATA_QUALITIES = ("ok", "partial", "insufficient", "out_of_range", "not_applicable")
TOP_REASONS = 5
STEP_COLUMN = "step"
ID_COLUMN = "person_id"


def output_frame(df: pd.DataFrame, outputs: list[dict], thr_youden: float) -> pd.DataFrame:
    """입력 표 + 단계 확률·예측 단계·위험 등급·이유 코드·품질 + 점검용 hypertension 이진(P(htn) ≥ 0.5 / Youden)."""
    frame = df.copy()
    frame.insert(0, "row", range(len(df)))
    for s in T.STAGES:
        frame[f"p_{s}"] = [(o["stage_probs"] or {}).get(s) for o in outputs]
    frame["stage_top"] = [o["stage_top"] for o in outputs]
    p_htn = pd.to_numeric(frame["p_htn"], errors="coerce")
    frame["pred_hypertension"] = (p_htn >= HTN_THRESHOLD_DEFAULT).astype(float).where(p_htn.notna())
    frame["pred_hypertension_youden"] = (p_htn >= thr_youden).astype(float).where(p_htn.notna())
    frame["htn_threshold_youden"] = thr_youden
    frame["risk_level"] = [o["risk_level"] for o in outputs]
    frame["reason_codes"] = [",".join(o["reason_codes"]) for o in outputs]
    frame["data_quality"] = [o["data_quality"] for o in outputs]
    frame["problems"] = [o.get("problems", "") for o in outputs]
    frame["model_version"] = [o["model_version"] for o in outputs]
    return frame


def summarize(combo: str, frame: pd.DataFrame) -> dict:
    """조합별 분포: 품질·예측 단계·위험 등급·평균 확률·이유 코드 상위."""
    scored = frame[frame["stage_top"].notna()]
    dq, top, rl = frame["data_quality"].value_counts(), scored["stage_top"].value_counts(), scored["risk_level"].value_counts()
    codes = scored["reason_codes"].str.split(",").explode()
    codes = codes[codes != ""].value_counts()
    return {
        "combo": combo, "rows": len(frame), "scored": len(scored),
        **{f"dq_{q}": int(dq.get(q, 0)) for q in DATA_QUALITIES},
        **{f"top_{s}": int(top.get(s, 0)) for s in T.STAGES},
        **{f"risk_{name}": int(rl.get(name, 0)) for name in T.RISK_LEVELS},
        **{f"mean_p_{s}": float(scored[f"p_{s}"].mean()) if len(scored) else float("nan") for s in T.STAGES},
        "top_reason_codes": ", ".join(f"{c} {100 * v / max(len(scored), 1):.0f}%" for c, v in codes.head(TOP_REASONS).items()),
    }


def step_frame(df: pd.DataFrame, frame: pd.DataFrame) -> pd.DataFrame:
    """person_id(없으면 row) + step(= stage_top; 산출 불가 행은 data_quality 값)."""
    ids = df[ID_COLUMN] if ID_COLUMN in df.columns else pd.Series(range(len(df)), index=df.index, name="row")
    step = frame["stage_top"].where(frame["stage_top"].notna(), frame["data_quality"])
    return pd.DataFrame({ids.name or ID_COLUMN: ids.to_numpy(), STEP_COLUMN: step.to_numpy()})


def bp_frames(run_dir: Path, contract: Contract, df: pd.DataFrame, predictor: M1Predictor) -> dict[str, pd.DataFrame]:
    """artifacts/<run>/bp_regression__* 가 있으면 행마다 예측 sbp·dbp 와 환산 단계(점검용)를 만든다. 키 = 시트 이름 bp_<후보>."""
    out = {}
    na_mask, _ = predictor.not_applicable_mask(df)
    for d in sorted(run_dir.glob(f"{BP_REGRESSION_PREFIX}*")):
        pre = Preprocessor.load(d / "preprocessor.json", contract)
        model = BPRegressor.load(d / "model.pkl")
        res = pre.transform(df.drop(columns=["htn_med"], errors="ignore"))
        valid = res.status.isin(VALID_STATUSES) & ~na_mask
        yhat = pd.DataFrame(np.nan, index=df.index, columns=["pred_sbp", "pred_dbp"])
        if valid.any():
            yhat.loc[valid, ["pred_sbp", "pred_dbp"]] = model.predict(res.X[valid]).round(1)
        frame = df.copy()
        frame.insert(0, "row", range(len(df)))
        frame[["pred_sbp", "pred_dbp"]] = yhat
        st = stage_index(yhat["pred_sbp"].to_numpy(), yhat["pred_dbp"].to_numpy(), np.zeros(len(df)))
        frame["pred_stage_from_bp"] = [T.STAGES[int(v)] if v == v else None for v in st]
        frame["pred_hypertension_from_bp"] = pd.Series(st == T.STAGE_INDEX["htn"], index=df.index).astype(float).where(~np.isnan(st))
        frame["data_quality"] = res.status.where(~na_mask, "not_applicable")
        frame["model_version"] = json.loads((d / "meta.json").read_text(encoding="utf-8"))["model_version"]
        out["bp_" + d.name[len(BP_REGRESSION_PREFIX):]] = frame
    return out


def write_sheets(path: Path, sheets: dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        for name, df in sheets.items():
            df.to_excel(xw, sheet_name=name[:31], index=False)
            ws = xw.sheets[name[:31]]
            ws.freeze_panes = "A2"
            for col in ws.columns:
                width = max((len(str(c.value)) for c in col if c.value is not None), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(width + 2, 40)

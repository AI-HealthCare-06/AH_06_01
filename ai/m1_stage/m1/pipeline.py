"""
[파일] m1/pipeline.py
[용도] 학습·평가·추론 CLI 가 함께 쓰는 공용 단계: 데이터 로드→명세 변수→라벨→행 검증, 단건 입력 샘플, 지연 측정, run/조합 찾기.
[왜 필요한가] train.py·evaluate_cli.py·predict_cli.py 가 같은 로드·검증 규칙을 쓰도록 한 곳에 둔다. CLI 끼리 서로 import 하지 않게 한다.
[쓰는 곳] train.py, evaluate_cli.py, predict_cli.py
"""

from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from .contract import Contract
from .data_io import load_table
from .features import VALID_STATUSES, Preprocessor, coerce_spec_table
from .labels import make_labels, measured_bp

# 흡연·스트레스 포함/제외 변형 (명세 2-4). 데이터에 없는 변수의 변형은 train.py 가 생략한다.
VARIANTS: dict[str, tuple[str, ...]] = {
    "base": (),
    "smoking": ("smoking",),
    "stress": ("stress_score",),
    "smoking_stress": ("smoking", "stress_score"),
}
BP_REGRESSION_PREFIX = "bp_regression__"   # 점검용 보조 회귀 산출물 폴더 접두사
LATENCY_WARMUP = 10


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# 데이터 준비
# ---------------------------------------------------------------------------
def load_labeled(path: str | Path, contract: Contract, *, sheet: int | str = 0, max_rows: int | None = None, sample_frac: float | None = None,
                 seed: int = 42, assume_no_med: bool = False) -> tuple[pd.DataFrame, np.ndarray, dict, dict]:
    """로드 → 명세 변수 표 → 라벨. 라벨이 없는 행은 뺀다. 측정 혈압은 __sbp/__dbp 로 보존한다(피처 아님, 회귀 점검 정답)."""
    df, load_info = load_table(path, sheet=sheet, max_rows=max_rows, sample_frac=sample_frac, seed=seed)
    spec = coerce_spec_table(df, contract)
    y_all, label_info = make_labels(spec, contract, med_policy="assume_false" if assume_no_med else "reject")
    spec["__sbp"], spec["__dbp"] = measured_bp(spec, contract)
    spec, y = spec[y_all.notna()].reset_index(drop=True), y_all.dropna().astype(int).to_numpy()
    if len(y) == 0:
        hint = " 복약 컬럼이 없으면 --assume-no-med 로 비복약 가정 실행 가능(명세 2-2 미적용)." if label_info["htn_med_source"] == "없음" else ""
        raise ValueError(f"{path}: 라벨을 만들 수 있는 행이 없음. 혈압·복약 컬럼명을 확인 (feature_contract.yaml label_inputs)." + hint)
    return spec, y, load_info, label_info


def filter_valid(pre: Preprocessor, spec: pd.DataFrame, y: np.ndarray) -> tuple[pd.DataFrame, np.ndarray, dict, dict]:
    """범위 밖·필수 결측·결측 과다 행 제외. (spec, y, 상태 수, 제외 사유 수)"""
    res = pre.transform(spec)
    keep = res.status.isin(VALID_STATUSES).to_numpy()
    status = {k: int(v) for k, v in res.status.value_counts().items()}
    excluded = {str(k): int(v) for k, v in res.problems[~keep].str.split(";").explode().value_counts().items()} if (~keep).any() else {}
    return spec[keep].reset_index(drop=True), y[keep], status, excluded


def stage_counts(y: np.ndarray) -> dict:
    return {T.STAGES[i]: int((np.asarray(y) == i).sum()) for i in range(len(T.STAGES))}


def input_columns(pre: Preprocessor, spec: pd.DataFrame) -> list[str]:
    """행 단위 결과표에 남길 입력 열: 출처 파일 + 이 변형의 명세 변수."""
    return [c for c in ["__source_file"] + [f.name for f in pre.features if f.name != "missing_count"] if c in spec.columns]


def sample_input(row: pd.Series, contract: Contract) -> dict:
    """명세 변수 한 행을 단건 추론 입력 dict 로 (결측은 뺀다)."""
    out = {}
    for f in contract.all_features():
        n = f.name
        if n == "missing_count" or n not in row.index:
            continue
        v = row[n]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        out[n] = v.item() if hasattr(v, "item") else v
    return out


def measure_latency(predictor, sample: dict, iters: int) -> dict:
    for _ in range(LATENCY_WARMUP):
        predictor.predict(sample)
    times = []
    for _ in range(iters):
        t0 = time.perf_counter()
        predictor.predict(sample)
        times.append((time.perf_counter() - t0) * 1000.0)
    return {"latency_p50_ms": float(np.percentile(times, 50)), "latency_p95_ms": float(np.percentile(times, 95)), "latency_iters": iters}


# ---------------------------------------------------------------------------
# run · 조합 찾기
# ---------------------------------------------------------------------------
def resolve_run(artifacts: str | Path, run: str | None = None) -> str:
    if run:
        return run
    latest = Path(artifacts) / "LATEST"
    if not latest.exists():
        raise FileNotFoundError("artifacts/LATEST 가 없음 — 먼저 train.py 를 실행하거나 --run 지정")
    return latest.read_text(encoding="utf-8").strip()


def stage_combos(run_dir: Path) -> list[str]:
    """run 폴더 안의 단계 모델 조합(보조 회귀 폴더 제외)."""
    return sorted(d.name for d in run_dir.iterdir() if (d / "meta.json").exists() and not d.name.startswith(BP_REGRESSION_PREFIX))


def select_combos(run_dir: Path, combo: str) -> list[str]:
    available = stage_combos(run_dir)
    if combo == "all":
        return available
    wanted = [c.strip() for c in combo.split(",") if c.strip()]
    missing = [c for c in wanted if c not in available]
    if missing:
        raise FileNotFoundError(f"run {run_dir.name} 에 없는 조합: {missing} (있는 조합: {available})")
    return wanted

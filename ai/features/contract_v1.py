"""features/contract_v1.py — Feature Contract v1 변환 (학습·추론 공용)

feature_contract_v1.yaml 이 원본이고, 이 모듈은 그 계약을 코드로 실행한다.
KNHANES 학습 행도, 앱에서 들어온 추론 요청도 전부 `build_features()` 한 함수를 지나므로
"학습 때랑 다르게 계산했다"는 사고가 생기지 않는다.

하는 일
  1. 금지 피처(sbp/dbp 등) 제거 + 경고        → 라벨 누수 차단
  2. 미적용 대상(18세 미만, 임신) 거부          → not_applicable
  3. 필수 피처(age, sex, bmi) 결측 거부         → insufficient
  4. 범위·enum 검사, 클리핑 없이 거부           → out_of_range
  5. 선택 피처 결측 대치 + *_missing 플래그      → missing_count
  6. 파생(activity_low_flag) 계산, lite/full 선택 → data_quality ok / partial
  7. 모델 입력용 숫자 인코딩 (encode_numeric)

임계값·범위 숫자는 여기서 새로 정하지 않는다. 범위는 yaml 에서 읽고, yaml 과
thresholds_kr_v1.FEATURE_RANGES 가 같은지 check_ranges_match_thresholds() 로 확인한다.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import yaml

import thresholds_kr_v1 as T

log = logging.getLogger(__name__)

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "feature_contract_v1.yaml"
FEATURE_VERSION = "v1"

# ── 계약 로드 ────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def load_contract() -> dict:
    with CONTRACT_PATH.open(encoding="utf-8") as f:
        c = yaml.safe_load(f)
    assert c["feature_version"] == FEATURE_VERSION, c["feature_version"]
    return c


def _spec() -> dict[str, dict]:
    return {f["name"]: f for f in load_contract()["features"]}


_C = load_contract()
SPEC: dict[str, dict] = _spec()
LITE_FEATURES: tuple[str, ...] = tuple(_C["models"]["htn_risk_lite"]["features"])
FULL_FEATURES: tuple[str, ...] = tuple(_C["models"]["htn_risk_full"]["features"])
NEVER_FEATURES: tuple[str, ...] = tuple(_C["never_features"])
REQUIRED: tuple[str, ...] = tuple(n for n, s in SPEC.items() if s.get("missing") == "reject")
RANGES: dict[str, tuple[float, float]] = {n: tuple(s["range"]) for n, s in SPEC.items() if "range" in s}
ENUMS: dict[str, tuple[str, ...]] = {n: tuple(s["values"]) for n, s in SPEC.items() if "values" in s}
BOOLS: tuple[str, ...] = tuple(n for n, s in SPEC.items() if s["type"] == "bool" and "derive" not in s)
DERIVED: tuple[str, ...] = tuple(n for n, s in SPEC.items() if "derive" in s)
# 결측 대치가 정의된 선택 피처: name -> (impute 규칙, 플래그 이름)
IMPUTABLE: dict[str, tuple[Any, str]] = {
    n: (s["missing"]["impute"], s["missing"]["flag"])
    for n, s in SPEC.items()
    if isinstance(s.get("missing"), dict)
}
REASON_CODES: tuple[str, ...] = tuple(_C["output"]["reason_codes_vocab"])
DATA_QUALITY: tuple[str, ...] = tuple(_C["output"]["data_quality"])

# yaml 의 자연어 규칙에 대응하는 숫자. 바꾸면 yaml 도 같이 바꾼다.
FALLBACK_MISSING_COUNT = 3        # fallback: "결측 3개 이상이면 htn_risk_lite"
ACTIVITY_LOW_MINUTES = 150        # activity_low_flag: "activity_minutes_week < 150"
ACTIVITY_BAND_EDGES = (150, 300)  # note: 3단 척도 activity_band (<150, 150~300, >300)
SLEEP_BAND_EDGES = (6.0, 8.0)     # note: 수면 밴드 (<6, 6~8, >8) — reason code sleep_short / sleep_long 에도 사용
# waist 대치용 BMI 구간 (대한비만학회 성인 기준: 저체중 <18.5, 정상 18.5~23, 과체중 23~25, 비만 25~30, 고도비만 ≥30)
BMI_BAND_EDGES = (18.5, 23.0, 25.0, 30.0)
BMI_BAND_NAMES = ("under", "normal", "over", "obese1", "obese2")

MODEL_FULL = "htn_risk_full"
MODEL_LITE = "htn_risk_lite"


def check_ranges_match_thresholds() -> None:
    """yaml 범위와 thresholds_kr_v1.FEATURE_RANGES 가 다르면 즉시 실패. 테스트와 학습 스크립트 시작 시 호출."""
    for name, rng in T.FEATURE_RANGES.items():
        assert tuple(rng) == RANGES.get(name), f"range mismatch for {name}: thresholds={rng} yaml={RANGES.get(name)}"


# ── 밴드·보조 변환 ───────────────────────────────────────────────────────────


def bmi_band(bmi: float) -> str:
    for edge, name in zip(BMI_BAND_EDGES, BMI_BAND_NAMES):
        if bmi < edge:
            return name
    return BMI_BAND_NAMES[-1]


def activity_band(minutes: float) -> int:
    """0: <150, 1: 150~300, 2: >300 — 설문(KNHANES)↔실측(웨어러블) 차이를 줄이기 위한 거친 척도."""
    lo, hi = ACTIVITY_BAND_EDGES
    return 0 if minutes < lo else (1 if minutes <= hi else 2)


def sleep_band(hours: float) -> int:
    """0: <6h, 1: 6~8h, 2: >8h."""
    lo, hi = SLEEP_BAND_EDGES
    return 0 if hours < lo else (1 if hours <= hi else 2)


# 앱 원시 필드 → 계약 피처 보조 변환 (개발팀 어댑터에서 사용). KNHANES 쪽 변환은 knhanes 어댑터에 둔다.
def bmi_from(height_cm: float, weight_kg: float) -> float:
    return weight_kg / (height_cm / 100.0) ** 2


def alcohol_units_week_from(days_per_week: float, drinks_per_occasion: float) -> float:
    return float(days_per_week) * float(drinks_per_occasion)


def stress_app_to_contract(stress_1_to_5: int) -> int:
    """앱 1~5 → 계약 1~4: round((s-1)*3/4)+1 (yaml app_source 그대로)."""
    return int(round((stress_1_to_5 - 1) * 3 / 4)) + 1


# ── 결측 대치값 (학습 세트에서 계산해 아티팩트에 저장) ─────────────────────────


@dataclass(frozen=True)
class Imputers:
    """계약의 '학습 세트에서 계산' 대치값. 아티팩트에 함께 저장되어 학습·추론이 같은 값을 쓴다."""

    waist_by_sex_bmi_band: dict[str, float]   # key: "male|normal"
    waist_by_sex: dict[str, float]            # 구간 키가 없을 때 fallback
    activity_median: float
    source: str = "provisional"               # "provisional" | "knhanes_<train years>"

    @staticmethod
    def key(sex: str, bmi: float) -> str:
        return f"{sex}|{bmi_band(bmi)}"

    def waist(self, sex: str, bmi: float) -> float:
        return self.waist_by_sex_bmi_band.get(self.key(sex, bmi), self.waist_by_sex[sex])

    @classmethod
    def provisional(cls) -> "Imputers":
        """KNHANES 학습 세트가 준비되기 전 임시값(한국 성인 대략치). 출시 아티팩트에는 fit_imputers 결과만 쓴다."""
        male = {"under": 70.0, "normal": 81.0, "over": 86.5, "obese1": 92.0, "obese2": 102.0}
        female = {"under": 66.0, "normal": 74.0, "over": 80.0, "obese1": 86.5, "obese2": 97.0}
        table = {f"male|{k}": v for k, v in male.items()} | {f"female|{k}": v for k, v in female.items()}
        return cls(table, {"male": 84.0, "female": 77.0}, activity_median=120.0, source="provisional")


def fit_imputers(df, source: str) -> Imputers:
    """학습 세트(계약 피처 열: sex, bmi, waist_cm, activity_minutes_week)에서 대치값 계산."""
    d = df.dropna(subset=["sex", "bmi"]).copy()
    d["_band"] = d["bmi"].map(bmi_band)
    w = d.dropna(subset=["waist_cm"])
    by_band = w.groupby(["sex", "_band"])["waist_cm"].median()
    table = {f"{s}|{b}": float(v) for (s, b), v in by_band.items()}
    by_sex = {s: float(v) for s, v in w.groupby("sex")["waist_cm"].median().items()}
    act = float(d["activity_minutes_week"].median()) if "activity_minutes_week" in d else 0.0
    if math.isnan(act):
        act = 0.0
    return Imputers(table, by_sex, activity_median=act, source=source)


# ── 결과 객체 ────────────────────────────────────────────────────────────────


@dataclass
class ContractResult:
    data_quality: str                          # ok | partial | insufficient | out_of_range | not_applicable
    model_id: str | None = None                # htn_risk_full | htn_risk_lite | None(거부)
    features: dict[str, Any] = field(default_factory=dict)   # 계약 피처 14개 (typed)
    missing_features: list[str] = field(default_factory=list)
    out_of_range: list[str] = field(default_factory=list)
    ignored_keys: list[str] = field(default_factory=list)    # 입력에 있었지만 무시한 금지 피처
    warnings: list[str] = field(default_factory=list)

    @property
    def accepted(self) -> bool:
        return self.data_quality in ("ok", "partial")


# ── 값 검사 도우미 ────────────────────────────────────────────────────────────


def _is_missing(v: Any) -> bool:
    """None / NaN(파이썬·numpy float) / pandas NA·NaT / 빈 문자열을 결측으로 본다.
    pandas 를 import 하지 않으려고 NA 는 타입 이름으로 판별한다 (추론 프로세스 메모리 예산)."""
    if v is None:
        return True
    if isinstance(v, (float, np.floating)) and math.isnan(float(v)):
        return True
    if type(v).__name__ in ("NAType", "NaTType"):
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    return False


def _as_number(v: Any) -> float | None:
    """숫자로 해석 가능하면 float, 아니면 None. bool 은 숫자로 보지 않는다."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    try:  # numpy 스칼라
        return float(v)
    except (TypeError, ValueError):
        return None


def _as_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "false"):
        return v.strip().lower() == "true"
    item = getattr(v, "item", None)  # numpy bool 스칼라
    if callable(item):
        try:
            x = item()
            if isinstance(x, bool):
                return x
        except (TypeError, ValueError):
            pass
    return None


def _coerce(name: str, v: Any) -> tuple[Any, bool]:
    """(값, 유효 여부). 타입·범위·enum 검사. 범위 밖은 클리핑하지 않는다."""
    spec = SPEC[name]
    t = spec["type"]
    if t in ("int", "float"):
        x = _as_number(v)
        if x is None or math.isinf(x):
            return v, False
        lo, hi = RANGES[name]
        if not (lo <= x <= hi):
            return x, False
        if t == "int":
            if abs(x - round(x)) > 1e-9:
                return x, False
            return int(round(x)), True
        return float(x), True
    if t == "enum":
        s = str(v).strip().lower() if isinstance(v, str) else v
        return s, s in ENUMS[name]
    if t == "bool":
        b = _as_bool(v)
        return b, b is not None
    raise ValueError(f"unknown type {t} for {name}")


# ── 핵심: 입력 1건 → 계약 피처 ───────────────────────────────────────────────


def build_features(raw: dict[str, Any], imputers: Imputers) -> ContractResult:
    """앱 입력(또는 매핑된 KNHANES 행) 1건을 계약 피처 14개로 바꾼다. 거부 사유는 data_quality 에."""
    raw = dict(raw)  # 호출자 dict 를 바꾸지 않는다
    warnings: list[str] = []

    # 1. 금지 피처는 어떤 경우에도 쓰지 않는다. 있으면 버리고 경고.
    ignored = [k for k in NEVER_FEATURES if k in raw]
    for k in ignored:
        raw.pop(k)
    if ignored:
        log.warning("never_features present in input and ignored: %s", ignored)
        warnings.append(f"ignored_never_features:{','.join(ignored)}")
    fv = raw.pop("feature_version", None)
    if fv is not None and str(fv) != FEATURE_VERSION:
        warnings.append(f"feature_version_mismatch:{fv}")

    # 2. 미적용 대상 — 18세 미만, 임신. 다른 검사보다 먼저.
    age_num = _as_number(raw.get("age")) if not _is_missing(raw.get("age")) else None
    preg = raw.get("pregnancy_status")
    if (age_num is not None and age_num < T.ADULT_AGE) or (isinstance(preg, str) and preg.strip().lower() == "pregnant"):
        return ContractResult("not_applicable", ignored_keys=ignored, warnings=warnings)

    # bmi 가 없고 키·체중이 있으면 계약 app_source 대로 파생
    if _is_missing(raw.get("bmi")):
        h, w = _as_number(raw.get("height_cm")), _as_number(raw.get("weight_kg"))
        if h and w and h > 0:
            raw["bmi"] = bmi_from(h, w)

    # 3. 필수 피처 결측 → insufficient
    missing_required = [n for n in REQUIRED if _is_missing(raw.get(n))]
    if missing_required:
        return ContractResult("insufficient", missing_features=missing_required,
                              ignored_keys=ignored, warnings=warnings)

    # 4. 존재하는 피처는 전부 타입·범위·enum 검사 (파생 피처는 입력을 믿지 않고 다시 계산)
    feats: dict[str, Any] = {}
    out_of_range: list[str] = []
    for name in SPEC:
        if name in DERIVED or _is_missing(raw.get(name)):
            continue
        val, ok = _coerce(name, raw[name])
        if ok:
            feats[name] = val
        else:
            out_of_range.append(name)
    if out_of_range:
        return ContractResult("out_of_range", out_of_range=out_of_range,
                              ignored_keys=ignored, warnings=warnings)

    # 5. 선택 피처 결측 대치 + 플래그
    missing: list[str] = []
    for name, (rule, _) in IMPUTABLE.items():
        if name in feats:
            continue
        missing.append(name)
        if name == "waist_cm":
            feats[name] = imputers.waist(feats["sex"], feats["bmi"])
        elif name == "activity_minutes_week":
            feats[name] = int(round(imputers.activity_median))
        else:
            feats[name] = rule  # yaml 상수: never / 0 / 7.0 / 1 / 2 / False

    # 6. 파생
    activity_missing = "activity_minutes_week" in missing
    feats["activity_low_flag"] = True if activity_missing else feats["activity_minutes_week"] < ACTIVITY_LOW_MINUTES
    feats["missing_count"] = len(missing)

    model_id = MODEL_LITE if len(missing) >= FALLBACK_MISSING_COUNT else MODEL_FULL
    quality = "partial" if model_id == MODEL_LITE else "ok"
    ordered = {n: feats[n] for n in FULL_FEATURES}
    return ContractResult(quality, model_id, ordered, missing, [], ignored, warnings)


# ── 모델 입력 인코딩 ─────────────────────────────────────────────────────────
# 학습(B0·B1)과 추론이 같은 열 이름·순서를 쓴다. 범주형은 고정 더미, bool 은 0/1.

NUMERIC_COLUMNS_LITE: tuple[str, ...] = (
    "age", "sex_female", "bmi", "waist_cm", "smoking_former", "smoking_current",
)
NUMERIC_COLUMNS_FULL: tuple[str, ...] = NUMERIC_COLUMNS_LITE + (
    "alcohol_units_week", "activity_minutes_week", "activity_low_flag", "sleep_avg_h",
    "sodium_risk_score", "stress_score", "family_htn", "diabetes_flag", "missing_count",
)
# 설명(reason code) 집계용: 인코딩 열 → 원래 계약 피처
ORIGIN_OF_COLUMN: dict[str, str] = {
    "sex_female": "sex", "smoking_former": "smoking_status", "smoking_current": "smoking_status",
}
# 단조 제약 (B0 부호 경계 · B1 LightGBM monotone_constraints): +1 위험↑, -1 위험↓, 0 제약 없음.
# 인수인계 5장: bmi↑ waist↑ age↑ alcohol↑ sodium↑ → 위험↑, activity↑ → 위험↓.
# 방향의 기준은 문헌 근거표 knowledge/lifestyle_evidence_v1.yaml 이며, 이 표와 일치해야 한다 (tests/test_evidence.py).
# KNHANES 단면 자료는 역인과(진단 후 소금↓·운동↑)로 sodium/activity 계수 부호가 뒤집히므로 데이터 부호를 따르지 않는다.
# smoking_current 는 문헌상 혈압 지속 효과는 약하나 심혈관 위험 기준으로 up — ≥0 제약 (AI팀 결정, 2026-10-12).
MONOTONE_CONSTRAINTS: dict[str, int] = {
    "age": 1, "sex_female": 0, "bmi": 1, "waist_cm": 1, "smoking_former": 0, "smoking_current": 1,
    "alcohol_units_week": 1, "activity_minutes_week": -1, "activity_low_flag": 1, "sleep_avg_h": 0,
    "sodium_risk_score": 1, "stress_score": 0, "family_htn": 0, "diabetes_flag": 0, "missing_count": 0,
}


def columns_for(model_id: str) -> tuple[str, ...]:
    return NUMERIC_COLUMNS_LITE if model_id == MODEL_LITE else NUMERIC_COLUMNS_FULL


def encode_numeric(features: dict[str, Any], model_id: str) -> dict[str, float]:
    """계약 피처(typed) → 숫자 열. lite 는 앞 6개 열만."""
    f = features
    row = {
        "age": float(f["age"]),
        "sex_female": 1.0 if f["sex"] == "female" else 0.0,
        "bmi": float(f["bmi"]),
        "waist_cm": float(f["waist_cm"]),
        "smoking_former": 1.0 if f["smoking_status"] == "former" else 0.0,
        "smoking_current": 1.0 if f["smoking_status"] == "current" else 0.0,
    }
    if model_id == MODEL_FULL:
        row.update({
            "alcohol_units_week": float(f["alcohol_units_week"]),
            "activity_minutes_week": float(f["activity_minutes_week"]),
            "activity_low_flag": 1.0 if f["activity_low_flag"] else 0.0,
            "sleep_avg_h": float(f["sleep_avg_h"]),
            "sodium_risk_score": float(f["sodium_risk_score"]),
            "stress_score": float(f["stress_score"]),
            "family_htn": 1.0 if f["family_htn"] else 0.0,
            "diabetes_flag": 1.0 if f["diabetes_flag"] else 0.0,
            "missing_count": float(f["missing_count"]),
        })
    return {c: row[c] for c in columns_for(model_id)}


def transform_frame(df, imputers: Imputers, model_id: str = MODEL_FULL):
    """학습용: 계약 입력 열을 가진 DataFrame → (숫자 행렬 DataFrame, ContractResult 리스트).

    거부된 행(insufficient/out_of_range/not_applicable)은 행렬에서 빠지고 결과 리스트로 사유를 셀 수 있다.
    model_id 를 강제하면(lite 학습 등) fallback 선택과 무관하게 그 열 집합으로 인코딩한다.
    """
    import pandas as pd

    rows, index, results = [], [], []
    for idx, rec in zip(df.index, df.to_dict("records")):
        r = build_features(rec, imputers)
        results.append(r)
        if r.accepted:
            rows.append(encode_numeric(r.features, model_id))
            index.append(idx)
    X = pd.DataFrame(rows, index=index, columns=list(columns_for(model_id)), dtype=float)
    return X, results

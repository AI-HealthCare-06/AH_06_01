"""
[파일] m1/features.py
[용도] 피처 변환. (1) coerce_spec_table: 원시 표 → 명세 변수 표(컬럼명 정규화, 타입 변환, 원시 컬럼에서 bmi·alcohol_week 등 산출)
      (2) Preprocessor: 범위 검사(out_of_range 거부) → 결측 대치 + 플래그 → missing_count → 상호작용·표준화 → 모델 행렬 X.
[왜 필요한가] 명세 1절 "학습과 추론이 같은 변환 함수를 쓴다"의 구현이다. 학습 때 fit 한 중앙값·표준화 통계를 json 으로 저장하고
             추론 때 같은 transform 을 쓰므로 한 행을 넣어도 학습 때와 같은 값이 나온다. 범위 밖 값은 클리핑하지 않고 상태로 거부하며,
             결측 처리 방식(거부/중앙값/성별×BMI 구간 중앙값/상수)은 feature_contract.yaml 을 따른다.
[쓰는 곳] m1/pipeline.py, m1/predict.py, m1/fast_path.py(규칙 공유·동등성 검증), m1/batch.py, m1/labels.py(to_bool), profile_data.py, tests/
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from pandas.api.types import is_bool_dtype, is_numeric_dtype

import thresholds as T
from .contract import Contract, FeatureSpec

STATUS_OK = "ok"
STATUS_PARTIAL = "partial"
STATUS_INSUFFICIENT = "insufficient"
STATUS_OUT_OF_RANGE = "out_of_range"
STATUS_NOT_APPLICABLE = "not_applicable"
VALID_STATUSES = (STATUS_OK, STATUS_PARTIAL)

TRUE_TOKENS = {"1", "1.0", "true", "t", "yes", "y", "o", "예", "있음", "있다", "해당", "복용"}
FALSE_TOKENS = {"0", "0.0", "false", "f", "no", "n", "x", "아니오", "아니요", "없음", "없다", "비해당", "미복용"}


# ---------------------------------------------------------------------------
# 타입 변환
# ---------------------------------------------------------------------------
def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = [str(c).strip().lower() for c in out.columns]
    if out.columns.duplicated().any():
        raise ValueError(f"소문자 정규화 후 컬럼명이 중복됨: {sorted(set(out.columns[out.columns.duplicated()]))}")
    return out


def to_numeric(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").astype(float)


def to_bool(s: pd.Series) -> pd.Series:
    """True/False/1/0/예/아니오 등 → 1.0/0.0, 그 외 NaN."""
    if is_bool_dtype(s):
        return s.astype(float)
    if is_numeric_dtype(s):
        v = s.astype(float)
        return pd.Series(np.where(v == 1, 1.0, np.where(v == 0, 0.0, np.nan)), index=s.index)
    t = s.astype("string").str.strip().str.lower()
    out = pd.Series(np.nan, index=s.index, dtype=float)
    out[t.isin(TRUE_TOKENS).fillna(False).astype(bool)] = 1.0
    out[t.isin(FALSE_TOKENS).fillna(False).astype(bool)] = 0.0
    return out


def alias_map(aliases: dict) -> dict[str, str]:
    """범주 별칭 → 라벨. 숫자 코드는 '1' 과 '1.0' 둘 다 받는다."""
    mapping: dict[str, str] = {}
    for label, toks in aliases.items():
        for tok in list(toks) + [label]:
            key = str(tok).strip().lower()
            mapping[key] = label
            if key.isdigit():
                mapping[f"{key}.0"] = label
    return mapping


def to_category(s: pd.Series, aliases: dict) -> pd.Series:
    mapped = s.astype("string").str.strip().str.lower().map(alias_map(aliases))
    return pd.Series(np.where(mapped.isna(), None, mapped), index=s.index, dtype=object)


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return to_numeric(df[col]) if col in df.columns else pd.Series(np.nan, index=df.index, dtype=float)


def _bool(df: pd.DataFrame, col: str) -> pd.Series:
    return to_bool(df[col]) if col in df.columns else pd.Series(np.nan, index=df.index, dtype=float)


def _any_flag(parts: list[pd.Series]) -> pd.Series:
    """bool 구성요소의 any: 하나라도 1 → 1, 관측된 것이 모두 0 → 0, 아무것도 관측 안 됨 → NaN."""
    st = pd.concat(parts, axis=1)
    out = pd.Series(np.nan, index=st.index, dtype=float)
    out[st.notna().any(axis=1)] = 0.0
    out[(st == 1).any(axis=1)] = 1.0
    return out


def _cmp(s: pd.Series, op: str, thr: float) -> pd.Series:
    """NaN 보존 비교 → 1.0/0.0/NaN."""
    res = {"<": s < thr, ">": s > thr, ">=": s >= thr}[op]
    return pd.Series(np.where(s.isna(), np.nan, res.astype(float)), index=s.index)


# ---------------------------------------------------------------------------
# 원시 컬럼 → 명세 변수 산출 (명세 변수 컬럼이 없거나 NaN 인 행만 채운다)
# ---------------------------------------------------------------------------
def _derive_activity(df):
    parts = pd.concat([_num(df, "moderate_min_week"), T.ACTIVITY_VIGOROUS_WEIGHT * _num(df, "vigorous_min_week"), _num(df, "walk_min_week")], axis=1)
    return parts.fillna(0).sum(axis=1).where(parts.notna().any(axis=1))


DERIVERS = {
    "bmi": lambda df: (_num(df, "weight_kg") / (_num(df, "height_cm") / 100) ** 2).where(_num(df, "height_cm") > 0),
    "alcohol_week": lambda df: _num(df, "alcohol_freq_per_week") * _num(df, "alcohol_drinks_per_occasion"),
    "alcohol_per_day": lambda df: _cmp(_num(df, "alcohol_week") / 7.0, ">", T.ALCOHOL_DRINKS_PER_DAY_HIGH),
    "binge": lambda df: _cmp(_num(df, "binge_freq_per_month"), ">=", T.BINGE_MIN_PER_MONTH),
    "activity_minutes_week": _derive_activity,
    "activity_low_flag": lambda df: _cmp(_num(df, "activity_minutes_week"), "<", T.ACTIVITY_LOW_MIN_PER_WEEK),  # 결측은 Preprocessor 가 true
    "family_htn": lambda df: _any_flag([_bool(df, "family_htn_father"), _bool(df, "family_htn_mother"), _bool(df, "family_htn_sibling")]),
    "sleep_short_flag": lambda df: _cmp(_num(df, "sleep_hours"), "<", T.SLEEP_SHORT_HOURS),
    "diabetes_flag": lambda df: _any_flag([_bool(df, "dm_dx"), _bool(df, "dm_med"), _cmp(_num(df, "fasting_glucose"), ">=", T.FASTING_GLUCOSE_DM), _cmp(_num(df, "hba1c"), ">=", T.HBA1C_DM)]),
}


def coerce_spec_table(df: pd.DataFrame, contract: Contract) -> pd.DataFrame:
    """원시 표 → 명세 변수 표. 라벨·시간·원시 컬럼은 그대로 보존한다. 멱등."""
    out = normalize_columns(df)
    for f in contract.all_features():
        if f.name == "missing_count":
            continue
        if f.type == "category":
            s = to_category(out[f.name], f.aliases or {}) if f.name in out.columns else pd.Series([None] * len(out), index=out.index, dtype=object)
        elif f.type == "bool":
            s = _bool(out, f.name)
        else:
            s = _num(out, f.name)
        if f.name in DERIVERS:
            s = s.where(s.notna(), DERIVERS[f.name](out))
        out[f.name] = s
    return out


# ---------------------------------------------------------------------------
# Preprocessor
# ---------------------------------------------------------------------------
@dataclass
class TransformResult:
    X: pd.DataFrame          # 모델 입력 행렬 (열 순서 고정, 표준화 적용)
    raw: pd.DataFrame        # 대치 후 원 척도 명세 변수 (이유 코드·보고용)
    observed: pd.DataFrame   # 명세 변수별 관측 여부 (대치 전 non-null)
    flags: pd.DataFrame      # 결측 플래그 (bool)
    status: pd.Series        # ok | partial | insufficient | out_of_range
    problems: pd.Series      # 거부 사유 코드(세미콜론 구분), 없으면 ""


class Preprocessor:
    def __init__(self, contract: Contract, optional: Iterable[str] = ()):
        self.contract = contract
        self.optional = tuple(optional)
        self.features: list[FeatureSpec] = contract.selected_features(self.optional)
        self.columns: list[str] = contract.model_columns(self.optional)
        self.monotone: list[int] = contract.monotone_vector(self.columns)
        self.flag_owner: dict[str, str] = contract.flag_owner(self.optional)
        self.stats: dict = {}
        self.fitted = False

    # ----- 검증: 필수 결측 → insufficient, 범위 밖 → out_of_range (우선) -----
    def _validate(self, spec: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
        status = pd.Series(STATUS_OK, index=spec.index, dtype=object)
        problems = pd.Series("", index=spec.index, dtype=object)
        checks = [(spec[f.name].isna(), f"{f.name}_missing", STATUS_INSUFFICIENT) for f in self.contract.required_features()]
        for f in self.features:
            if f.range and f.is_numeric:
                v = spec[f.name]
                checks.append((v.notna() & ((v < f.range[0]) | (v > f.range[1])), f"{f.name}_out_of_range", STATUS_OUT_OF_RANGE))
        for mask, code, st in checks:
            m = mask.fillna(False).astype(bool)
            problems[m] = problems[m].map(lambda s: f"{s};{code}" if s else code)
            status[m & (status != STATUS_OUT_OF_RANGE)] = st
        return status, problems

    # ----- 대치 -----
    def _waist_fill(self, male: np.ndarray, bmi_bin: np.ndarray) -> pd.Series:
        g = self.stats["waist_groups"]
        vals = [g["cell"].get(f"{int(m)}|{int(b)}", g["sex"].get(str(int(m)), g["all"])) for m, b in zip(male, bmi_bin)]
        return pd.Series(vals, dtype=float)

    def _impute(self, spec: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        idx = spec.index
        raw = pd.DataFrame({"sex": spec["sex"], "male": (spec["sex"] == "male").astype(float)}, index=idx)
        observed = pd.DataFrame(index=idx)
        flags = pd.DataFrame(index=idx)
        bmi_bin = np.digitize(spec["bmi"].to_numpy(dtype=float), T.BMI_BINS)
        for f in self.features:
            if f.name in ("sex", "missing_count"):
                continue
            s = spec[f.name]
            observed[f.name] = s.notna()
            if f.method == "reject":
                filled = s
            elif f.method == "median":
                filled = s.fillna(self.stats["medians"][f.name])
            elif f.method == "median_by_sex_bmi_bin":
                filled = s.fillna(self._waist_fill(raw["male"].to_numpy(), bmi_bin).set_axis(idx))
            elif f.method == "constant":
                val = f.missing["value"]
                filled = s.where(s.notna(), val) if f.type == "category" else s.fillna(float(bool(val)) if f.type == "bool" else val)
            elif f.method == "derived":   # activity_low_flag: 활동량 결측이면 true (명세)
                filled = s.fillna(1.0)
            else:
                raise ValueError(f"알 수 없는 결측 처리 방법: {f.method} ({f.name})")
            raw[f.name] = filled if f.type == "category" else filled.astype(float)
            if f.flag and self.flag_owner.get(f.flag) == f.name:
                flags[f.flag] = s.isna()
        observed["sex"] = spec["sex"].notna()
        raw["missing_count"] = flags[self.contract.base_flags()].sum(axis=1).astype(float)
        observed["missing_count"] = True
        return raw, observed, flags

    # ----- 행렬 -----
    def _build_X(self, raw: pd.DataFrame, flags: pd.DataFrame, standardize: bool) -> pd.DataFrame:
        dummies = {d: (f.name, v) for f in self.features if f.type == "category" and f.encoding and "dummies" in f.encoding
                   for d, v in zip(f.encoding["dummies"], f.values[1:])}
        X = pd.DataFrame(index=raw.index)
        for col in self.columns:
            if col in self.contract.interactions:
                continue
            if col in flags.columns:
                X[col] = flags[col].astype(float)
            elif col in dummies:
                X[col] = (raw[dummies[col][0]] == dummies[col][1]).astype(float)
            else:
                X[col] = raw[col].astype(float)
        if standardize:
            for col, mu in self.stats["means"].items():
                X[col] = (X[col] - mu) / self.stats["stds"][col]
        for name in self.contract.interactions:
            if name != "age_x_male":
                raise ValueError(f"알 수 없는 상호작용 항: {name}")
            X[name] = X["age"] * X["male"]
        X = X[self.columns]
        self.contract.check_forbidden(X.columns)
        return X

    # ----- 공개 API -----
    def fit(self, df: pd.DataFrame) -> "Preprocessor":
        spec = coerce_spec_table(df, self.contract)
        status, _ = self._validate(spec)
        rows = spec[status == STATUS_OK]
        if rows.empty:
            raise ValueError("학습에 쓸 수 있는 행이 없음 (필수 결측·범위 밖 제외 후)")
        med = lambda v: float(np.nanmedian(v)) if v.notna().any() else 0.0  # noqa: E731
        self.stats = {"medians": {f.name: med(rows[f.name]) for f in self.features if f.method == "median"}}
        w, male = rows["waist_cm"], (rows["sex"] == "male").astype(int).to_numpy()
        bins = np.digitize(rows["bmi"].to_numpy(dtype=float), T.BMI_BINS)
        self.stats["waist_groups"] = {
            "all": med(w),
            "sex": {str(m): med(w[male == m]) for m in (0, 1) if w[male == m].notna().any()},
            "cell": {f"{m}|{b}": med(w[(male == m) & (bins == b)]) for m in (0, 1) for b in range(len(T.BMI_BINS) + 1) if w[(male == m) & (bins == b)].notna().any()},
        }
        raw, _, flags = self._impute(rows)
        X0 = self._build_X(raw, flags, standardize=False)
        cols = [c for c in self.contract.standardize if c in X0.columns]
        self.stats["means"] = {c: float(X0[c].mean()) for c in cols}
        self.stats["stds"] = {c: float(X0[c].std(ddof=0)) or 1.0 for c in cols}
        self.fitted = True
        return self

    def transform(self, df: pd.DataFrame) -> TransformResult:
        if not self.fitted:
            raise RuntimeError("Preprocessor.fit 이 먼저 필요함")
        spec = coerce_spec_table(df, self.contract)
        status, problems = self._validate(spec)
        raw, observed, flags = self._impute(spec)
        X = self._build_X(raw, flags, standardize=True).fillna(0.0)   # 거부된 행의 NaN — 호출자는 status 로 걸러낸다
        too_many = (status == STATUS_OK) & (raw["missing_count"] >= T.INSUFFICIENT_MISSING_COUNT)
        status[too_many] = STATUS_INSUFFICIENT
        problems[too_many] = problems[too_many].map(lambda s: f"{s};missing_count_high" if s else "missing_count_high")
        status[(status == STATUS_OK) & flags[self.contract.base_flags()].any(axis=1)] = STATUS_PARTIAL
        return TransformResult(X=X, raw=raw, observed=observed, flags=flags, status=status, problems=problems)

    # ----- 저장 -----
    def save(self, path: Path | str) -> None:
        d = {"contract_version": self.contract.version, "optional": list(self.optional), "columns": self.columns, "stats": self.stats}
        Path(path).write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path | str, contract: Contract) -> "Preprocessor":
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        if d["contract_version"] != contract.version:
            raise ValueError(f"피처 계약 버전 불일치: 저장 {d['contract_version']} vs 현재 {contract.version}")
        p = cls(contract, d["optional"])
        if p.columns != list(d["columns"]):
            raise ValueError("저장된 열 순서가 현재 계약과 다름")
        p.stats, p.fitted = d["stats"], True
        return p

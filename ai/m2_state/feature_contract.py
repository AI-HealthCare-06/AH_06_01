"""feature_contract.py — feature_contract.yaml 의 로더·검증기·변환 모듈.

- 계약(yaml)이 원본이다. 이 모듈은 숫자(범위·임계값)를 갖지 않는다.
- validate(): 타입·범위 검사 → data_quality(ok / out_of_range / invalid) + 위반 목록 + 변수 존재 여부(presence)
- from_table(): 평탄 표(한 행 = subject 하나, 컬럼 "<변수>__<필드>") → 중첩 payload
- compare_columns(): 실제 표의 컬럼 ↔ 계약 컬럼 대조 (4단계용)
"""
from __future__ import annotations

import datetime as dt
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

import yaml

import thresholds as T

CONTRACT_PATH = Path(__file__).with_name("feature_contract.yaml")
SEP = "__"   # 평탄 표 컬럼 구분자: <변수>__<필드>

_CONTRACT_CACHE: dict[str, dict] = {}


def load_contract(path: Path | str = CONTRACT_PATH) -> dict:
    key = str(path)
    if key not in _CONTRACT_CACHE:
        with open(path, encoding="utf-8") as f:
            _CONTRACT_CACHE[key] = yaml.safe_load(f)
    return _CONTRACT_CACHE[key]


def variables_by_name(contract: Optional[dict] = None) -> dict[str, dict]:
    contract = contract or load_contract()
    return {v["name"]: v for v in contract["variables"]}


# ───────────────────────────── 결측·파싱 ─────────────────────────────
def is_missing(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    try:  # pandas NA / NaT
        import pandas as pd
        if not isinstance(v, (list, dict, tuple)) and pd.isna(v):
            return True
    except Exception:  # pragma: no cover - pandas 없거나 비교 불가 타입
        pass
    return False


class ParseError(ValueError):
    pass


def to_date(v: Any) -> dt.date:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if hasattr(v, "to_pydatetime"):
        return v.to_pydatetime().date()
    if isinstance(v, str):
        try:
            return dt.date.fromisoformat(v.strip()[:10])
        except ValueError as e:
            raise ParseError(str(e)) from e
    raise ParseError(f"date expected, got {type(v).__name__}")


def to_time(v: Any) -> dt.time:
    if isinstance(v, dt.datetime):
        return v.time().replace(second=0, microsecond=0)
    if isinstance(v, dt.time):
        return v.replace(second=0, microsecond=0)
    if hasattr(v, "to_pydatetime"):
        return v.to_pydatetime().time().replace(second=0, microsecond=0)
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return dt.datetime.strptime(s, fmt).time()
            except ValueError:
                continue
        raise ParseError(f"time expected HH:MM, got {v!r}")
    raise ParseError(f"time expected, got {type(v).__name__}")


def to_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "t", "yes", "y", "1"):
            return True
        if s in ("false", "f", "no", "n", "0"):
            return False
    raise ParseError(f"bool expected, got {v!r}")


def to_int(v: Any) -> int:
    if isinstance(v, bool):
        raise ParseError("bool is not int")
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if v.is_integer():
            return int(v)
        raise ParseError(f"int expected, got {v!r}")
    if isinstance(v, str):
        try:
            f = float(v.strip())
        except ValueError as e:
            raise ParseError(str(e)) from e
        if f.is_integer():
            return int(f)
        raise ParseError(f"int expected, got {v!r}")
    try:
        return int(v)
    except Exception as e:  # numpy ints 등
        raise ParseError(str(e)) from e


def to_float(v: Any) -> float:
    if isinstance(v, bool):
        raise ParseError("bool is not float")
    try:
        return float(v)
    except Exception as e:
        raise ParseError(str(e)) from e


def _coerce(ftype: str, v: Any, spec: dict) -> Any:
    if ftype == "int":
        return to_int(v)
    if ftype == "float":
        return to_float(v)
    if ftype == "bool":
        return to_bool(v)
    if ftype == "date":
        return to_date(v)
    if ftype == "time":
        return to_time(v)
    if ftype == "enum":
        values = spec.get("values", [])
        if v in values:
            return v
        if isinstance(v, str):                      # 숫자 enum(예: medication.status)의 문자열 표기 허용
            for allowed in values:
                if str(allowed) == v.strip():
                    return allowed
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            for allowed in values:
                if isinstance(allowed, int) and float(allowed) == float(v):
                    return allowed
        raise ParseError(f"enum value {v!r} not in {values}")
    if ftype == "str":
        return str(v)
    if ftype == "list":
        if isinstance(v, (list, tuple)):
            return list(v)
        raise ParseError("list expected")
    raise ParseError(f"unknown type {ftype}")


# ───────────────────────────── 검증 ─────────────────────────────
@dataclass
class Violation:
    variable: str
    field: str
    kind: str                  # out_of_range | invalid
    value: Any
    detail: str

    def as_dict(self) -> dict:
        value = self.value.isoformat() if isinstance(self.value, (dt.date, dt.time)) else self.value
        return {"variable": self.variable, "field": self.field, "kind": self.kind, "value": value, "detail": self.detail}


@dataclass
class ValidationResult:
    data_quality: str
    violations: list[Violation] = field(default_factory=list)
    presence: dict[str, bool] = field(default_factory=dict)
    payload: dict = field(default_factory=dict)   # 타입 정규화된 payload

    @property
    def ok(self) -> bool:
        return self.data_quality == T.DQ_OK


def _check_field(var_name: str, fspec: dict, v: Any, out: list[Violation]) -> Any:
    """필드 하나를 정규화하고 범위 검사. 위반은 out 에 추가하고 정규화 값(결측·오류면 None)을 돌려준다."""
    if is_missing(v):
        return None
    try:
        nv = _coerce(fspec["type"], v, fspec)
    except ParseError as e:
        out.append(Violation(var_name, fspec["name"], T.DQ_INVALID, v, str(e)))
        return None
    rng = fspec.get("range")
    if rng is not None and isinstance(nv, (int, float)):
        lo, hi = rng
        if nv < lo or nv > hi:
            out.append(Violation(var_name, fspec["name"], T.DQ_OUT_OF_RANGE, nv, f"range [{lo}, {hi}]"))
    return nv


def _normalize(var: dict, d: Any, out: list[Violation]) -> Optional[dict]:
    if is_missing(d):
        return None
    if not isinstance(d, dict):
        out.append(Violation(var["name"], "*", T.DQ_INVALID, type(d).__name__, "dict expected"))
        return None
    return {f["name"]: _check_field(var["name"], f, d.get(f["name"]), out) for f in var["fields"]}


def _present(var: dict, d: Optional[dict]) -> bool:
    if d is None:
        return False
    cond = var.get("present_if", {})
    if any(is_missing(d.get(f)) for f in cond.get("all", [])):
        return False
    any_f = cond.get("any", [])
    return not any_f or any(not is_missing(d.get(f)) for f in any_f)


def validate(payload: dict, contract: Optional[dict] = None) -> ValidationResult:
    """payload(중첩 dict) 를 계약에 따라 정규화·검증한다. 범위 밖은 클리핑하지 않는다."""
    contract = contract or load_contract()
    out: list[Violation] = []
    norm: dict = {}
    presence: dict[str, bool] = {}

    for meta in contract.get("meta_fields", []):
        v = payload.get(meta["name"])
        if is_missing(v):
            norm[meta["name"]] = None
            if meta.get("required"):
                out.append(Violation("meta", meta["name"], T.DQ_INVALID, None, "required meta field missing"))
            continue
        try:
            norm[meta["name"]] = _coerce(meta["type"], v, meta)
        except ParseError as e:
            out.append(Violation("meta", meta["name"], T.DQ_INVALID, v, str(e)))
            norm[meta["name"]] = None

    for var in contract["variables"]:
        nd = _normalize(var, payload.get(var["name"]), out)
        norm[var["name"]] = nd
        presence[var["name"]] = _present(var, nd)

    if any(v.kind == T.DQ_OUT_OF_RANGE for v in out):
        dq = T.DQ_OUT_OF_RANGE
    elif out:
        dq = T.DQ_INVALID
    else:
        dq = T.DQ_OK
    return ValidationResult(data_quality=dq, violations=out, presence=presence, payload=norm)


# ───────────────────────────── 변환: 평탄 표 ↔ payload ─────────────────────────────
def expected_columns(contract: Optional[dict] = None) -> list[str]:
    """계약이 기대하는 평탄 컬럼명 목록 (행 키 + meta + 변수__필드). list 필드는 JSON 문자열 컬럼."""
    contract = contract or load_contract()
    cols = list(contract.get("table_keys", []))
    cols += [m["name"] for m in contract.get("meta_fields", []) if m["name"] not in cols]
    for var in contract["variables"]:
        cols += [f"{var['name']}{SEP}{f['name']}" for f in var["fields"]]
    return cols


def compare_columns(actual: Iterable[str], contract: Optional[dict] = None,
                    column_aliases: Optional[dict[str, str]] = None) -> dict:
    """실제 컬럼 ↔ 계약 컬럼 대조. column_aliases: {실제컬럼: 계약컬럼}."""
    contract = contract or load_contract()
    aliases = column_aliases or {}
    actual_list = list(actual)
    mapped = [aliases.get(c, c) for c in actual_list]
    mapped_set = set(mapped)
    exp = expected_columns(contract)
    exp_set = set(exp)
    missing = [c for c in exp if c not in mapped_set]

    # 필수(required_for 가 있는) 변수 중 존재 조건(present_if.all)의 필드 컬럼이 빠진 변수
    missing_required_vars = []
    for var in contract["variables"]:
        if not var.get("required_for"):
            continue
        core = var.get("present_if", {}).get("all", [])
        if any(f"{var['name']}{SEP}{f}" in missing for f in core):
            missing_required_vars.append(var["name"])
    return {
        "n_actual": len(actual_list), "n_expected": len(exp),
        "matched": [c for c in mapped if c in exp_set],
        "missing": missing,
        "extra": [a for a, m in zip(actual_list, mapped) if m not in exp_set],
        "missing_required_vars": missing_required_vars,
    }


def from_table(df, subject_id: Any, contract: Optional[dict] = None,
               column_aliases: Optional[dict[str, str]] = None, subject_col: str = "subject_id") -> dict:
    """평탄 표에서 subject 한 명의 payload 를 만든다. 같은 subject 행이 여러 개면 첫 비결측값을 쓴다.
    list 필드(medication.drugs)는 JSON 문자열 또는 리스트를 허용한다."""
    contract = contract or load_contract()
    sub = df[df[subject_col] == subject_id]
    if column_aliases:
        sub = sub.rename(columns=column_aliases)
    cols = set(sub.columns)

    def first(col: str) -> Any:
        return next((v for v in sub[col] if not is_missing(v)), None)

    payload: dict = {"subject_id": subject_id}
    for meta in contract.get("meta_fields", []):
        if meta["name"] in cols and meta["name"] != "subject_id":
            payload[meta["name"]] = first(meta["name"])
    for var in contract["variables"]:
        d: dict = {}
        for f in var["fields"]:
            col = f"{var['name']}{SEP}{f['name']}"
            if col not in cols:
                continue
            v = first(col)
            if f["type"] == "list" and isinstance(v, str):
                try:
                    v = json.loads(v)
                except json.JSONDecodeError:
                    v = None
            if v is not None:
                d[f["name"]] = v
        payload[var["name"]] = d or None
    return payload

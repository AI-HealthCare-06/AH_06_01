"""
[파일] m1/fast_path.py
[용도] 단건 추론 전용 변환 경로. 입력 dict 한 건을 pandas 없이 스칼라 연산으로 변환해 모델 입력 벡터 x 와 원 척도 값·관측 여부·플래그·상태를 만든다.
      features.Preprocessor.transform(배치 경로)과 같은 계약·같은 통계(stats)·같은 규칙을 쓴다.
[왜 필요한가] pandas 로 1행을 변환하면 약 26 ms 가 걸려 p95 ≤ 20 ms 를 못 맞춘다. 규칙은 같되 자료구조만 바꾼 경로를 두고,
             check_equivalence 로 배치 경로와 결과(x·상태·문제 코드·플래그·관측·원 척도 값·확률·기여도)가 같은지 학습 때마다 검증한다.
             규칙(계약·thresholds·features.py)을 바꾸면 이 파일도 함께 고치고 tests/test_fast_path.py 가 어긋남을 잡는다.
[쓰는 곳] m1/predict.py(predict), train.py(동등성 점검), tests/test_fast_path.py
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

import thresholds as T
from .features import (FALSE_TOKENS, STATUS_INSUFFICIENT, STATUS_OK, STATUS_OUT_OF_RANGE, STATUS_PARTIAL, TRUE_TOKENS, Preprocessor,
                       alias_map, normalize_columns)

NAN = float("nan")


# ---------------------------------------------------------------------------
# 스칼라 타입 변환 (features.to_numeric / to_bool / to_category 와 같은 규칙)
# ---------------------------------------------------------------------------
def isnan(v) -> bool:
    return v is None or (isinstance(v, (float, np.floating)) and math.isnan(v))


def num(v) -> float:
    if v is None:
        return NAN
    if isinstance(v, (bool, np.bool_, int, float, np.integer, np.floating)):
        return float(v)
    try:
        return float(str(v).strip())
    except ValueError:
        return NAN


def boo(v) -> float:
    if v is None:
        return NAN
    if isinstance(v, (bool, np.bool_)):
        return float(v)
    if isinstance(v, (int, float, np.integer, np.floating)):
        return NAN if math.isnan(v) else 1.0 if v == 1 else 0.0 if v == 0 else NAN
    t = str(v).strip().lower()
    return 1.0 if t in TRUE_TOKENS else 0.0 if t in FALSE_TOKENS else NAN


def cat(v, amap: dict) -> str | None:
    return None if isnan(v) else amap.get(str(v).strip().lower())


def _any_flag(parts: list[float]) -> float:
    obs = [p for p in parts if not isnan(p)]
    if not obs:
        return NAN
    return 1.0 if any(p == 1.0 for p in obs) else 0.0


def _flag(v: float, cond: bool) -> float:
    return NAN if isnan(v) else float(cond)


# r: 입력 dict(소문자 키), vals: 지금까지 만든 명세 변수 값 — features.DERIVERS 와 같은 식·같은 순서
def _d_bmi(r, vals):
    h, w = num(r.get("height_cm")) / 100.0, num(r.get("weight_kg"))
    return w / (h * h) if h > 0 else NAN


def _d_activity(r, vals):
    parts = [num(r.get("moderate_min_week")), T.ACTIVITY_VIGOROUS_WEIGHT * num(r.get("vigorous_min_week")), num(r.get("walk_min_week"))]
    obs = [p for p in parts if not isnan(p)]
    return sum(obs) if obs else NAN


SCALAR_DERIVERS = {
    "bmi": _d_bmi,
    "alcohol_week": lambda r, v: num(r.get("alcohol_freq_per_week")) * num(r.get("alcohol_drinks_per_occasion")),
    "alcohol_per_day": lambda r, v: _flag(v["alcohol_week"], v["alcohol_week"] / 7.0 > T.ALCOHOL_DRINKS_PER_DAY_HIGH),
    "binge": lambda r, v: _flag(num(r.get("binge_freq_per_month")), num(r.get("binge_freq_per_month")) >= T.BINGE_MIN_PER_MONTH),
    "activity_minutes_week": _d_activity,
    "activity_low_flag": lambda r, v: _flag(v["activity_minutes_week"], v["activity_minutes_week"] < T.ACTIVITY_LOW_MIN_PER_WEEK),
    "family_htn": lambda r, v: _any_flag([boo(r.get("family_htn_father")), boo(r.get("family_htn_mother")), boo(r.get("family_htn_sibling"))]),
    "sleep_short_flag": lambda r, v: _flag(num(r.get("sleep_hours")), num(r.get("sleep_hours")) < T.SLEEP_SHORT_HOURS),
    "diabetes_flag": lambda r, v: _any_flag([boo(r.get("dm_dx")), boo(r.get("dm_med")),
                                             _flag(num(r.get("fasting_glucose")), num(r.get("fasting_glucose")) >= T.FASTING_GLUCOSE_DM),
                                             _flag(num(r.get("hba1c")), num(r.get("hba1c")) >= T.HBA1C_DM)]),
}


@dataclass
class TransformOne:
    x: np.ndarray        # 모델 입력 벡터 (pre.columns 순서, 표준화 적용)
    raw: dict            # 대치 후 원 척도 값
    observed: dict       # 관측 여부
    flags: dict          # 결측 플래그
    status: str
    problems: str


class FastTransformer:
    """Preprocessor 하나에 대해 계약·통계를 한 번 풀어 두고 dict 한 건을 변환한다."""

    def __init__(self, pre: Preprocessor):
        if not pre.fitted:
            raise RuntimeError("Preprocessor.fit 이 먼저 필요함")
        self.pre = pre
        c = pre.contract
        self.features = pre.features
        self.all_features = c.all_features()
        self.amaps = {f.name: alias_map(f.aliases or {}) for f in self.all_features if f.type == "category"}
        self.required = [f.name for f in c.required_features()]
        self.ranged = [(f.name, f.range) for f in pre.features if f.range and f.is_numeric]
        self.base_flags = c.base_flags()
        self.interactions = set(c.interactions)
        self.dummies = {d: (f.name, v) for f in pre.features if f.type == "category" and f.encoding and "dummies" in f.encoding
                        for d, v in zip(f.encoding["dummies"], f.values[1:])}
        self.means, self.stds = pre.stats["means"], pre.stats["stds"]
        self.medians, self.wg = pre.stats["medians"], pre.stats["waist_groups"]
        self.columns = pre.columns

    def _coerce(self, r: dict) -> dict:
        vals: dict = {}
        for f in self.all_features:
            if f.name == "missing_count":
                continue
            v = r.get(f.name)
            if f.type == "category":
                v = cat(v, self.amaps[f.name])
                vals[f.name] = v
                continue
            v = boo(v) if f.type == "bool" else num(v)
            if isnan(v) and f.name in SCALAR_DERIVERS:
                v = SCALAR_DERIVERS[f.name](r, vals)
            vals[f.name] = v
        return vals

    def _validate(self, vals: dict) -> tuple[str, str]:
        status, problems = STATUS_OK, []
        checks = [(isnan(vals[n]) if not isinstance(vals[n], str) else False, f"{n}_missing", STATUS_INSUFFICIENT) for n in self.required]
        for n, (lo, hi) in self.ranged:
            v = vals[n]
            checks.append((not isnan(v) and (v < lo or v > hi), f"{n}_out_of_range", STATUS_OUT_OF_RANGE))
        for hit, code, st in checks:
            if hit:
                problems.append(code)
                if status != STATUS_OUT_OF_RANGE:
                    status = st
        return status, ";".join(problems)

    def _waist_fill(self, male: float, bmi_bin: int) -> float:
        return self.wg["cell"].get(f"{int(male)}|{bmi_bin}", self.wg["sex"].get(str(int(male)), self.wg["all"]))

    def transform(self, row: dict) -> TransformOne:
        r = {str(k).strip().lower(): v for k, v in row.items()}
        vals = self._coerce(r)
        status, problems = self._validate(vals)
        sex = vals["sex"]
        raw = {"sex": sex, "male": 1.0 if sex == "male" else 0.0}
        observed, flags = {}, {}
        bmi = vals["bmi"]
        bmi_bin = len(T.BMI_BINS) if isnan(bmi) else sum(bmi >= b for b in T.BMI_BINS)
        for f in self.features:
            n = f.name
            if n in ("sex", "missing_count"):
                continue
            v = vals[n]
            obs = (v is not None) if f.type == "category" else not isnan(v)
            observed[n] = obs
            m = f.method
            if obs or m == "reject":
                filled = v
            elif m == "median":
                filled = self.medians[n]
            elif m == "median_by_sex_bmi_bin":
                filled = self._waist_fill(raw["male"], bmi_bin)
            elif m == "constant":
                val = f.missing["value"]
                filled = val if f.type == "category" else float(bool(val)) if f.type == "bool" else float(val)
            elif m == "derived":
                filled = 1.0
            else:
                raise ValueError(f"알 수 없는 결측 처리 방법: {m} ({n})")
            raw[n] = filled if f.type == "category" else (NAN if isnan(filled) else float(filled))
            if f.flag and self.pre.flag_owner.get(f.flag) == n:
                flags[f.flag] = not obs
        observed["sex"] = sex is not None
        raw["missing_count"] = float(sum(flags[b] for b in self.base_flags))
        observed["missing_count"] = True
        if status == STATUS_OK and raw["missing_count"] >= T.INSUFFICIENT_MISSING_COUNT:
            status, problems = STATUS_INSUFFICIENT, (problems + ";" if problems else "") + "missing_count_high"
        if status == STATUS_OK and any(flags[b] for b in self.base_flags):
            status = STATUS_PARTIAL
        # 모델 입력 벡터
        x = np.empty(len(self.columns))
        for i, col in enumerate(self.columns):
            if col in self.interactions:
                continue
            if col in flags:
                x[i] = float(flags[col])
            elif col in self.dummies:
                fname, val = self.dummies[col]
                x[i] = float(raw[fname] == val)
            else:
                x[i] = raw[col]
            if col in self.means:
                x[i] = (x[i] - self.means[col]) / self.stds[col]
        idx = {c: i for i, c in enumerate(self.columns)}
        for name in self.interactions:
            x[idx[name]] = x[idx["age"]] * x[idx["male"]]
        x = np.nan_to_num(x, nan=0.0)
        return TransformOne(x=x, raw=raw, observed=observed, flags=flags, status=status, problems=problems)


def transform_one(pre: Preprocessor, row: dict) -> TransformOne:
    return FastTransformer(pre).transform(row)


# ---------------------------------------------------------------------------
# 동등성 검증: 배치 경로(Preprocessor.transform + model.predict_proba) vs 단건 경로
# ---------------------------------------------------------------------------
def _same_raw(a, b, atol: float) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    if isnan(a) or isnan(b):
        return isnan(a) and isnan(b)
    return abs(float(a) - float(b)) <= atol


def check_equivalence(pre: Preprocessor, df, model=None, atol: float = 1e-9) -> dict:
    """df 의 모든 행에 대해 두 경로를 비교한다. 결과 dict 의 ok 가 False 면 단건 경로를 쓰면 안 된다."""
    batch = pre.transform(df)
    Xb = batch.X.to_numpy()
    flags_b, obs_b = batch.flags.to_numpy(), batch.observed.to_numpy()
    flag_cols, obs_cols = list(batch.flags.columns), list(batch.observed.columns)
    raw_b = batch.raw.to_dict("records")
    status_b, prob_b = batch.status.tolist(), batch.problems.tolist()
    Pb = model.predict_proba(batch.X) if model is not None else None
    Cb = model.contributions(batch.X) if model is not None else None
    ft = FastTransformer(pre)
    rows = normalize_columns(df).to_dict("records")
    out = {"rows": len(rows), "max_abs_dx": 0.0, "status_mismatch": 0, "problems_mismatch": 0, "flags_mismatch": 0,
           "observed_mismatch": 0, "raw_mismatch": 0, "max_abs_dp": 0.0, "max_abs_dcontrib": 0.0}
    for i, r in enumerate(rows):
        one = ft.transform(r)
        out["max_abs_dx"] = max(out["max_abs_dx"], float(np.max(np.abs(one.x - Xb[i]))))
        out["status_mismatch"] += one.status != status_b[i]
        out["problems_mismatch"] += one.problems != prob_b[i]
        out["flags_mismatch"] += any(one.flags[c] != bool(flags_b[i, j]) for j, c in enumerate(flag_cols))
        out["observed_mismatch"] += any(one.observed[c] != bool(obs_b[i, j]) for j, c in enumerate(obs_cols))
        out["raw_mismatch"] += any(not _same_raw(one.raw[c], raw_b[i][c], atol) for c in raw_b[i])
        if model is not None:
            P1, C1 = model.predict_one(one.x)
            out["max_abs_dp"] = max(out["max_abs_dp"], float(np.max(np.abs(P1 - Pb[i]))))
            out["max_abs_dcontrib"] = max(out["max_abs_dcontrib"], float(np.max(np.abs(C1 - Cb[i]))))
    out["atol"] = atol
    out["ok"] = (out["max_abs_dx"] <= atol and out["max_abs_dp"] <= atol and out["max_abs_dcontrib"] <= atol
                 and not any(out[k] for k in ("status_mismatch", "problems_mismatch", "flags_mismatch", "observed_mismatch", "raw_mismatch")))
    return out

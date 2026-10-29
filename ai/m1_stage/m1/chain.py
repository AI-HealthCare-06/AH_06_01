"""
[파일] m1/chain.py
[용도] 체인 파이프라인(규칙 재설계 2026-10-25). 명세 계약(feature_contract.yaml)과 별개로 사용자가 정한 규칙을 구현한다.
      ① ChainPreprocessor — 입력 17열을 거부 없이 동일 투입. 나이·성별·BMI 결측 행만 제외. 음주 3열이 결측이면 0, 15잔/주 이상은 15로 통일 + alcohol_15plus 플래그,
         15잔 이상이면 alcohol_per_day=1. 활동 결측은 activity_low_flag 가 1인 행의 최빈값(0이면 flag 0 행 최빈값), flag 는 분<150 으로 다시 계산, 600분 이상은 600 + activity_600plus.
         family_htn 0, sodium 1, sleep_short 0, diabetes 0, fasting_glucose·resting_hr·education 최빈값, waist 는 성별·BMI·나이 회귀(학습 행)로 추정. 데이터의 missing_count 는 그대로.
      ② ChainFeatures("추가 데이터") — 연속형 표준화 + 나이×컬럼, 성별×컬럼, (dbp 모델) sbp×컬럼.
      ③ ChainModel — 1단계 전 컬럼 → sbp, 2단계 전 컬럼 + sbp(학습: 실제, 추론: 예측) → dbp, 3단계 (sbp, dbp) → 단계. 단계는 두 가지: 점 추정 → 경계, 검증 잔차(나이대×성별 풀) 부트스트랩 → 단계 확률.
[왜 필요한가] 사용자 결정(2026-10-25): 명세 무시, 전 컬럼 동일 투입, 범위 거부 없음(상한만), 결측 규칙 지정, 대치 행 학습 포함, 행마다 sbp·dbp·stage 산출.
[주의] 제약(단조·금지 패턴) 없음. 상관·계수는 단면 자료의 연관이며 인과가 아니다.
[쓰는 곳] train_chain.py, tests/test_chain.py
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from .continuous import RIDGE_GRID, dispersion_groups
from .data_io import list_data_files, read_one

INPUT_COLUMNS = ["age", "sex", "bmi", "waist_cm", "alcohol_week", "alcohol_per_day", "binge", "activity_minutes_week", "activity_low_flag", "family_htn",
                 "sodium_risk_score", "sleep_short_flag", "diabetes_flag", "fasting_glucose", "resting_hr", "education_years", "missing_count"]
ID_COLUMNS = ["person_id", "exam_year"]
TARGETS = ["sbp", "dbp"]
REQUIRED = list(T.CHAIN_REQUIRED)   # 필수 열(사용자 결정 2026-10-26: waist 추가)
IMPUTED_COUNT_COLS = ["waist_cm", "alcohol_week", "alcohol_per_day", "binge", "activity_minutes_week", "family_htn", "diabetes_flag", "fasting_glucose", "resting_hr"]
ALCOHOL_GROUP = ["alcohol_week", "alcohol_per_day", "binge"]
CONST_FILL = {"family_htn": 0.0, "sodium_risk_score": 1.0, "sleep_short_flag": 0.0, "diabetes_flag": 0.0}
MODE_FILL = ["fasting_glucose", "resting_hr", "education_years"]
COUNT_VARS = ["bmi", "waist_cm", "alcohol_week", "alcohol_per_day", "binge", "activity_minutes_week", "family_htn", "sodium_risk_score", "sleep_short_flag",
              "diabetes_flag", "fasting_glucose", "resting_hr", "education_years"]   # 데이터의 missing_count 가 없을 때 다시 세는 변수
BASE_COLUMNS = ["age", "male", "bmi", "waist_cm", "alcohol_week", "alcohol_15plus", "alcohol_per_day", "binge", "activity_minutes_week", "activity_600plus",
                "activity_low_flag", "family_htn", "sodium_risk_score", "sleep_short_flag", "diabetes_flag", "fasting_glucose", "resting_hr", "education_years", "missing_count"]
CONTINUOUS = ["age", "bmi", "waist_cm", "alcohol_week", "activity_minutes_week", "sodium_risk_score", "fasting_glucose", "resting_hr", "education_years", "missing_count"]
# 입력에서 빼는 열(사용자 결정 2026-10-25: 영향력 보고에서 순열 ΔRMSE ≈0). train_chain.py --exclude 로 바꿀 수 있다.
DEFAULT_EXCLUDE = ("sodium_risk_score", "sleep_short_flag", "missing_count", "education_years")
SEX_ALIASES = {"male": {"male", "m", "남", "남자", "남성", "1"}, "female": {"female", "f", "여", "여자", "여성", "2"}}
MIN_POOL_N = 100
LGBM_PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=15, max_depth=4, min_child_samples=50, subsample=0.8, subsample_freq=1,
                   colsample_bytree=0.8, reg_lambda=1.0, n_estimators=3000, deterministic=True, force_row_wise=True, verbose=-1)
EARLY_STOPPING_ROUNDS = 100


# ---------------------------------------------------------------------------
# 로드·단계
# ---------------------------------------------------------------------------
def load_frame(path: str | Path, sheet: int | str = 0) -> tuple[pd.DataFrame, list[str]]:
    files = list_data_files(path)
    if not files:
        raise FileNotFoundError(f"데이터 파일 없음: {path}")
    frames = [read_one(f, sheet) for f in files]
    df = pd.concat(frames, ignore_index=True)
    df.columns = [str(c).strip().lstrip("﻿").lower() for c in df.columns]
    return df, [str(f) for f in files]


def stage_from_bp(sbp, dbp) -> np.ndarray:
    """측정/예측 혈압 → 단계 인덱스(0 normal, 1 elevated, 2 prehtn, 3 htn). 경계는 thresholds."""
    sbp, dbp = np.asarray(sbp, float), np.asarray(dbp, float)
    return np.where((sbp >= T.SBP_HTN_MIN) | (dbp >= T.DBP_HTN_MIN), 3,
                    np.where((sbp >= T.SBP_PREHTN_MIN) | (dbp >= T.DBP_PREHTN_MIN), 2, np.where(sbp >= T.SBP_ELEVATED_MIN, 1, 0))).astype(int)


def stage3_from_bp(sbp, dbp=None, use_dbp: bool = False) -> np.ndarray:
    """3단계(0 normal, 1 elevated_prehtn, 2 htn). 기본은 sbp 만: <122 / 122~139 / ≥140. use_dbp 면 dbp 80/90 을 'or' 로 함께 적용."""
    sbp = np.asarray(sbp, float)
    lo, hi = T.STAGE3_SBP_CUTS
    if use_dbp and dbp is not None:
        dbp = np.asarray(dbp, float); dlo, dhi = T.STAGE3_DBP_CUTS
        return np.where((sbp >= hi) | (dbp >= dhi), 2, np.where((sbp >= lo) | (dbp >= dlo), 1, 0)).astype(int)
    return np.where(sbp >= hi, 2, np.where(sbp >= lo, 1, 0)).astype(int)


def _mode(s: pd.Series, default: float = 0.0) -> float:
    s = s.dropna()
    return float(s.mode().iloc[0]) if len(s) else default


def _waist_design(male: np.ndarray, bmi: np.ndarray, age: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(len(male)), male, bmi, age, male * bmi, male * age])


# ---------------------------------------------------------------------------
# ① 전처리
# ---------------------------------------------------------------------------
class ChainPreprocessor:
    def __init__(self, exclude=DEFAULT_EXCLUDE, required=None, max_imputed: int | None = T.CHAIN_MAX_IMPUTED, ranges: dict | None = None):
        self.exclude = tuple(exclude)
        self.required = list(REQUIRED if required is None else required)
        self.max_imputed = max_imputed
        self.ranges = dict(T.CHAIN_RANGES if ranges is None else ranges)
        self.columns = [c for c in BASE_COLUMNS if c not in self.exclude]
        self.stats: dict = {}
        self.fitted = False

    @staticmethod
    def coerce(df: pd.DataFrame) -> pd.DataFrame:
        d = df.copy()
        d.columns = [str(c).strip().lstrip("﻿").lower() for c in d.columns]
        for c in INPUT_COLUMNS + TARGETS:
            if c not in d.columns:
                d[c] = np.nan
            if c != "sex":
                d[c] = pd.to_numeric(d[c], errors="coerce")
        sx = d["sex"].astype("string").str.strip().str.lower()
        d["sex"] = sx.map(lambda v: next((k for k, al in SEX_ALIASES.items() if v in al), pd.NA) if pd.notna(v) else pd.NA)
        return d

    @staticmethod
    def keep_mask(d: pd.DataFrame, required=None) -> np.ndarray:
        return d[list(REQUIRED if required is None else required)].notna().all(axis=1).to_numpy()

    def reasons(self, d: pd.DataFrame) -> pd.Series:
        """행별 제외 사유('' 이면 사용). 필수 결측 → 범위 밖 → 대치 과다 순."""
        r = pd.Series("", index=d.index, dtype=object)
        miss = d[self.required].isna()
        for c in self.required:
            m = miss[c] & (r == ""); r[m] = f"{c}_missing"
        for c, (lo, hi) in self.ranges.items():
            if c in d.columns:
                m = d[c].notna() & ((d[c] < lo) | (d[c] > hi)) & (r == ""); r[m] = f"{c}_out_of_range"
        if self.max_imputed is not None:
            cols = [c for c in IMPUTED_COUNT_COLS if c not in self.required and (c in self.columns or c in ("alcohol_per_day", "binge", "alcohol_week"))]
            n_imp = d[cols].isna().sum(axis=1)
            m = (n_imp >= self.max_imputed) & (r == ""); r[m] = f"imputed_ge_{self.max_imputed}"
        return r

    def fit(self, df: pd.DataFrame) -> "ChainPreprocessor":
        d = self.coerce(df)
        d = d[(self.reasons(d) == "").to_numpy()]
        am, fl = d["activity_minutes_week"], d["activity_low_flag"]
        self.stats = {
            "modes": {c: _mode(d[c]) for c in MODE_FILL},
            "activity_mode_low": _mode(am[(fl == 1) & am.notna()]),
            "activity_mode_high": _mode(am[(fl == 0) & am.notna()], default=float(T.ACTIVITY_LOW_MIN_PER_WEEK)),
        }
        w = d[d["waist_cm"].notna()]
        A = _waist_design((w["sex"] == "male").to_numpy(float), w["bmi"].to_numpy(float), w["age"].to_numpy(float))
        beta = np.linalg.lstsq(A, w["waist_cm"].to_numpy(float), rcond=None)[0]
        self.stats["waist_beta"] = beta.tolist()
        self.stats["waist_rmse"] = float(np.sqrt(((w["waist_cm"].to_numpy(float) - A @ beta) ** 2).mean()))
        self.stats["waist_n"] = int(len(w))
        self.fitted = True
        X = self._apply(d)
        self.stats["train_rows"] = int(len(X))
        return self

    def _apply(self, d: pd.DataFrame) -> pd.DataFrame:
        s = self.stats
        out = pd.DataFrame(index=d.index)
        out["age"] = d["age"].astype(float)
        out["male"] = (d["sex"] == "male").astype(float)
        out["bmi"] = d["bmi"].astype(float)
        # missing_count: 데이터 열이 있으면 그대로, 없으면 대치 전 결측 수
        mc = d["missing_count"]
        out["missing_count"] = mc.fillna(d[COUNT_VARS].isna().sum(axis=1)).astype(float)
        # 음주: 세 열이 결측이면 0 (일부만 결측이어도 그 열은 0). 15잔 이상 → 15 + 플래그, per_day=1
        aw = d["alcohol_week"].fillna(0.0).astype(float)
        ap = d["alcohol_per_day"].fillna(0.0).astype(float)
        out["alcohol_15plus"] = (aw >= T.ALCOHOL_WEEK_CAP).astype(float)
        out["alcohol_week"] = aw.clip(upper=T.ALCOHOL_WEEK_CAP)
        out["alcohol_per_day"] = np.where(aw >= T.ALCOHOL_WEEK_CAP, 1.0, ap)
        out["binge"] = d["binge"].fillna(0.0).astype(float)
        # 활동: 결측은 flag 1 행 최빈값(flag 0 이면 flag 0 행 최빈값), flag 는 분<150 으로 재계산, 600 상한
        am, fl = d["activity_minutes_week"].astype(float), d["activity_low_flag"]
        fill = np.where(fl == 0, s["activity_mode_high"], s["activity_mode_low"])
        am = am.fillna(pd.Series(fill, index=d.index))
        out["activity_low_flag"] = (am < T.ACTIVITY_LOW_MIN_PER_WEEK).astype(float)
        out["activity_600plus"] = (am >= T.ACTIVITY_MINUTES_CAP).astype(float)
        out["activity_minutes_week"] = am.clip(upper=T.ACTIVITY_MINUTES_CAP)
        for c, v in CONST_FILL.items():
            out[c] = d[c].fillna(v).astype(float)
        for c in MODE_FILL:
            out[c] = d[c].fillna(s["modes"][c]).astype(float)
        # 허리둘레: 성별·BMI·나이 회귀 추정
        est = _waist_design(out["male"].to_numpy(), out["bmi"].to_numpy(), out["age"].to_numpy()) @ np.asarray(s["waist_beta"])
        out["waist_cm"] = d["waist_cm"].astype(float).fillna(pd.Series(est, index=d.index))
        return out[self.columns]

    def transform(self, df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
        """(규칙 적용 후 원 척도 행렬[유지 행만], 유지 마스크, 정규화된 원 데이터[전체 행])."""
        if not self.fitted:
            raise RuntimeError("fit 이 먼저 필요함")
        d = self.coerce(df)
        d["__reason"] = self.reasons(d)
        keep = (d["__reason"] == "").to_numpy()
        X = self._apply(d[keep])
        if X.isna().any().any():
            raise ValueError(f"대치 후에도 결측이 남음: {X.columns[X.isna().any()].tolist()}")
        return X, keep, d

    def save(self, path): pickle.dump(self, open(path, "wb"))

    @staticmethod
    def load(path) -> "ChainPreprocessor": return pickle.load(open(path, "rb"))


# ---------------------------------------------------------------------------
# ② 추가 데이터
# ---------------------------------------------------------------------------
def _ms(v) -> tuple[float, float]:
    v = np.asarray(v, float)
    return float(v.mean()), float(max(v.std(), 1e-9))


def _z(v, ms) -> np.ndarray:
    return (np.asarray(v, float) - ms[0]) / ms[1]


def reference_center(col: str, male: np.ndarray) -> np.ndarray | None:
    ref = T.REFERENCE_CENTERS.get(col)
    if ref is None:
        return None
    return np.where(male == 1, ref["male"], ref["female"]) if isinstance(ref, dict) else np.full(len(male), float(ref))


def hinge_features(X: pd.DataFrame) -> pd.DataFrame:
    """정상 범위 초과·미달량: max(0, x − 상한), max(0, 하한 − x). 범위는 thresholds.REFERENCE_RANGES."""
    male = X["male"].to_numpy(float)
    H = pd.DataFrame(index=X.index)
    for c, (lo, hi) in T.REFERENCE_RANGES.items():
        if c not in X.columns:
            continue
        v = X[c].to_numpy(float)
        if hi is not None:
            h = np.where(male == 1, hi["male"], hi["female"]) if isinstance(hi, dict) else float(hi)
            H[f"{c}_over"] = np.maximum(0.0, v - h)
        if lo is not None:
            H[f"{c}_under"] = np.maximum(0.0, float(lo) - v)
    return H


class ChainFeatures:
    """표준화(중심: 평균 또는 문헌 기준값) + 선택적 힌지 + 나이×컬럼 + 성별×컬럼 (+ sbp 및 sbp×컬럼). fit 은 학습 행에서만."""

    def __init__(self, with_sbp: bool = False, center: str = "reference", hinge: bool = False, extra_name: str = "sbp"):
        if center not in ("mean", "reference"):
            raise ValueError(f"center 는 mean|reference: {center}")
        self.with_sbp, self.center, self.hinge, self.extra_name = with_sbp, center, hinge, extra_name   # extra_name: 2단계 입력으로 넣는 혈압 열 이름(sbp 또는 dbp)
        self.stats: dict[str, tuple[float, float]] = {}
        self.base_columns: list[str] = []
        self.columns: list[str] = []

    def _base(self, X: pd.DataFrame, sbp=None) -> pd.DataFrame:
        Z = pd.DataFrame(index=X.index)
        male = X["male"].to_numpy(float)
        for c in self.base_columns:
            if c in CONTINUOUS:
                ref = reference_center(c, male) if self.center == "reference" else None
                Z[c] = (X[c].to_numpy(float) - ref) / self.stats[c][1] if ref is not None else _z(X[c], self.stats[c])
            else:
                Z[c] = X[c].to_numpy(float)
        if self.hinge:
            H = hinge_features(X)
            for c in H.columns:
                Z[c] = _z(H[c], self.stats[c])
        if self.with_sbp:
            Z[self.extra_name] = _z(sbp, self.stats[self.extra_name])
        return Z

    def _inter(self, Z: pd.DataFrame) -> pd.DataFrame:
        age, male = Z["age"].to_numpy(), Z["male"].to_numpy()
        out = {"age_x_male": age * male}
        ex = self.extra_name
        others = [c for c in Z.columns if c not in ("age", "male", ex)]
        for c in others:
            out[f"age_x_{c}"] = age * Z[c].to_numpy()
            out[f"male_x_{c}"] = male * Z[c].to_numpy()
        if self.with_sbp:
            s = Z[ex].to_numpy()
            for c in [c for c in Z.columns if c != ex]:
                out[f"{ex}_x_{c}"] = s * Z[c].to_numpy()
        return pd.DataFrame(out, index=Z.index)

    def fit(self, X: pd.DataFrame, sbp=None) -> "ChainFeatures":
        self.base_columns = list(X.columns)
        self.stats = {c: _ms(X[c]) for c in CONTINUOUS if c in self.base_columns}
        if self.hinge:
            H = hinge_features(X)
            self.stats.update({c: _ms(H[c]) for c in H.columns})
        if self.with_sbp:
            self.stats[self.extra_name] = _ms(sbp)
        Z = self._base(X, sbp)
        I = self._inter(Z)
        for c in I.columns:
            self.stats[c] = _ms(I[c])
        self.columns = list(Z.columns) + list(I.columns)
        return self

    def transform(self, X: pd.DataFrame, sbp=None) -> pd.DataFrame:
        Z = self._base(X, sbp)
        I = self._inter(Z)
        for c in I.columns:
            I[c] = _z(I[c], self.stats[c])
        return pd.concat([Z, I], axis=1)[self.columns]


# ---------------------------------------------------------------------------
# ③ 모델
# ---------------------------------------------------------------------------
class MeanRegressor:
    """linear: 릿지(λ 검증 선택, 제약 없음) | lgbm: LightGBM 회귀(제약 없음, 조기 종료)."""

    def __init__(self, learner: str, seed: int = 42, params: dict | None = None):
        if learner not in ("linear", "lgbm"):
            raise ValueError(f"learner 는 linear|lgbm: {learner}")
        self.learner, self.seed = learner, seed
        self.params = dict(LGBM_PARAMS, **(params or {}))
        self.columns: list[str] = []
        self.beta: np.ndarray | None = None
        self.model = None
        self.info: dict = {}

    def fit(self, X: pd.DataFrame, y: np.ndarray, Xv: pd.DataFrame, yv: np.ndarray) -> "MeanRegressor":
        self.columns = list(X.columns)
        y, yv = np.asarray(y, float), np.asarray(yv, float)
        if self.learner == "linear":
            A = np.column_stack([np.ones(len(X)), X.to_numpy(float)])
            Av = np.column_stack([np.ones(len(Xv)), Xv.to_numpy(float)])
            best = None
            for lam in RIDGE_GRID:
                pen = np.sqrt(lam) * np.eye(A.shape[1]); pen[0, 0] = 0.0
                beta = np.linalg.lstsq(np.vstack([A, pen]), np.concatenate([y, np.zeros(A.shape[1])]), rcond=None)[0]
                rmse = float(np.sqrt(((yv - Av @ beta) ** 2).mean()))
                if best is None or rmse < best[0]:
                    best = (rmse, lam, beta)
            self.beta = best[2]
            self.info = {"lambda": best[1], "val_rmse": best[0]}
        else:
            import lightgbm as lgb
            m = lgb.LGBMRegressor(**dict(self.params, random_state=self.seed))
            m.fit(X, y, eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)])
            self.model = m
            self.info = {"best_iteration": int(m.best_iteration_ or 0), "val_rmse": float(np.sqrt(((yv - m.predict(Xv)) ** 2).mean()))}
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.learner == "linear":
            return np.column_stack([np.ones(len(X)), X[self.columns].to_numpy(float)]) @ self.beta
        return np.asarray(self.model.predict(X[self.columns]), float)

    def importance(self) -> pd.Series:
        if self.learner == "linear":
            return pd.Series(self.beta[1:], index=self.columns, name="coef")
        imp = np.asarray(self.model.booster_.feature_importance("gain"), float)
        return pd.Series(imp / max(imp.sum(), 1e-12), index=self.columns, name="gain_share")


def residual_pools(e: np.ndarray, groups: np.ndarray) -> dict[str, np.ndarray]:
    pools = {"__all__": np.asarray(e, float)}
    for g in np.unique(groups):
        m = groups == g
        pools[str(g)] = pools["__all__"][m] if m.sum() >= MIN_POOL_N else pools["__all__"]
    return pools


def sample_residuals(pools: dict[str, np.ndarray], groups: np.ndarray, K: int, rng: np.random.Generator) -> np.ndarray:
    out = np.empty((len(groups), K))
    for g in np.unique(groups):
        m = groups == g
        pool = pools.get(str(g), pools["__all__"])
        out[m] = pool[rng.integers(0, len(pool), size=(int(m.sum()), K))]
    return out


class ChainModel:
    def __init__(self, learner: str, seed: int = 42):
        self.learner, self.seed = learner, seed
        self.m_sbp = MeanRegressor(learner, seed)
        self.m_dbp = MeanRegressor(learner, seed)
        self.pools_s: dict = {}
        self.pools_d: dict = {}
        self.stage_thresholds: dict | None = None
        self.info: dict = {}

    def fit(self, Xs: pd.DataFrame, sbp: np.ndarray, Xd: pd.DataFrame, dbp: np.ndarray, Xs_v: pd.DataFrame, sbp_v: np.ndarray, Xd_v: pd.DataFrame, dbp_v: np.ndarray,
            groups_v: np.ndarray) -> "ChainModel":
        """Xd 는 실제 sbp 로 만든 dbp 입력(학습·검증 모두)."""
        self.m_sbp.fit(Xs, sbp, Xs_v, sbp_v)
        self.m_dbp.fit(Xd, dbp, Xd_v, dbp_v)
        e_s = np.asarray(sbp_v, float) - self.m_sbp.predict(Xs_v)
        e_d = np.asarray(dbp_v, float) - self.m_dbp.predict(Xd_v)
        self.pools_s, self.pools_d = residual_pools(e_s, groups_v), residual_pools(e_d, groups_v)
        self.info = {"sbp": self.m_sbp.info, "dbp": self.m_dbp.info, "resid_sd_sbp": float(e_s.std()), "resid_sd_dbp": float(e_d.std()),
                     "resid_corr": float(np.corrcoef(e_s, e_d)[0, 1])}
        return self

    def predict_point(self, Xs: pd.DataFrame, X: pd.DataFrame, feat_d: ChainFeatures) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """점 추정 체인: sbp_hat → dbp_hat(예측 sbp 투입) → 단계."""
        sbp_hat = self.m_sbp.predict(Xs)
        dbp_hat = self.m_dbp.predict(feat_d.transform(X, sbp_hat))
        return sbp_hat, dbp_hat, stage_from_bp(sbp_hat, dbp_hat)

    def predict_dist(self, Xs: pd.DataFrame, X: pd.DataFrame, feat_d: ChainFeatures, groups: np.ndarray, K: int = 200, seed: int | None = None) -> dict:
        """잔차 부트스트랩 체인: sbp_k = sbp_hat + e_s, dbp_k = f(x, sbp_k) + e_d → 단계 확률·분포 요약."""
        rng = np.random.default_rng(self.seed if seed is None else seed)
        sbp_hat = self.m_sbp.predict(Xs)
        Es, Ed = sample_residuals(self.pools_s, groups, K, rng), sample_residuals(self.pools_d, groups, K, rng)
        counts = np.zeros((len(X), 4))
        dbp_sum = np.zeros(len(X))
        ge_140 = np.zeros(len(X)); ge_90 = np.zeros(len(X))
        for k in range(K):
            s_k = sbp_hat + Es[:, k]
            d_k = self.m_dbp.predict(feat_d.transform(X, s_k)) + Ed[:, k]
            st = stage_from_bp(s_k, d_k)
            counts[np.arange(len(X)), st] += 1
            dbp_sum += d_k
            ge_140 += s_k >= T.SBP_HTN_MIN; ge_90 += d_k >= T.DBP_HTN_MIN
        P = counts / K
        return {"P": P, "sbp_mean": sbp_hat, "dbp_mean": dbp_sum / K, "p_sbp_ge_140": ge_140 / K, "p_dbp_ge_90": ge_90 / K}

    def save(self, path): pickle.dump(self, open(path, "wb"))

    @staticmethod
    def load(path) -> "ChainModel": return pickle.load(open(path, "rb"))

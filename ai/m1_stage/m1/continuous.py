"""
[파일] m1/continuous.py
[용도] 연속형 혈압 분포 모델(M1-C). 4단계 라벨 대신 측정 혈압(sbp, dbp)을 목표로 평균 μ(x)(선형 릿지 또는 단조 LightGBM)를 학습하고,
      검증 잔차에서 집단(10세 나이대×성별)별 산포 σ와 sbp·dbp 잔차 상관 ρ 를 추정해 (sbp, dbp) 결합 정규 분포를 만든다. 어떤 혈압 구간의 확률이든
      (4단계 확률 포함) 이 분포를 적분해 낸다. 입력은 계약 피처에 사용자 규칙을 더해 확장한다(FeatureExpander):
      음주 0(비음주) 분리 drinker 플래그 + 주당 잔 수 상한(thresholds.ALCOHOL_WEEK_CAP), age², 나이×변수·성별×변수 상호작용.
[왜 필요한가] 사용자 결정(2026-10-23): 명세의 단계 라벨로 학습하지 않고 연속형 혈압 정보를 그대로 학습하며, 나이·성별이 다른 변수의 영향을 바꾸는 것도
             입력으로 넣는다. 점 추정 체인(sbp→dbp)은 보류. mmHg 는 내부 중간값이며 제품 출력이 아니다(명세 2-1). 혈압은 입력에 넣지 않는다.
[쓰는 곳] train_continuous.py, tests/test_continuous.py
"""

from __future__ import annotations

import pickle
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm

import thresholds as T
from .contract import Contract

# 산포(σ·ρ) 집단: 10세 나이대 × 성별. 셀 행 수가 MIN_GROUP_N 미만이면 전체 값으로 대체.
AGE_EDGES = (19, 30, 40, 50, 60, 70, 200)
AGE_LABELS = ("19~29", "30~39", "40~49", "50~59", "60~69", "70+")
MIN_GROUP_N = 100
# 상호작용에 쓰는 변수(계약 열 이름). 나이·성별 자체와 age_x_male 은 계약에 이미 있다.
AGE_INTERACTIONS = ("bmi", "waist_cm", "alcohol_week", "drinker", "binge", "activity_minutes_week", "resting_hr", "fasting_glucose", "sleep_short_flag", "family_htn", "education_years")
SEX_INTERACTIONS = ("bmi", "waist_cm", "alcohol_week", "drinker", "binge", "activity_minutes_week", "resting_hr", "sleep_short_flag")
# 보고용 혈압 구간 경계(mmHg). 단계 경계는 thresholds 의 값을 그대로 쓴다.
SBP_CUTS = (T.SBP_ELEVATED_MIN, T.SBP_PREHTN_MIN, T.SBP_HTN_MIN, 160)
DBP_CUTS = (T.DBP_PREHTN_MIN, T.DBP_HTN_MIN, 100)
RIDGE_GRID = (0.0, 0.1, 1.0, 10.0, 100.0)
LGBM_PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=15, max_depth=4, min_child_samples=50, subsample=0.8, subsample_freq=1,
                   colsample_bytree=0.8, reg_lambda=1.0, n_estimators=3000, monotone_constraints_method="advanced", deterministic=True, force_row_wise=True, verbose=-1)
EARLY_STOPPING_ROUNDS = 100
GL_NODES = 48
_GL_X, _GL_W = np.polynomial.legendre.leggauss(GL_NODES)
Z_CLIP = 8.0


def _ms(v) -> tuple[float, float]:
    v = np.asarray(v, float)
    return float(v.mean()), float(max(v.std(), 1e-9))


def _z(v, ms) -> np.ndarray:
    return (np.asarray(v, float) - ms[0]) / ms[1]


def dispersion_groups(raw: pd.DataFrame) -> np.ndarray:
    """원 척도 age·male → '19~29|female' 같은 집단 키."""
    age = np.asarray(raw["age"], float)
    band = np.asarray(AGE_LABELS)[np.clip(np.digitize(age, AGE_EDGES[1:]), 0, len(AGE_LABELS) - 1)]
    sex = np.where(np.asarray(raw["male"], float) == 1, "male", "female")
    return np.char.add(np.char.add(band.astype(str), "|"), sex)


class FeatureExpander:
    """계약 표준화 행렬 X 와 원 척도 raw 를 받아 확장 입력을 만든다. fit 은 학습 행에서만(새 열의 표준화 통계)."""

    def __init__(self, contract: Contract, age_inter=AGE_INTERACTIONS, sex_inter=SEX_INTERACTIONS):
        self.contract = contract
        self.age_inter, self.sex_inter = tuple(age_inter), tuple(sex_inter)
        self.stats: dict[str, tuple[float, float]] = {}
        self.base_columns: list[str] = []
        self.columns: list[str] = []

    def _derive(self, X: pd.DataFrame, raw: pd.DataFrame) -> pd.DataFrame:
        Z = X.copy()
        alc = np.asarray(raw["alcohol_week"], float)
        Z["alcohol_week"] = np.minimum(alc, T.ALCOHOL_WEEK_CAP)   # 상한 적용, 원 척도(표준화는 아래)
        Z["drinker"] = (alc > 0).astype(float)
        return Z

    def _interactions(self, Z: pd.DataFrame) -> pd.DataFrame:
        age, male = Z["age"].to_numpy(float), Z["male"].to_numpy(float)
        out = {"age_sq": age ** 2}
        for v in self.age_inter:
            if v in Z.columns:
                out[f"age_x_{v}"] = age * Z[v].to_numpy(float)
        for v in self.sex_inter:
            if v in Z.columns:
                out[f"male_x_{v}"] = male * Z[v].to_numpy(float)
        return pd.DataFrame(out, index=Z.index)

    def fit(self, X: pd.DataFrame, raw: pd.DataFrame) -> "FeatureExpander":
        self.base_columns = list(X.columns)
        Z = self._derive(X, raw)
        self.stats = {"alcohol_week": _ms(Z["alcohol_week"])}
        Z["alcohol_week"] = _z(Z["alcohol_week"], self.stats["alcohol_week"])
        new = self._interactions(Z)
        for c in new.columns:
            self.stats[c] = _ms(new[c])
        self.columns = list(Z.columns) + list(new.columns)
        return self

    def transform(self, X: pd.DataFrame, raw: pd.DataFrame) -> pd.DataFrame:
        Z = self._derive(X, raw)
        Z["alcohol_week"] = _z(Z["alcohol_week"], self.stats["alcohol_week"])
        new = self._interactions(Z)
        for c in new.columns:
            new[c] = _z(new[c], self.stats[c])
        return pd.concat([Z, new], axis=1)[self.columns]

    def monotone(self) -> list[int]:
        """주효과는 계약의 단조 방향, 새 열(drinker·age²·상호작용)은 제약 없음."""
        base = dict(zip(self.base_columns, self.contract.monotone_vector(self.base_columns)))
        return [int(base.get(c, 0)) for c in self.columns]


def bvn_cdf(h, k, rho) -> np.ndarray:
    """표준 이변량 정규 P(X<h, Y<k). Drezner–Wesolowsky 적분을 Gauss–Legendre 로 벡터화. |ρ|≤0.9 에서 오차 ~1e-6."""
    h, k, rho = np.broadcast_arrays(np.clip(np.asarray(h, float), -Z_CLIP, Z_CLIP), np.clip(np.asarray(k, float), -Z_CLIP, Z_CLIP), np.asarray(rho, float))
    base = norm.cdf(h) * norm.cdf(k)
    r = rho[..., None] * (_GL_X + 1) / 2
    w = rho[..., None] * _GL_W / 2
    hh, kk = h[..., None], k[..., None]
    denom = 1 - r ** 2
    integrand = np.exp(-(hh ** 2 - 2 * r * hh * kk + kk ** 2) / (2 * denom)) / np.sqrt(denom)
    return np.clip(base + (integrand * w).sum(axis=-1) / (2 * np.pi), 0.0, 1.0)


@dataclass
class Dist:
    mu_s: np.ndarray
    mu_d: np.ndarray
    sig_s: np.ndarray
    sig_d: np.ndarray
    rho: np.ndarray


def stage_probs(d: Dist) -> np.ndarray:
    """(sbp, dbp) 결합 정규 분포 → 4단계 확률. normal: s<120&d<80, elevated: 120≤s<130&d<80, prehtn: 나머지 중 s<140&d<90, htn: 그 외."""
    def F(a, b):
        return bvn_cdf((a - d.mu_s) / d.sig_s, (b - d.mu_d) / d.sig_d, d.rho)
    f_120_80, f_130_80, f_140_90 = F(T.SBP_ELEVATED_MIN, T.DBP_PREHTN_MIN), F(T.SBP_PREHTN_MIN, T.DBP_PREHTN_MIN), F(T.SBP_HTN_MIN, T.DBP_HTN_MIN)
    P = np.clip(np.column_stack([f_120_80, f_130_80 - f_120_80, f_140_90 - f_130_80, 1 - f_140_90]), 0.0, 1.0)
    return P / P.sum(axis=1, keepdims=True)


def interval_bins(name: str, cuts) -> list[tuple[str, float, float]]:
    """(열 이름, 하한, 상한) 목록. 예: ("sbp_<120", -inf, 120), ("sbp_120~129", 120, 130), ("sbp_≥160", 160, inf)."""
    edges = (-np.inf, *cuts, np.inf)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        label = f"<{hi:g}" if not np.isfinite(lo) else (f"≥{lo:g}" if not np.isfinite(hi) else f"{lo:g}~{hi - 1:g}")
        out.append((f"{name}_{label}", float(lo), float(hi)))
    return out


def interval_probs(d: Dist, sbp_cuts=SBP_CUTS, dbp_cuts=DBP_CUTS) -> pd.DataFrame:
    """주변 분포의 구간 확률. 열 이름은 interval_bins 와 같다."""
    out = {}
    for name, mu, sig, cuts in (("sbp", d.mu_s, d.sig_s, sbp_cuts), ("dbp", d.mu_d, d.sig_d, dbp_cuts)):
        def cdf(e):
            return norm.cdf((e - mu) / sig) if np.isfinite(e) else (np.zeros_like(mu) if e < 0 else np.ones_like(mu))
        for col, lo, hi in interval_bins(name, cuts):
            out[col] = np.clip(cdf(hi) - cdf(lo), 0, 1)
    return pd.DataFrame(out)


class ContinuousBP:
    """sbp·dbp 평균 모델 2개 + 집단별 (σ_s, σ_d, ρ). learner: linear(릿지, λ 검증 선택) | lgbm(단조 제약 회귀, 조기 종료)."""

    def __init__(self, learner: str = "linear", seed: int = 42, params: dict | None = None):
        if learner not in ("linear", "lgbm"):
            raise ValueError(f"learner 는 linear|lgbm: {learner}")
        self.learner, self.seed = learner, seed
        self.params = dict(LGBM_PARAMS, **(params or {}))
        self.columns: list[str] = []
        self.models: dict[str, object] = {}
        self.fit_info: dict[str, dict] = {}
        self.disp: dict[str, dict] = {}
        self.stage_thresholds: dict | None = None

    # --- 평균 모델 ---------------------------------------------------------
    def _fit_mean(self, X: pd.DataFrame, y: np.ndarray, Xv: pd.DataFrame, yv: np.ndarray, monotone: list[int]):
        if self.learner == "linear":
            A = np.column_stack([np.ones(len(X)), X.to_numpy(float)])
            Av = np.column_stack([np.ones(len(Xv)), Xv.to_numpy(float)])
            best = None
            for lam in RIDGE_GRID:
                # 증강 최소제곱(절편 비벌점). λ=0 이거나 상수 열이 있어도 최소 노름 해로 풀린다.
                pen = np.sqrt(lam) * np.eye(A.shape[1]); pen[0, 0] = 0.0
                beta = np.linalg.lstsq(np.vstack([A, pen]), np.concatenate([y, np.zeros(A.shape[1])]), rcond=None)[0]
                rmse = float(np.sqrt(((yv - Av @ beta) ** 2).mean()))
                if best is None or rmse < best[0]:
                    best = (rmse, lam, beta)
            return {"beta": best[2], "lambda": best[1], "val_rmse": best[0]}
        import lightgbm as lgb
        m = lgb.LGBMRegressor(**dict(self.params, monotone_constraints=list(monotone), random_state=self.seed))
        m.fit(X, y, eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)])
        return {"model": m, "best_iteration": int(m.best_iteration_ or 0), "val_rmse": float(np.sqrt(((yv - m.predict(Xv)) ** 2).mean()))}

    def _mean(self, name: str, X: pd.DataFrame) -> np.ndarray:
        m = self.models[name]
        if self.learner == "linear":
            return np.column_stack([np.ones(len(X)), X[self.columns].to_numpy(float)]) @ m["beta"]
        return np.asarray(m["model"].predict(X[self.columns]), float)

    def fit(self, X: pd.DataFrame, sbp: np.ndarray, dbp: np.ndarray, X_val: pd.DataFrame, sbp_val: np.ndarray, dbp_val: np.ndarray,
            groups_val: np.ndarray, monotone: list[int]) -> "ContinuousBP":
        self.columns = list(X.columns)
        sbp, dbp, sbp_val, dbp_val = (np.asarray(v, float) for v in (sbp, dbp, sbp_val, dbp_val))
        for name, y, yv in (("sbp", sbp, sbp_val), ("dbp", dbp, dbp_val)):
            self.models[name] = self._fit_mean(X, y, X_val, yv, monotone)
            self.fit_info[name] = {k: v for k, v in self.models[name].items() if k not in ("beta", "model")}
        es, ed = sbp_val - self._mean("sbp", X_val), dbp_val - self._mean("dbp", X_val)
        self.disp = self._dispersion(es, ed, np.asarray(groups_val))
        return self

    @staticmethod
    def _dispersion(es: np.ndarray, ed: np.ndarray, groups: np.ndarray) -> dict[str, dict]:
        def cell(a, b):
            return {"sig_s": float(a.std(ddof=1)), "sig_d": float(b.std(ddof=1)), "rho": float(np.corrcoef(a, b)[0, 1]), "n": int(len(a))}
        out = {"__all__": cell(es, ed)}
        for g in np.unique(groups):
            m = groups == g
            out[str(g)] = cell(es[m], ed[m]) if m.sum() >= MIN_GROUP_N else {**out["__all__"], "n": int(m.sum()), "fallback": True}
        return out

    # --- 분포·확률 --------------------------------------------------------
    def predict_dist(self, X: pd.DataFrame, groups: np.ndarray) -> Dist:
        tab = pd.DataFrame([self.disp.get(str(g), self.disp["__all__"]) for g in np.asarray(groups)])
        return Dist(self._mean("sbp", X), self._mean("dbp", X), tab["sig_s"].to_numpy(float), tab["sig_d"].to_numpy(float), tab["rho"].to_numpy(float))

    def predict_proba(self, X: pd.DataFrame, groups: np.ndarray) -> np.ndarray:
        return stage_probs(self.predict_dist(X, groups))

    # --- 보고 -------------------------------------------------------------
    def coefficients(self) -> pd.DataFrame:
        """linear: 표준화 1단위(플래그는 0→1)당 mmHg. lgbm: gain 비중."""
        if self.learner == "linear":
            return pd.DataFrame({"sbp_coef": self.models["sbp"]["beta"][1:], "dbp_coef": self.models["dbp"]["beta"][1:]}, index=self.columns)
        out = {}
        for name in ("sbp", "dbp"):
            imp = np.asarray(self.models[name]["model"].booster_.feature_importance("gain"), float)
            out[f"{name}_gain_share"] = imp / max(imp.sum(), 1e-12)
        return pd.DataFrame(out, index=self.columns)

    def save(self, path: Path | str) -> None:
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(path: Path | str) -> "ContinuousBP":
        with open(path, "rb") as f:
            return pickle.load(f)

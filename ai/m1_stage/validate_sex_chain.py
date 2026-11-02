"""
[파일] validate_sex_chain.py
[용도] 성별 분리 + 역체인(전 열 → dbp, 전 열 + dbp → sbp) 구조를 고정한 채, 그동안 시도했던 방법들을 5겹 교차검증에서 기준(문헌 기준값 중심 입력 + LightGBM 역체인)과
      접힘별로 짝지어 비교한다(차이 평균과 95% 신뢰구간 1.96·sd/√k).
      ① 입력 표현 8종(verify_inputs_cv.py 의 표현을 역체인에 적용) ② 학습기(LightGBM 설정·dart·extra_trees·XGBoost·CatBoost·MLP·시드 5개 평균·linear+lgbm 평균; max_search.py·boost_round3.py)
      ③ 확률→단계 규칙(분포 argmax·클래스 가중·나이대별 가중·누적 τ; boost_accuracy.py) ④ 구조·데이터(체인 없음, 실제 dbp 상한, 나이대별 모델, 잡음 증강, 학습 곡선,
      나이 외 계수 배수, 나이만·나이 제외, 체인+분류기 스택, 음주 포함/제외 반대, 제외 4열 복원; boost_round2/3.py·experiments_chain.py).
      분류 전용 방법(소프트 라벨, two_axis, 계층 분류, 자기학습, LDA/QDA/NB)은 역체인 구조와 맞지 않아 넣지 않았다. 행 검증 변형은 행 집합이 달라져 짝지은 비교가 안 되므로 뺐다.
      과학습 점검: 학습 행 지표와 테스트 접힘 지표의 차이, 학습 곡선(25/50/75/100%).
[쓰는 곳] python3 validate_sex_chain.py --data train/ --sex male --out-dir reports/validate_<시각>   (여성은 --sex female 로 따로, 이후 --summarize reports/validate_<시각>)
"""

from __future__ import annotations

import argparse
import itertools
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import lightgbm as lgb  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import xgboost as xgb  # noqa: E402
from catboost import CatBoostRegressor  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from scipy.stats import norm  # noqa: E402
from sklearn.model_selection import KFold, StratifiedKFold  # noqa: E402
from sklearn.neural_network import MLPRegressor  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

import thresholds as T  # noqa: E402
from analysis_pack import style  # noqa: E402
from m1.chain import LGBM_PARAMS, ChainFeatures, ChainPreprocessor, MeanRegressor, load_frame, residual_pools, sample_residuals, stage3_from_bp  # noqa: E402
from m1.evaluate import age_groups, auroc  # noqa: E402
from m1.pipeline import log  # noqa: E402
from m1.report import md_table  # noqa: E402
from train_sex_chain import EXCLUDE, MC_PARAMS, build  # noqa: E402
from verify_inputs_cv import interact_apply, interact_fit, ref_ranges  # noqa: E402

_KO = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO:
    plt.rcParams["font.family"] = _KO[0]
plt.rcParams["axes.unicode_minus"] = False
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
SEX_KO = {"male": "남성", "female": "여성"}
CONT = ["age", "bmi", "waist_cm", "alcohol_week", "activity_minutes_week", "fasting_glucose", "resting_hr"]
VARIANTS = ["표준화(평균중심)", "원척도", "문헌기준값중심(verify판)", "원값+힌지", "힌지만", "분위수변환", "구간화", "나이대편차z"]
GROUP_COLORS = {"기준": "#0b0b0b", "입력표현": "#2a78d6", "학습기": "#1baf7a", "규칙": "#b45fcf", "구조·데이터": "#c2410c", "참고(배포 불가)": "#9a9a9a"}
USE_DBP = False   # --label dbp_rule: 3단계를 sbp 122/140 또는 dbp 80/90 으로
W_GRID = np.round(np.arange(0.5, 2.01, 0.1), 2)
TAU_GRID = np.round(np.arange(0.10, 0.91, 0.05), 2)
METRIC_COLS = ["dbp_rmse", "sbp_rmse", "point_acc", "dist_acc", "auroc_ge140", "recall_htn", "exp_upper", "train_point_acc", "train_sbp_rmse"]


# ------------------------------------------------------------------ 입력 표현(verify_inputs_cv 와 같은 정의, 없는 열은 건너뜀)
def represent(variant: str, X: pd.DataFrame, fit: np.ndarray, groups: np.ndarray) -> pd.DataFrame:
    Xf = X.astype(float); cont = [c for c in CONT if c in X.columns]; flags = [c for c in X.columns if c not in cont]

    def std(df):
        out = df.copy()
        for c in cont:
            mu, sd = out[c][fit].mean(), out[c][fit].std() or 1.0; out[c] = (out[c] - mu) / sd
        return out

    def hinge(Xf):
        H = pd.DataFrame(index=Xf.index)
        for c, (lo, hi) in ref_ranges(Xf["male"].to_numpy()).items():
            if c not in Xf.columns: continue
            v = Xf[c].to_numpy(float)
            if hi is not None: H[f"{c}_over"] = np.maximum(0, v - np.asarray(hi, float))
            if lo is not None: H[f"{c}_under"] = np.maximum(0, np.asarray(lo, float) - v)
        return H

    def std_h(H):
        for c in H.columns:
            mu, sd = H[c][fit].mean(), H[c][fit].std() or 1.0; H[c] = (H[c] - mu) / sd
        return H

    if variant == "표준화(평균중심)": return std(Xf)
    if variant == "원척도": return Xf
    if variant == "문헌기준값중심(verify판)":
        out = Xf.copy(); R = ref_ranges(Xf["male"].to_numpy())
        for c in cont:
            ref = (R[c][1] if R[c][1] is not None else R[c][0]) if c in R else Xf[c][fit].mean()
            out[c] = (Xf[c].to_numpy() - np.asarray(ref, float)) / (Xf[c][fit].std() or 1.0)
        return out
    if variant == "원값+힌지": return pd.concat([std(Xf), std_h(hinge(Xf))], axis=1)
    if variant == "힌지만": return pd.concat([std(Xf)[["age", "male"]], std_h(hinge(Xf)), Xf[[c for c in flags if c != "male"]]], axis=1)
    if variant == "분위수변환":
        out = Xf.copy()
        for c in cont:
            ref = np.sort(Xf[c].to_numpy()[fit]); q = (np.searchsorted(ref, Xf[c].to_numpy(), side="right") - 0.5) / len(ref)
            out[c] = norm.ppf(np.clip(q, 1e-4, 1 - 1e-4))
        return out
    if variant == "구간화":
        edges = {"age": [0, 30, 40, 50, 60, 70, 200], "bmi": [-np.inf, 18.5, 23, 25, 30, np.inf], "waist_cm": [-np.inf, 80, 85, 90, 95, np.inf], "fasting_glucose": [-np.inf, 100, 126, np.inf],
                 "resting_hr": [-np.inf, 60, 70, 80, 90, np.inf], "alcohol_week": [-np.inf, 0.001, 7, 15, np.inf], "activity_minutes_week": [-np.inf, 0.001, 150, 300, 600, np.inf]}
        def bins(col, e):
            cut = pd.cut(Xf[col].to_numpy(), e, right=False, labels=False)
            return pd.get_dummies(pd.Series(cut, index=X.index), prefix=col).astype(float)
        out = pd.concat([bins(c, e) for c, e in edges.items() if c in Xf.columns] + [Xf[flags]], axis=1)
        out["age"] = std(Xf)["age"]
        return out.loc[:, ~out.columns.duplicated()]
    if variant == "나이대편차z":
        out = std(Xf); g = pd.Series(groups, index=X.index)
        for c in cont[1:]:
            st = Xf[fit].groupby(g[fit].to_numpy())[c].agg(["mean", "std"])
            mu, sd = g.map(st["mean"]).to_numpy(float), g.map(st["std"]).to_numpy(float)
            out[f"{c}_dev"] = (Xf[c].to_numpy() - np.nan_to_num(mu, nan=Xf[c][fit].mean())) / np.where(np.isfinite(sd) & (sd > 0), sd, 1.0)
        return out
    raise ValueError(variant)


# ------------------------------------------------------------------ 체인 입력 명세
class Spec:
    """Xd: dbp 모델 입력(전 행). xs(idx, dbp값): 해당 행의 sbp 모델 입력(전 열 + dbp). groups: 잔차 풀 키."""

    def __init__(self, Xd: pd.DataFrame, xs, groups: np.ndarray):
        self.Xd, self.xs, self.groups = Xd, xs, groups


def spec_cf(X: pd.DataFrame, fd: ChainFeatures, fs: ChainFeatures, groups: np.ndarray) -> Spec:
    return Spec(fd.transform(X), lambda idx, dv: fs.transform(X.iloc[idx], np.asarray(dv, float)), groups)


def spec_repr(variant: str, X: pd.DataFrame, fit: np.ndarray, tr: np.ndarray, dbp: np.ndarray, groups: np.ndarray) -> Spec:
    Z = represent(variant, X, fit, groups)
    Xd, _ = interact_fit(Z, None, fit)
    mu, sd = float(dbp[tr].mean()), float(dbp[tr].std())
    Xs, st_s = interact_fit(Z, (dbp - mu) / sd, fit); cols = list(Xs.columns)   # _inter_raw 가 붙이는 'sbp' 이름의 열은 여기서는 dbp 값
    return Spec(Xd, lambda idx, dv: interact_apply(Z.iloc[idx], (np.asarray(dv, float) - mu) / sd, st_s)[cols], groups)


# ------------------------------------------------------------------ 학습기
class SkReg:
    """fit(X, y, Xv, yv) / predict(X) 인터페이스로 감싼 다른 회귀기."""

    def __init__(self, kind: str, seed: int):
        self.kind, self.seed = kind, seed

    def fit(self, X, y, Xv, yv):
        self.columns = list(X.columns); k, s = self.kind, self.seed
        if k == "xgb":
            self.m = xgb.XGBRegressor(n_estimators=5000, learning_rate=0.05, max_depth=4, subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0, tree_method="hist", early_stopping_rounds=100, random_state=s, nthread=4)
            self.m.fit(X, y, eval_set=[(Xv, yv)], verbose=False)
        elif k == "cat":
            self.m = CatBoostRegressor(iterations=4000, learning_rate=0.05, depth=4, od_type="Iter", od_wait=100, random_seed=s, verbose=False, thread_count=4); self.m.fit(X, y, eval_set=(Xv, yv))
        elif k == "mlp":
            self.sc = StandardScaler().fit(X); self.m = MLPRegressor(hidden_layer_sizes=(64, 32), early_stopping=True, validation_fraction=0.15, max_iter=300, random_state=s); self.m.fit(self.sc.transform(X), y)
        elif k == "dart":
            self.m = lgb.LGBMRegressor(**dict(LGBM_PARAMS, boosting_type="dart", n_estimators=600, learning_rate=0.05, drop_rate=0.1, random_state=s)); self.m.fit(X, y)
        elif k == "bag5":
            self.ms = [MeanRegressor("lgbm", s + 100 * i).fit(X, y, Xv, yv) for i in range(5)]
        elif k == "ens":
            self.ms = [MeanRegressor("linear", s).fit(X, y, Xv, yv), MeanRegressor("lgbm", s).fit(X, y, Xv, yv)]
        else:
            raise ValueError(k)
        return self

    def predict(self, X):
        if self.kind in ("bag5", "ens"): return np.mean([m.predict(X) for m in self.ms], axis=0)
        if self.kind == "mlp": return np.asarray(self.m.predict(self.sc.transform(X[self.columns])), float)
        return np.asarray(self.m.predict(X[self.columns]), float)


def L(kind: str, **params):
    if kind in ("linear", "lgbm"): return lambda s: MeanRegressor(kind, s, params or None)
    return lambda s: SkReg(kind, s)


LEARNERS = {"linear": L("linear"), "lgbm": L("lgbm"), "lgbm_잎31": L("lgbm", num_leaves=31, max_depth=-1), "lgbm_잎7": L("lgbm", num_leaves=7, max_depth=3), "lgbm_min_child200": L("lgbm", min_child_samples=200),
            "lgbm_lr0.02": L("lgbm", learning_rate=0.02), "lgbm_colsample0.5": L("lgbm", colsample_bytree=0.5), "lgbm_lambda20": L("lgbm", reg_lambda=20.0), "lgbm_extra_trees": L("lgbm", extra_trees=True),
            "dart": L("dart"), "xgboost": L("xgb"), "catboost": L("cat"), "mlp": L("mlp"), "bag5(시드평균)": L("bag5"), "linear+lgbm평균": L("ens")}


# ------------------------------------------------------------------ 체인 실행·채점
def run_chain(spec: Spec, sbp, dbp, y3, tr, va, te, mk_d, mk_s, K: int, seed: int, true_dbp: bool = False, post_s=None, want_val: bool = False, need_dist: bool = True) -> dict:
    m_d = mk_d(seed).fit(spec.Xd.iloc[tr], dbp[tr], spec.Xd.iloc[va], dbp[va])
    Xs_va = spec.xs(va, dbp[va]); m_s = mk_s(seed).fit(spec.xs(tr, dbp[tr]), sbp[tr], Xs_va, sbp[va])
    if post_s: post_s(m_s)
    pools_d = residual_pools(dbp[va] - m_d.predict(spec.Xd.iloc[va]), spec.groups[va]); pools_s = residual_pools(sbp[va] - m_s.predict(Xs_va), spec.groups[va])

    def point(idx):
        d_hat = m_d.predict(spec.Xd.iloc[idx]); return d_hat, m_s.predict(spec.xs(idx, dbp[idx] if true_dbp else d_hat))

    def dist(idx, d_hat):
        if not need_dist: return None
        rng = np.random.default_rng(seed); g = spec.groups[idx]; base_d = dbp[idx] if true_dbp else d_hat
        Ed = np.zeros((len(idx), K)) if true_dbp else sample_residuals(pools_d, g, K, rng); Es = sample_residuals(pools_s, g, K, rng)
        counts = np.zeros((len(idx), 3))
        for k in range(K):
            d_k = base_d + Ed[:, k]; counts[np.arange(len(idx)), stage3_from_bp(m_s.predict(spec.xs(idx, d_k)) + Es[:, k], d_k, USE_DBP)] += 1
        return counts / K

    d_te, s_te = point(te); out = {"te": (d_te, s_te, dist(te, d_te)), "tr": point(tr), "models": (m_d, m_s)}
    if want_val:
        d_va, s_va = point(va); out["va"] = (d_va, s_va, dist(va, d_va))
    return out


def rmse(a, b): return float(np.sqrt(((np.asarray(a, float) - np.asarray(b, float)) ** 2).mean()))


def score(y, sbp, dbp, d_hat, s_hat, P, pred=None) -> dict:
    pt = stage3_from_bp(s_hat, d_hat, USE_DBP) if pred is None else pred
    out = {"dbp_rmse": rmse(dbp, d_hat), "sbp_rmse": rmse(sbp, s_hat), "point_acc": float((pt == y).mean()), "recall_htn": float(((pt == 2) & (y == 2)).sum() / max((y == 2).sum(), 1))}
    if P is not None:
        out.update(dist_acc=float((P.argmax(1) == y).mean()), auroc_ge140=auroc((y == 2).astype(int), P[:, 2]), exp_upper=float(P.max(1).mean()))
    return out


def record(rows, sex, fold, group, cand, r, y3, sbp, dbp, tr, te, pred=None, P=None):
    d_te, s_te, P_te = r["te"]; d_tr, s_tr = r["tr"]
    sc = score(y3[te], sbp[te], dbp[te], d_te, s_te, P_te if P is None else P, pred)
    sc.update(train_point_acc=float((stage3_from_bp(s_tr, d_tr, USE_DBP) == y3[tr]).mean()), train_sbp_rmse=rmse(sbp[tr], s_tr))
    rows.append({"sex": sex, "fold": fold, "group": group, "candidate": cand, **sc})
    return sc


# ------------------------------------------------------------------ 규칙(boost_accuracy.py 의 3단계판)
def fit_weights(P, y):
    best, bw = -1.0, np.ones(3)
    for a, b in itertools.product(W_GRID, W_GRID):
        w = np.array([1.0, a, b]); acc = float(((P * w).argmax(1) == y).mean())
        if acc > best: best, bw = acc, w
    return bw


def cum_pred(P, t1, t2):
    return np.where(P[:, 2] >= t2, 2, np.where(P[:, 1] + P[:, 2] >= t1, 1, 0))


def fit_tau(P, y):
    best, bt = -1.0, (0.5, 0.5)
    for t1, t2 in itertools.product(TAU_GRID, TAU_GRID):
        acc = float((cum_pred(P, t1, t2) == y).mean())
        if acc > best: best, bt = acc, (t1, t2)
    return bt


# ------------------------------------------------------------------ 접힘 하나
def run_fold(sex, fold, d, tr, va, te, sbp, dbp, y3, K, seed, rows):
    fit = np.zeros(len(d), bool); fit[tr] = True
    pre, X, fd, fs, Xd, Xs, groups, _, _ = build(d, tr, EXCLUDE[sex]); spec = spec_cf(X, fd, fs, groups); ag = age_groups(X["age"].to_numpy())
    lg, ln = LEARNERS["lgbm"], LEARNERS["linear"]
    # 기준
    base = run_chain(spec, sbp, dbp, y3, tr, va, te, lg, lg, K, seed, want_val=True); record(rows, sex, fold, "기준", "기준(lgbm)", base, y3, sbp, dbp, tr, te)
    record(rows, sex, fold, "기준", "기준(linear)", run_chain(spec, sbp, dbp, y3, tr, va, te, ln, ln, K, seed), y3, sbp, dbp, tr, te)
    # ① 입력 표현
    for v in VARIANTS:
        sp = spec_repr(v, X, fit, tr, dbp, groups)
        for lr_name, lr in (("lgbm", lg), ("linear", ln)):
            record(rows, sex, fold, "입력표현", f"{v}·{lr_name}", run_chain(sp, sbp, dbp, y3, tr, va, te, lr, lr, K, seed), y3, sbp, dbp, tr, te)
    # ② 학습기(기준 입력)
    for name, mk in LEARNERS.items():
        if name in ("linear", "lgbm"): continue
        record(rows, sex, fold, "학습기", name, run_chain(spec, sbp, dbp, y3, tr, va, te, mk, mk, K, seed), y3, sbp, dbp, tr, te)
    # ③ 규칙(기준 lgbm 분포 확률, 검증 접힘에서 최적화)
    P_va, y_va, P_te = base["va"][2], y3[va], base["te"][2]
    w = fit_weights(P_va, y_va); record(rows, sex, fold, "규칙", "클래스 가중 argmax", base, y3, sbp, dbp, tr, te, pred=(P_te * w).argmax(1))
    ws = {g: fit_weights(P_va[ag[va] == g], y_va[ag[va] == g]) for g in T.AGE_GROUP_LABELS}; pr = np.zeros(len(te), int)
    for g, wg in ws.items():
        m = ag[te] == g; pr[m] = (P_te[m] * wg).argmax(1)
    record(rows, sex, fold, "규칙", "나이대별 가중 argmax", base, y3, sbp, dbp, tr, te, pred=pr)
    t1, t2 = fit_tau(P_va, y_va); record(rows, sex, fold, "규칙", "누적 τ", base, y3, sbp, dbp, tr, te, pred=cum_pred(P_te, t1, t2))
    # ④ 구조·데이터
    record(rows, sex, fold, "구조·데이터", "체인 없음(sbp 모델에 dbp 미입력)", run_chain(Spec(spec.Xd, lambda idx, dv: spec.Xd.iloc[idx], groups), sbp, dbp, y3, tr, va, te, lg, lg, K, seed), y3, sbp, dbp, tr, te)
    record(rows, sex, fold, "참고(배포 불가)", "실제 dbp 입력(상한)", run_chain(spec, sbp, dbp, y3, tr, va, te, lg, lg, K, seed, true_dbp=True), y3, sbp, dbp, tr, te)
    # 나이대별 모델 3개
    d_all, s_all, P_all = np.zeros(len(te)), np.zeros(len(te)), np.zeros((len(te), 3)); d_tr_all, s_tr_all = np.zeros(len(tr)), np.zeros(len(tr))
    for g in T.AGE_GROUP_LABELS:
        trg, vag = tr[ag[tr] == g], va[ag[va] == g]; pos_te, pos_tr = np.where(ag[te] == g)[0], np.where(ag[tr] == g)[0]
        if len(pos_te) == 0 or len(vag) < 50: continue
        r = run_chain(spec, sbp, dbp, y3, trg, vag, te[pos_te], lg, lg, K, seed)
        d_all[pos_te], s_all[pos_te], P_all[pos_te] = r["te"]; d_tr_all[pos_tr], s_tr_all[pos_tr] = r["tr"]
    record(rows, sex, fold, "구조·데이터", "나이대별 모델 3개", {"te": (d_all, s_all, P_all), "tr": (d_tr_all, s_tr_all)}, y3, sbp, dbp, tr, te)
    # 잡음 증강(연속 입력에 표준편차 10% 잡음, 학습 행 2배)
    rng = np.random.default_rng(seed); cont = [c for c in CONT if c in X.columns]
    Xj = X.iloc[tr].copy()
    for c in cont: Xj[c] = Xj[c].to_numpy(float) + rng.normal(0, 0.1 * float(X[c].iloc[tr].std()), len(tr))
    Xa = pd.concat([X, Xj], ignore_index=True); ext = np.arange(len(X), len(Xa))
    r = run_chain(spec_cf(Xa, fd, fs, np.concatenate([groups, groups[tr]])), np.concatenate([sbp, sbp[tr]]), np.concatenate([dbp, dbp[tr]]), np.concatenate([y3, y3[tr]]), np.concatenate([tr, ext]), va, te, lg, lg, K, seed)
    r["tr"] = (r["tr"][0][: len(tr)], r["tr"][1][: len(tr)]); record(rows, sex, fold, "구조·데이터", "잡음 증강 2배", r, y3, sbp, dbp, tr, te)
    # 학습 곡선
    for frac in (0.25, 0.5, 0.75):
        sub = np.sort(rng.choice(tr, int(len(tr) * frac), replace=False))
        r = run_chain(spec, sbp, dbp, y3, sub, va, te, lg, lg, K, seed); r["tr"] = (np.full(len(tr), np.nan), np.full(len(tr), np.nan))
        rec = {"te": r["te"], "tr": r["tr"]}; d_te, s_te, P_te2 = rec["te"]
        sc = score(y3[te], sbp[te], dbp[te], d_te, s_te, P_te2); rows.append({"sex": sex, "fold": fold, "group": "구조·데이터", "candidate": f"학습 행 {int(frac*100)}%", **sc, "train_point_acc": np.nan, "train_sbp_rmse": np.nan})
    # 나이 외 계수 배수(linear, sbp 모델; 절편·나이 관련 계수 고정)
    for f in (1.5, 2.0):
        def post(m, f=f):
            idx = [i + 1 for i, c in enumerate(m.columns) if "age" not in c]; m.beta[idx] *= f
        record(rows, sex, fold, "구조·데이터", f"linear 나이 외 계수 ×{f:g}", run_chain(spec, sbp, dbp, y3, tr, va, te, ln, ln, K, seed, post_s=post), y3, sbp, dbp, tr, te)
    # 나이만 / 나이 제외
    X2 = X[["age", "male"]]; fd2 = ChainFeatures(False, center="reference").fit(X2.iloc[tr]); fs2 = ChainFeatures(True, center="reference", extra_name="dbp").fit(X2.iloc[tr], dbp[tr])
    record(rows, sex, fold, "참고(배포 불가)", "나이만", run_chain(spec_cf(X2, fd2, fs2, groups), sbp, dbp, y3, tr, va, te, lg, lg, K, seed), y3, sbp, dbp, tr, te)
    X3 = X.copy(); X3["age"] = 0.0; fd3 = ChainFeatures(False, center="reference").fit(X3.iloc[tr]); fs3 = ChainFeatures(True, center="reference", extra_name="dbp").fit(X3.iloc[tr], dbp[tr])
    record(rows, sex, fold, "참고(배포 불가)", "나이 제외", run_chain(spec_cf(X3, fd3, fs3, groups), sbp, dbp, y3, tr, va, te, lg, lg, K, seed), y3, sbp, dbp, tr, te)
    # 체인+분류기 스택(학습 행은 내부 3겹 교차 예측, 검증·테스트는 전체 학습 행 체인)
    d_oof, s_oof = np.zeros(len(tr)), np.zeros(len(tr))
    for a, b in KFold(3, shuffle=True, random_state=seed).split(tr):
        ia = tr[a]; p = np.random.default_rng(seed).permutation(ia); n_va = int(len(ia) * 0.15)
        r = run_chain(spec, sbp, dbp, y3, np.sort(p[n_va:]), np.sort(p[:n_va]), tr[b], lg, lg, K, seed, need_dist=False); d_oof[b], s_oof[b] = r["te"][0], r["te"][1]
    d_va, s_va = base["va"][0], base["va"][1]; d_te, s_te = base["te"][0], base["te"][1]
    def stack_X(idx, dh, sh): return spec.Xd.iloc[idx].assign(dbp_hat=dh, sbp_hat=sh, pp=sh - dh)
    mc = lgb.LGBMClassifier(**dict(MC_PARAMS, random_state=seed)); mc.fit(stack_X(tr, d_oof, s_oof), y3[tr], eval_set=[(stack_X(va, d_va, s_va), y3[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
    P = mc.predict_proba(stack_X(te, d_te, s_te)); record(rows, sex, fold, "구조·데이터", "체인+분류기 스택", base, y3, sbp, dbp, tr, te, pred=P.argmax(1), P=P)
    # 음주 포함/제외 반대, 제외 4열 복원
    other = EXCLUDE["female"] if sex == "male" else EXCLUDE["male"]
    _, X5, fd5, fs5, _, _, g5, _, _ = build(d, tr, other); record(rows, sex, fold, "구조·데이터", "음주 열 " + ("제외" if sex == "male" else "포함"), run_chain(spec_cf(X5, fd5, fs5, g5), sbp, dbp, y3, tr, va, te, lg, lg, K, seed), y3, sbp, dbp, tr, te)
    _, X6, fd6, fs6, _, _, g6, _, _ = build(d, tr, tuple(c for c in EXCLUDE[sex] if c not in ("sodium_risk_score", "sleep_short_flag", "missing_count", "education_years")))
    record(rows, sex, fold, "구조·데이터", "제외 4열 복원", run_chain(spec_cf(X6, fd6, fs6, g6), sbp, dbp, y3, tr, va, te, lg, lg, K, seed), y3, sbp, dbp, tr, te)


# ------------------------------------------------------------------ 요약
def summarize(out_dir: Path, folds: int):
    files = sorted(out_dir.glob("folds_*.csv")); df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    tables, L = {}, [f"# 성별 분리 역체인(dbp→sbp) 검증 — 그동안의 방법 적용 ({out_dir.name})\n",
                     f"- 구조 고정: 성별 분리, 전 열 → dbp, 전 열 + dbp(학습 실제·추론 예측) → sbp. 3단계 라벨: " + (f"sbp {T.STAGE3_SBP_CUTS} 또는 dbp {T.STAGE3_DBP_CUTS}" if USE_DBP else f"sbp {T.STAGE3_SBP_CUTS} 만") + f". {folds}겹 층화 CV, 접힘마다 전처리·추가 데이터·모델 재학습.",
                     "- 기준 = 문헌 기준값 중심 입력 + LightGBM 역체인(train_sex_chain.py 와 같은 설정). Δ = 후보 − 기준(접힘별 짝지은 차이의 평균), CI95 = 1.96·sd/√k. |Δ| 가 CI 보다 크면 '잡음 밖'.",
                     "- point_acc: 점추정(예측 sbp 로 단계) 정확도, dist_acc: 분포 argmax 정확도, auroc_ge140: htn 확률의 AUROC, recall_htn: 점추정 htn 재현율, exp_upper: 평균 max P(기대 상한), train_*: 학습 행 지표(과학습 점검).",
                     "- '참고(배포 불가)' 는 실제 dbp 를 넣거나 입력을 줄인 비교용이며 제품에 쓸 수 없다. 분류 전용 방법(소프트 라벨·two_axis·계층 분류·자기학습·LDA/QDA/NB)과 행 검증 변형은 넣지 않았다(머리말 참조).\n"]
    for sex in [s for s in ("male", "female") if s in set(df["sex"])]:
        d = df[df["sex"] == sex]; base = d[d["candidate"] == "기준(lgbm)"].set_index("fold")
        rows = []
        for (grp, cand), g in d.groupby(["group", "candidate"], sort=False):
            g = g.set_index("fold"); row = {"group": grp, "candidate": cand, "n_folds": len(g)}
            for m in METRIC_COLS:
                row[m] = float(g[m].mean())
            for m in ("point_acc", "dist_acc", "sbp_rmse", "dbp_rmse", "auroc_ge140"):
                diff = (g[m] - base.loc[g.index, m]).to_numpy(float)
                row[f"Δ{m}"] = float(np.nanmean(diff)); row[f"CI95_{m}"] = float(1.96 * np.nanstd(diff, ddof=1) / np.sqrt(len(diff))) if len(diff) > 1 else np.nan
            row["Δpoint_acc_잡음밖"] = "예" if abs(row["Δpoint_acc"]) > row["CI95_point_acc"] else ""
            row["Δsbp_rmse_잡음밖"] = "예" if abs(row["Δsbp_rmse"]) > row["CI95_sbp_rmse"] else ""
            row["과학습_gap(train−test acc)"] = row["train_point_acc"] - row["point_acc"]
            rows.append(row)
        t = pd.DataFrame(rows).sort_values("Δpoint_acc", ascending=False).reset_index(drop=True); tables[sex] = t
        show = t[["group", "candidate", "point_acc", "Δpoint_acc", "CI95_point_acc", "Δpoint_acc_잡음밖", "dist_acc", "Δdist_acc", "sbp_rmse", "Δsbp_rmse", "CI95_sbp_rmse", "Δsbp_rmse_잡음밖", "dbp_rmse", "auroc_ge140", "Δauroc_ge140", "recall_htn", "과학습_gap(train−test acc)"]]
        b = base.mean(numeric_only=True)
        L += [f"\n## {SEX_KO[sex]} (기준 lgbm: point_acc {b['point_acc']:.3f}, dist_acc {b['dist_acc']:.3f}, sbp RMSE {b['sbp_rmse']:.2f}, dbp RMSE {b['dbp_rmse']:.2f}, AUROC≥140 {b['auroc_ge140']:.3f}, 기대 상한 {b['exp_upper']:.3f}, train point_acc {b['train_point_acc']:.3f})\n", md_table(show, nd=3)]
    (out_dir / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(out_dir / "results.xlsx", engine="openpyxl") as w:
        for sex, t in tables.items():
            t.to_excel(w, sheet_name=SEX_KO[sex], index=False); style(w.book[SEX_KO[sex]], nd=3, freeze="C2")
        df.to_excel(w, sheet_name="접힘별", index=False); style(w.book["접힘별"], nd=3, freeze="E2")
    for m, title, fmt, scale in (("point_acc", "3단계 점추정 정확도 차이 (%p, 기준 lgbm 대비)", "{:+.1f}", 100.0), ("sbp_rmse", "sbp RMSE 차이 (mmHg, 기준 lgbm 대비; 음수가 개선)", "{:+.2f}", 1.0)):
        fig, axes = plt.subplots(1, len(tables), figsize=(9 * len(tables), 13), facecolor=SURFACE, squeeze=False)
        for ax, (sex, t) in zip(axes[0], tables.items()):
            tt = t[t["candidate"] != "기준(lgbm)"].sort_values(f"Δ{m}")
            ax.barh(tt["candidate"], tt[f"Δ{m}"] * scale, xerr=tt[f"CI95_{m}"] * scale, color=[GROUP_COLORS.get(g, TEXT) for g in tt["group"]], edgecolor=SURFACE, error_kw={"ecolor": MUTED, "elinewidth": 0.8, "capsize": 2})
            for k, v in enumerate(tt[f"Δ{m}"] * scale): ax.text(max(v, 0), k, " " + fmt.format(v), va="center", fontsize=7, color=MUTED)
            ax.axvline(0, color=TEXT, linewidth=0.8); ax.set_facecolor(SURFACE); ax.grid(axis="x", color=GRID, linewidth=0.6); ax.tick_params(colors=MUTED, labelsize=8)
            ax.set_title(f"{SEX_KO[sex]} · {title}", color=TEXT, fontsize=10)
            for s in ("top", "right"): ax.spines[s].set_visible(False)
        handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in GROUP_COLORS.values()]; axes[0][0].legend(handles, list(GROUP_COLORS.keys()), fontsize=8, loc="lower right")
        fig.suptitle(f"성별 분리 역체인 검증 — {folds}겹 CV 짝지은 차이와 95% 신뢰구간", color=TEXT, fontsize=11); fig.tight_layout(); fig.savefig(out_dir / f"fig_delta_{m}.png", dpi=130); plt.close(fig)
    log(f"요약 완료: {out_dir}/summary.md, results.xlsx, fig_delta_point_acc.png, fig_delta_sbp_rmse.png")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="train/"); ap.add_argument("--sex", default="both", choices=["male", "female", "both"]); ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--samples", type=int, default=50); ap.add_argument("--seed", type=int, default=42); ap.add_argument("--out-dir", default=None); ap.add_argument("--summarize", default=None); ap.add_argument("--limit", type=int, default=None, help="점검용: 성별당 행 수 제한"); ap.add_argument("--label", default="sbp", choices=["sbp", "dbp_rule"])
    a = ap.parse_args(argv)
    global USE_DBP; USE_DBP = a.label == "dbp_rule"
    if a.summarize:
        summarize(Path(a.summarize), a.folds); return
    out = Path(a.out_dir or f"reports/validate_{datetime.now():%Y%m%d_%H%M%S}"); out.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d0 = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d0) == "").to_numpy() & d0[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d0 = d0[keep].reset_index(drop=True)
    for sex in (("male", "female") if a.sex == "both" else (a.sex,)):
        d = d0[d0["sex"] == sex].reset_index(drop=True)
        if a.limit: d = d.sample(min(a.limit, len(d)), random_state=a.seed).reset_index(drop=True)
        sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y3 = stage3_from_bp(sbp, dbp, USE_DBP); rows = []
        for f, (trva, te) in enumerate(StratifiedKFold(a.folds, shuffle=True, random_state=a.seed).split(d, y3), 1):
            prm = np.random.default_rng(a.seed + f).permutation(trva); n_va = int(len(trva) * 0.15); va, tr = np.sort(prm[:n_va]), np.sort(prm[n_va:])
            run_fold(sex, f, d, tr, va, te, sbp, dbp, y3, a.samples, a.seed, rows)
            b = [r for r in rows if r["fold"] == f and r["candidate"] == "기준(lgbm)"][0]
            log(f"[{sex}] 접힘 {f}/{a.folds} 완료: 후보 {sum(r['fold'] == f for r in rows)}개, 기준 point_acc {b['point_acc']:.3f} sbp RMSE {b['sbp_rmse']:.2f}")
        pd.DataFrame(rows).to_csv(out / f"folds_{sex}.csv", index=False)
    if a.sex == "both": summarize(out, a.folds)
    log(f"완료: {out}")


if __name__ == "__main__":
    main()

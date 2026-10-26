"""
[파일] boost_accuracy.py
[용도] 4단계 정답률(정확도)을 올리기 위한 탐색 하네스. 체인 파이프라인 전처리(새 행 검증·기준값 중심) 위에서 다음 후보를 같은 시간 분할로 평가한다:
      ① 단계 직접 다중분류 LightGBM(용량 3단계), ② 순서형 회귀(단계 인덱스 회귀 + 경계 최적화), ③ 연도 피처·최근 연도 가중, ④ 체인 분포 확률과의 앙상블,
      ⑤ 확률→단계 규칙: argmax / 누적 τ / 클래스 가중 argmax(검증 최적화) / 나이대별 가중 argmax. 오른 후보는 5겹 교차검증으로 확인하고,
      최종 모델을 전체 라벨 행으로 다시 학습해 테스트 파일 단계 예측(person_id + 단계 열)을 만든다.
[왜 필요한가] 사용자 요청(2026-10-26): 가능한 방법을 모두 동원해 정답률 상승을 시도. 결과 reports/boost_<시각>/
[쓰는 곳] python3 boost_accuracy.py --data train/ --test-data test/
"""

from __future__ import annotations

import argparse
import itertools
import pickle
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import KFold

import thresholds as T
from analysis_pack import style
from m1 import decision as D
from m1.chain import ChainFeatures, ChainModel, ChainPreprocessor, load_frame, stage_from_bp
from m1.continuous import dispersion_groups
from m1.evaluate import age_groups, auroc
from m1.pipeline import log
from m1.report import md_table
from m1.splits import make_splits

MC_PARAMS = {
    "mc_small": dict(num_leaves=15, max_depth=4, min_child_samples=50, colsample_bytree=0.8),
    "mc_mid": dict(num_leaves=31, max_depth=-1, min_child_samples=50, colsample_bytree=0.8),
    "mc_big": dict(num_leaves=63, max_depth=-1, min_child_samples=100, colsample_bytree=0.6, reg_lambda=5.0),
}
BASE = dict(objective="multiclass", num_class=4, learning_rate=0.03, n_estimators=4000, subsample=0.8, subsample_freq=1, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1)
W_GRID = np.round(np.arange(0.5, 2.01, 0.1), 2)


# ---------------------------------------------------------------- 규칙
def weighted_argmax(P: np.ndarray, w: np.ndarray) -> np.ndarray:
    return (P * w[None, :]).argmax(axis=1)


def fit_weights(P_val: np.ndarray, y_val: np.ndarray) -> np.ndarray:
    """정확도 최대 클래스 가중(normal 가중 1 고정, 나머지 0.5~2.0 격자)."""
    best, best_w = -1.0, np.ones(4)
    for a, b, c in itertools.product(W_GRID, W_GRID, W_GRID):
        w = np.array([1.0, a, b, c]); acc = float((weighted_argmax(P_val, w) == y_val).mean())
        if acc > best:
            best, best_w = acc, w
    return best_w


def fit_weights_by_age(P_val: np.ndarray, y_val: np.ndarray, ag_val: np.ndarray) -> dict:
    return {g: fit_weights(P_val[ag_val == g], y_val[ag_val == g]) for g in T.AGE_GROUP_LABELS}


def apply_weights_by_age(P: np.ndarray, ag: np.ndarray, ws: dict) -> np.ndarray:
    out = np.zeros(len(P), int)
    for g, w in ws.items():
        m = ag == g; out[m] = weighted_argmax(P[m], w)
    return out


def rule_metrics(name: str, P_val: np.ndarray, y_val: np.ndarray, P_te: np.ndarray, y_te: np.ndarray, ag_val: np.ndarray, ag_te: np.ndarray) -> dict:
    tau = D.fit_thresholds(P_val, y_val)
    w = fit_weights(P_val, y_val)
    ws = fit_weights_by_age(P_val, y_val, ag_val)
    saved = (D.STAGE_RULE, D.STAGE_OBJECTIVE); D.STAGE_RULE, D.STAGE_OBJECTIVE = "cumulative", "accuracy"
    acc_cum = float((D.decide_stage(P_te, tau) == y_te).mean())
    D.STAGE_RULE, D.STAGE_OBJECTIVE = saved
    return {"candidate": name, "argmax": float((P_te.argmax(1) == y_te).mean()), "cumulative_tau": acc_cum, "weighted_argmax": float((weighted_argmax(P_te, w) == y_te).mean()),
            "weighted_by_age": float((apply_weights_by_age(P_te, ag_te, ws) == y_te).mean()), "AUROC_140_90": auroc((y_te == 3).astype(int), P_te[:, 3]),
            "AUROC_130_80": auroc((y_te >= 2).astype(int), P_te[:, 2] + P_te[:, 3]), "weights": np.round(w, 2).tolist(), "tau": [round(t, 2) for t in tau["accuracy"]]}


# ---------------------------------------------------------------- 후보 모델
def fit_mc(X, y, Xv, yv, params: dict, seed: int, sample_weight=None):
    m = lgb.LGBMClassifier(**dict(BASE, **params, random_state=seed))
    m.fit(X, y, sample_weight=sample_weight, eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
    return m


def fit_ordreg(X, y, Xv, yv, seed: int):
    """단계 인덱스(0~3) 회귀 + 검증에서 경계 3개 최적화 → 확률은 경계 간 거리로 근사(softmax)."""
    m = lgb.LGBMRegressor(objective="regression", learning_rate=0.03, n_estimators=4000, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1, random_state=seed)
    m.fit(X, y, eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
    s = m.predict(Xv)
    best, bt = -1, (0.5, 1.5, 2.5)
    for t1 in np.arange(0.2, 1.3, 0.05):
        for t2 in np.arange(t1 + 0.1, 2.3, 0.05):
            for t3 in np.arange(t2 + 0.1, 3.0, 0.05):
                pred = np.digitize(s, [t1, t2, t3]); acc = (pred == yv).mean()
                if acc > best:
                    best, bt = acc, (t1, t2, t3)
    return m, bt


def ordreg_proba(m, bt, X) -> np.ndarray:
    s = m.predict(X); centers = np.array([bt[0] - 0.5, (bt[0] + bt[1]) / 2, (bt[1] + bt[2]) / 2, bt[2] + 0.5])
    z = -((s[:, None] - centers[None, :]) ** 2) / (2 * 0.35 ** 2)
    P = np.exp(z - z.max(1, keepdims=True)); return P / P.sum(1, keepdims=True)


class Setup:
    """전처리·피처 한 번에."""
    def __init__(self, d: pd.DataFrame, tr: np.ndarray, sbp: np.ndarray, center: str = "reference"):
        self.pre = ChainPreprocessor().fit(d.iloc[tr])
        self.X, _, _ = self.pre.transform(d)
        self.fs = ChainFeatures(False, center=center).fit(self.X.iloc[tr])
        self.fd = ChainFeatures(True, center=center).fit(self.X.iloc[tr], sbp[tr])
        self.Xs, self.Xd = self.fs.transform(self.X), self.fd.transform(self.X, sbp)
        self.groups = dispersion_groups(self.X)
        self.ag = age_groups(self.X["age"].to_numpy())


def candidates_P(setup: Setup, d: pd.DataFrame, sbp, dbp, y, tr, va, te, K: int, seed: int, with_chain: bool = True) -> dict:
    """후보별 (P_val, P_test)."""
    Xs, Xd, X = setup.Xs, setup.Xd, setup.X
    out = {}
    if with_chain:
        for lr in ("lgbm", "linear"):
            m = ChainModel(lr, seed).fit(Xs.iloc[tr], sbp[tr], Xd.iloc[tr], dbp[tr], Xs.iloc[va], sbp[va], Xd.iloc[va], dbp[va], setup.groups[va])
            out[f"chain_{lr}"] = (m.predict_dist(Xs.iloc[va], X.iloc[va], setup.fd, setup.groups[va], K=K)["P"], m.predict_dist(Xs.iloc[te], X.iloc[te], setup.fd, setup.groups[te], K=K)["P"])
    for name, params in MC_PARAMS.items():
        m = fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], params, seed)
        out[name] = (m.predict_proba(Xs.iloc[va]), m.predict_proba(Xs.iloc[te]))
    year = d["exam_year"].to_numpy(float)
    Xy = Xs.assign(exam_year=year)
    m = fit_mc(Xy.iloc[tr], y[tr], Xy.iloc[va], y[va], MC_PARAMS["mc_mid"], seed)
    out["mc_mid+year"] = (m.predict_proba(Xy.iloc[va]), m.predict_proba(Xy.iloc[te]))
    wts = 1.0 + 0.15 * (year[tr] - year[tr].min())
    m = fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed, sample_weight=wts)
    out["mc_mid_recency"] = (m.predict_proba(Xs.iloc[va]), m.predict_proba(Xs.iloc[te]))
    m, bt = fit_ordreg(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], seed)
    out["ordreg"] = (ordreg_proba(m, bt, Xs.iloc[va]), ordreg_proba(m, bt, Xs.iloc[te]))
    members = [k for k in ("chain_lgbm", "mc_mid", "mc_big", "chain_linear") if k in out]
    out["ensemble"] = (np.mean([out[k][0] for k in members], axis=0), np.mean([out[k][1] for k in members], axis=0))
    members2 = [k for k in ("mc_mid", "mc_big", "mc_mid+year") if k in out]
    out["ensemble_mc"] = (np.mean([out[k][0] for k in members2], axis=0), np.mean([out[k][1] for k in members2], axis=0))
    return out


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--test-data", default=None)
    ap.add_argument("--time-col", default="exam_year")
    ap.add_argument("--samples", type=int, default=100)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--cv-folds", type=int, default=5)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    rep = Path(a.out) / f"boost_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data)
    d = ChainPreprocessor.coerce(raw)
    reasons = ChainPreprocessor().reasons(d)
    keep = (reasons == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
    d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y = stage_from_bp(sbp, dbp)
    splits, _ = make_splits(y, d[a.time_col], seed=a.seed); tr, va, te = splits["train"], splits["val"], splits["test"]
    log(f"[1/4] 사용 {len(d)}행, 시간 분할 train {len(tr)} / val {len(va)} / test {len(te)}; 전부 normal 기준선(test) {float((y[te]==0).mean()):.4f}")

    # 1. 시간 분할에서 후보 평가
    setup = Setup(d, tr, sbp)
    Ps = candidates_P(setup, d, sbp, dbp, y, tr, va, te, a.samples, a.seed)
    rows = [rule_metrics(name, Pv, y[va], Pt, y[te], setup.ag[va], setup.ag[te]) for name, (Pv, Pt) in Ps.items()]
    tab = pd.DataFrame(rows)
    tab["best_rule_acc"] = tab[["argmax", "cumulative_tau", "weighted_argmax", "weighted_by_age"]].max(axis=1)
    tab = tab.sort_values("best_rule_acc", ascending=False).reset_index(drop=True)
    log("[2/4] 시간 분할 결과:\n" + tab.drop(columns=["weights", "tau"]).round(4).to_string(index=False))

    # 2. 상위 후보 교차검증 (기준 chain_lgbm 포함)
    top = [c for c in tab["candidate"].tolist() if c not in ("chain_lgbm",)][:3] + ["chain_lgbm"]
    cv_rows = []
    kf = KFold(a.cv_folds, shuffle=True, random_state=a.seed)
    for f, (trva, te_f) in enumerate(kf.split(d), 1):
        rng = np.random.default_rng(a.seed + f); perm = rng.permutation(trva); n_va = int(len(trva) * 0.15)
        va_f, tr_f = np.sort(perm[:n_va]), np.sort(perm[n_va:])
        st = Setup(d, tr_f, sbp)
        Pf = candidates_P(st, d, sbp, dbp, y, tr_f, va_f, te_f, max(30, a.samples // 2), a.seed, with_chain=True)
        for name in top:
            if name in Pf:
                r = rule_metrics(name, Pf[name][0], y[va_f], Pf[name][1], y[te_f], st.ag[va_f], st.ag[te_f]); r["fold"] = f; cv_rows.append(r)
        log(f"   CV fold {f} 완료")
    cv = pd.DataFrame(cv_rows)
    rules = ["argmax", "cumulative_tau", "weighted_argmax", "weighted_by_age"]
    cv_summ = cv.groupby("candidate")[rules + ["AUROC_140_90"]].agg(["mean", "std"]).reset_index()
    cv_summ.columns = ["candidate"] + [f"{m}_{s}" for m, s in cv_summ.columns[1:]]
    base = cv[cv.candidate == "chain_lgbm"].set_index("fold")
    diff_rows = []
    for name in top:
        if name == "chain_lgbm":
            continue
        v = cv[cv.candidate == name].set_index("fold")
        row = {"candidate": name}
        for r in rules:
            dlt = (v[r] - base["argmax"]).to_numpy(); ci = 1.96 * dlt.std(ddof=1) / np.sqrt(len(dlt))
            row[f"Δ{r} vs chain_lgbm argmax"] = dlt.mean(); row[f"ci95_{r}"] = ci; row[f"판정_{r}"] = "개선" if dlt.mean() > ci else ("악화" if dlt.mean() < -ci else "잡음 범위")
        diff_rows.append(row)
    diff = pd.DataFrame(diff_rows)
    log("[3/4] 교차검증 요약:\n" + cv_summ.round(4).to_string(index=False))

    # 3. 최종: 전체 라벨 행 재학습 → 테스트 파일 예측 (최고 후보 + 기준)
    test_info = None
    best_name = tab.iloc[0]["candidate"]
    best_rule = tab.iloc[0][["argmax", "cumulative_tau", "weighted_argmax", "weighted_by_age"]].astype(float).idxmax()
    if a.test_data:
        rng = np.random.default_rng(a.seed); perm = rng.permutation(len(d)); n_va = int(len(d) * 0.15)
        va_all, tr_all = np.sort(perm[:n_va]), np.sort(perm[n_va:])
        st = Setup(d, tr_all, sbp)
        dft, _ = load_frame(a.test_data)
        Xt, keep_t, dt = st.pre.transform(dft)
        Xs_t = st.fs.transform(Xt); groups_t = dispersion_groups(Xt); ag_t = age_groups(Xt["age"].to_numpy())
        ids = dt["person_id"].astype(str)
        preds = {}
        def finish(name, Pv, Pt):
            w = fit_weights(Pv, y[va_all]); ws = fit_weights_by_age(Pv, y[va_all], st.ag[va_all]); tau = D.fit_thresholds(Pv, y[va_all])
            saved = (D.STAGE_RULE, D.STAGE_OBJECTIVE); D.STAGE_RULE, D.STAGE_OBJECTIVE = "cumulative", "accuracy"
            preds[f"{name}__argmax"] = Pt.argmax(1); preds[f"{name}__cumulative_tau"] = D.decide_stage(Pt, tau)
            D.STAGE_RULE, D.STAGE_OBJECTIVE = saved
            preds[f"{name}__weighted_argmax"] = weighted_argmax(Pt, w); preds[f"{name}__weighted_by_age"] = apply_weights_by_age(Pt, ag_t, ws)
        # 기준 chain_lgbm
        cm = ChainModel("lgbm", a.seed).fit(st.Xs.iloc[tr_all], sbp[tr_all], st.Xd.iloc[tr_all], dbp[tr_all], st.Xs.iloc[va_all], sbp[va_all], st.Xd.iloc[va_all], dbp[va_all], st.groups[va_all])
        finish("chain_lgbm", cm.predict_dist(st.Xs.iloc[va_all], st.X.iloc[va_all], st.fd, st.groups[va_all], K=a.samples)["P"], cm.predict_dist(Xs_t, Xt, st.fd, groups_t, K=a.samples)["P"])
        # 다중분류 후보 전부 + 앙상블
        Pv_all, Pt_all = {}, {}
        for name, params in MC_PARAMS.items():
            m = fit_mc(st.Xs.iloc[tr_all], y[tr_all], st.Xs.iloc[va_all], y[va_all], params, a.seed)
            Pv_all[name], Pt_all[name] = m.predict_proba(st.Xs.iloc[va_all]), m.predict_proba(Xs_t)
        year_all = d["exam_year"].to_numpy(float); Xy = st.Xs.assign(exam_year=year_all)
        if "exam_year" in dt.columns:
            m = fit_mc(Xy.iloc[tr_all], y[tr_all], Xy.iloc[va_all], y[va_all], MC_PARAMS["mc_mid"], a.seed)
            Pv_all["mc_mid+year"], Pt_all["mc_mid+year"] = m.predict_proba(Xy.iloc[va_all]), m.predict_proba(Xs_t.assign(exam_year=pd.to_numeric(dt.loc[keep_t, "exam_year"], errors="coerce").fillna(year_all.max()).to_numpy(float)))
        for name in Pv_all:
            finish(name, Pv_all[name], Pt_all[name])
        Pv_all["ensemble_mc"] = np.mean([Pv_all[k] for k in ("mc_mid", "mc_big", "mc_mid+year") if k in Pv_all], axis=0)
        Pt_all["ensemble_mc"] = np.mean([Pt_all[k] for k in ("mc_mid", "mc_big", "mc_mid+year") if k in Pt_all], axis=0)
        finish("ensemble_mc", Pv_all["ensemble_mc"], Pt_all["ensemble_mc"])
        out = pd.DataFrame({"person_id": ids[keep_t].to_numpy(), **{k: np.asarray(T.STAGES)[v] for k, v in preds.items()}})
        dropped = pd.DataFrame({"person_id": ids[~keep_t].to_numpy(), "note": "예측 불가: " + dt.loc[~keep_t, "__reason"].astype(str)})
        full = pd.concat([out, dropped], ignore_index=True)
        order = {pid: i for i, pid in enumerate(ids)}
        full = full.iloc[np.argsort(full["person_id"].map(order).to_numpy(), kind="stable")].reset_index(drop=True).fillna("")
        with pd.ExcelWriter(rep / "test_stage_candidates.xlsx", engine="openpyxl") as w:
            full.to_excel(w, sheet_name="stage", index=False); style(w.book["stage"], nd=1, freeze="B2")
        full.to_csv(rep / "test_stage_candidates.csv", index=False)
        test_info = {"rows": int(len(dft)), "predicted": int(keep_t.sum()), "columns": list(preds.keys())}
        log(f"[4/4] 테스트 파일 {len(dft)}행 → 예측 {int(keep_t.sum())}행, 열 {len(preds)}개 → {rep}/test_stage_candidates.xlsx")

    L = [f"# 정답률 탐색 — {rep.name}\n", f"- 사용 {len(d)}행, 시간 분할 train {len(tr)} / val {len(va)} / test {len(te)}; 전부 normal 기준선(test) {float((y[te]==0).mean()):.4f}",
         "- 규칙: argmax / cumulative_tau(검증 τ) / weighted_argmax(검증에서 클래스 가중 최적화) / weighted_by_age(나이대별 가중). best_rule_acc = 네 규칙 중 최고",
         f"- 시간 분할 최고: {best_name} / {best_rule} = {tab.iloc[0]['best_rule_acc']:.4f}\n", "## 1. 시간 분할\n", md_table(tab.drop(columns=["weights", "tau"]), nd=4),
         "\n가중·τ:\n", md_table(tab[["candidate", "weights", "tau"]], nd=2), f"\n## 2. {a.cv_folds}겹 교차검증 (상위 후보 + 기준)\n", md_table(cv_summ, nd=4),
         "\n### 기준(chain_lgbm argmax) 대비 짝지은 차이\n", md_table(diff, nd=4)]
    if test_info:
        L += ["\n## 3. 테스트 파일\n", f"- {test_info['rows']}행 중 {test_info['predicted']}행 예측. 열: {test_info['columns']}", "- 최종 모델은 전체 라벨 행(검증 15% 제외) 으로 재학습, 가중·τ 는 그 검증에서 선택"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in (("시간분할", tab.astype(str)), ("교차검증", cv_summ), ("기준대비", diff), ("접힘별", cv.astype(str))):
            df.to_excel(w, sheet_name=name, index=False); style(w.book[name], nd=4, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

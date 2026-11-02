"""
[파일] boost_round2.py
[용도] 정답률 2차 탐색(2026-10-26). 최종 모델(다중분류 LightGBM, mc_mid)을 기준으로 아직 안 써 본 방법을 5겹 교차검증에서 짝지어 비교한다:
      bag5(시드 5개 평균), two_axis(sbp≥120/130/140·dbp≥80/90 이진 5개 → 검증 분할에서 다항 로지스틱 합성), stack_reg(내부 3겹 교차 예측한 sbp·dbp 회귀값을 분류기 입력에 추가),
      per_age(나이대별 모델 3개), self_train(라벨 없는 테스트 파일 입력을 높은 확신 가짜 라벨로 추가), bag5+stack_reg. 오른 후보는 전체 라벨 행으로 재학습해 테스트 파일 단계를 낸다.
[쓰는 곳] python3 boost_round2.py --data train/ --test-data test/
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import KFold

import thresholds as T
from analysis_pack import style
from boost_accuracy import MC_PARAMS, Setup, fit_mc
from m1.chain import ChainPreprocessor, MeanRegressor, load_frame, stage_from_bp
from m1.evaluate import age_groups, auroc
from m1.pipeline import log
from m1.report import md_table

AXES = [("sbp", T.SBP_ELEVATED_MIN), ("sbp", T.SBP_PREHTN_MIN), ("sbp", T.SBP_HTN_MIN), ("dbp", T.DBP_PREHTN_MIN), ("dbp", T.DBP_HTN_MIN)]
BIN_PARAMS = dict(objective="binary", learning_rate=0.03, n_estimators=4000, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1)


def oof_regression(X: pd.DataFrame, target: np.ndarray, tr: np.ndarray, others: list[np.ndarray], seed: int, k: int = 3) -> np.ndarray:
    """학습 행은 k겹 교차 예측, 나머지 행은 전체 학습 행 모델로 예측 → 누출 없는 회귀 예측 열."""
    out = np.zeros(len(X))
    kf = KFold(k, shuffle=True, random_state=seed)
    for a, b in kf.split(tr):
        ia, ib = tr[a], tr[b]
        n_va = int(len(ia) * 0.15); rng = np.random.default_rng(seed); p = rng.permutation(ia)
        m = MeanRegressor("lgbm", seed).fit(X.iloc[p[n_va:]], target[p[n_va:]], X.iloc[p[:n_va]], target[p[:n_va]])
        out[ib] = m.predict(X.iloc[ib])
    n_va = int(len(tr) * 0.15); rng = np.random.default_rng(seed + 1); p = rng.permutation(tr)
    m = MeanRegressor("lgbm", seed).fit(X.iloc[p[n_va:]], target[p[n_va:]], X.iloc[p[:n_va]], target[p[:n_va]])
    for idx in others:
        out[idx] = m.predict(X.iloc[idx])
    return out


def candidates(setup: Setup, d, sbp, dbp, y, tr, va, te, seed: int, unlabeled: pd.DataFrame | None) -> dict:
    Xs = setup.Xs; out = {}
    # 기준
    m = fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed); out["baseline_mc_mid"] = m.predict_proba(Xs.iloc[te]); base_val = m.predict_proba(Xs.iloc[va])
    # bag5
    Ps = [out["baseline_mc_mid"]] + [fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed + 100 * s).predict_proba(Xs.iloc[te]) for s in range(1, 5)]
    out["bag5"] = np.mean(Ps, axis=0)
    # two_axis
    F_va, F_te = [], []
    for tgt, cut in AXES:
        yb = (sbp if tgt == "sbp" else dbp) >= cut
        mb = lgb.LGBMClassifier(**dict(BIN_PARAMS, random_state=seed))
        mb.fit(Xs.iloc[tr], yb[tr].astype(int), eval_set=[(Xs.iloc[va], yb[va].astype(int))], callbacks=[lgb.early_stopping(100, verbose=False)])
        F_va.append(mb.predict_proba(Xs.iloc[va])[:, 1]); F_te.append(mb.predict_proba(Xs.iloc[te])[:, 1])
    F_va, F_te = np.column_stack(F_va), np.column_stack(F_te)
    def logit(p): p = np.clip(p, 1e-4, 1 - 1e-4); return np.log(p / (1 - p))
    comp = LogisticRegression(C=1.0, max_iter=2000).fit(logit(F_va), y[va])
    out["two_axis"] = comp.predict_proba(logit(F_te))
    # stack_reg: 내부 교차 예측 sbp_hat·dbp_hat 를 입력에 추가
    s_hat = oof_regression(Xs, sbp, tr, [va, te], seed); d_hat = oof_regression(Xs, dbp, tr, [va, te], seed + 7)
    Xst = Xs.assign(sbp_hat=s_hat, dbp_hat=d_hat, pp=s_hat - d_hat)
    m = fit_mc(Xst.iloc[tr], y[tr], Xst.iloc[va], y[va], MC_PARAMS["mc_mid"], seed); out["stack_reg"] = m.predict_proba(Xst.iloc[te])
    Ps = [out["stack_reg"]] + [fit_mc(Xst.iloc[tr], y[tr], Xst.iloc[va], y[va], MC_PARAMS["mc_mid"], seed + 100 * s).predict_proba(Xst.iloc[te]) for s in range(1, 5)]
    out["bag5+stack_reg"] = np.mean(Ps, axis=0)
    # per_age
    P = np.zeros((len(te), 4)); ag = setup.ag
    for g in T.AGE_GROUP_LABELS:
        trg, vag, teg = tr[ag[tr] == g], va[ag[va] == g], np.where(ag[te] == g)[0]
        if len(teg) == 0:
            continue
        mg = fit_mc(Xs.iloc[trg], y[trg], Xs.iloc[vag], y[vag], MC_PARAMS["mc_small"], seed)
        full = np.zeros((len(teg), 4)); full[:, mg.classes_] = mg.predict_proba(Xs.iloc[te[teg]]); P[teg] = full
    out["per_age"] = P
    # self_train: 라벨 없는 입력(테스트 파일)에 가짜 라벨
    if unlabeled is not None:
        Pu = fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed).predict_proba(unlabeled)
        conf = Pu.max(1) >= 0.6
        Xaug = pd.concat([Xs.iloc[tr], unlabeled[conf]], ignore_index=True); yaug = np.concatenate([y[tr], Pu[conf].argmax(1)])
        w = np.concatenate([np.ones(len(tr)), np.full(int(conf.sum()), 0.5)])
        m = fit_mc(Xaug, yaug, Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed, sample_weight=w); out["self_train"] = m.predict_proba(Xs.iloc[te])
        out["_self_train_n"] = int(conf.sum())
    return out


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--test-data", default=None)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    rep = Path(a.out) / f"boost2_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d) == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y = stage_from_bp(sbp, dbp)
    dft = load_frame(a.test_data)[0] if a.test_data else None
    rows = []
    kf = KFold(a.folds, shuffle=True, random_state=a.seed)
    for f, (trva, te) in enumerate(kf.split(d), 1):
        prm = np.random.default_rng(a.seed + f).permutation(trva); n_va = int(len(trva) * 0.15); va, tr = np.sort(prm[:n_va]), np.sort(prm[n_va:])
        st = Setup(d, tr, sbp)
        unl = None
        if dft is not None:
            Xt, keep_t, _ = st.pre.transform(dft); unl = st.fs.transform(Xt)
        out = candidates(st, d, sbp, dbp, y, tr, va, te, a.seed, unl)
        n_self = out.pop("_self_train_n", None)
        for name, P in out.items():
            rows.append({"fold": f, "candidate": name, "acc": float((P.argmax(1) == y[te]).mean()), "auroc_140": auroc((y[te] == 3).astype(int), P[:, 3]), "auroc_130": auroc((y[te] >= 2).astype(int), P[:, 2] + P[:, 3]), "expected_max": float(P.max(1).mean())})
        log(f"fold {f}: " + ", ".join(f"{r['candidate']} {r['acc']:.4f}" for r in rows if r["fold"] == f) + (f" (self_train 가짜 라벨 {n_self}행)" if n_self else ""))
    res = pd.DataFrame(rows)
    summ = res.groupby("candidate")[["acc", "auroc_140", "auroc_130", "expected_max"]].agg(["mean", "std"]).reset_index(); summ.columns = ["candidate"] + [f"{m}_{s}" for m, s in summ.columns[1:]]
    base = res[res.candidate == "baseline_mc_mid"].set_index("fold")
    diffs = []
    for name in res["candidate"].unique():
        if name == "baseline_mc_mid":
            continue
        v = res[res.candidate == name].set_index("fold"); row = {"candidate": name}
        for mcol in ("acc", "auroc_140"):
            dlt = (v[mcol] - base[mcol]).to_numpy(); ci = 1.96 * dlt.std(ddof=1) / np.sqrt(len(dlt))
            row[f"Δ{mcol}"] = dlt.mean(); row[f"ci95_{mcol}"] = ci; row[f"판정_{mcol}"] = "개선" if dlt.mean() > ci else ("악화" if dlt.mean() < -ci else "잡음 범위")
        diffs.append(row)
    diff = pd.DataFrame(diffs).sort_values("Δacc", ascending=False)
    log("교차검증 요약:\n" + summ.round(4).to_string(index=False) + "\n" + diff.round(4).to_string(index=False))
    L = [f"# 정답률 2차 탐색 — {rep.name}\n", f"- {len(d)}행, {a.folds}겹 CV, 기준 = 최종 모델 설정(mc_mid). self_train 은 테스트 파일 입력(라벨 없음)에 확신 ≥0.6 가짜 라벨(가중 0.5)\n",
         "## 교차검증 평균 ± sd\n", md_table(summ, nd=4), "\n## 기준 대비 짝지은 차이\n", md_table(diff, nd=4), "\n## 접힘별\n", md_table(res, nd=4)]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for n_, df in (("요약", summ), ("기준대비", diff), ("접힘별", res)):
            df.to_excel(w, sheet_name=n_, index=False); style(w.book[n_], nd=4, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

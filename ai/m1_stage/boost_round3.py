"""
[파일] boost_round3.py
[용도] 정답률 3차 탐색(2026-10-26). 기준(최종 모델 설정 mc_mid) 대비 5겹 CV 짝지은 비교:
      soft_label_σ(측정 오차 σ mmHg 를 가정해 각 행의 4단계 라벨 확률을 만들고 행을 4배 복제·가중 학습), jitter(연속 입력에 잡음 증강 2배), dart·extra_trees(다른 부스팅 규제),
      hier(normal vs 나머지 → 나머지 3단계 계층 분류), learning curve(학습 행 25/50/75/100%), id_prefix(person_id 첫 글자 더미 — 진단용, 제품 입력 부적합).
[쓰는 곳] python3 boost_round3.py --data train/
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.model_selection import KFold

import thresholds as T
from analysis_pack import style
from boost_accuracy import BASE, MC_PARAMS, Setup, fit_mc
from m1.chain import ChainPreprocessor, load_frame, stage_from_bp
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table


def soft_labels(sbp: np.ndarray, dbp: np.ndarray, sigma: float, n: int = 400, seed: int = 0) -> np.ndarray:
    """측정 오차 N(0, σ²) 를 sbp·dbp 에 더했을 때 각 단계가 될 확률(몬테카를로)."""
    rng = np.random.default_rng(seed)
    P = np.zeros((len(sbp), 4))
    for _ in range(n):
        st = stage_from_bp(sbp + rng.normal(0, sigma, len(sbp)), dbp + rng.normal(0, sigma * 0.6, len(dbp)))
        P[np.arange(len(sbp)), st] += 1
    return P / n


def fit_soft(X, Psoft, Xv, yv, seed):
    """소프트 라벨: 행을 4배 복제(각 단계) + 확률 가중."""
    n = len(X); Xr = pd.concat([X] * 4, ignore_index=True); yr = np.repeat(np.arange(4), n); wr = Psoft.T.reshape(-1)
    keep = wr > 1e-3
    m = lgb.LGBMClassifier(**dict(BASE, **MC_PARAMS["mc_mid"], random_state=seed))
    m.fit(Xr[keep], yr[keep], sample_weight=wr[keep], eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
    return m


def candidates(setup: Setup, d, sbp, dbp, y, tr, va, te, seed: int, prefix_dummies: pd.DataFrame) -> dict:
    Xs = setup.Xs; out = {}
    base = fit_mc(Xs.iloc[tr], y[tr], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed); out["baseline_mc_mid"] = base.predict_proba(Xs.iloc[te])
    for sg in (3.0, 5.0, 8.0):
        Ps = soft_labels(sbp[tr], dbp[tr], sg, seed=seed)
        out[f"soft_label_{sg:g}"] = fit_soft(Xs.iloc[tr], Ps, Xs.iloc[va], y[va], seed).predict_proba(Xs.iloc[te])
    # jitter: 연속 입력(표준화 척도)에 N(0, 0.1) 잡음을 더한 복제 1배 추가
    rng = np.random.default_rng(seed)
    cont = [c for c in Xs.columns if not set(np.unique(Xs[c].iloc[tr])) <= {0.0, 1.0}]
    Xj = Xs.iloc[tr].copy(); Xj[cont] = Xj[cont] + rng.normal(0, 0.1, Xj[cont].shape)
    m = fit_mc(pd.concat([Xs.iloc[tr], Xj], ignore_index=True), np.concatenate([y[tr], y[tr]]), Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed); out["jitter"] = m.predict_proba(Xs.iloc[te])
    for name, extra in (("dart", dict(boosting_type="dart", n_estimators=600, learning_rate=0.05, drop_rate=0.1)), ("extra_trees", dict(extra_trees=True))):
        p = dict(BASE, **MC_PARAMS["mc_mid"], **extra, random_state=seed)
        m = lgb.LGBMClassifier(**p)
        if name == "dart":
            m.fit(Xs.iloc[tr], y[tr])
        else:
            m.fit(Xs.iloc[tr], y[tr], eval_set=[(Xs.iloc[va], y[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
        out[name] = m.predict_proba(Xs.iloc[te])
    # hier: normal vs rest, then 3단계
    yb = (y > 0).astype(int)
    m1 = lgb.LGBMClassifier(**dict(BASE, **MC_PARAMS["mc_mid"], objective="binary", random_state=seed)); m1.set_params(num_class=None)
    m1 = lgb.LGBMClassifier(objective="binary", learning_rate=0.03, n_estimators=4000, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1, random_state=seed)
    m1.fit(Xs.iloc[tr], yb[tr], eval_set=[(Xs.iloc[va], yb[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
    rest_tr, rest_va = tr[y[tr] > 0], va[y[va] > 0]
    m2 = lgb.LGBMClassifier(**dict(BASE, **MC_PARAMS["mc_mid"], num_class=3, random_state=seed))
    m2.fit(Xs.iloc[rest_tr], y[rest_tr] - 1, eval_set=[(Xs.iloc[rest_va], y[rest_va] - 1)], callbacks=[lgb.early_stopping(100, verbose=False)])
    p_rest = m1.predict_proba(Xs.iloc[te])[:, 1]; P3 = m2.predict_proba(Xs.iloc[te])
    out["hier"] = np.column_stack([1 - p_rest, p_rest[:, None] * P3])
    # learning curve
    for frac in (0.25, 0.5, 0.75):
        sub = np.sort(rng.choice(tr, int(len(tr) * frac), replace=False))
        out[f"train_{int(frac*100)}%"] = fit_mc(Xs.iloc[sub], y[sub], Xs.iloc[va], y[va], MC_PARAMS["mc_mid"], seed).predict_proba(Xs.iloc[te])
    # id_prefix (진단)
    Xp = pd.concat([Xs, prefix_dummies], axis=1)
    out["id_prefix(진단)"] = fit_mc(Xp.iloc[tr], y[tr], Xp.iloc[va], y[va], MC_PARAMS["mc_mid"], seed).predict_proba(Xp.iloc[te])
    return out


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    rep = Path(a.out) / f"boost3_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d) == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y = stage_from_bp(sbp, dbp)
    prefix = d["person_id"].astype(str).str[0]
    log(f"person_id 접두 문자 분포: {prefix.value_counts().to_dict()}")
    pdum = pd.get_dummies(prefix, prefix="idp").astype(float)
    rows = []
    kf = KFold(a.folds, shuffle=True, random_state=a.seed)
    for f, (trva, te) in enumerate(kf.split(d), 1):
        prm = np.random.default_rng(a.seed + f).permutation(trva); n_va = int(len(trva) * 0.15); va, tr = np.sort(prm[:n_va]), np.sort(prm[n_va:])
        st = Setup(d, tr, sbp)
        out = candidates(st, d, sbp, dbp, y, tr, va, te, a.seed, pdum)
        for name, P in out.items():
            rows.append({"fold": f, "candidate": name, "acc": float((P.argmax(1) == y[te]).mean()), "auroc_140": auroc((y[te] == 3).astype(int), P[:, 3]), "auroc_130": auroc((y[te] >= 2).astype(int), P[:, 2] + P[:, 3])})
        log(f"fold {f}: " + ", ".join(f"{r['candidate']} {r['acc']:.4f}" for r in rows if r["fold"] == f))
    res = pd.DataFrame(rows)
    summ = res.groupby("candidate")[["acc", "auroc_140", "auroc_130"]].agg(["mean", "std"]).reset_index(); summ.columns = ["candidate"] + [f"{m}_{s}" for m, s in summ.columns[1:]]
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
    L = [f"# 정답률 3차 탐색 — {rep.name}\n", f"- {len(d)}행, {a.folds}겹 CV, 기준 mc_mid. soft_label_σ: 측정 오차 σ(sbp)·0.6σ(dbp) 가정 소프트 라벨; jitter: 표준화 척도 N(0,0.1) 잡음 복제; hier: normal/나머지 → 3단계; train_x%: 학습 행 일부만; id_prefix: 진단용\n",
         "## 교차검증 평균 ± sd\n", md_table(summ, nd=4), "\n## 기준 대비 짝지은 차이\n", md_table(diff, nd=4), "\n## 접힘별\n", md_table(res, nd=4)]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for n_, df in (("요약", summ), ("기준대비", diff), ("접힘별", res)):
            df.to_excel(w, sheet_name=n_, index=False); style(w.book[n_], nd=4, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

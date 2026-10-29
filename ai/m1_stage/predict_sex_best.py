"""
[파일] predict_sex_best.py
[용도] 성별 역체인 검증(validate_sex_chain.py, reports/validate_20261029_2230)에서 수치가 가장 높았던 후보로 테스트 파일 3단계를 낸다.
      남성 = CatBoost 역체인(전 열 → dbp, 전 열 + dbp → sbp; 점추정 단계), 여성 = LightGBM 역체인 + 분류기 스택(내부 3겹 교차 예측 dbp_hat·sbp_hat 을 입력에 더한 3단계 LightGBM, argmax).
      학습 분할은 train_sex_chain.py 와 같은 무작위 층화 70/15/15(seed 42)라서 기존 lgbm 역체인 예측(reports/sexchain_*)과 같은 행에서 비교할 수 있다. 내부 테스트 15% 지표와 기존 예측과의 일치율도 적는다.
[쓰는 곳] python3 predict_sex_best.py --data train/ --test-data test/ [--prev reports/sexchain_20261029_215324/test_predictions.csv]
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import KFold

import thresholds as T
from analysis_pack import style
from m1.chain import ChainPreprocessor, load_frame, residual_pools, sample_residuals, stage3_from_bp
from m1.continuous import dispersion_groups
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table
from m1.splits import make_splits
from train_sex_chain import EXCLUDE, MC_PARAMS, build
import validate_sex_chain as V
from validate_sex_chain import LEARNERS, rmse


USE_DBP = False


class Chain:
    """역체인: fd(전 열) → dbp, fs(전 열 + dbp) → sbp. 분포 경로는 검증 잔차(나이대 풀) 부트스트랩."""

    def __init__(self, mk, seed: int):
        self.mk, self.seed = mk, seed

    def fit(self, X, fd, fs, sbp, dbp, groups, tr, va):
        self.fd, self.fs = fd, fs; Xd = fd.transform(X)
        self.m_d = self.mk(self.seed).fit(Xd.iloc[tr], dbp[tr], Xd.iloc[va], dbp[va])
        Xs_va = fs.transform(X.iloc[va], dbp[va]); self.m_s = self.mk(self.seed).fit(fs.transform(X.iloc[tr], dbp[tr]), sbp[tr], Xs_va, sbp[va])
        self.pools_d = residual_pools(dbp[va] - self.m_d.predict(Xd.iloc[va]), groups[va]); self.pools_s = residual_pools(sbp[va] - self.m_s.predict(Xs_va), groups[va])
        return self

    def point(self, Xn):
        d = self.m_d.predict(self.fd.transform(Xn)); return d, self.m_s.predict(self.fs.transform(Xn, d))

    def dist(self, Xn, groups_n, K: int = 100):
        d, _ = self.point(Xn); rng = np.random.default_rng(self.seed)
        Ed, Es = sample_residuals(self.pools_d, groups_n, K, rng), sample_residuals(self.pools_s, groups_n, K, rng); counts = np.zeros((len(Xn), 3))
        for k in range(K):
            d_k = d + Ed[:, k]; counts[np.arange(len(Xn)), stage3_from_bp(self.m_s.predict(self.fs.transform(Xn, d_k)) + Es[:, k], d_k, USE_DBP)] += 1
        return counts / K


def SX(Xd_part: pd.DataFrame, d: np.ndarray, s: np.ndarray) -> pd.DataFrame:
    return Xd_part.assign(dbp_hat=d, sbp_hat=s, pp=s - d)


def fit_stack(X, fd, fs, sbp, dbp, y3, groups, tr, va, seed: int):
    base = Chain(LEARNERS["lgbm"], seed).fit(X, fd, fs, sbp, dbp, groups, tr, va)
    d_oof, s_oof = np.zeros(len(tr)), np.zeros(len(tr))
    for a, b in KFold(3, shuffle=True, random_state=seed).split(tr):
        ia = tr[a]; p = np.random.default_rng(seed).permutation(ia); n_va = int(len(ia) * 0.15)
        c = Chain(LEARNERS["lgbm"], seed).fit(X, fd, fs, sbp, dbp, groups, np.sort(p[n_va:]), np.sort(p[:n_va])); d_oof[b], s_oof[b] = c.point(X.iloc[tr[b]])
    Xd = fd.transform(X); d_va, s_va = base.point(X.iloc[va])
    mc = lgb.LGBMClassifier(**dict(MC_PARAMS, random_state=seed))
    mc.fit(SX(Xd.iloc[tr], d_oof, s_oof), y3[tr], eval_set=[(SX(Xd.iloc[va], d_va, s_va), y3[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
    return base, mc


def stack_predict(base: Chain, mc, Xn):
    d, s = base.point(Xn); return d, s, mc.predict_proba(SX(base.fd.transform(Xn), d, s))


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="train/"); ap.add_argument("--test-data", default="test/"); ap.add_argument("--seed", type=int, default=42); ap.add_argument("--samples", type=int, default=100)
    ap.add_argument("--out", default="reports"); ap.add_argument("--prev", default=None, help="비교할 기존 예측 csv(person_id, stage3_point, stage3_dist)"); ap.add_argument("--label", default="sbp", choices=["sbp", "dbp_rule"])
    a = ap.parse_args(argv)
    global USE_DBP; USE_DBP = a.label == "dbp_rule"; V.USE_DBP = USE_DBP
    rep = Path(a.out) / f"sexbest_{a.label}_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d0 = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d0) == "").to_numpy() & d0[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d0 = d0[keep].reset_index(drop=True)
    dft, _ = load_frame(a.test_data); dt = ChainPreprocessor.coerce(dft)
    out = pd.DataFrame({"person_id": dt["person_id"].astype(str).to_numpy(), "sex": dt["sex"].astype(str).to_numpy(), "model": ""})
    for col in ("sbp_pred", "dbp_pred"): out[col] = np.nan
    for col in ("stage3", "stage3_alt", "note"): out[col] = ""
    metrics, S3 = [], np.asarray(T.STAGE3)
    for sex in ("male", "female"):
        d = d0[d0["sex"] == sex].reset_index(drop=True); sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y3 = stage3_from_bp(sbp, dbp, USE_DBP)
        splits, _ = make_splits(y3, None, seed=a.seed); tr, va, te = splits["train"], splits["val"], splits["test"]
        pre, X, fd, fs, _, _, groups, _, _ = build(d, tr, EXCLUDE[sex])
        if sex == "male":
            model_name = "catboost_reverse_chain(점추정)"; ch = Chain(LEARNERS["catboost"], a.seed).fit(X, fd, fs, sbp, dbp, groups, tr, va)
            d_te, s_te = ch.point(X.iloc[te]); P_te = ch.dist(X.iloc[te], groups[te], a.samples); pred_te, alt_te = stage3_from_bp(s_te, d_te, USE_DBP), P_te.argmax(1)
            predict = lambda Xn, gn: (lambda d_, s_, P_: (d_, s_, stage3_from_bp(s_, d_, USE_DBP), P_.argmax(1)))(*ch.point(Xn), ch.dist(Xn, gn, a.samples))
        else:
            model_name = "lgbm_reverse_chain+stack_classifier(argmax)"; base, mc = fit_stack(X, fd, fs, sbp, dbp, y3, groups, tr, va, a.seed)
            d_te, s_te, P_te = stack_predict(base, mc, X.iloc[te]); pred_te, alt_te = P_te.argmax(1), stage3_from_bp(s_te, d_te, USE_DBP)
            predict = lambda Xn, gn: (lambda d_, s_, P_: (d_, s_, P_.argmax(1), stage3_from_bp(s_, d_, USE_DBP)))(*stack_predict(base, mc, Xn))
        m = {"sex": sex, "model": model_name, "n_train": int(len(tr)), "n_test": int(len(te)), "baseline_all_normal": float((y3[te] == 0).mean()), "accuracy": float((pred_te == y3[te]).mean()),
             "accuracy_alt": float((alt_te == y3[te]).mean()), "auroc_ge140": auroc((y3[te] == 2).astype(int), P_te[:, 2]), "recall_htn": float(((pred_te == 2) & (y3[te] == 2)).sum() / max((y3[te] == 2).sum(), 1)),
             "sbp_rmse": rmse(sbp[te], s_te), "dbp_rmse": rmse(dbp[te], d_te)}
        metrics.append(m); log(f"[{sex}] {model_name}: 내부 테스트 {len(te)}행 정확도 {m['accuracy']:.3f} (대안 {m['accuracy_alt']:.3f}, 기준선 {m['baseline_all_normal']:.3f}), AUROC≥140 {m['auroc_ge140']:.3f}, sbp RMSE {m['sbp_rmse']:.2f}")
        msk = (dt["sex"] == sex).to_numpy()
        if not msk.any(): continue
        Xt, keep_t, dts = pre.transform(dt[msk]); idx_all = np.where(msk)[0]; idx_ok = idx_all[keep_t]
        out.loc[idx_all, "model"] = model_name; out.loc[idx_all[~keep_t], "note"] = "예측 불가: " + dts.loc[~keep_t, "__reason"].astype(str).to_numpy()
        if keep_t.any():
            d_hat, s_hat, pr, alt = predict(Xt, dispersion_groups(Xt))
            out.loc[idx_ok, "sbp_pred"], out.loc[idx_ok, "dbp_pred"] = np.round(s_hat, 1), np.round(d_hat, 1); out.loc[idx_ok, "stage3"], out.loc[idx_ok, "stage3_alt"] = S3[pr], S3[alt]
    unknown = ~dt["sex"].isin(["male", "female"]).to_numpy(); out.loc[unknown, "note"] = "예측 불가: sex_missing"
    agree = None
    if a.prev and Path(a.prev).exists():
        prev = pd.read_csv(a.prev, dtype={"person_id": str})[["person_id", "stage3_point", "stage3_dist"]]
        j = out[out["stage3"] != ""].merge(prev, on="person_id", how="inner")
        agree = j.groupby("sex").apply(lambda g: pd.Series({"n": len(g), "일치율_vs_lgbm점추정": float((g["stage3"] == g["stage3_point"]).mean()), "일치율_vs_lgbm분포": float((g["stage3"] == g["stage3_dist"]).mean())})).reset_index()
    with pd.ExcelWriter(rep / "test_predictions.xlsx", engine="openpyxl") as w:
        out.to_excel(w, sheet_name="pred", index=False); style(w.book["pred"], nd=1, freeze="B2")
        out[["person_id", "stage3", "note"]].to_excel(w, sheet_name="stage_only", index=False); style(w.book["stage_only"], nd=1, freeze="B2")
    out.to_csv(rep / "test_predictions.csv", index=False)
    mdf = pd.DataFrame(metrics); n_pred = int((out["stage3"] != "").sum())
    L = [f"# 성별 최고 후보 테스트 파일 예측 — {rep.name}\n", "- 남성: CatBoost 역체인(점추정 단계; stage3_alt = 분포 argmax). 여성: LightGBM 역체인 + 분류기 스택(argmax; stage3_alt = 체인 점추정).",
         f"- 학습 분할: 무작위 층화 70/15/15(seed {a.seed}), train_sex_chain.py 와 동일. 3단계 라벨: " + (f"sbp {T.STAGE3_SBP_CUTS} 또는 dbp {T.STAGE3_DBP_CUTS}" if USE_DBP else f"sbp {T.STAGE3_SBP_CUTS} 만") + ".",
         f"- 테스트 파일 {len(out)}행 중 {n_pred}행 예측, 단계 비율 {out.loc[out['stage3'] != '', 'stage3'].value_counts(normalize=True).round(3).to_dict()}\n", "## 내부 테스트 15% 지표\n", md_table(mdf, nd=3)]
    if agree is not None: L += ["\n## 기존 lgbm 역체인 예측과의 일치율 (같은 행)\n", md_table(agree, nd=3)]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    log(f"완료: {rep}/test_predictions.xlsx ({n_pred}행 예측)")
    return rep


if __name__ == "__main__":
    main()

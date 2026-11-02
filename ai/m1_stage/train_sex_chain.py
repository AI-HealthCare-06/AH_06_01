"""
[파일] train_sex_chain.py
[용도] 멘토링 반영(2026-10-29). ① 3단계 라벨(sbp <122 / 122~139 / ≥140; elevated+prehtn 합침, thresholds.STAGE3_*), ② 역체인(전 열 → dbp, 전 열 + dbp → sbp;
      학습은 실제 dbp, 추론은 예측 dbp), ③ 성별 분리 모델, ④ 여성 모델은 음주 변수 제외·남성은 포함, ⑤ 시간 순 대신 무작위 층화 분할(70/15/15)과 5겹 CV,
      학습 행 지표와 테스트 지표의 차이로 과학습 점검. 비교용으로 통합(pooled) 역체인과 성별 3단계 직접 분류(LightGBM)도 같이 평가하고, 테스트 파일 단계를 낸다.
[쓰는 곳] python3 train_sex_chain.py --data train/ --test-data test/ [--label sbp|dbp_rule]
"""

from __future__ import annotations

import argparse
import json
import pickle
import platform
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

import thresholds as T
from analysis_pack import style
from m1.chain import DEFAULT_EXCLUDE, ChainFeatures, ChainPreprocessor, MeanRegressor, load_frame, residual_pools, sample_residuals, stage3_from_bp
from m1.continuous import dispersion_groups
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table
from m1.splits import make_splits

ALCOHOL_COLS = ("alcohol_week", "alcohol_15plus", "alcohol_per_day", "binge")
EXCLUDE = {"male": tuple(DEFAULT_EXCLUDE), "female": tuple(DEFAULT_EXCLUDE) + ALCOHOL_COLS, "pooled": tuple(DEFAULT_EXCLUDE)}
USE_DBP = False   # --label dbp_rule 이면 True: 3단계를 sbp 122/140 "또는" dbp 80/90 으로(사용자 채점 규칙 2026-10-29). False 면 sbp 만.
MC_PARAMS = dict(objective="multiclass", num_class=3, learning_rate=0.03, n_estimators=4000, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1)


class ReverseChain:
    """전 열 → dbp, 전 열 + dbp → sbp. 분포 경로는 검증 잔차(나이대×성별 풀) 부트스트랩."""

    def __init__(self, learner: str, seed: int = 42):
        self.learner, self.seed = learner, seed
        self.m_dbp, self.m_sbp = MeanRegressor(learner, seed), MeanRegressor(learner, seed)
        self.pools_d: dict = {}; self.pools_s: dict = {}

    def fit(self, Xd, dbp, Xs, sbp, Xd_v, dbp_v, Xs_v, sbp_v, groups_v):
        self.m_dbp.fit(Xd, dbp, Xd_v, dbp_v); self.m_sbp.fit(Xs, sbp, Xs_v, sbp_v)
        self.pools_d = residual_pools(dbp_v - self.m_dbp.predict(Xd_v), groups_v)
        self.pools_s = residual_pools(sbp_v - self.m_sbp.predict(Xs_v), groups_v)
        return self

    def predict_point(self, Xd, X, feat_s):
        d_hat = self.m_dbp.predict(Xd); s_hat = self.m_sbp.predict(feat_s.transform(X, d_hat))
        return d_hat, s_hat

    def predict_dist(self, Xd, X, feat_s, groups, K=100, use_dbp=False):
        rng = np.random.default_rng(self.seed)
        d_hat = self.m_dbp.predict(Xd)
        Ed, Es = sample_residuals(self.pools_d, groups, K, rng), sample_residuals(self.pools_s, groups, K, rng)
        counts = np.zeros((len(X), 3))
        for k in range(K):
            d_k = d_hat + Ed[:, k]; s_k = self.m_sbp.predict(feat_s.transform(X, d_k)) + Es[:, k]
            counts[np.arange(len(X)), stage3_from_bp(s_k, d_k, use_dbp)] += 1
        return counts / K


def reg(y, yhat):
    e = y - yhat
    return {"rmse": float(np.sqrt((e ** 2).mean())), "r2": float(1 - (e ** 2).sum() / ((y - y.mean()) ** 2).sum())}


def stage_metrics(y, pred, P=None):
    out = {"accuracy": float((pred == y).mean()), **{f"recall_{s}": float(((pred == k) & (y == k)).sum() / max((y == k).sum(), 1)) for k, s in enumerate(T.STAGE3)}}
    if P is not None:
        out["auroc_ge140"] = auroc((y == 2).astype(int), P[:, 2]); out["auroc_ge122"] = auroc((y >= 1).astype(int), P[:, 1] + P[:, 2])
    return out


def build(d: pd.DataFrame, tr: np.ndarray, exclude: tuple):
    pre = ChainPreprocessor(exclude=exclude).fit(d.iloc[tr]); X, _, _ = pre.transform(d)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float)
    fd = ChainFeatures(False, center="reference").fit(X.iloc[tr])                              # dbp 모델 입력
    fs = ChainFeatures(True, center="reference", extra_name="dbp").fit(X.iloc[tr], dbp[tr])     # sbp 모델 입력(+dbp)
    return pre, X, fd, fs, fd.transform(X), fs.transform(X, dbp), dispersion_groups(X), sbp, dbp


def evaluate_block(sex: str, learner: str, d, tr, va, te, exclude, K, seed, y3, y3_alt):
    pre, X, fd, fs, Xd, Xs, groups, sbp, dbp = build(d, tr, exclude)
    m = ReverseChain(learner, seed).fit(Xd.iloc[tr], dbp[tr], Xs.iloc[tr], sbp[tr], Xd.iloc[va], dbp[va], Xs.iloc[va], sbp[va], groups[va])
    rows = {}
    for split, idx in (("train", tr), ("test", te)):
        d_hat, s_hat = m.predict_point(Xd.iloc[idx], X.iloc[idx], fs)
        s_hat_actual = m.m_sbp.predict(Xs.iloc[idx])
        P = m.predict_dist(Xd.iloc[idx], X.iloc[idx], fs, groups[idx], K=K, use_dbp=USE_DBP)
        r = {"dbp_rmse": reg(dbp[idx], d_hat)["rmse"], "dbp_r2": reg(dbp[idx], d_hat)["r2"], "sbp_rmse": reg(sbp[idx], s_hat)["rmse"], "sbp_r2": reg(sbp[idx], s_hat)["r2"],
             "sbp_rmse_actual_dbp": reg(sbp[idx], s_hat_actual)["rmse"], "point_acc": float((stage3_from_bp(s_hat, d_hat, USE_DBP) == y3[idx]).mean()),
             "point_acc_alt_rule": float((stage3_from_bp(s_hat, d_hat, not USE_DBP) == y3_alt[idx]).mean()), **{f"dist_{k}": v for k, v in stage_metrics(y3[idx], P.argmax(1), P).items()},
             "baseline_all_normal": float((y3[idx] == 0).mean()), "n": int(len(idx))}
        rows[split] = r
    return m, pre, fd, fs, rows


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--test-data", default=None)
    ap.add_argument("--seed", type=int, default=42); ap.add_argument("--samples", type=int, default=100); ap.add_argument("--cv-folds", type=int, default=5)
    ap.add_argument("--out", default="reports"); ap.add_argument("--artifacts", default="artifacts"); ap.add_argument("--label", default="sbp", choices=["sbp", "dbp_rule"])
    a = ap.parse_args(argv)
    global USE_DBP; USE_DBP = a.label == "dbp_rule"
    run_ts = f"{datetime.now():%Y%m%d_%H%M%S}"; rep = Path(a.out) / f"sexchain_{a.label}_{run_ts}"; rep.mkdir(parents=True, exist_ok=True)
    raw, files = load_frame(a.data); d0 = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d0) == "").to_numpy() & d0[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d0 = d0[keep].reset_index(drop=True)
    sbp0, dbp0 = d0["sbp"].to_numpy(float), d0["dbp"].to_numpy(float)
    y3_all, y3_alt_all = stage3_from_bp(sbp0, dbp0, USE_DBP), stage3_from_bp(sbp0, dbp0, not USE_DBP)
    rule_txt = f"sbp {T.STAGE3_SBP_CUTS} 또는 dbp {T.STAGE3_DBP_CUTS}" if USE_DBP else f"sbp {T.STAGE3_SBP_CUTS} 만"
    log(f"[1/4] 사용 {len(d0)}행. 3단계 라벨({rule_txt}) 분포 {dict(zip(T.STAGE3, np.bincount(y3_all, minlength=3).tolist()))}; 반대 규칙 {dict(zip(T.STAGE3, np.bincount(y3_alt_all, minlength=3).tolist()))}")

    results, models, splits_by_sex = [], {}, {}
    for sex in ("male", "female"):
        d = d0[d0["sex"] == sex].reset_index(drop=True)
        sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y3, y3_alt = stage3_from_bp(sbp, dbp, USE_DBP), stage3_from_bp(sbp, dbp, not USE_DBP)
        splits, _ = make_splits(y3, None, seed=a.seed)   # 무작위 층화 70/15/15
        tr, va, te = splits["train"], splits["val"], splits["test"]; splits_by_sex[sex] = (d, tr, va, te, y3, y3_alt)
        for learner in ("linear", "lgbm"):
            m, pre, fd, fs, rows = evaluate_block(sex, learner, d, tr, va, te, EXCLUDE[sex], a.samples, a.seed, y3, y3_alt)
            models[(sex, learner)] = (m, pre, fd, fs)
            for split, r in rows.items():
                results.append({"model": f"{sex}_{learner}", "sex": sex, "learner": learner, "split": split, **r})
            t = rows["test"]; g = rows["train"]
            log(f"[2/4] {sex} {learner}: n={len(d)} (train {len(tr)}/val {len(va)}/test {len(te)}) | dbp RMSE {t['dbp_rmse']:.2f} R² {t['dbp_r2']:.3f} | sbp RMSE {t['sbp_rmse']:.2f} R² {t['sbp_r2']:.3f} "
                f"| 3단계 정확도 점추정 {t['point_acc']:.3f} / 분포 {t['dist_accuracy']:.3f} (기준선 {t['baseline_all_normal']:.3f}) | AUROC≥140 {t['dist_auroc_ge140']:.3f} | 과학습 점검 train−test: sbp RMSE {g['sbp_rmse']-t['sbp_rmse']:+.2f}, 정확도 {g['dist_accuracy']-t['dist_accuracy']:+.3f}")
        # 참고: 성별 3단계 직접 분류(LightGBM)
        pre, X, fd, fs, Xd, Xs, groups, _, _ = build(d, tr, EXCLUDE[sex])
        mc = lgb.LGBMClassifier(**dict(MC_PARAMS, random_state=a.seed)); mc.fit(Xd.iloc[tr], y3[tr], eval_set=[(Xd.iloc[va], y3[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
        for split, idx in (("train", tr), ("test", te)):
            P = mc.predict_proba(Xd.iloc[idx])
            results.append({"model": f"{sex}_direct_mc", "sex": sex, "learner": "lgbm_multiclass", "split": split, **{f"dist_{k}": v for k, v in stage_metrics(y3[idx], P.argmax(1), P).items()}, "baseline_all_normal": float((y3[idx] == 0).mean()), "n": int(len(idx))})
        models[(sex, "direct_mc")] = (mc, pre, fd, fs)
        t = [r for r in results if r["model"] == f"{sex}_direct_mc" and r["split"] == "test"][0]
        log(f"       {sex} 직접 3단계 분류(참고): 정확도 {t['dist_accuracy']:.3f}, AUROC≥140 {t['dist_auroc_ge140']:.3f}")

    # 모델 저장(성별 lgbm 역체인 + 전처리 + 추가 데이터; 학습 파일 이름은 기록하지 않는다)
    art = Path(a.artifacts) / f"sexchain_{a.label}_{run_ts}"; art.mkdir(parents=True, exist_ok=True)
    bundle = {"model_version": f"M1-X-{run_ts}", "label": a.label, "use_dbp": USE_DBP, "stage3": list(T.STAGE3), "sbp_cuts": [float(c) for c in T.STAGE3_SBP_CUTS], "dbp_cuts": [float(c) for c in T.STAGE3_DBP_CUTS],
              "exclude": {k: list(v) for k, v in EXCLUDE.items()}, "seed": a.seed, "samples": a.samples,
              "models": {sex: {"chain": models[(sex, "lgbm")][0], "pre": models[(sex, "lgbm")][1], "fd": models[(sex, "lgbm")][2], "fs": models[(sex, "lgbm")][3]} for sex in ("male", "female")}}
    with open(art / "model.pkl", "wb") as fh:
        pickle.dump(bundle, fh)
    meta = {"model_version": bundle["model_version"], "label": a.label, "use_dbp": USE_DBP, "stage3": bundle["stage3"], "sbp_cuts": bundle["sbp_cuts"], "dbp_cuts": bundle["dbp_cuts"], "train_file_count": len(files),
            "rows_loaded": int(len(raw)), "rows_used": int(len(d0)), "label_counts": dict(zip(T.STAGE3, np.bincount(y3_all, minlength=3).tolist())), "exclude": bundle["exclude"], "python": platform.python_version(),
            "per_sex": {sex: {"n": int(len(splits_by_sex[sex][0])), "train": int(len(splits_by_sex[sex][1])), "val": int(len(splits_by_sex[sex][2])), "test": int(len(splits_by_sex[sex][3])),
                             "lgbm_test": {k: (None if (isinstance(v, float) and np.isnan(v)) else v) for k, v in [r for r in results if r["model"] == f"{sex}_lgbm" and r["split"] == "test"][0].items() if k not in ("model", "sex", "learner", "split")},
                             "best_iteration": {"dbp": models[(sex, "lgbm")][0].m_dbp.info.get("best_iteration"), "sbp": models[(sex, "lgbm")][0].m_sbp.info.get("best_iteration")}} for sex in ("male", "female")}}
    (art / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"       모델 저장: {art}/model.pkl, meta.json")

    # 통합 모델(남녀 합침, 음주 포함) → 각 성별 테스트 행에서 평가
    d_m, tr_m, va_m, te_m, y3_m, y3_alt_m = splits_by_sex["male"]; d_f, tr_f, va_f, te_f, y3_f, y3_alt_f = splits_by_sex["female"]
    dp = pd.concat([d_m, d_f], ignore_index=True); off = len(d_m)
    trp, vap = np.concatenate([tr_m, tr_f + off]), np.concatenate([va_m, va_f + off])
    sbp_p, dbp_p = dp["sbp"].to_numpy(float), dp["dbp"].to_numpy(float); y3_p = stage3_from_bp(sbp_p, dbp_p, USE_DBP)
    pre, X, fd, fs, Xd, Xs, groups, _, _ = build(dp, trp, EXCLUDE["pooled"])
    for learner in ("linear", "lgbm"):
        m = ReverseChain(learner, a.seed).fit(Xd.iloc[trp], dbp_p[trp], Xs.iloc[trp], sbp_p[trp], Xd.iloc[vap], dbp_p[vap], Xs.iloc[vap], sbp_p[vap], groups[vap])
        for sex, te in (("male", te_m), ("female", te_f + off)):
            d_hat, s_hat = m.predict_point(Xd.iloc[te], X.iloc[te], fs); P = m.predict_dist(Xd.iloc[te], X.iloc[te], fs, groups[te], K=a.samples, use_dbp=USE_DBP)
            results.append({"model": f"pooled_{learner}", "sex": sex, "learner": learner, "split": "test", "dbp_rmse": reg(dbp_p[te], d_hat)["rmse"], "sbp_rmse": reg(sbp_p[te], s_hat)["rmse"], "sbp_r2": reg(sbp_p[te], s_hat)["r2"],
                            "point_acc": float((stage3_from_bp(s_hat, d_hat, USE_DBP) == y3_p[te]).mean()), **{f"dist_{k}": v for k, v in stage_metrics(y3_p[te], P.argmax(1), P).items()}, "baseline_all_normal": float((y3_p[te] == 0).mean()), "n": int(len(te))})
    log("[3/4] 통합 모델(남녀 합침) 비교 완료")

    # 5겹 CV (성별 역체인 lgbm·linear, 직접 분류): 분포 경로 정확도·AUROC
    cv_rows = []
    for sex in ("male", "female"):
        d = splits_by_sex[sex][0]; sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y3, y3_alt = stage3_from_bp(sbp, dbp, USE_DBP), stage3_from_bp(sbp, dbp, not USE_DBP)
        for f, (trva, te) in enumerate(StratifiedKFold(a.cv_folds, shuffle=True, random_state=a.seed).split(d, y3), 1):
            prm = np.random.default_rng(a.seed + f).permutation(trva); n_va = int(len(trva) * 0.15); va, tr = np.sort(prm[:n_va]), np.sort(prm[n_va:])
            pre, X, fd, fs, Xd, Xs, groups, _, _ = build(d, tr, EXCLUDE[sex])
            for learner in ("linear", "lgbm"):
                m = ReverseChain(learner, a.seed).fit(Xd.iloc[tr], dbp[tr], Xs.iloc[tr], sbp[tr], Xd.iloc[va], dbp[va], Xs.iloc[va], sbp[va], groups[va])
                d_hat, s_hat = m.predict_point(Xd.iloc[te], X.iloc[te], fs); P = m.predict_dist(Xd.iloc[te], X.iloc[te], fs, groups[te], K=max(30, a.samples // 2), use_dbp=USE_DBP)
                cv_rows.append({"fold": f, "sex": sex, "model": f"{sex}_{learner}", "point_acc": float((stage3_from_bp(s_hat, d_hat, USE_DBP) == y3[te]).mean()), "dist_acc": float((P.argmax(1) == y3[te]).mean()), "auroc_ge140": auroc((y3[te] == 2).astype(int), P[:, 2]), "sbp_rmse": reg(sbp[te], s_hat)["rmse"]})
            mc = lgb.LGBMClassifier(**dict(MC_PARAMS, random_state=a.seed)); mc.fit(Xd.iloc[tr], y3[tr], eval_set=[(Xd.iloc[va], y3[va])], callbacks=[lgb.early_stopping(100, verbose=False)]); P = mc.predict_proba(Xd.iloc[te])
            cv_rows.append({"fold": f, "sex": sex, "model": f"{sex}_direct_mc", "point_acc": np.nan, "dist_acc": float((P.argmax(1) == y3[te]).mean()), "auroc_ge140": auroc((y3[te] == 2).astype(int), P[:, 2]), "sbp_rmse": np.nan})
        log(f"       CV {sex} 완료")
    cv = pd.DataFrame(cv_rows); cv_summ = cv.groupby("model")[["point_acc", "dist_acc", "auroc_ge140", "sbp_rmse"]].agg(["mean", "std"]).reset_index(); cv_summ.columns = ["model"] + [f"{m_}_{s}" for m_, s in cv_summ.columns[1:]]

    # 테스트 파일: 성별 모델(lgbm 역체인)로 3단계
    test_info = None
    if a.test_data:
        dft, _ = load_frame(a.test_data); dt = ChainPreprocessor.coerce(dft)
        ids = dt["person_id"].astype(str); out = pd.DataFrame({"person_id": ids.to_numpy()}); out["sex"] = dt["sex"].astype(str).to_numpy()
        for col in ("sbp_pred", "dbp_pred"): out[col] = np.nan
        for col in ("stage3_point", "stage3_dist", "stage3_point_alt_rule", "note"): out[col] = ""
        for sex in ("male", "female"):
            msk = (dt["sex"] == sex).to_numpy()
            if not msk.any(): continue
            m, pre, fd, fs = models[(sex, "lgbm")]
            Xt, keep_t, dts = pre.transform(dt[msk]); idx_all = np.where(msk)[0]; idx_ok = idx_all[keep_t]
            out.loc[idx_all[~keep_t], "note"] = "예측 불가: " + dts.loc[~keep_t, "__reason"].astype(str).to_numpy()
            if keep_t.any():
                Xd_t = fd.transform(Xt); d_hat, s_hat = m.predict_point(Xd_t, Xt, fs); P = m.predict_dist(Xd_t, Xt, fs, dispersion_groups(Xt), K=a.samples, use_dbp=USE_DBP)
                out.loc[idx_ok, "sbp_pred"], out.loc[idx_ok, "dbp_pred"] = np.round(s_hat, 1), np.round(d_hat, 1)
                out.loc[idx_ok, "stage3_point"] = np.asarray(T.STAGE3)[stage3_from_bp(s_hat, d_hat, USE_DBP)]; out.loc[idx_ok, "stage3_dist"] = np.asarray(T.STAGE3)[P.argmax(1)]
                out.loc[idx_ok, "stage3_point_alt_rule"] = np.asarray(T.STAGE3)[stage3_from_bp(s_hat, d_hat, not USE_DBP)]
        unknown = ~dt["sex"].isin(["male", "female"]).to_numpy(); out.loc[unknown, "note"] = "예측 불가: sex_missing"
        with pd.ExcelWriter(rep / "test_predictions.xlsx", engine="openpyxl") as w:
            out.to_excel(w, sheet_name="pred", index=False); style(w.book["pred"], nd=1, freeze="B2")
            out[["person_id", "stage3_point", "stage3_dist", "note"]].to_excel(w, sheet_name="stage_only", index=False); style(w.book["stage_only"], nd=1, freeze="B2")
        out.to_csv(rep / "test_predictions.csv", index=False)
        test_info = {"rows": int(len(out)), "predicted": int((out["stage3_point"] != "").sum()), "share_point": out.loc[out["stage3_point"] != "", "stage3_point"].value_counts(normalize=True).round(3).to_dict()}
        log(f"[4/4] 테스트 파일 {test_info['rows']}행 → 예측 {test_info['predicted']}행 → {rep}/test_predictions.xlsx")

    res = pd.DataFrame(results)
    cols = ["model", "sex", "split", "n", "baseline_all_normal", "dbp_rmse", "dbp_r2", "sbp_rmse", "sbp_r2", "sbp_rmse_actual_dbp", "point_acc", "point_acc_alt_rule", "dist_accuracy", "dist_auroc_ge140", "dist_auroc_ge122", "dist_recall_normal", "dist_recall_elevated_prehtn", "dist_recall_htn"]
    res = res[[c for c in cols if c in res.columns]]
    L = [f"# 성별 분리 역체인(dbp→sbp) 3단계 — {rep.name}\n", f"- 모델 저장: {art} (model.pkl: 성별 lgbm 역체인 + 전처리 + 추가 데이터, meta.json). 추론: python3 predict_sex_chain.py --model {art} --data <파일>",
         f"- 3단계 라벨: {rule_txt} (normal / elevated_prehtn / htn). 분포 {dict(zip(T.STAGE3, np.bincount(y3_all, minlength=3).tolist()))}. point_acc_alt_rule·stage3_point_alt_rule 은 반대 규칙(비교용)",
         "- 역체인: 전 열 → dbp, 전 열 + dbp(학습 실제·추론 예측) → sbp. 분포 경로 = 검증 잔차 부트스트랩. 여성 모델은 음주 4열 제외, 남성은 포함. 분할 = 무작위 층화 70/15/15(시간 순 아님)",
         "- 과학습 점검: train 행과 test 행의 지표 차이(train 이 크게 좋으면 과학습). 조기 종료는 검증 15%\n",
         "## 1. 성별 모델 결과 (train / test)\n", md_table(res, nd=3), f"\n## 2. {a.cv_folds}겹 교차검증 (분포 경로 정확도·AUROC, 점 추정 정확도)\n", md_table(cv_summ, nd=4)]
    if test_info: L += ["\n## 3. 테스트 파일\n", f"- {test_info['rows']}행 중 {test_info['predicted']}행 예측, 점 추정 단계 비율 {test_info['share_point']}", "- 열: sbp_pred, dbp_pred, stage3_point(라벨 규칙), stage3_dist(분포 argmax, 라벨 규칙), stage3_point_alt_rule(반대 규칙), note"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in (("성별모델", res), ("교차검증", cv_summ), ("접힘별", cv)):
            df.to_excel(w, sheet_name=name, index=False); style(w.book[name], nd=3, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

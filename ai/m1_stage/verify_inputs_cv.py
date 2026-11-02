"""
[파일] verify_inputs_cv.py
[용도] 입력 표현(표준화 / 문헌 기준값 중심화 / 정상 범위 힌지 / 힌지만 / 분위수 변환 / 구간화 / 나이대 편차 / 원 척도)이 체인 모델 성능을 바꾸는지
      5겹 교차검증(무작위, 접힘마다 전처리·추가 데이터·모델을 다시 학습)으로 검정한다. 접힘별 짝지은 차이의 평균과 95% 신뢰구간을 내서 잡음보다 큰 차이인지 판정한다.
      변형은 sbp 모델과 dbp 모델 양쪽 입력에 같은 표현을 적용한다.
[왜 필요한가] 사용자 요청(2026-10-26): 분할 하나로 본 결과를 결론 없이 다시 검정. 결과 reports/verify_inputs_<시각>/summary.md, results.xlsx
[쓰는 곳] python3 verify_inputs_cv.py --data train/ [--folds 5] [--samples 50]
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.model_selection import KFold

import thresholds as T
from analysis_pack import style
from m1.chain import ChainPreprocessor, MeanRegressor, load_frame, residual_pools, sample_residuals, stage_from_bp
from m1.continuous import dispersion_groups
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table

CONT = ["age", "bmi", "waist_cm", "alcohol_week", "activity_minutes_week", "fasting_glucose", "resting_hr"]
VARIANTS = ["표준화(기준)", "원척도", "문헌기준값중심화", "원값+힌지", "힌지만", "분위수변환", "구간화", "나이대편차z"]


def ref_ranges(male: np.ndarray) -> dict:
    """문헌·문서 기준 정상 범위 (하한, 상한). 공복혈당 100 은 대한당뇨병학회 공복혈당장애 기준, 심박 60~100 은 일반 정상 범위(참고표 근거 없음)."""
    return {"bmi": (18.5, T.BMI_HIGH), "waist_cm": (None, np.where(male == 1, T.WAIST_HIGH_CM["male"], T.WAIST_HIGH_CM["female"])), "fasting_glucose": (None, 100.0),
            "resting_hr": (60.0, 100.0), "activity_minutes_week": (T.ACTIVITY_LOW_MIN_PER_WEEK, None), "alcohol_week": (None, T.ALCOHOL_DRINKS_PER_DAY_HIGH * 7)}


def hinge(X: pd.DataFrame) -> pd.DataFrame:
    H = pd.DataFrame(index=X.index)
    for c, (lo, hi) in ref_ranges(X["male"].to_numpy()).items():
        v = X[c].to_numpy(float)
        if hi is not None:
            H[f"{c}_over"] = np.maximum(0, v - np.asarray(hi, float))
        if lo is not None:
            H[f"{c}_under"] = np.maximum(0, np.asarray(lo, float) - v)
    return H


def represent(variant: str, X: pd.DataFrame, fit: np.ndarray, groups: np.ndarray) -> pd.DataFrame:
    """변형별 기준 열 표현(상호작용 전). fit = 통계를 낼 행 마스크."""
    Xf = X.astype(float)
    flags = [c for c in X.columns if c not in CONT]
    def std(df):
        out = df.copy()
        for c in CONT:
            mu, sd = out[c][fit].mean(), out[c][fit].std() or 1.0
            out[c] = (out[c] - mu) / sd
        return out
    if variant == "표준화(기준)":
        return std(Xf)
    if variant == "원척도":
        return Xf
    if variant == "문헌기준값중심화":
        out = Xf.copy(); R = ref_ranges(Xf["male"].to_numpy())
        for c in CONT:
            ref = (R[c][1] if R[c][1] is not None else R[c][0]) if c in R else Xf[c][fit].mean()
            out[c] = (Xf[c].to_numpy() - np.asarray(ref, float)) / (Xf[c][fit].std() or 1.0)
        return out
    def std_h(H):
        for c in H.columns:
            mu, sd = H[c][fit].mean(), H[c][fit].std() or 1.0
            H[c] = (H[c] - mu) / sd
        return H
    if variant == "원값+힌지":
        return pd.concat([std(Xf), std_h(hinge(Xf))], axis=1)
    if variant == "힌지만":
        return pd.concat([std(Xf)[["age", "male"]], std_h(hinge(Xf)), Xf[[c for c in flags if c != "male"]]], axis=1)
    if variant == "분위수변환":
        out = Xf.copy()
        for c in CONT:
            ref = np.sort(Xf[c].to_numpy()[fit]); q = (np.searchsorted(ref, Xf[c].to_numpy(), side="right") - 0.5) / len(ref)
            out[c] = norm.ppf(np.clip(q, 1e-4, 1 - 1e-4))
        return out
    if variant == "구간화":
        def bins(col, edges):
            cut = pd.cut(Xf[col].to_numpy(), edges, right=False, labels=False)
            return pd.get_dummies(pd.Series(cut, index=X.index), prefix=col).astype(float)
        parts = [bins("age", [0, 30, 40, 50, 60, 70, 200]), bins("bmi", [-np.inf, 18.5, 23, 25, 30, np.inf]), bins("waist_cm", [-np.inf, 80, 85, 90, 95, np.inf]),
                 bins("fasting_glucose", [-np.inf, 100, 126, np.inf]), bins("resting_hr", [-np.inf, 60, 70, 80, 90, np.inf]), bins("alcohol_week", [-np.inf, 0.001, 7, 15, np.inf]),
                 bins("activity_minutes_week", [-np.inf, 0.001, 150, 300, 600, np.inf]), Xf[flags]]
        out = pd.concat(parts, axis=1)
        out["age"] = std(Xf)["age"]   # 상호작용용 연속 나이
        return out.loc[:, ~out.columns.duplicated()]
    if variant == "나이대편차z":
        out = std(Xf); g = pd.Series(groups, index=X.index)
        for c in CONT[1:]:
            st = Xf[fit].groupby(g[fit].to_numpy())[c].agg(["mean", "std"])
            mu, sd = g.map(st["mean"]).to_numpy(float), g.map(st["std"]).to_numpy(float)
            out[f"{c}_dev"] = (Xf[c].to_numpy() - np.nan_to_num(mu, nan=Xf[c][fit].mean())) / np.where(np.isfinite(sd) & (sd > 0), sd, 1.0)
        return out
    raise ValueError(variant)


def _inter_raw(Z: pd.DataFrame, sbp_z: np.ndarray | None) -> pd.DataFrame:
    base = [c for c in Z.columns if c not in ("age", "male")]
    age, male = Z["age"].to_numpy(float), Z["male"].to_numpy(float)
    out = {"age_x_male": age * male}
    for c in base:
        v = Z[c].to_numpy(float); out[f"age_x_{c}"] = age * v; out[f"male_x_{c}"] = male * v
    if sbp_z is not None:
        out["sbp"] = sbp_z
        for c in list(Z.columns):
            out[f"sbp_x_{c}"] = sbp_z * Z[c].to_numpy(float)
    return pd.DataFrame(out, index=Z.index)


def interact_fit(Z: pd.DataFrame, sbp_z: np.ndarray | None, fit: np.ndarray) -> tuple[pd.DataFrame, dict]:
    """나이×, 성별× (+ sbp, sbp×) 상호작용을 붙이고 학습 행 통계로 표준화. 통계를 돌려줘 추론에서 재사용한다."""
    I = _inter_raw(Z, sbp_z)
    stats = {c: (float(I[c][fit].mean()), float(I[c][fit].std()) or 1.0) for c in I.columns}
    return interact_apply(Z, sbp_z, stats), stats


def interact_apply(Z: pd.DataFrame, sbp_z: np.ndarray | None, stats: dict) -> pd.DataFrame:
    I = _inter_raw(Z, sbp_z)
    for c in I.columns:
        mu, sd = stats[c]; I[c] = (I[c] - mu) / sd
    return pd.concat([Z, I], axis=1)


def evaluate_fold(variant: str, learner: str, X: pd.DataFrame, sbp: np.ndarray, dbp: np.ndarray, y: np.ndarray, tr: np.ndarray, va: np.ndarray, te: np.ndarray, groups: np.ndarray, K: int, seed: int) -> dict:
    fit = np.zeros(len(X), bool); fit[tr] = True
    Z = represent(variant, X, fit, groups)
    Xs, st_s = interact_fit(Z, None, fit)
    mu_s, sd_s = sbp[tr].mean(), sbp[tr].std()
    Xd, st_d = interact_fit(Z, (sbp - mu_s) / sd_s, fit)
    m_s = MeanRegressor(learner, seed).fit(Xs.iloc[tr], sbp[tr], Xs.iloc[va], sbp[va])
    m_d = MeanRegressor(learner, seed).fit(Xd.iloc[tr], dbp[tr], Xd.iloc[va], dbp[va])
    pools_s = residual_pools(sbp[va] - m_s.predict(Xs.iloc[va]), groups[va])
    pools_d = residual_pools(dbp[va] - m_d.predict(Xd.iloc[va]), groups[va])
    s_hat = m_s.predict(Xs.iloc[te])
    Zte = Z.iloc[te]
    def dbp_inputs(s):
        return interact_apply(Zte, (s - mu_s) / sd_s, st_d)[Xd.columns]
    d_hat = m_d.predict(dbp_inputs(s_hat))
    rng = np.random.default_rng(seed)
    Es, Ed = sample_residuals(pools_s, groups[te], K, rng), sample_residuals(pools_d, groups[te], K, rng)
    counts = np.zeros((len(te), 4))
    for k in range(K):
        s_k = s_hat + Es[:, k]; d_k = m_d.predict(dbp_inputs(s_k)) + Ed[:, k]
        counts[np.arange(len(te)), stage_from_bp(s_k, d_k)] += 1
    P = counts / K
    yt = y[te]
    return {"sbp_rmse": float(np.sqrt(((sbp[te] - s_hat) ** 2).mean())), "dbp_rmse": float(np.sqrt(((dbp[te] - d_hat) ** 2).mean())),
            "point_acc": float((stage_from_bp(s_hat, d_hat) == yt).mean()), "auroc_140_90": auroc((yt == 3).astype(int), P[:, 3]),
            "auroc_130_80": auroc((yt >= 2).astype(int), P[:, 2] + P[:, 3]), "argmax_acc": float((P.argmax(1) == yt).mean()), "n_cols_sbp": int(Xs.shape[1])}


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--samples", type=int, default=50)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--learners", default="linear,lgbm")
    ap.add_argument("--variants", default=",".join(VARIANTS))
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    rep = Path(a.out) / f"verify_inputs_{datetime.now():%Y%m%d_%H%M%S}"
    rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data)
    d = ChainPreprocessor.coerce(raw)
    keep = ChainPreprocessor.keep_mask(d) & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
    d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float)
    y = stage_from_bp(sbp, dbp)
    variants = [v.strip() for v in a.variants.split(",") if v.strip()]
    learners = [s.strip() for s in a.learners.split(",") if s.strip()]
    rows = []
    kf = KFold(a.folds, shuffle=True, random_state=a.seed)
    for f, (trva, te) in enumerate(kf.split(d), 1):
        rng = np.random.default_rng(a.seed + f)
        perm = rng.permutation(trva); n_va = int(len(trva) * 0.15)
        va, tr = np.sort(perm[:n_va]), np.sort(perm[n_va:])
        pre = ChainPreprocessor().fit(d.iloc[tr])
        X, _, _ = pre.transform(d)
        groups = dispersion_groups(X)
        for variant in variants:
            for learner in learners:
                r = evaluate_fold(variant, learner, X, sbp, dbp, y, tr, va, te, groups, a.samples, a.seed)
                rows.append({"fold": f, "variant": variant, "learner": learner, **r})
                log(f"fold {f} {variant:10s} {learner:6s} sbp RMSE {r['sbp_rmse']:.3f} dbp RMSE {r['dbp_rmse']:.3f} AUROC140 {r['auroc_140_90']:.3f} argmax {r['argmax_acc']:.3f} 열 {r['n_cols_sbp']}")
    res = pd.DataFrame(rows)
    metrics = ["sbp_rmse", "dbp_rmse", "point_acc", "auroc_140_90", "auroc_130_80", "argmax_acc"]
    summ = res.groupby(["learner", "variant"])[metrics].agg(["mean", "std"]).reset_index()
    summ.columns = ["learner", "variant"] + [f"{m}_{s}" for m, s in summ.columns[2:]]
    # 기준 대비 짝지은 차이(접힘별) 평균 ± 95% CI
    diff_rows = []
    for learner in learners:
        base = res[(res.learner == learner) & (res.variant == variants[0])].set_index("fold")
        for variant in variants[1:]:
            v = res[(res.learner == learner) & (res.variant == variant)].set_index("fold")
            row = {"learner": learner, "variant": variant}
            for m in metrics:
                dlt = (v[m] - base[m]).to_numpy()
                ci = 1.96 * dlt.std(ddof=1) / np.sqrt(len(dlt)) if len(dlt) > 1 else float("nan")
                row[f"Δ{m}"] = dlt.mean(); row[f"Δ{m}_ci95"] = ci
                row[f"{m}_판정"] = "잡음 범위" if abs(dlt.mean()) <= ci else ("개선" if (dlt.mean() < 0) == (m.endswith("rmse")) else "악화")
            diff_rows.append(row)
    diff = pd.DataFrame(diff_rows)
    order = {v: i for i, v in enumerate(variants)}
    summ = summ.sort_values(["learner", "variant"], key=lambda s: s.map(order) if s.name == "variant" else s)
    L = [f"# 입력 표현 검정 — {rep.name}\n", f"- 데이터 {len(d):,}행, {a.folds}겹 무작위 교차검증(접힘마다 전처리·추가 데이터·모델 재학습, 내부 검증 15%로 λ·조기종료·잔차 풀), 분포 표본 {a.samples}개",
         "- Δ = 변형 − 기준(표준화)의 접힘별 짝지은 차이 평균, ci95 = 1.96·표준오차. |Δ| ≤ ci95 이면 '잡음 범위'. RMSE 는 음수가 개선, 나머지는 양수가 개선\n",
         "## 변형별 평균 ± 표준편차\n", md_table(summ, nd=4), "\n## 기준 대비 짝지은 차이\n", md_table(diff, nd=4), "\n## 접힘별 원자료\n", md_table(res, nd=4)]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in (("요약", summ), ("기준대비차이", diff), ("접힘별", res)):
            df.to_excel(w, sheet_name=name, index=False)
        for s in w.book.sheetnames:
            style(w.book[s], nd=4, freeze="C2")
    log(f"완료: {rep}/summary.md, results.xlsx")
    return rep


if __name__ == "__main__":
    main()

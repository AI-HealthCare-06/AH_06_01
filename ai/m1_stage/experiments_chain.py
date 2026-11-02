"""
[파일] experiments_chain.py
[용도] 2026-10-25 에 체인 파이프라인 위에서 시험한 방식들을 테스트 파일(혈압 비움)에 한꺼번에 적용해 방식별 예측 시트를 한 엑셀로 낸다.
      기준은 최신 chain_<run> 산출물(15열, 4열 제외)이며 변형은 sbp 모델만 바꾸고 dbp 모델·분포 경로는 같은 방식으로 재계산한다.
      변형: 기준 linear/lgbm, 나이 외 계수 배수(0.5/1.5/2/3), 나이 제외·나이+성별만, 나이대×성별 편차 z(+극단 플래그, 편차만), 단계별 분포 분류(LDA/QDA/NB: 단계 확률만).
      --prev-run 을 주면 이전 run(19열) 예측 시트도 함께 복사한다. 내부 테스트 지표를 설명 시트에 같이 적는다.
[왜 필요한가] 사용자 요청(2026-10-25): 방식마다 테스트 데이터를 만들어 정답과 직접 비교하기 위해.
[쓰는 곳] python3 experiments_chain.py --data train/ --test-data test/ [--run artifacts/chain_...] [--prev-run reports/chain_...]
"""

from __future__ import annotations

import argparse
import copy
import pickle
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis, QuadraticDiscriminantAnalysis
from sklearn.naive_bayes import GaussianNB
from sklearn.preprocessing import StandardScaler

import thresholds as T
from analysis_pack import style
from m1 import decision as D
from m1.chain import ChainFeatures, ChainModel, ChainPreprocessor, MeanRegressor, load_frame, residual_pools, sample_residuals, stage_from_bp
from m1.continuous import dispersion_groups
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table
from m1.splits import make_splits

DEV_VARS = ["bmi", "waist_cm", "alcohol_week", "activity_minutes_week", "fasting_glucose", "resting_hr"]


def latest_run(root: str, prefix: str) -> Path:
    runs = sorted(p for p in Path(root).glob(f"{prefix}_*") if p.is_dir())
    if not runs:
        raise SystemExit(f"{root}/{prefix}_* 없음")
    return runs[-1]


class SubsetModel:
    """열 부분집합으로 학습한 평균 모델을 전체 열 행렬에 쓰기 위한 래퍼."""
    def __init__(self, model: MeanRegressor, extra: pd.DataFrame | None = None):
        self.model, self.extra = model, extra
    def predict(self, Xf: pd.DataFrame) -> np.ndarray:
        X = Xf if self.extra is None else pd.concat([Xf, self.extra.loc[Xf.index]], axis=1)
        return self.model.predict(X[self.model.columns])


def deviation_features(X: pd.DataFrame, groups: np.ndarray, stats: dict | None, train_mask: np.ndarray | None = None) -> tuple[pd.DataFrame, dict]:
    g = pd.Series(groups, index=X.index)
    if stats is None:
        stats = {c: X[train_mask].groupby(g[train_mask].to_numpy())[c].agg(["mean", "std"]) for c in DEV_VARS}
    out = pd.DataFrame(index=X.index)
    for c in DEV_VARS:
        mu, sd = g.map(stats[c]["mean"]).to_numpy(float), g.map(stats[c]["std"]).to_numpy(float)
        z = (X[c].to_numpy(float) - np.nan_to_num(mu, nan=float(stats[c]["mean"].mean()))) / np.where(np.isfinite(sd) & (sd > 0), sd, 1.0)
        out[f"{c}_dev"], out[f"{c}_hi"], out[f"{c}_lo"] = z, (z > 1.5).astype(float), (z < -1.5).astype(float)
    return out, stats


def chain_predict(m_sbp, base: ChainModel, pools_s: dict, Xs: pd.DataFrame, X: pd.DataFrame, fd: ChainFeatures, groups: np.ndarray, K: int, seed: int = 42) -> dict:
    """sbp 모델만 바꾼 체인: 점 추정 + 분포(잔차 부트스트랩)."""
    rng = np.random.default_rng(seed)
    s_hat = m_sbp.predict(Xs)
    d_hat = base.m_dbp.predict(fd.transform(X, s_hat))
    Es, Ed = sample_residuals(pools_s, groups, K, rng), sample_residuals(base.pools_d, groups, K, rng)
    counts, dsum, g140, g90 = np.zeros((len(X), 4)), np.zeros(len(X)), np.zeros(len(X)), np.zeros(len(X))
    for k in range(K):
        s_k = s_hat + Es[:, k]
        d_k = base.m_dbp.predict(fd.transform(X, s_k)) + Ed[:, k]
        counts[np.arange(len(X)), stage_from_bp(s_k, d_k)] += 1
        dsum += d_k; g140 += s_k >= T.SBP_HTN_MIN; g90 += d_k >= T.DBP_HTN_MIN
    return {"sbp": s_hat, "dbp": d_hat, "stage_point": stage_from_bp(s_hat, d_hat), "P": counts / K, "p140": g140 / K, "p90": g90 / K}


def table(ids: pd.Series, keep: np.ndarray, out: dict, tau: dict | None) -> pd.DataFrame:
    P = out["P"]
    cols = {"person_id": ids[keep].to_numpy()}
    if "sbp" in out:
        cols.update({"sbp_pred": np.round(out["sbp"], 1), "dbp_pred": np.round(out["dbp"], 1), "stage_point": np.asarray(T.STAGES)[out["stage_point"]]})
    cols["stage_dist_rule"] = np.asarray(T.STAGES)[D.decide_stage(P, tau)] if tau else ""
    cols["stage_dist_argmax"] = np.asarray(T.STAGES)[P.argmax(axis=1)]
    cols.update({f"P_{s}": np.round(P[:, k], 4) for k, s in enumerate(T.STAGES)})
    if "p140" in out:
        cols.update({"p_sbp_ge_140": np.round(out["p140"], 4), "p_dbp_ge_90": np.round(out["p90"], 4)})
    tab = pd.DataFrame(cols)
    dropped = pd.DataFrame({"person_id": ids[~keep].to_numpy(), "note": "age/sex/bmi 결측으로 예측 불가"})
    full = pd.concat([tab, dropped], ignore_index=True)
    order = {pid: i for i, pid in enumerate(ids.astype(str))}
    return full.iloc[np.argsort(full["person_id"].map(order).to_numpy(), kind="stable")].reset_index(drop=True)


def metrics(out: dict, y: np.ndarray, sbp: np.ndarray | None, tau: dict | None) -> dict:
    P = out["P"]
    m = {"AUROC≥140/90": auroc((y == 3).astype(int), P[:, 3]), "AUROC≥130/80": auroc((y >= 2).astype(int), P[:, 2] + P[:, 3]), "argmax 정확도": float((P.argmax(1) == y).mean())}
    if tau:
        m["규칙 정확도"] = float((D.decide_stage(P, tau) == y).mean())
    if sbp is not None and "sbp" in out:
        m["sbp RMSE"] = float(np.sqrt(((sbp - out["sbp"]) ** 2).mean()))
        m["점추정 정확도"] = float((out["stage_point"] == y).mean())
    return m


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="방식별 테스트 파일 예측 모음")
    ap.add_argument("--data", required=True)
    ap.add_argument("--test-data", required=True)
    ap.add_argument("--run", default=None, help="기준 체인 산출물 폴더(기본: artifacts/chain_* 최신)")
    ap.add_argument("--prev-run", default=None, help="함께 복사할 이전 run 보고서 폴더(예: 19열 run)")
    ap.add_argument("--time-col", default="exam_year")
    ap.add_argument("--samples", type=int, default=200)
    ap.add_argument("--samples-internal", type=int, default=100)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    run = Path(a.run) if a.run else latest_run("artifacts", "chain")
    rep = Path(a.out) / f"experiments_{datetime.now():%Y%m%d_%H%M%S}"
    rep.mkdir(parents=True, exist_ok=True)

    pre = ChainPreprocessor.load(run / "preprocessor.pkl")
    feats = pickle.load(open(run / "features.pkl", "rb")); fs, fd = feats["sbp"], feats["dbp"]
    base = {lr: ChainModel.load(run / lr / "model.pkl") for lr in ("linear", "lgbm") if (run / lr / "model.pkl").exists()}
    raw, _ = load_frame(a.data)
    d = ChainPreprocessor.coerce(raw)
    keep = ChainPreprocessor.keep_mask(d) & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
    d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float)
    y = stage_from_bp(sbp, dbp)
    splits, _ = make_splits(y, d[a.time_col], seed=a.seed)
    tr, va, te = splits["train"], splits["val"], splits["test"]
    X, _, _ = pre.transform(d)
    Xs = fs.transform(X)
    groups = dispersion_groups(X)
    dft, _ = load_frame(a.test_data)
    Xt, keep_t, dt = pre.transform(dft)
    Xs_t, groups_t = fs.transform(Xt), dispersion_groups(Xt)
    ids = dt["person_id"].astype(str) if "person_id" in dt.columns else pd.Series(np.arange(len(dt)).astype(str), index=dt.index)
    log(f"기준 run {run.name}: 기준 열 {len(pre.columns)}, 학습 {len(tr)} / 검증 {len(va)} / 테스트 {len(te)}, 테스트 파일 {len(dft)}행(예측 {int(keep_t.sum())})")

    train_mask = np.zeros(len(X), bool); train_mask[tr] = True
    dev, dev_stats = deviation_features(X, groups, None, train_mask)
    dev_t, _ = deviation_features(Xt, groups_t, dev_stats)
    cols = list(Xs.columns)
    age_cols = [c for c in cols if c == "age" or c.startswith("age_x_")]
    variants = []   # (이름, learner, sbp 모델, 설명, 검증용 입력, 테스트 파일 입력)
    for lr, bm in base.items():
        variants.append((f"기준_{lr}", lr, bm.m_sbp, f"{lr}: 기준(전 열 + 추가 데이터)", None, None))
    if "linear" in base:
        bl = base["linear"]
        non_age = np.array([c not in age_cols for c in cols])
        for f in (0.5, 1.5, 2.0, 3.0):
            ms = copy.deepcopy(bl.m_sbp); b = ms.beta.copy(); b[1:][non_age] *= f; ms.beta = b
            variants.append((f"계수배수_{f:g}", "linear", ms, f"linear: 나이 외 계수 ×{f:g} (절편·나이 고정)", None, None))
        Xs_na = Xs[[c for c in cols if c not in age_cols]]
        m_na = MeanRegressor("linear").fit(Xs_na.iloc[tr], sbp[tr], Xs_na.iloc[va], sbp[va])
        variants.append(("나이제외_linear", "linear", SubsetModel(m_na), "linear: 나이 관련 열 전부 제외", None, None))
        m_as = MeanRegressor("linear").fit(Xs[["age", "male", "age_x_male"]].iloc[tr], sbp[tr], Xs[["age", "male", "age_x_male"]].iloc[va], sbp[va])
        variants.append(("나이성별만_linear", "linear", SubsetModel(m_as), "linear: 나이·성별만", None, None))
    for lr, bm in base.items():
        dev_cols = [c for c in dev.columns if c.endswith("_dev")]
        for name, use, desc in (("편차z", dev_cols, "나이대×성별 편차 z 추가"), ("편차z극단", list(dev.columns), "편차 z + 극단 플래그(|z|>1.5) 추가")):
            Xv = pd.concat([Xs, dev[use]], axis=1)
            mm = MeanRegressor(lr).fit(Xv.iloc[tr], sbp[tr], Xv.iloc[va], sbp[va])
            variants.append((f"{name}_{lr}", lr, SubsetModel(mm, dev[use]), f"{lr}: {desc}", dev[use], dev_t[use]))
        Xo = pd.concat([Xs[["age", "male", "age_x_male"]], dev[dev_cols]], axis=1)
        mm = MeanRegressor(lr).fit(Xo.iloc[tr], sbp[tr], Xo.iloc[va], sbp[va])
        variants.append((f"편차만_{lr}", lr, SubsetModel(mm, dev[dev_cols]), f"{lr}: 원값 대신 나이·성별 + 편차 z", dev[dev_cols], dev_t[dev_cols]))

    sheets, rows = {}, []
    for name, lr, m_sbp, desc, extra_tr, extra_t in variants:
        bm = base[lr]
        if extra_tr is not None:
            m_sbp.extra = extra_tr
        e_s = sbp[va] - m_sbp.predict(Xs.iloc[va])
        pools_s = residual_pools(e_s, groups[va])
        out_int = chain_predict(m_sbp, bm, pools_s, Xs.iloc[te], X.iloc[te], fd, groups[te], a.samples_internal, a.seed)
        tau = D.fit_thresholds(chain_predict(m_sbp, bm, pools_s, Xs.iloc[va], X.iloc[va], fd, groups[va], a.samples_internal, a.seed)["P"], y[va])
        if extra_t is not None:
            m_sbp.extra = extra_t
        out_t = chain_predict(m_sbp, bm, pools_s, Xs_t, Xt, fd, groups_t, a.samples, a.seed)
        if extra_tr is not None:
            m_sbp.extra = extra_tr
        sheets[name] = table(ids, keep_t, out_t, tau)
        rows.append({"시트": name, "방식": desc, **metrics(out_int, y[te], sbp[te], tau)})
        log(f"  {name}: {rows[-1]}")
    # 단계별 분포 분류(생성 모델): 단계 확률만
    Z_sc = StandardScaler().fit(X.iloc[tr]); Z, Zt = Z_sc.transform(X), Z_sc.transform(Xt)
    for name, mdl, desc in (("LDA", LinearDiscriminantAnalysis(), "단계별 분포(공통 공분산) → 베이즈"), ("QDA", QuadraticDiscriminantAnalysis(reg_param=0.5), "단계별 분포(단계별 공분산, reg 0.5) → 베이즈"), ("NB", GaussianNB(), "단계별 독립 정규 분포 → 베이즈")):
        mdl.fit(Z[tr], y[tr])
        tau = D.fit_thresholds(mdl.predict_proba(Z[va]), y[va])
        sheets[name] = table(ids, keep_t, {"P": mdl.predict_proba(Zt)}, tau)
        rows.append({"시트": name, "방식": desc + " (sbp·dbp 없음)", **metrics({"P": mdl.predict_proba(Z[te])}, y[te], None, tau)})
        log(f"  {name}: {rows[-1]}")
    if a.prev_run:
        prev = pd.ExcelFile(Path(a.prev_run) / "test_predictions.xlsx")
        for s in prev.sheet_names:
            if s.startswith("pred_"):
                sheets[f"이전run_{s[5:]}"] = prev.parse(s)
                rows.append({"시트": f"이전run_{s[5:]}", "방식": f"{Path(a.prev_run).name} 의 {s} 복사(19열 기준)"})
    info = pd.DataFrame(rows)
    readme = pd.DataFrame({"항목": ["기준 run", "내부 지표", "열 뜻", "", "", "", "제외 행"],
                           "내용": [f"{run.name} (기준 열 {len(pre.columns)}: {', '.join(pre.columns)})", f"내부 테스트 {len(te)}행, 분포 표본 {a.samples_internal}개(테스트 파일은 {a.samples}개)",
                                  "sbp_pred/dbp_pred: 점 추정 체인(mmHg). stage_point: 점 추정을 경계로 자른 단계", "stage_dist_rule: 분포 체인 단계 확률 + 판정 규칙(τ 검증 분할). stage_dist_argmax: 확률 최대 단계",
                                  "P_*: 분포 체인 4단계 확률. p_sbp_ge_140 / p_dbp_ge_90: 분포에서 sbp≥140 / dbp≥90 확률", "LDA/QDA/NB 는 단계 확률만 있고 sbp·dbp 예측이 없음", "age/sex/bmi 결측 행은 note 열에 표시, 예측 없음"]})
    with pd.ExcelWriter(rep / "test_predictions_variants.xlsx", engine="openpyxl") as w:
        readme.to_excel(w, sheet_name="설명", index=False)
        info.to_excel(w, sheet_name="방식별_내부지표", index=False)
        for name, tab in sheets.items():
            tab.to_excel(w, sheet_name=name[:31], index=False)
            tab.to_csv(rep / f"test_{name}.csv", index=False)
        for s in w.book.sheetnames:
            style(w.book[s], nd=3 if s == "방식별_내부지표" else 1, freeze="B2")
    (rep / "summary.md").write_text(f"# 방식별 테스트 파일 예측 — {rep.name}\n\n기준 run {run.name}\n\n" + md_table(info, nd=3) + "\n", encoding="utf-8")
    log(f"완료: {rep}/test_predictions_variants.xlsx (시트 {len(sheets)}개), summary.md")
    return rep


if __name__ == "__main__":
    main()

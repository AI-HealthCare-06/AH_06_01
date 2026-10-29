"""
[파일] train_chain.py
[용도] 체인 파이프라인 학습·평가·예측 CLI(m1/chain.py). 규칙 재설계(2026-10-25)대로 학습 파일을 전처리해 시간 분할(70/15/15, 대치 행 포함)로 학습자 2종(linear, lgbm)을
      학습하고, 내부 테스트 분할에서 ① 점 추정 체인(sbp_hat → dbp_hat(예측 sbp 투입) → 경계 단계)과 ② 분포 체인(검증 잔차 부트스트랩 → 단계 확률 → 판정 규칙)을 함께
      평가한다(RMSE·R²·편향, 단계 정확도·재현율·혼동행렬, AUROC·ECE·보정). 컬럼 영향력은 순열 중요도(검증 ΔRMSE, 기준 컬럼 단위), Spearman, 선형 계수·LightGBM gain 으로
      표·그림을 낸다. --test-data 를 주면 그 파일(혈압 비움) 행마다 person_id, sbp·dbp 예측, 단계(점 추정 / 분포+규칙 / argmax), 단계 확률을 엑셀로 낸다.
[왜 필요한가] 사용자 결정(2026-10-25): 테스트 파일 결과로 RMSE·R²·AUROC·정확도를 사용자가 직접 평가하고, 영향력 보고를 보고 필수·제외 컬럼을 정한다.
[주의] 명세 제약 없음. 단건 추론 경로(p95)는 아직 없음. 결과 reports/chain_<run>/, 산출물 artifacts/chain_<run>/.
[쓰는 곳] python3 train_chain.py --data train/ --test-data test/ --time-col exam_year
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib import font_manager  # noqa: E402

import thresholds as T  # noqa: E402
from analysis_pack import style  # noqa: E402
from m1 import decision as D  # noqa: E402
from m1.chain import BASE_COLUMNS, DEFAULT_EXCLUDE, ChainFeatures, ChainModel, ChainPreprocessor, load_frame, stage_from_bp  # noqa: E402
from m1.continuous import dispersion_groups  # noqa: E402
from m1.evaluate import evaluate_split  # noqa: E402
from m1.pipeline import log  # noqa: E402
from m1.report import md_table  # noqa: E402
from m1.splits import make_splits  # noqa: E402
from train_continuous import rule_table  # noqa: E402

_KO = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO:
    plt.rcParams["font.family"] = _KO[0]
plt.rcParams["axes.unicode_minus"] = False
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
COLORS = {"linear": "#2a78d6", "lgbm": "#1baf7a"}


def reg(y: np.ndarray, yhat: np.ndarray) -> dict:
    e = y - yhat
    return {"rmse": float(np.sqrt((e ** 2).mean())), "mae": float(np.abs(e).mean()), "bias(pred-actual)": float(-e.mean()), "r2": float(1 - (e ** 2).sum() / ((y - y.mean()) ** 2).sum())}


def stage_point_metrics(y: np.ndarray, s: np.ndarray) -> dict:
    out = {"accuracy": float((s == y).mean()), "adjacent_accuracy": float((np.abs(s - y) <= 1).mean())}
    rec = {st: float(((s == k) & (y == k)).sum() / max((y == k).sum(), 1)) for k, st in enumerate(T.STAGES)}
    out["balanced_accuracy"] = float(np.mean(list(rec.values())))
    out.update({f"recall_{k}": v for k, v in rec.items()})
    out.update({f"pred_share_{st}": float((s == k).mean()) for k, st in enumerate(T.STAGES)})
    return out


def confusion(y: np.ndarray, s: np.ndarray) -> pd.DataFrame:
    cm = np.array([[int(((y == i) & (s == j)).sum()) for j in range(4)] for i in range(4)])
    return pd.DataFrame(cm, index=[f"actual_{st}" for st in T.STAGES], columns=[f"pred_{st}" for st in T.STAGES]).reset_index().rename(columns={"index": "actual"})


def permutation_importance(model, X: pd.DataFrame, feats: ChainFeatures, y: np.ndarray, sbp: np.ndarray | None, seed: int) -> pd.DataFrame:
    """기준 컬럼 하나를 뒤섞고(파생·상호작용 포함 전부 다시 계산) 검증 RMSE 증가분. dbp 모델은 실제 sbp 열도 평가."""
    rng = np.random.default_rng(seed)
    base = reg(y, model.predict(feats.transform(X, sbp)))["rmse"]
    rows = []
    for c in feats.base_columns + (["sbp"] if feats.with_sbp else []):
        Xp, sp = X.copy(), None if sbp is None else sbp.copy()
        if c == "sbp":
            sp = rng.permutation(sp)
        else:
            Xp[c] = rng.permutation(Xp[c].to_numpy())
        rows.append({"column": c, "delta_rmse": reg(y, model.predict(feats.transform(Xp, sp)))["rmse"] - base})
    return pd.DataFrame(rows).sort_values("delta_rmse", ascending=False).reset_index(drop=True)


def fig_influence(perm: pd.DataFrame, path: Path) -> None:
    learners = sorted(perm["learner"].unique())
    fig, axes = plt.subplots(2, len(learners), figsize=(6.2 * len(learners), 8.5), facecolor=SURFACE, squeeze=False)
    for i, target in enumerate(("sbp", "dbp")):
        for j, lr in enumerate(learners):
            ax = axes[i, j]
            t = perm[(perm["target"] == target) & (perm["learner"] == lr)].sort_values("delta_rmse")
            ax.barh(t["column"], t["delta_rmse"], color=COLORS.get(lr, TEXT), edgecolor=SURFACE)
            for k, (c, v) in enumerate(zip(t["column"], t["delta_rmse"])):
                ax.text(max(v, 0), k, f" {v:.2f}", va="center", fontsize=7, color=MUTED)
            ax.set_facecolor(SURFACE); ax.grid(axis="x", color=GRID, linewidth=0.6); ax.tick_params(colors=MUTED, labelsize=8)
            ax.set_title(f"{target} 모델 · {lr}: 컬럼을 뒤섞었을 때 검증 RMSE 증가(mmHg)", color=TEXT, fontsize=9.5)
            for s in ("top", "right"):
                ax.spines[s].set_visible(False)
    fig.suptitle("컬럼 영향력 (순열 중요도, 파생·상호작용 포함 기준 컬럼 단위)", color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="체인 파이프라인 학습·평가·예측")
    ap.add_argument("--data", required=True)
    ap.add_argument("--test-data", default=None)
    ap.add_argument("--time-col", default="exam_year")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--learners", default="linear,lgbm")
    ap.add_argument("--samples", type=int, default=200, help="분포 체인 부트스트랩 표본 수")
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--exclude", default=",".join(DEFAULT_EXCLUDE), help="입력에서 뺄 열(쉼표 구분). 비우면 전부 사용")
    ap.add_argument("--required", default=",".join(T.CHAIN_REQUIRED), help="필수 열(결측이면 행 제외)")
    ap.add_argument("--max-imputed", type=int, default=T.CHAIN_MAX_IMPUTED, help="대치 개수가 이 값 이상이면 행 제외. 0 이면 제한 없음")
    ap.add_argument("--no-range-filter", action="store_true", help="thresholds.CHAIN_RANGES 범위 밖 행 제외를 끈다")
    ap.add_argument("--center", default="reference", choices=["mean", "reference"], help="연속형 편차의 중심: 평균 | 문헌 기준값")
    ap.add_argument("--hinge", action="store_true", help="정상 범위 초과·미달량 열 추가")
    ap.add_argument("--out", default="reports")
    ap.add_argument("--artifacts", default="artifacts")
    a = ap.parse_args(argv)
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    rep, art = Path(a.out) / f"chain_{run_id}", Path(a.artifacts) / f"chain_{run_id}"
    rep.mkdir(parents=True, exist_ok=True)
    art.mkdir(parents=True, exist_ok=True)
    learners = [s.strip() for s in a.learners.split(",") if s.strip()]

    # 1. 로드·필수 결측 제외·라벨
    raw, files = load_frame(a.data)
    if a.max_rows:
        raw = raw.head(a.max_rows)
    d = ChainPreprocessor.coerce(raw)
    exclude = tuple(c.strip() for c in a.exclude.split(",") if c.strip())
    required = tuple(c.strip() for c in a.required.split(",") if c.strip())
    pre_cfg = dict(exclude=exclude, required=required, max_imputed=(a.max_imputed or None), ranges=({} if a.no_range_filter else None))
    reasons = ChainPreprocessor(**pre_cfg).reasons(d)
    keep = (reasons == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
    reason_counts = reasons[reasons != ""].value_counts().to_dict()
    d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float)
    y = stage_from_bp(sbp, dbp)
    log(f"[1/5] 데이터 {len(raw)}행 ({len(files)}개 파일) → 제외 {int((~keep).sum())}행 {reason_counts} → 사용 {len(d)}행. 단계 분포 {dict(zip(T.STAGES, np.bincount(y, minlength=4).tolist()))}")

    # 2. 분할(시간 순서, 대치 행 포함)
    splits, sinfo = make_splits(y, d[a.time_col.strip().lower()] if a.time_col else None, seed=a.seed)
    tr, va, te = splits["train"], splits["val"], splits["test"]
    log(f"[2/5] 분할 {sinfo['method']}: {sinfo['sizes']} (대치 행 포함)")

    # 3. 전처리·추가 데이터
    pre = ChainPreprocessor(**pre_cfg).fit(d.iloc[tr])
    X, _, _ = pre.transform(d)
    fs = ChainFeatures(False, center=a.center, hinge=a.hinge).fit(X.iloc[tr])
    fd = ChainFeatures(True, center=a.center, hinge=a.hinge).fit(X.iloc[tr], sbp[tr])
    Xs, Xd = fs.transform(X), fd.transform(X, sbp)
    groups = dispersion_groups(X)
    male, age = X["male"].to_numpy(), X["age"].to_numpy()
    st = pre.stats
    log(f"[3/5] 전처리: 최빈값 {st['modes']}, 활동 결측 대치 {st['activity_mode_low']:g}분(flag1)/{st['activity_mode_high']:g}분(flag0), 허리둘레 회귀 RMSE {st['waist_rmse']:.2f}cm(n={st['waist_n']}); "
        f"입력 열 sbp 모델 {len(fs.columns)} / dbp 모델 {len(fd.columns)} (기준 {len(pre.columns)}, 제외 {list(exclude) or '없음'}, 중심 {a.center}, 힌지 {a.hinge})")
    pre.save(art / "preprocessor.pkl")
    import pickle
    pickle.dump({"sbp": fs, "dbp": fd}, open(art / "features.pkl", "wb"))

    # 4. 학습·평가
    results, perm_rows, spear = {}, [], None
    Xtr = X.iloc[tr]
    spear = pd.DataFrame({"column": pre.columns, "spearman_sbp": [pd.Series(Xtr[c].to_numpy()).corr(pd.Series(sbp[tr]), method="spearman") for c in pre.columns],
                          "spearman_dbp": [pd.Series(Xtr[c].to_numpy()).corr(pd.Series(dbp[tr]), method="spearman") for c in pre.columns]})
    for i, lr in enumerate(learners, 1):
        t0 = time.perf_counter()
        m = ChainModel(lr, a.seed).fit(Xs.iloc[tr], sbp[tr], Xd.iloc[tr], dbp[tr], Xs.iloc[va], sbp[va], Xd.iloc[va], dbp[va], groups[va])
        fit_s = time.perf_counter() - t0
        dv = m.predict_dist(Xs.iloc[va], X.iloc[va], fd, groups[va], K=a.samples)
        m.stage_thresholds = D.fit_thresholds(dv["P"], y[va])
        s_hat, d_hat, s_point = m.predict_point(Xs.iloc[te], X.iloc[te], fd)
        d_hat_actual = m.m_dbp.predict(Xd.iloc[te])
        dt = m.predict_dist(Xs.iloc[te], X.iloc[te], fd, groups[te], K=a.samples)
        P = dt["P"]
        ev = evaluate_split(y[te], P, male[te], age[te], m.stage_thresholds)
        point = {"sbp": reg(sbp[te], s_hat), "dbp(예측 sbp 투입)": reg(dbp[te], d_hat), "dbp(실제 sbp 투입)": reg(dbp[te], d_hat_actual), "dbp(분포 평균)": reg(dbp[te], dt["dbp_mean"])}
        perm_s = permutation_importance(m.m_sbp, X.iloc[va], fs, sbp[va], None, a.seed).assign(target="sbp", learner=lr)
        perm_d = permutation_importance(m.m_dbp, X.iloc[va], fd, dbp[va], sbp[va], a.seed).assign(target="dbp", learner=lr)
        perm_rows += [perm_s, perm_d]
        results[lr] = {"model": m, "fit_s": fit_s, "point": point, "stage_point": stage_point_metrics(y[te], s_point), "conf_point": confusion(y[te], s_point),
                       "dist_metrics": ev["metrics"], "conf_dist": confusion(y[te], D.decide_stage(P, m.stage_thresholds)), "rules": rule_table(y[te], P, m.stage_thresholds),
                       "subgroups": ev["subgroups"], "imp_sbp": m.m_sbp.importance(), "imp_dbp": m.m_dbp.importance(), "P_mean": P.mean(axis=0)}
        (art / lr).mkdir(exist_ok=True)
        m.save(art / lr / "model.pkl")
        (art / lr / "meta.json").write_text(json.dumps({"model_version": f"M1-chain-{run_id}-{lr}", "learner": lr, "stage_thresholds": m.stage_thresholds, "fit_info": m.info,
                                                        "columns_sbp": fs.columns, "columns_dbp": fd.columns, "preprocess_stats": st}, ensure_ascii=False, indent=2, default=float), encoding="utf-8")
        log(f"[4/5] ({i}/{len(learners)}) {lr}: sbp RMSE {point['sbp']['rmse']:.2f} R² {point['sbp']['r2']:.3f} | dbp RMSE {point['dbp(예측 sbp 투입)']['rmse']:.2f} R² {point['dbp(예측 sbp 투입)']['r2']:.3f} "
            f"(실제 sbp 투입 시 {point['dbp(실제 sbp 투입)']['rmse']:.2f}) | 점 추정 단계 정확도 {results[lr]['stage_point']['accuracy']:.3f}, htn 재현 {results[lr]['stage_point']['recall_htn']:.3f} "
            f"| 분포 AUROC≥140/90 {ev['metrics']['auroc_ge_140_90']:.3f}, 정확도 {ev['metrics']['accuracy']:.3f} | {fit_s:.1f}s")
    perm = pd.concat(perm_rows, ignore_index=True)
    fig_influence(perm, rep / "influence.png")

    # 5. 테스트 파일 예측
    test_info = None
    if a.test_data:
        test_info = predict_file(a.test_data, pre, fs, fd, results, a.samples, rep)
        log(f"[5/5] 테스트 파일 {test_info['rows']}행 → 예측 {test_info['predicted']}행, 제외 {test_info['dropped']}행 {test_info['dropped_reasons']} → {rep}/test_predictions.xlsx")
    write_report(rep, results, y[te], sinfo, len(raw), reason_counts, len(d), pre, fs, fd, perm, spear, test_info, a)
    log(f"완료: {rep}/summary.md, results.xlsx, influence.png | 산출물 {art}")
    return rep


def predict_file(path: str, pre: ChainPreprocessor, fs: ChainFeatures, fd: ChainFeatures, results: dict, K: int, rep: Path) -> dict:
    dft, _ = load_frame(path)
    Xt, keep, dt = pre.transform(dft)
    Xs_t, groups_t = fs.transform(Xt), dispersion_groups(Xt)
    ids = dt["person_id"].astype(str) if "person_id" in dt.columns else pd.Series(np.arange(len(dt)).astype(str), index=dt.index)
    sheets = {}
    for lr, r in results.items():
        m = r["model"]
        s_hat, d_hat, s_point = m.predict_point(Xs_t, Xt, fd)
        out = m.predict_dist(Xs_t, Xt, fd, groups_t, K=K)
        P = out["P"]
        rule_stage = D.decide_stage(P, m.stage_thresholds)
        tab = pd.DataFrame({"person_id": ids[keep].to_numpy(), "sbp_pred": np.round(s_hat, 1), "dbp_pred": np.round(d_hat, 1),
                            "stage_point": np.asarray(T.STAGES)[s_point], "stage_dist_rule": np.asarray(T.STAGES)[rule_stage], "stage_dist_argmax": np.asarray(T.STAGES)[P.argmax(axis=1)],
                            **{f"P_{st}": np.round(P[:, k], 4) for k, st in enumerate(T.STAGES)}, "p_sbp_ge_140": np.round(out["p_sbp_ge_140"], 4), "p_dbp_ge_90": np.round(out["p_dbp_ge_90"], 4)})
        dropped = pd.DataFrame({"person_id": ids[~keep].to_numpy(), "sbp_pred": np.nan, "dbp_pred": np.nan, "stage_point": "", "stage_dist_rule": "", "stage_dist_argmax": "", "note": "예측 불가: " + dt.loc[~keep, "__reason"].astype(str)})
        full = pd.concat([tab, dropped], ignore_index=True)
        order = {pid: i for i, pid in enumerate(ids.astype(str))}
        full = full.iloc[np.argsort(full["person_id"].map(order).to_numpy(), kind="stable")].reset_index(drop=True)
        sheets[lr] = full
    readme = pd.DataFrame({"열": ["sbp_pred, dbp_pred", "stage_point", "stage_dist_rule", "stage_dist_argmax", "P_*", "p_sbp_ge_140, p_dbp_ge_90", "note"],
                           "뜻": ["점 추정 체인: 전 컬럼 → sbp, 전 컬럼 + 예측 sbp → dbp (mmHg)", "sbp_pred·dbp_pred 를 단계 경계(120/130/140, 80/90)로 자른 단계",
                                 f"분포 체인(검증 잔차 부트스트랩 {K}개) 단계 확률에 판정 규칙(decision.py {D.STAGE_RULE}/{D.STAGE_OBJECTIVE}, τ 검증 분할 선택) 적용",
                                 "분포 체인 단계 확률 중 최대", "분포 체인 4단계 확률(합 1)", "분포에서 sbp≥140 / dbp≥90 확률", "예측 불가 사유"]})
    with pd.ExcelWriter(rep / "test_predictions.xlsx", engine="openpyxl") as w:
        readme.to_excel(w, sheet_name="설명", index=False)
        for lr, tab in sheets.items():
            tab.to_excel(w, sheet_name=f"pred_{lr}", index=False)
        for name in w.book.sheetnames:
            style(w.book[name], nd=1, freeze="B2")
    for lr, tab in sheets.items():
        tab.to_csv(rep / f"test_predictions_{lr}.csv", index=False)
    first = next(iter(sheets.values()))
    return {"rows": int(len(dft)), "predicted": int(keep.sum()), "dropped": int((~keep).sum()), "dropped_reasons": dt.loc[~keep, "__reason"].value_counts().to_dict(),
            "stage_share": {lr: tab["stage_point"].value_counts(normalize=True).round(3).to_dict() for lr, tab in sheets.items()}, "n_cols": int(len(first.columns))}


def write_report(rep, results, y_te, sinfo, n_loaded, reason_counts, n_used, pre, fs, fd, perm, spear, test_info, a) -> None:
    st = pre.stats
    rows_point = []
    for lr, r in results.items():
        for tgt, mm in r["point"].items():
            rows_point.append({"learner": lr, "target": tgt, **mm})
    point = pd.DataFrame(rows_point)
    stage_pt = pd.DataFrame([{"learner": lr, **r["stage_point"]} for lr, r in results.items()])
    base_norm = float((y_te == 0).mean())
    keys = [("auroc_ge_140_90", "AUROC ≥140/90"), ("auroc_ge_130_80", "AUROC ≥130/80"), ("auprc_ge_140_90", "AUPRC ≥140/90"), ("cal_slope_ge_140_90", "보정 기울기"), ("cal_intercept_ge_140_90", "보정 절편"),
            ("ece_ge_140_90", "ECE ≥140/90"), ("accuracy", "정확도(규칙)"), ("adjacent_accuracy", "인접 정확도"), ("balanced_accuracy", "균형 정확도"), ("recall_elevated", "재현 elevated"), ("recall_htn", "재현 htn")]
    dist = pd.DataFrame([{"learner": lr, **{lab: r["dist_metrics"].get(k) for k, lab in keys}, **{f"P평균_{s}": r["P_mean"][k] for k, s in enumerate(T.STAGES)}} for lr, r in results.items()])
    rules = pd.concat([r["rules"].assign(learner=lr) for lr, r in results.items()], ignore_index=True)
    rules = rules[["learner", *[c for c in rules.columns if c != "learner"]]]
    perm_w = perm.pivot_table(index="column", columns=["target", "learner"], values="delta_rmse")
    perm_w.columns = [f"{t}_{l}" for t, l in perm_w.columns]
    perm_w = perm_w.reset_index().merge(spear, on="column", how="left")
    perm_w["순위합"] = sum(perm_w[c].rank(ascending=False) for c in perm_w.columns if c.startswith(("sbp_", "dbp_")))
    perm_w = perm_w.sort_values("순위합").reset_index(drop=True)
    conf = pd.concat([pd.concat([r["conf_point"].assign(path="점 추정"), r["conf_dist"].assign(path="분포+규칙")]).assign(learner=lr) for lr, r in results.items()], ignore_index=True)
    sub = pd.concat([r["subgroups"].assign(learner=lr) for lr, r in results.items()], ignore_index=True)
    sub = sub[sub["age_group"] != "all"].pivot_table(index=["sex", "age_group"], columns="learner", values="auroc_ge_140_90").reset_index()
    imps = {f"{kind}_{lr}": r[f"imp_{kind}"].rename("value").reset_index().rename(columns={"index": "feature"}).sort_values("value", key=lambda s: s.abs(), ascending=False)
            for lr, r in results.items() for kind in ("sbp", "dbp")}
    setting = pd.DataFrame({"항목": ["데이터", "제외 행", "사용 행", "분할", "최빈값 대치", "활동 결측 대치", "허리둘레 추정", "음주", "활동 상한", "제외 열", "입력 열", "부트스트랩", "판정 규칙", "행 검증", "편차 중심·힌지"],
                            "값": [f"{a.data} {n_loaded}행", f"{reason_counts}", f"{n_used}행 (대치 행 포함)", f"{sinfo['method']} {sinfo['sizes']}",
                                  str(st["modes"]), f"flag1 행 최빈값 {st['activity_mode_low']:g}분 / flag0 행 최빈값 {st['activity_mode_high']:g}분",
                                  f"waist ~ 1 + male + bmi + age + male·bmi + male·age, 계수 {np.round(st['waist_beta'], 3).tolist()}, 학습 RMSE {st['waist_rmse']:.2f}cm",
                                  f"3열 결측 0, {T.ALCOHOL_WEEK_CAP:g}잔 이상 → {T.ALCOHOL_WEEK_CAP:g} + alcohol_15plus, per_day=1", f"{T.ACTIVITY_MINUTES_CAP:g}분 이상 → {T.ACTIVITY_MINUTES_CAP:g} + activity_600plus, flag = 분<{T.ACTIVITY_LOW_MIN_PER_WEEK}",
                                  ", ".join(pre.exclude) or "없음", f"기준 {len(pre.columns)} → sbp 모델 {len(fs.columns)}(나이×, 성별×) / dbp 모델 {len(fd.columns)}(+ sbp, sbp×)", f"{a.samples}개, 검증 잔차 나이대×성별 풀", f"{D.STAGE_RULE}/{D.STAGE_OBJECTIVE} (τ 검증 분할)",
                                  f"필수 {list(pre.required)}, 대치 ≥{pre.max_imputed} 제외, 범위 {pre.ranges or '없음'}", f"중심 {a.center} ({T.REFERENCE_CENTERS if a.center == 'reference' else '학습 평균'}), 힌지 {a.hinge}"]})
    L = [f"# 체인 파이프라인 — {rep.name}\n", md_table(setting, nd=3),
         f"\n## 1. 점 추정 체인 (테스트 {len(y_te)}행)\n", md_table(point, nd=3), "\n### 단계(점 추정 → 경계)\n", md_table(stage_pt, nd=3), f"\n전부 normal 기준선 정확도 {base_norm:.3f}\n",
         "\n## 2. 분포 체인 (단계 확률)\n", md_table(dist, nd=3), "\n### 판정 규칙 비교\n", md_table(rules, nd=3),
         "\n## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)\n", md_table(perm_w, nd=3),
         "\n## 4. 하위군 AUROC ≥140/90 (분포 체인)\n", md_table(sub, nd=3),
         "\n## 5. 혼동행렬\n", md_table(conf, nd=0)]
    for name, t in imps.items():
        L += [f"\n## 6. 피처별 {'계수(표준화 단위당 mmHg)' if 'linear' in name else 'gain 비중'} — {name} 상위 25\n", md_table(t.head(25), nd=3)]
    if test_info:
        L += ["\n## 7. 테스트 파일 예측\n", f"- {test_info['rows']}행 중 예측 {test_info['predicted']}행, 제외 {test_info['dropped']}행. 점 추정 단계 분포: {test_info['stage_share']}", "- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv"]
    L += ["\n주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.\n"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    sheets = {"설정": setting, "점추정": point, "단계_점추정": stage_pt, "분포": dist, "규칙비교": rules, "영향력": perm_w, "하위군": sub, "혼동행렬": conf, **{f"피처_{k}": v for k, v in imps.items()}}
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name[:31], index=False)
        for name in w.book.sheetnames:
            style(w.book[name], nd=3, freeze="B2")


if __name__ == "__main__":
    main()

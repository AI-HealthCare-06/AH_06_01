"""
[파일] max_search.py
[용도] 현재 입력으로 낼 수 있는 4단계 정확도의 상한을 넓게 탐색한다: LightGBM 다중분류 무작위 탐색(25설정), XGBoost·CatBoost 다중분류, MLP, 상위 모델 평균(스태킹),
      입력 두 벌(A: 15열+추가 데이터 / B: 제외했던 4열·연도까지 전부). 시간 분할에서 검증 정확도로 고른 뒤 상위 설정을 5겹 교차검증으로 확인한다.
[왜 필요한가] 사용자 목표(2026-10-26): 정확도 0.6. 모델 쪽 여지를 모두 써서 도달 가능 여부를 수치로 확인하기 위해. 결과 reports/maxsearch_<시각>/
[쓰는 곳] python3 max_search.py --data train/
"""

from __future__ import annotations

import argparse
import time
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb
from catboost import CatBoostClassifier
from sklearn.model_selection import KFold
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

import thresholds as T
from analysis_pack import style
from boost_accuracy import fit_weights, weighted_argmax
from m1.chain import ChainFeatures, ChainPreprocessor, load_frame, stage_from_bp
from m1.evaluate import auroc
from m1.pipeline import log
from m1.report import md_table
from m1.splits import make_splits


def feature_sets(d: pd.DataFrame, tr: np.ndarray) -> dict[str, pd.DataFrame]:
    out = {}
    preA = ChainPreprocessor().fit(d.iloc[tr]); XA, _, _ = preA.transform(d)
    out["A_15열"] = ChainFeatures(False, center="reference").fit(XA.iloc[tr]).transform(XA)
    preB = ChainPreprocessor(exclude=()).fit(d.iloc[tr]); XB, _, _ = preB.transform(d)
    fb = ChainFeatures(False, center="reference").fit(XB.iloc[tr]).transform(XB)
    out["B_전열+연도"] = fb.assign(exam_year=d["exam_year"].to_numpy(float))
    return out


def lgbm_configs(rng: np.random.Generator, n: int) -> list[dict]:
    cfgs = []
    for _ in range(n):
        cfgs.append(dict(num_leaves=int(rng.choice([7, 15, 31, 63, 127])), max_depth=int(rng.choice([-1, 4, 6, 8])), min_child_samples=int(rng.choice([10, 20, 50, 100, 200])),
                         colsample_bytree=float(rng.choice([0.5, 0.7, 0.9, 1.0])), subsample=float(rng.choice([0.6, 0.8, 1.0])), learning_rate=float(rng.choice([0.02, 0.03, 0.05, 0.1])),
                         reg_lambda=float(rng.choice([0, 1, 5, 20])), min_split_gain=float(rng.choice([0, 0.01, 0.1]))))
    return cfgs


def fit_predict(kind: str, cfg: dict, X, y, Xv, yv, Xt, seed: int):
    if kind == "lgbm":
        m = lgb.LGBMClassifier(objective="multiclass", num_class=4, n_estimators=5000, subsample_freq=1, deterministic=True, force_row_wise=True, verbose=-1, random_state=seed, **cfg)
        m.fit(X, y, eval_set=[(Xv, yv)], callbacks=[lgb.early_stopping(150, verbose=False)])
        return m.predict_proba(Xv), m.predict_proba(Xt), int(m.best_iteration_ or 0)
    if kind == "xgb":
        m = xgb.XGBClassifier(objective="multi:softprob", num_class=4, n_estimators=5000, tree_method="hist", early_stopping_rounds=150, eval_metric="mlogloss", random_state=seed, nthread=8, **cfg)
        m.fit(X, y, eval_set=[(Xv, yv)], verbose=False)
        return m.predict_proba(Xv), m.predict_proba(Xt), int(m.best_iteration)
    if kind == "cat":
        m = CatBoostClassifier(loss_function="MultiClass", iterations=4000, od_type="Iter", od_wait=150, random_seed=seed, verbose=False, thread_count=8, **cfg)
        m.fit(X, y, eval_set=(Xv, yv))
        return m.predict_proba(Xv), m.predict_proba(Xt), int(m.get_best_iteration())
    if kind == "mlp":
        sc = StandardScaler().fit(X)
        m = MLPClassifier(random_state=seed, early_stopping=True, validation_fraction=0.15, max_iter=300, **cfg)
        m.fit(sc.transform(X), y)
        return m.predict_proba(sc.transform(Xv)), m.predict_proba(sc.transform(Xt)), int(m.n_iter_)
    raise ValueError(kind)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--time-col", default="exam_year")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--n-lgbm", type=int, default=25)
    ap.add_argument("--cv-folds", type=int, default=5)
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    rep = Path(a.out) / f"maxsearch_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d = ChainPreprocessor.coerce(raw)
    reasons = ChainPreprocessor().reasons(d)
    keep = (reasons == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d = d[keep].reset_index(drop=True)
    sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y = stage_from_bp(sbp, dbp)
    splits, _ = make_splits(y, d[a.time_col], seed=a.seed); tr, va, te = splits["train"], splits["val"], splits["test"]
    rng = np.random.default_rng(a.seed)
    sets = feature_sets(d, tr)
    log(f"[1/3] {len(d)}행, 분할 {len(tr)}/{len(va)}/{len(te)}, 기준선(test) {float((y[te]==0).mean()):.4f}; 입력 A {sets['A_15열'].shape[1]}열, B {sets['B_전열+연도'].shape[1]}열")
    trials = [("lgbm", c) for c in lgbm_configs(rng, a.n_lgbm)]
    trials += [("xgb", dict(max_depth=md, eta=0.05, subsample=0.8, colsample_bytree=cs, min_child_weight=mcw, reg_lambda=1.0)) for md, cs, mcw in ((4, 0.8, 5), (6, 0.8, 10), (8, 0.6, 20), (6, 1.0, 50), (10, 0.5, 50), (3, 0.9, 1))]
    trials += [("cat", dict(depth=dp, learning_rate=0.05, l2_leaf_reg=l2)) for dp, l2 in ((6, 3), (8, 10), (4, 1))]
    trials += [("mlp", dict(hidden_layer_sizes=(128, 64), alpha=1e-3, learning_rate_init=1e-3)), ("mlp", dict(hidden_layer_sizes=(256, 128, 64), alpha=1e-2, learning_rate_init=5e-4))]
    rows, probs = [], {}
    for set_name, Xall in sets.items():
        for i, (kind, cfg) in enumerate(trials):
            if kind == "mlp" and set_name == "B_전열+연도":
                continue
            t0 = time.perf_counter()
            Pv, Pt, it = fit_predict(kind, cfg, Xall.iloc[tr], y[tr], Xall.iloc[va], y[va], Xall.iloc[te], a.seed)
            w = fit_weights(Pv, y[va])
            name = f"{set_name}|{kind}#{i}"
            probs[name] = (Pv, Pt)
            rows.append({"name": name, "set": set_name, "kind": kind, "cfg": str(cfg), "iters": it, "val_acc": float((Pv.argmax(1) == y[va]).mean()), "test_acc": float((Pt.argmax(1) == y[te]).mean()),
                         "test_acc_weighted": float((weighted_argmax(Pt, w) == y[te]).mean()), "test_auroc_140": auroc((y[te] == 3).astype(int), Pt[:, 3]), "test_auroc_130": auroc((y[te] >= 2).astype(int), Pt[:, 2] + Pt[:, 3]),
                         "expected_max_acc(test)": float(Pt.max(1).mean()), "sec": round(time.perf_counter() - t0, 1)})
            log(f"   {name:22s} val_acc {rows[-1]['val_acc']:.4f} test_acc {rows[-1]['test_acc']:.4f} wacc {rows[-1]['test_acc_weighted']:.4f} AUROC {rows[-1]['test_auroc_140']:.4f} ({rows[-1]['sec']}s)")
    tab = pd.DataFrame(rows).sort_values("val_acc", ascending=False).reset_index(drop=True)
    # 스태킹: 검증 정확도 상위 5 평균
    top5 = tab["name"].head(5).tolist()
    Pv = np.mean([probs[n][0] for n in top5], axis=0); Pt = np.mean([probs[n][1] for n in top5], axis=0); w = fit_weights(Pv, y[va])
    stack = {"name": "stack_top5", "set": "-", "kind": "mean", "cfg": str(top5), "iters": 0, "val_acc": float((Pv.argmax(1) == y[va]).mean()), "test_acc": float((Pt.argmax(1) == y[te]).mean()),
             "test_acc_weighted": float((weighted_argmax(Pt, w) == y[te]).mean()), "test_auroc_140": auroc((y[te] == 3).astype(int), Pt[:, 3]), "test_auroc_130": auroc((y[te] >= 2).astype(int), Pt[:, 2] + Pt[:, 3]), "expected_max_acc(test)": float(Pt.max(1).mean()), "sec": 0}
    tab = pd.concat([tab, pd.DataFrame([stack])], ignore_index=True)
    log("[2/3] 시간 분할 상위 10 (검증 정확도 순):\n" + tab.head(10)[["name", "val_acc", "test_acc", "test_acc_weighted", "test_auroc_140", "expected_max_acc(test)"]].round(4).to_string(index=False))

    # 교차검증: 검증 정확도 상위 3 설정 (lgbm/xgb/cat 중) + 기준 mc_mid
    top_cfgs = []
    for _, r in tab.iterrows():
        if r["kind"] in ("lgbm", "xgb", "cat") and len(top_cfgs) < 3:
            idx = int(r["name"].split("#")[1]); top_cfgs.append((r["name"], r["set"], trials[idx][0], trials[idx][1]))
    top_cfgs.append(("baseline_mc_mid", "A_15열", "lgbm", dict(num_leaves=31, max_depth=-1, min_child_samples=50, colsample_bytree=0.8, learning_rate=0.03, subsample=0.8, reg_lambda=1.0)))
    cv_rows = []
    kf = KFold(a.cv_folds, shuffle=True, random_state=a.seed)
    for f, (trva, te_f) in enumerate(kf.split(d), 1):
        prm = np.random.default_rng(a.seed + f).permutation(trva); n_va = int(len(trva) * 0.15); va_f, tr_f = np.sort(prm[:n_va]), np.sort(prm[n_va:])
        fsets = feature_sets(d, tr_f)
        for name, set_name, kind, cfg in top_cfgs:
            Xall = fsets[set_name]
            Pv, Pt, _ = fit_predict(kind, cfg, Xall.iloc[tr_f], y[tr_f], Xall.iloc[va_f], y[va_f], Xall.iloc[te_f], a.seed)
            w = fit_weights(Pv, y[va_f])
            cv_rows.append({"fold": f, "name": name, "acc": float((Pt.argmax(1) == y[te_f]).mean()), "acc_weighted": float((weighted_argmax(Pt, w) == y[te_f]).mean()), "auroc_140": auroc((y[te_f] == 3).astype(int), Pt[:, 3]), "expected_max_acc": float(Pt.max(1).mean())})
        log(f"   CV fold {f} 완료")
    cv = pd.DataFrame(cv_rows)
    summ = cv.groupby("name")[["acc", "acc_weighted", "auroc_140", "expected_max_acc"]].agg(["mean", "std"]).reset_index(); summ.columns = ["name"] + [f"{m}_{s}" for m, s in summ.columns[1:]]
    base = cv[cv.name == "baseline_mc_mid"].set_index("fold")["acc"]
    diffs = []
    for name in cv["name"].unique():
        if name == "baseline_mc_mid":
            continue
        dlt = (cv[cv.name == name].set_index("fold")["acc"] - base).to_numpy(); ci = 1.96 * dlt.std(ddof=1) / np.sqrt(len(dlt))
        diffs.append({"name": name, "Δacc vs mc_mid": dlt.mean(), "ci95": ci, "판정": "개선" if dlt.mean() > ci else ("악화" if dlt.mean() < -ci else "잡음 범위")})
    diff = pd.DataFrame(diffs)
    log("[3/3] 교차검증:\n" + summ.round(4).to_string(index=False) + "\n" + diff.round(4).to_string(index=False))
    L = [f"# 정확도 상한 탐색 — {rep.name}\n", f"- {len(d)}행, 시간 분할 {len(tr)}/{len(va)}/{len(te)}, 기준선(test) {float((y[te]==0).mean()):.4f}. 시도 {len(rows)}개(LightGBM {a.n_lgbm}×2벌, XGBoost 6×2, CatBoost 3×2, MLP 2) + 스태킹",
         "- expected_max_acc = 모델 확률이 맞다고 가정한 기대 정확도(평균 max P): 현재 입력으로 가능한 상한의 추정\n", "## 시간 분할 (검증 정확도 순)\n", md_table(tab.drop(columns=["cfg"]), nd=4),
         "\n## 교차검증 (상위 3 + 기준 mc_mid)\n", md_table(summ, nd=4), "\n", md_table(diff, nd=4), "\n## 설정\n", md_table(tab[["name", "cfg"]].head(15), nd=2)]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for n_, df in (("시간분할", tab), ("교차검증", summ), ("기준대비", diff), ("접힘별", cv)):
            df.to_excel(w, sheet_name=n_, index=False); style(w.book[n_], nd=4, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

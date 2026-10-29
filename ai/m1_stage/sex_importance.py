"""
[파일] sex_importance.py
[용도] 성별 분리 역체인(dbp→sbp) 3단계 모델의 컬럼별 영향도(순열 중요도). 테스트 행에서 기준 컬럼 하나를 뒤섞고(파생·상호작용 열은 다시 계산)
      ① dbp 모델 RMSE 증가, ② sbp 모델 RMSE 증가(실제 dbp 고정), ③ 역체인을 끝까지 돌린 sbp RMSE 증가와 3단계 정확도 감소,
      ④ 성별 직접 3단계 분류(LightGBM)의 정확도·AUROC 감소를 잰다. 뒤섞기는 반복(기본 5회)해 평균±표준편차로 낸다.
      참고로 학습 행에서 컬럼과 sbp·dbp 의 Spearman 상관도 같이 낸다. 분할·전처리·제외 열은 train_sex_chain.py 와 같다.
[쓰는 곳] python3 sex_importance.py --data train/ [--label sbp|dbp_rule] [--sex male|female|both]
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import lightgbm as lgb  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402

import thresholds as T  # noqa: E402
from analysis_pack import style  # noqa: E402
from m1.chain import ChainPreprocessor, load_frame, stage3_from_bp  # noqa: E402
from m1.evaluate import auroc  # noqa: E402
from m1.pipeline import log  # noqa: E402
from m1.report import md_table  # noqa: E402
from m1.splits import make_splits  # noqa: E402
from train_sex_chain import EXCLUDE, MC_PARAMS, ReverseChain, build, reg  # noqa: E402

_KO = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO:
    plt.rcParams["font.family"] = _KO[0]
plt.rcParams["axes.unicode_minus"] = False
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
SEX_COLORS = {"male": "#2a78d6", "female": "#c2410c"}
LEARNER_COLORS = {"linear": "#2a78d6", "lgbm": "#1baf7a"}
SEX_KO = {"male": "남성", "female": "여성"}
METRICS = {"dbp_rmse": "dbp 모델 RMSE 증가 (mmHg)", "sbp_rmse_actual_dbp": "sbp 모델 RMSE 증가, 실제 dbp 고정 (mmHg)", "sbp_rmse_chain": "역체인 sbp RMSE 증가 (mmHg)",
           "acc_chain": "역체인 3단계 정확도 감소 (%p)", "acc_direct": "직접 분류 정확도 감소 (%p)", "auroc_direct": "직접 분류 AUROC≥140 감소"}
PP = {"acc_chain", "acc_direct"}   # 퍼센트포인트로 표시
USE_DBP = False   # --label dbp_rule: 3단계를 sbp 122/140 또는 dbp 80/90 으로


def metrics_for(m, mc, Xd, X, fs, sbp, dbp, y3, dbp_in=None):
    """현재 입력으로 모델들을 돌려 지표 묶음을 돌려준다. dbp_in 은 sbp 모델의 '실제 dbp' 입력(뒤섞은 것을 넣을 수 있음)."""
    d_hat = m.m_dbp.predict(Xd)
    s_actual = m.m_sbp.predict(fs.transform(X, dbp if dbp_in is None else dbp_in))
    s_chain = m.m_sbp.predict(fs.transform(X, d_hat))
    out = {"dbp_rmse": reg(dbp, d_hat)["rmse"], "sbp_rmse_actual_dbp": reg(sbp, s_actual)["rmse"], "sbp_rmse_chain": reg(sbp, s_chain)["rmse"], "acc_chain": float((stage3_from_bp(s_chain, d_hat, USE_DBP) == y3).mean())}
    if mc is not None:
        P = mc.predict_proba(Xd)
        out["acc_direct"] = float((P.argmax(1) == y3).mean()); out["auroc_direct"] = auroc((y3 == 2).astype(int), P[:, 2])
    return out


def permutation_block(m, mc, X_te, fd, fs, sbp_te, dbp_te, y_te, repeats: int, seed: int) -> tuple[dict, pd.DataFrame]:
    Xd_te = fd.transform(X_te)
    base = metrics_for(m, mc, Xd_te, X_te, fs, sbp_te, dbp_te, y_te)
    cols = [c for c in fd.base_columns if X_te[c].nunique() > 1]   # 성별 모델에서 male 은 상수 → 제외
    rows = []
    for j, c in enumerate(cols + ["dbp(sbp 모델 입력)"]):
        for r in range(repeats):
            rng = np.random.default_rng(seed * 1000 + j * 10 + r)
            if c.startswith("dbp("):
                mt = metrics_for(m, None, Xd_te, X_te, fs, sbp_te, dbp_te, y_te, dbp_in=rng.permutation(dbp_te))
                rows.append({"column": c, "repeat": r, "sbp_rmse_actual_dbp": mt["sbp_rmse_actual_dbp"]}); continue
            Xp = X_te.copy(); Xp[c] = rng.permutation(Xp[c].to_numpy())
            rows.append({"column": c, "repeat": r, **metrics_for(m, mc, fd.transform(Xp), Xp, fs, sbp_te, dbp_te, y_te)})
    df = pd.DataFrame(rows)
    for k, b in base.items():
        if k in df.columns:
            df[f"d_{k}"] = (df[k] - b) if "rmse" in k else (b - df[k]) * (100.0 if k in PP else 1.0)
    return base, df


def spearman_table(X: pd.DataFrame, sbp: np.ndarray, dbp: np.ndarray) -> pd.DataFrame:
    rows = []
    for c in X.columns:
        if X[c].nunique() <= 1: continue
        rows.append({"column": c, "spearman_sbp": float(spearmanr(X[c], sbp).correlation), "spearman_dbp": float(spearmanr(X[c], dbp).correlation)})
    return pd.DataFrame(rows)


def barh(ax, t: pd.DataFrame, col: str, color: str, title: str, unit_fmt: str = "{:.2f}"):
    t = t.sort_values(f"{col}_mean")
    ax.barh(t["column"], t[f"{col}_mean"], xerr=t[f"{col}_std"].fillna(0), color=color, edgecolor=SURFACE, error_kw={"ecolor": MUTED, "elinewidth": 0.8, "capsize": 2})
    for k, v in enumerate(t[f"{col}_mean"]):
        ax.text(max(v, 0), k, " " + unit_fmt.format(v), va="center", fontsize=7, color=MUTED)
    ax.axvline(0, color=MUTED, linewidth=0.6)
    ax.set_facecolor(SURFACE); ax.grid(axis="x", color=GRID, linewidth=0.6); ax.tick_params(colors=MUTED, labelsize=8)
    ax.set_title(title, color=TEXT, fontsize=9.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def fig_sex_detail(sex: str, agg: dict, path: Path):
    """한 성별: 행 = 학습기(linear, lgbm), 열 = dbp 모델 / 역체인 sbp / 역체인 3단계 정확도."""
    keys = ["dbp_rmse", "sbp_rmse_chain", "acc_chain"]
    fig, axes = plt.subplots(2, 3, figsize=(18, 9), facecolor=SURFACE)
    for i, lr in enumerate(("linear", "lgbm")):
        for j, k in enumerate(keys):
            barh(axes[i, j], agg[(sex, lr)], f"d_{k}", LEARNER_COLORS[lr], f"{SEX_KO[sex]} · {lr} · {METRICS[k]}", "{:.1f}" if k in PP else "{:.2f}")
    fig.suptitle(f"{SEX_KO[sex]} 모델 컬럼 영향도 — 테스트 행에서 컬럼을 뒤섞었을 때 (평균±표준편차, 반복 뒤섞기)", color=TEXT, fontsize=11)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def fig_compare(agg: dict, path: Path):
    """lgbm 역체인: 남녀를 한 축에 나란히(dbp RMSE, 역체인 sbp RMSE, 3단계 정확도) + 직접 분류 정확도."""
    keys = ["dbp_rmse", "sbp_rmse_chain", "acc_chain", "acc_direct"]
    cols = sorted(set(agg[("male", "lgbm")]["column"]) | set(agg[("female", "lgbm")]["column"]), key=lambda c: -float(agg[("male", "lgbm")].set_index("column")["d_acc_chain_mean"].get(c, 0) + agg[("female", "lgbm")].set_index("column")["d_acc_chain_mean"].get(c, 0)))
    cols = [c for c in cols if not c.startswith("dbp(")][::-1]
    fig, axes = plt.subplots(1, 4, figsize=(22, 7.5), facecolor=SURFACE)
    y = np.arange(len(cols)); h = 0.38
    for j, k in enumerate(keys):
        ax = axes[j]
        for s, (sex, off) in enumerate((("male", h / 2), ("female", -h / 2))):
            t = agg[(sex, "lgbm")].set_index("column")
            v = np.array([t[f"d_{k}_mean"].get(c, np.nan) for c in cols]); e = np.array([t[f"d_{k}_std"].get(c, 0) for c in cols])
            ax.barh(y + off, np.nan_to_num(v), height=h, xerr=np.nan_to_num(e), color=SEX_COLORS[sex], edgecolor=SURFACE, label=SEX_KO[sex], error_kw={"ecolor": MUTED, "elinewidth": 0.8, "capsize": 2})
            for yi, vi in zip(y + off, v):
                if np.isfinite(vi): ax.text(max(vi, 0), yi, (" {:.1f}" if k in PP else " {:.2f}").format(vi), va="center", fontsize=6.5, color=MUTED)
        ax.set_yticks(y); ax.set_yticklabels(cols, fontsize=8); ax.axvline(0, color=MUTED, linewidth=0.6)
        ax.set_facecolor(SURFACE); ax.grid(axis="x", color=GRID, linewidth=0.6); ax.tick_params(colors=MUTED, labelsize=8); ax.set_title(METRICS[k], color=TEXT, fontsize=9.5)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
    axes[0].legend(fontsize=8, loc="lower right")
    fig.suptitle("성별 분리 모델(lgbm) 컬럼 영향도 비교 — 테스트 행에서 컬럼을 뒤섞었을 때 (여성 모델은 음주 열 없음)", color=TEXT, fontsize=11)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--seed", type=int, default=42); ap.add_argument("--repeats", type=int, default=5); ap.add_argument("--out", default="reports")
    ap.add_argument("--label", default="sbp", choices=["sbp", "dbp_rule"]); ap.add_argument("--sex", default="both", choices=["male", "female", "both"])
    a = ap.parse_args(argv)
    global USE_DBP; USE_DBP = a.label == "dbp_rule"; sexes = ("male", "female") if a.sex == "both" else (a.sex,)
    rep = Path(a.out) / f"seximp_{a.label}_{a.sex}_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    raw, _ = load_frame(a.data); d0 = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d0) == "").to_numpy() & d0[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d0 = d0[keep].reset_index(drop=True)
    log(f"[1/3] 사용 {len(d0)}행 (train_sex_chain.py 와 같은 행 검증·분할)")

    agg, raw_rows, bases, spear = {}, [], [], []
    for sex in sexes:
        d = d0[d0["sex"] == sex].reset_index(drop=True)
        sbp, dbp = d["sbp"].to_numpy(float), d["dbp"].to_numpy(float); y3 = stage3_from_bp(sbp, dbp, USE_DBP)
        splits, _ = make_splits(y3, None, seed=a.seed); tr, va, te = splits["train"], splits["val"], splits["test"]
        pre, X, fd, fs, Xd, Xs, groups, _, _ = build(d, tr, EXCLUDE[sex])
        mc = lgb.LGBMClassifier(**dict(MC_PARAMS, random_state=a.seed)); mc.fit(Xd.iloc[tr], y3[tr], eval_set=[(Xd.iloc[va], y3[va])], callbacks=[lgb.early_stopping(100, verbose=False)])
        spear.append(spearman_table(X.iloc[tr], sbp[tr], dbp[tr]).assign(sex=sex))
        for learner in ("linear", "lgbm"):
            m = ReverseChain(learner, a.seed).fit(Xd.iloc[tr], dbp[tr], Xs.iloc[tr], sbp[tr], Xd.iloc[va], dbp[va], Xs.iloc[va], sbp[va], groups[va])
            base, df = permutation_block(m, mc if learner == "lgbm" else None, X.iloc[te], fd, fs, sbp[te], dbp[te], y3[te], a.repeats, a.seed)
            bases.append({"sex": sex, "learner": learner, "n_test": int(len(te)), **base}); raw_rows.append(df.assign(sex=sex, learner=learner))
            dcols = [c for c in df.columns if c.startswith("d_")]
            g = df.groupby("column")[dcols].agg(["mean", "std"]); g.columns = [f"{m_}_{s}" for m_, s in g.columns]; g = g.reset_index()
            agg[(sex, learner)] = g
            top = g.sort_values("d_acc_chain_mean", ascending=False).head(5)
            log(f"[2/3] {sex} {learner}: 테스트 {len(te)}행, 기준 역체인 정확도 {base['acc_chain']:.3f}, sbp RMSE {base['sbp_rmse_chain']:.2f} | 3단계 정확도 감소 상위: " + ", ".join(f"{r.column} {r.d_acc_chain_mean:.1f}%p" for r in top.itertuples()))

    # 표: 성별 × (lgbm/linear) 넓은 형식 + Spearman
    spear = pd.concat(spear, ignore_index=True); wide = {}
    for sex in sexes:
        gl = agg[(sex, "lgbm")].rename(columns=lambda c: c if c == "column" else f"{c}_lgbm"); gn = agg[(sex, "linear")].rename(columns=lambda c: c if c == "column" else f"{c}_linear")
        g = gl.merge(gn, on="column", how="outer")
        keep_cols = ["column"] + [c for c in g.columns if "_mean_" in c] + [c for c in g.columns if "_std_" in c]
        g = g[keep_cols].merge(spear[spear["sex"] == sex].drop(columns="sex"), on="column", how="left")
        g = g.sort_values("d_acc_chain_mean_lgbm", ascending=False).reset_index(drop=True); wide[sex] = g
    base_df = pd.DataFrame(bases); raw_df = pd.concat(raw_rows, ignore_index=True)
    raw_df.to_csv(rep / "permutation_raw.csv", index=False)

    if len(sexes) == 2: fig_compare(agg, rep / "fig_compare_lgbm.png")
    for sex in sexes: fig_sex_detail(sex, agg, rep / f"fig_{sex}_detail.png")

    show = lambda sex: wide[sex][["column", "d_dbp_rmse_mean_lgbm", "d_sbp_rmse_actual_dbp_mean_lgbm", "d_sbp_rmse_chain_mean_lgbm", "d_acc_chain_mean_lgbm", "d_acc_direct_mean_lgbm", "d_auroc_direct_mean_lgbm",
                                  "d_dbp_rmse_mean_linear", "d_sbp_rmse_chain_mean_linear", "d_acc_chain_mean_linear", "spearman_sbp", "spearman_dbp"]].rename(columns=lambda c: c.replace("_mean", ""))
    L = [f"# 성별 분리 모델 컬럼 영향도 (순열 중요도) — {rep.name}\n", "- 3단계 라벨: " + (f"sbp {T.STAGE3_SBP_CUTS} 또는 dbp {T.STAGE3_DBP_CUTS}" if USE_DBP else f"sbp {T.STAGE3_SBP_CUTS} 만") + " (acc_chain·acc_direct 는 이 라벨 기준).",
         f"- 방법: 테스트 행에서 기준 컬럼 하나를 뒤섞고(그 컬럼에서 파생된 표준화·상호작용 열은 다시 계산) 지표가 얼마나 나빠지는지 잰다. {a.repeats}회 반복 평균(표준편차는 xlsx). 값이 클수록 모델이 그 컬럼에 많이 기댄다는 뜻이고, 0 근처면 뒤섞어도 결과가 안 바뀐다는 뜻.",
         "- d_dbp_rmse: dbp 모델 RMSE 증가(mmHg). d_sbp_rmse_actual_dbp: sbp 모델 RMSE 증가(실제 dbp 를 입력에 고정). d_sbp_rmse_chain: 예측 dbp 를 넣는 역체인 끝까지의 sbp RMSE 증가. d_acc_chain: 역체인 3단계 정확도 감소(%p). d_acc_direct / d_auroc_direct: 직접 3단계 분류(LightGBM) 정확도 감소(%p)·AUROC≥140 감소.",
         "- 'dbp(sbp 모델 입력)' 행은 sbp 모델에 들어가는 실제 dbp 를 뒤섞은 경우(2단계 입력의 영향). Spearman 은 학습 행에서 컬럼과 실제 sbp·dbp 의 순위 상관. 여성 모델은 음주 4열을 쓰지 않으므로 행이 없다.",
         "- 분할·전처리·제외 열은 train_sex_chain.py 와 같다(무작위 층화 70/15/15, seed 동일). 같은 테스트 행에서 잰 값.\n",
         "## 기준 지표 (뒤섞기 전, 테스트 행)\n", md_table(base_df, nd=3)]
    for sex in sexes:
        L += [f"\n## {SEX_KO[sex]} 모델 (lgbm 역체인 3단계 정확도 감소 순)\n", md_table(show(sex), nd=3)]
    L += ["\n## 그림\n", "- fig_compare_lgbm.png: lgbm 남·여 나란히(dbp RMSE, 역체인 sbp RMSE, 역체인 정확도, 직접 분류 정확도)", "- fig_male_detail.png / fig_female_detail.png: 성별별 linear·lgbm 세 지표"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "importance.xlsx", engine="openpyxl") as w:
        for name, df in [(SEX_KO[sx], wide[sx]) for sx in sexes] + [("기준지표", base_df), ("반복별", raw_df), ("Spearman", spear)]:
            df.to_excel(w, sheet_name=name, index=False); style(w.book[name], nd=3, freeze="B2")
    log(f"[3/3] 완료: {rep}/summary.md, importance.xlsx, 그림 3장")
    return rep


if __name__ == "__main__":
    main()

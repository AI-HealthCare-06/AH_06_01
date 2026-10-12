"""evaluation.py — 성능·보정·하위군 지표 (B0, B1, 외부 검증이 전부 같은 함수를 쓴다)

필수 지표(인수인계 5장): AUROC, AUPRC, Brier, 보정 곡선(10분위) + 기울기·절편, ECE,
가중 유병률 대비 예측 평균, 성별 × 연령대(19~39 / 40~59 / 60+) 6개 셀.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

from features.sk_transforms import origin_of
from inference.calibration import logit, sigmoid

AGE_GROUPS = ((19, 39, "19-39"), (40, 59, "40-59"), (60, 200, "60+"))
N_BINS = 10

# 차트 색 (dataviz 참조 팔레트, 라이트 서피스): 계열1 파랑, 계열2 주황, 본문·보조 글자색
C_SERIES1, C_SERIES2, C_TEXT, C_TEXT2, C_GRID, C_SURFACE = "#2a78d6", "#eb6834", "#0b0b0b", "#52514e", "#d9d8d3", "#fcfcfb"


def age_group(age: pd.Series) -> pd.Series:
    bins = [AGE_GROUPS[0][0] - 1] + [hi for _, hi, _ in AGE_GROUPS]
    return pd.cut(pd.to_numeric(age), bins=bins, labels=[name for *_, name in AGE_GROUPS])


# ── 보정 ────────────────────────────────────────────────────────────────────


def calibration_table(y, p, n_bins: int = N_BINS) -> pd.DataFrame:
    """분위 구간별 (n, 예측 평균, 관측 비율). 분위라 구간마다 표본 수가 비슷하다."""
    y, p = np.asarray(y, dtype=float), np.asarray(p, dtype=float)
    edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    rows = []
    for b in range(len(edges) - 1):
        m = idx == b
        if m.sum() == 0:
            continue
        rows.append({"bin": b, "n": int(m.sum()), "p_lo": float(edges[b]), "p_hi": float(edges[b + 1]),
                     "pred_mean": float(p[m].mean()), "obs_rate": float(y[m].mean())})
    return pd.DataFrame(rows)


def ece(y, p, n_bins: int = N_BINS) -> float:
    t = calibration_table(y, p, n_bins)
    return float((t["n"] / t["n"].sum() * (t["pred_mean"] - t["obs_rate"]).abs()).sum())


def calibration_slope_intercept(y, p) -> tuple[float, float]:
    """y ~ a·logit(p) + b 의 (a, b). a=1, b=0 이 완벽."""
    lr = LogisticRegression(C=np.inf, max_iter=1000).fit(logit(p).reshape(-1, 1), np.asarray(y).astype(int))
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def calibration_in_the_large(y, p) -> float:
    """기울기를 1로 고정했을 때의 절편 b: mean(sigmoid(logit(p)+b)) = mean(y). 이분법."""
    y, z = np.asarray(y, dtype=float), logit(p)
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if sigmoid(z + mid).mean() < y.mean():
            lo = mid
        else:
            hi = mid
    return float((lo + hi) / 2)


# ── 종합 지표 ───────────────────────────────────────────────────────────────


def evaluate(y, p, w=None) -> dict[str, float]:
    y, p = np.asarray(y, dtype=int), np.asarray(p, dtype=float)
    out = {
        "n": int(len(y)),
        "prevalence": float(y.mean()),
        "pred_mean": float(p.mean()),
        "auroc": float(roc_auc_score(y, p)),
        "auprc": float(average_precision_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "logloss": float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))),
        "ece10": ece(y, p),
    }
    a, b = calibration_slope_intercept(y, p)
    out["cal_slope"], out["cal_intercept"], out["citl"] = a, b, calibration_in_the_large(y, p)
    if w is not None:
        w = np.asarray(w, dtype=float)
        ok = np.isfinite(w) & (w > 0)
        out["prevalence_w"] = float(np.average(y[ok], weights=w[ok]))
        out["pred_mean_w"] = float(np.average(p[ok], weights=w[ok]))
        out["auroc_w"] = float(roc_auc_score(y[ok], p[ok], sample_weight=w[ok]))
        out["brier_w"] = float(brier_score_loss(y[ok], p[ok], sample_weight=w[ok]))
    return out


def subgroup_table(y, p, sex: pd.Series, age: pd.Series, w=None) -> pd.DataFrame:
    """성별 × 연령대 6개 셀. 양성이 적은 셀(20~30대 여성)은 AUPRC 가 낮게 나온다 — 숫자 그대로 보고."""
    df = pd.DataFrame({"y": np.asarray(y), "p": np.asarray(p), "sex": np.asarray(sex), "age_group": age_group(pd.Series(np.asarray(age)))})
    if w is not None:
        df["w"] = np.asarray(w, dtype=float)
    rows = []
    for (s, g), d in df.groupby(["sex", "age_group"], observed=True):
        if d["y"].nunique() < 2:
            continue
        m = evaluate(d["y"], d["p"], d["w"] if "w" in d else None)
        rows.append({"sex": s, "age_group": str(g), "n": m["n"], "positives": int(d["y"].sum()), "prevalence": m["prevalence"],
                     "pred_mean": m["pred_mean"], "auroc": m["auroc"], "auprc": m["auprc"], "brier": m["brier"], "ece10": m["ece10"]})
    return pd.DataFrame(rows)


def fairness_gap(sub: pd.DataFrame, col: str = "ece10") -> float:
    """성별 간 지표 차이(최대). 인수인계 7장 공정성: 성별 ECE 차 ≤ 0.05."""
    by_sex = sub.groupby("sex")[col].mean()
    return float(by_sex.max() - by_sex.min()) if len(by_sex) > 1 else 0.0


# ── 계수 표 (B0) ─────────────────────────────────────────────────────────────


def coefficient_table(pipeline, columns: list[str], expected_sign: dict[str, int]) -> pd.DataFrame:
    """표준화 계수와 1 SD 당 오즈비. 부호가 임상 상식(expected_sign)과 맞는지 표시."""
    final = pipeline.steps[-1][1]
    pre = pipeline[:-1]
    names = list(pre.get_feature_names_out(columns)) if hasattr(pre, "get_feature_names_out") else list(columns)
    coef = np.asarray(final.coef_).reshape(-1)
    rows = []
    for name, c in zip(names, coef):
        origin = origin_of(name, columns)
        exp = 0 if name.endswith("^2") else expected_sign.get(origin, 0)   # 제곱항은 부호 기대 없음 (단조성은 probe 로 확인)
        rows.append({"term": name, "origin": origin, "coef_std": float(c), "odds_ratio_per_sd": float(np.exp(c)),
                     "expected_sign": exp, "sign_ok": bool(exp == 0 or np.sign(c) == exp or abs(c) < 1e-6)})
    rows.append({"term": "intercept", "origin": "", "coef_std": float(final.intercept_[0]), "odds_ratio_per_sd": float(np.exp(final.intercept_[0])),
                 "expected_sign": 0, "sign_ok": True})
    return pd.DataFrame(rows)


# ── 보정 곡선 PNG ────────────────────────────────────────────────────────────


def plot_calibration(y, p_raw, p_cal, path: Path, title: str) -> Path:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t_raw, t_cal = calibration_table(y, p_raw), calibration_table(y, p_cal)
    fig, ax = plt.subplots(figsize=(5.2, 5.2), dpi=150, facecolor=C_SURFACE)
    ax.set_facecolor(C_SURFACE)
    ax.plot([0, 1], [0, 1], color=C_GRID, lw=1, ls="--", zorder=1)
    ax.plot(t_raw["pred_mean"], t_raw["obs_rate"], color=C_SERIES2, lw=2, marker="o", ms=5, label="보정 전", zorder=2)
    ax.plot(t_cal["pred_mean"], t_cal["obs_rate"], color=C_SERIES1, lw=2, marker="o", ms=5, label="보정 후", zorder=3)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_aspect("equal")
    ax.set_xlabel("예측 확률 (10분위 평균)", color=C_TEXT2); ax.set_ylabel("관측 고혈압 비율", color=C_TEXT2)
    ax.set_title(title, color=C_TEXT, fontsize=11, loc="left")
    ax.tick_params(colors=C_TEXT2); ax.grid(color=C_GRID, lw=0.6)
    for s in ax.spines.values():
        s.set_color(C_GRID)
    ax.legend(frameon=False, loc="upper left", labelcolor=C_TEXT)
    ax.text(0.98, 0.02, f"ECE 보정 전 {ece(y, p_raw):.3f} → 후 {ece(y, p_cal):.3f}", ha="right", va="bottom",
            transform=ax.transAxes, color=C_TEXT2, fontsize=9)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, facecolor=C_SURFACE)
    plt.close(fig)
    return path


def set_korean_font() -> None:
    """macOS/Windows/Linux 에서 흔한 한글 글꼴을 찾아 matplotlib 에 지정. 없으면 영문 그대로."""
    import matplotlib
    from matplotlib import font_manager
    for name in ("AppleGothic", "Apple SD Gothic Neo", "NanumGothic", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR"):
        if any(f.name == name for f in font_manager.fontManager.ttflist):
            matplotlib.rcParams["font.family"] = name
            matplotlib.rcParams["axes.unicode_minus"] = False
            return

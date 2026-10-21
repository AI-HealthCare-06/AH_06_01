"""
[파일] m1/evaluate.py
[용도] 평가 지표 계산. 임계값별(≥elevated, ≥130/80, ≥140/90) AUROC·AUPRC·보정 기울기·절편·ECE·Brier, 단계 정확도·인접 정확도·혼동행렬,
      클래스별 ECE, 성별×연령대 6셀 하위군 지표, 성별 ECE 차.
      점검용: P(htn) 이진화(0.5·Youden 임계값)의 정확도·민감도·특이도, 보조 혈압 회귀의 RMSE·MAE 와 환산 단계 정확도.
[왜 필요한가] 명세 2-5 의 평가 항목을 모든 조합에 같은 방식으로 적용해야 비교가 된다. 합격선 판정은 여기서 하지 않고 숫자만 낸다(판정은 사용자).
             연령대 경계와 임계값 이름은 thresholds.py 에서 가져온다.
[쓰는 곳] train.py, evaluate_cli.py, m1/plots.py, m1/batch.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.special import expit, logit
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, log_loss, roc_auc_score, roc_curve

import thresholds as T
from .decision import decide_stage
from .labels import stage_index
from .models.calibration import cumulative_probs

EVAL_CONFIG = {"n_bins": 10, "prob_clip": 1e-6}   # 평가 방법 파라미터 (임상 임계값 아님)


def _clip(p: np.ndarray) -> np.ndarray:
    e = EVAL_CONFIG["prob_clip"]
    return np.clip(np.asarray(p, dtype=float), e, 1 - e)


def auroc(y: np.ndarray, p: np.ndarray) -> float:
    return float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else float("nan")


def auprc(y: np.ndarray, p: np.ndarray) -> float:
    return float(average_precision_score(y, p)) if len(np.unique(y)) > 1 else float("nan")


def calibration_slope_intercept(y: np.ndarray, p: np.ndarray) -> dict:
    """기울기: y ~ logit(p) 로지스틱 회귀 계수. 절편: 기울기 1 고정(offset) 모델의 절편."""
    y = np.asarray(y).astype(int)
    if len(np.unique(y)) < 2:
        return {"cal_slope": float("nan"), "cal_intercept": float("nan")}
    z = logit(_clip(p))
    slope = float(LogisticRegression(C=1e6, max_iter=1000).fit(z.reshape(-1, 1), y).coef_[0, 0])
    res = minimize_scalar(lambda b: log_loss(y, _clip(expit(z + b)), labels=[0, 1]), bounds=(-10, 10), method="bounded")
    return {"cal_slope": slope, "cal_intercept": float(res.x)}


def _bin_index(p: np.ndarray, n_bins: int) -> np.ndarray:
    edges = np.linspace(0, 1, n_bins + 1)
    return np.clip(np.digitize(p, edges[1:-1]), 0, n_bins - 1)


def ece_binary(y: np.ndarray, p: np.ndarray) -> float:
    y, p = np.asarray(y).astype(float), np.asarray(p, dtype=float)
    b = _bin_index(p, EVAL_CONFIG["n_bins"])
    return float(sum((b == i).mean() * abs(y[b == i].mean() - p[b == i].mean()) for i in range(EVAL_CONFIG["n_bins"]) if (b == i).any()))


def reliability_table(y: np.ndarray, p: np.ndarray) -> pd.DataFrame:
    y, p = np.asarray(y).astype(float), np.asarray(p, dtype=float)
    n_bins = EVAL_CONFIG["n_bins"]
    b = _bin_index(p, n_bins)
    rows = [{"bin": i, "n": int((b == i).sum()), "mean_pred": p[b == i].mean() if (b == i).any() else np.nan, "frac_pos": y[b == i].mean() if (b == i).any() else np.nan}
            for i in range(n_bins)]
    return pd.DataFrame(rows)


def binary_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    y = np.asarray(y).astype(int)
    return {"n": int(len(y)), "prevalence": float(y.mean()), "auroc": auroc(y, p), "auprc": auprc(y, p), "ece": ece_binary(y, p),
            "brier": float(brier_score_loss(y, _clip(p))), **calibration_slope_intercept(y, p)}


def stage_metrics(y: np.ndarray, P: np.ndarray, thresholds: dict | None = None) -> tuple[dict, np.ndarray]:
    y = np.asarray(y).astype(int)
    pred = decide_stage(P, thresholds)
    conf = P[np.arange(len(P)), pred]
    labels = list(range(len(T.STAGES)))
    recalls = {s: float(((pred == k) & (y == k)).sum() / max((y == k).sum(), 1)) for k, s in enumerate(T.STAGES)}
    out = {
        "accuracy": float((pred == y).mean()),
        "adjacent_accuracy": float((np.abs(pred - y) <= 1).mean()),
        "balanced_accuracy": float(np.mean(list(recalls.values()))),
        **{f"recall_{s}": v for s, v in recalls.items()},
        **{f"pred_share_{s}": float((pred == k).mean()) for k, s in enumerate(T.STAGES)},
        "logloss": float(log_loss(y, _clip(P) / _clip(P).sum(axis=1, keepdims=True), labels=labels)),
        "ece_top": ece_binary(pred == y, conf),
        **{f"ece_class_{s}": ece_binary(y == k, P[:, k]) for k, s in enumerate(T.STAGES)},
    }
    return out, confusion_matrix(y, pred, labels=labels)


def threshold_metrics(y: np.ndarray, P: np.ndarray) -> dict:
    """CUMULATIVE_THRESHOLDS 각각의 이진 지표. 키: <metric>_<threshold>."""
    y, Q = np.asarray(y).astype(int), cumulative_probs(P)
    return {f"{m}_{name}": v for name, k in T.CUMULATIVE_THRESHOLDS.items() for m, v in binary_metrics(y >= k, Q[:, k - 1]).items()}


def age_groups(age: np.ndarray) -> np.ndarray:
    return np.asarray(T.AGE_GROUP_LABELS)[np.digitize(np.asarray(age, dtype=float), T.AGE_GROUP_BINS)]


def _cell_metrics(y: np.ndarray, P: np.ndarray, thresholds: dict | None = None) -> dict:
    sm, _ = stage_metrics(y, P, thresholds)
    Q = cumulative_probs(P)
    out = {"ece_top": sm["ece_top"], "accuracy": sm["accuracy"]}
    for name, k in T.CUMULATIVE_THRESHOLDS.items():
        out[f"auroc_{name}"] = auroc(y >= k, Q[:, k - 1])
        out[f"ece_{name}"] = ece_binary(y >= k, Q[:, k - 1])
    return out


def subgroup_table(y: np.ndarray, P: np.ndarray, male: np.ndarray, age: np.ndarray, thresholds: dict | None = None) -> pd.DataFrame:
    """성별 × 연령대 6셀 + 성별 전체(age_group='all')."""
    y = np.asarray(y).astype(int)
    sex, ag = np.where(np.asarray(male) == 1, "male", "female"), age_groups(age)
    rows = []
    for s in ("male", "female"):
        for g in (*T.AGE_GROUP_LABELS, "all"):
            m = (sex == s) & ((ag == g) if g != "all" else True)
            rows.append({"sex": s, "age_group": g, "n": int(m.sum()), **(_cell_metrics(y[m], P[m], thresholds) if m.any() else {})})
    return pd.DataFrame(rows)


def evaluate_split(y: np.ndarray, P: np.ndarray, male: np.ndarray, age: np.ndarray, thresholds: dict | None = None) -> dict:
    sm, cm = stage_metrics(y, P, thresholds)
    sub = subgroup_table(y, P, male, age, thresholds)
    metrics = {**sm, **threshold_metrics(y, P)}
    sex_all = sub[sub["age_group"] == "all"].set_index("sex")
    for name in T.CUMULATIVE_THRESHOLDS:
        col = f"ece_{name}"
        if col in sex_all and sex_all[col].notna().all():
            metrics[f"sex_ece_gap_{name}"] = float(abs(sex_all.loc["male", col] - sex_all.loc["female", col]))
    return {"metrics": metrics, "confusion": cm, "subgroups": sub}


# ---------------------------------------------------------------------------
# 점검용: hypertension 이진 판정, 보조 혈압 회귀
# ---------------------------------------------------------------------------
HTN_THRESHOLD_DEFAULT = 0.5   # 이진화 기본 임계값 (점검용, 임상 임계값 아님)


def youden_threshold(y: np.ndarray, p: np.ndarray) -> float:
    """민감도 + 특이도 − 1 을 최대로 하는 확률 임계값. 한 클래스뿐이면 기본값."""
    y = np.asarray(y).astype(int)
    if len(np.unique(y)) < 2:
        return HTN_THRESHOLD_DEFAULT
    fpr, tpr, thr = roc_curve(y, p)
    i = int(np.argmax(tpr - fpr))
    return float(min(max(thr[i], 0.0), 1.0))


def binary_at_threshold(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    y, pred = np.asarray(y).astype(bool), np.asarray(p) >= thr
    tp, tn = int((pred & y).sum()), int((~pred & ~y).sum())
    fp, fn = int((pred & ~y).sum()), int((~pred & y).sum())
    return {"accuracy": (tp + tn) / len(y), "sensitivity": tp / max(tp + fn, 1), "specificity": tn / max(tn + fp, 1),
            "ppv": tp / max(tp + fp, 1), "n_pred_pos": tp + fp}


def htn_binary_summary(y: np.ndarray, P: np.ndarray, thr_youden: float) -> dict:
    """stage=htn 를 양성으로 P(htn) 을 이진화한 점검 지표. 키: <지표>_htn_<임계값이름>."""
    yb, p = (np.asarray(y).astype(int) == T.STAGE_INDEX["htn"]).astype(int), np.asarray(P)[:, T.STAGE_INDEX["htn"]]
    out = {"htn_threshold_youden": float(thr_youden), "accuracy_htn_all_negative": float(1 - yb.mean())}
    for name, t in (("0.5", HTN_THRESHOLD_DEFAULT), ("youden", thr_youden)):
        out.update({f"{k}_htn_{name}": v for k, v in binary_at_threshold(yb, p, t).items()})
    return out


def regression_metrics(y: np.ndarray, yhat: np.ndarray) -> dict:
    y, yhat = np.asarray(y, dtype=float), np.asarray(yhat, dtype=float)
    r = yhat - y
    ss = float(((y - y.mean()) ** 2).sum())
    return {"rmse": float(np.sqrt(np.mean(r ** 2))), "mae": float(np.mean(np.abs(r))), "bias": float(r.mean()),
            "r2": float(1 - (r @ r) / ss) if ss > 0 else float("nan")}


def bp_derived_metrics(y_stage: np.ndarray, sbp: np.ndarray, dbp: np.ndarray, Yhat: np.ndarray) -> dict:
    """예측 혈압(Yhat[:,0]=sbp, [:,1]=dbp) 의 회귀 오차와, 그 혈압으로 환산한 단계·hypertension 의 점검 지표(비복약 가정)."""
    out = {}
    for j, t in enumerate(("sbp", "dbp")):
        out.update({f"{k}_{t}": v for k, v in regression_metrics([sbp, dbp][j], Yhat[:, j]).items()})
    y = np.asarray(y_stage).astype(int)
    s_hat = stage_index(Yhat[:, 0], Yhat[:, 1], np.zeros(len(y))).astype(int)
    out["stage_accuracy_from_bp"] = float((s_hat == y).mean())
    out["stage_adjacent_accuracy_from_bp"] = float((np.abs(s_hat - y) <= 1).mean())
    out["stage_counts_from_bp"] = {T.STAGES[i]: int((s_hat == i).sum()) for i in range(len(T.STAGES))}
    yb, pb = y == T.STAGE_INDEX["htn"], s_hat == T.STAGE_INDEX["htn"]
    out.update({f"{k}_htn_from_bp": v for k, v in binary_at_threshold(yb, pb.astype(float), 0.5).items()})
    return out

"""
[파일] m1/final_model.py
[용도] 최종 단계 모델 M1-F(사용자 결정 2026-10-26: 현재 입력으로 가능한 최선 = 단계 직접 다중분류 LightGBM). 구성:
      ChainPreprocessor(입력 15열, 필수 age·sex·bmi·waist, 대치 ≥5 제외, 범위 밖 제외, 사용자 결측 규칙) → ChainFeatures(문헌 기준값 중심 표준화 + 나이×·성별× 추가 데이터, 42열)
      → LightGBM multiclass(leaves 31, lr 0.03, 내부 검증 조기 종료) → 단계 = argmax(4단계 확률). 행별 기여 요인은 pred_contrib(SHAP)을 기준 컬럼 단위로 합산해 예측 단계를 올린 상위 항목.
[왜 필요한가] 5겹 교차검증에서 체인 분포 경로보다 정확도 +0.010, AUROC +0.017 로 일관되게 높았고(reports/boost_20261026_111530), 71개 학습기·설정 탐색에서 더 오르는 조합이 없었음(reports/maxsearch_20261026_125451).
[주의] 명세 제약(단조·금지 패턴·mmHg 미출력)은 사용자 결정으로 해제된 상태이나 이 모델은 혈압을 입력으로 쓰지 않는다. 복약 컬럼이 없어 라벨은 비복약 가정.
[쓰는 곳] train_final.py, predict_final.py, tests/test_final.py
"""

from __future__ import annotations

import json
import pickle
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

import thresholds as T
from .chain import CONTINUOUS, IMPUTED_COUNT_COLS, SEX_ALIASES, ChainFeatures, ChainPreprocessor, _waist_design, reference_center, stage_from_bp

PARAMS = dict(objective="multiclass", num_class=4, learning_rate=0.03, n_estimators=4000, num_leaves=31, max_depth=-1, min_child_samples=50, subsample=0.8, subsample_freq=1,
              colsample_bytree=0.8, reg_lambda=1.0, deterministic=True, force_row_wise=True, verbose=-1)
EARLY_STOPPING = 100
VAL_SHARE = 0.15
TOP_FACTORS = 3


def _base_of(col: str, base_cols: list[str]) -> str:
    """상호작용 열 → 기준 컬럼(age_x_bmi → bmi, male_x_binge → binge, age_x_male → age)."""
    for p in ("age_x_", "male_x_"):
        if col.startswith(p):
            rest = col[len(p):]
            return rest if rest in base_cols else ("age" if rest == "male" else rest)
    return col


class FinalStageModel:
    def __init__(self, seed: int = 42, params: dict | None = None):
        self.seed = seed
        self.params = dict(PARAMS, **(params or {}))
        self.pre: ChainPreprocessor | None = None
        self.feats: ChainFeatures | None = None
        self.model: lgb.LGBMClassifier | None = None
        self.meta: dict = {}

    # ------------------------------------------------------------ 학습
    def fit(self, df: pd.DataFrame, val_mask: np.ndarray | None = None) -> "FinalStageModel":
        """df: 라벨(sbp·dbp) 있는 원본 표. val_mask 가 없으면 무작위 15% 를 내부 검증(조기 종료)으로 뗀다."""
        d = ChainPreprocessor.coerce(df)
        pre = ChainPreprocessor()
        keep = (pre.reasons(d) == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
        d = d[keep].reset_index(drop=True)
        y = stage_from_bp(d["sbp"].to_numpy(float), d["dbp"].to_numpy(float))
        if val_mask is None:
            rng = np.random.default_rng(self.seed)
            val_mask = np.zeros(len(d), bool); val_mask[rng.permutation(len(d))[: int(len(d) * VAL_SHARE)]] = True
        tr, va = np.where(~val_mask)[0], np.where(val_mask)[0]
        self.pre = pre.fit(d.iloc[tr])
        X, _, _ = self.pre.transform(d)
        self.feats = ChainFeatures(False, center="reference").fit(X.iloc[tr])
        Z = self.feats.transform(X)
        m = lgb.LGBMClassifier(**dict(self.params, random_state=self.seed))
        m.fit(Z.iloc[tr], y[tr], eval_set=[(Z.iloc[va], y[va])], callbacks=[lgb.early_stopping(EARLY_STOPPING, verbose=False)])
        self.model = m
        Pv = m.predict_proba(Z.iloc[va])
        self.meta = {"rows_used": int(len(d)), "rows_train": int(len(tr)), "rows_val": int(len(va)), "best_iteration": int(m.best_iteration_ or 0), "columns": self.feats.columns,
                     "base_columns": self.pre.columns, "val_accuracy": float((Pv.argmax(1) == y[va]).mean()), "val_stage_counts": np.bincount(y[va], minlength=4).tolist(),
                     "stage_counts": np.bincount(y, minlength=4).tolist(), "params": {k: v for k, v in self.params.items()}, "rule": "argmax"}
        return self

    # ------------------------------------------------------------ 추론
    def _inputs(self, df: pd.DataFrame):
        X, keep, d = self.pre.transform(df)
        return self.feats.transform(X), X, keep, d

    def predict_frame(self, df: pd.DataFrame, with_factors: bool = True) -> pd.DataFrame:
        """행별 단계·확률·기여 요인. 제외 행은 note 에 사유."""
        Z, X, keep, d = self._inputs(df)
        ids = d["person_id"].astype(str) if "person_id" in d.columns else pd.Series(np.arange(len(d)).astype(str), index=d.index)
        out = pd.DataFrame({"person_id": ids.to_numpy()})
        out["stage"] = ""
        for s in T.STAGES:
            out[f"P_{s}"] = np.nan
        out["top_factors"] = ""
        out["note"] = np.where(keep, "", "예측 불가: " + d["__reason"].astype(str))
        if keep.any():
            P = self.model.predict_proba(Z)
            st = P.argmax(1)
            out.loc[keep, "stage"] = np.asarray(T.STAGES)[st]
            for k, s in enumerate(T.STAGES):
                out.loc[keep, f"P_{s}"] = np.round(P[:, k], 4)
            if with_factors:
                out.loc[keep, "top_factors"] = self.top_factors(Z, st)
        return out

    def top_factors(self, Z: pd.DataFrame, st: np.ndarray) -> list[str]:
        """예측 단계의 SHAP 기여를 기준 컬럼으로 합산해 양의 기여 상위 TOP_FACTORS 를 'bmi(+0.31)' 형식으로."""
        C = np.asarray(self.model.booster_.predict(Z, pred_contrib=True))
        n_feat = Z.shape[1]
        C = C.reshape(len(Z), 4, n_feat + 1)[:, :, :n_feat]   # (n, class, feature)
        base_cols = self.pre.columns
        owner = [_base_of(c, base_cols) for c in Z.columns]
        groups = {b: [i for i, o in enumerate(owner) if o == b] for b in dict.fromkeys(owner)}
        res = []
        for i in range(len(Z)):
            contrib = {b: float(C[i, st[i], idx].sum()) for b, idx in groups.items()}
            top = sorted(((b, v) for b, v in contrib.items() if v > 0), key=lambda kv: -kv[1])[:TOP_FACTORS]
            res.append(", ".join(f"{b}(+{v:.2f})" for b, v in top))
        return res

    # ------------------------------------------------------------ 단건 고속 경로 (pandas 없이, 배치 경로와 같은 값)
    @staticmethod
    def _num(v):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return float("nan")
        return x

    def _vector_one(self, record: dict) -> tuple[np.ndarray | None, str]:
        """dict 한 건 → 모델 입력 벡터(feats.columns 순서). 거부되면 (None, 사유). ChainPreprocessor._apply / ChainFeatures.transform 과 같은 규칙."""
        pre, fe, st = self.pre, self.feats, self.pre.stats
        r = {str(k).strip().lower(): v for k, v in record.items()}
        sx = str(r.get("sex", "")).strip().lower() if r.get("sex") is not None else ""
        sex = next((k for k, al in SEX_ALIASES.items() if sx in al), None)
        v = {c: self._num(r.get(c)) for c in IMPUTED_COUNT_COLS + ["age", "bmi"]}
        # 거부 사유: 필수 결측 → 범위 밖 → 대치 과다 (reasons() 와 같은 순서)
        for c in pre.required:
            if (c == "sex" and sex is None) or (c != "sex" and np.isnan(v.get(c, float("nan")))):
                return None, f"{c}_missing"
        for c, (lo, hi) in pre.ranges.items():
            x = v.get(c, float("nan"))
            if not np.isnan(x) and (x < lo or x > hi):
                return None, f"{c}_out_of_range"
        if pre.max_imputed is not None:
            cols = [c for c in IMPUTED_COUNT_COLS if c not in pre.required and (c in pre.columns or c in ("alcohol_per_day", "binge", "alcohol_week"))]
            if sum(np.isnan(v[c]) for c in cols) >= pre.max_imputed:
                return None, f"imputed_ge_{pre.max_imputed}"
        male = 1.0 if sex == "male" else 0.0
        age, bmi = v["age"], v["bmi"]
        aw = 0.0 if np.isnan(v["alcohol_week"]) else v["alcohol_week"]
        ap_ = 0.0 if np.isnan(v["alcohol_per_day"]) else v["alcohol_per_day"]
        fl = self._num(r.get("activity_low_flag"))
        am = v["activity_minutes_week"]
        if np.isnan(am):
            am = st["activity_mode_high"] if fl == 0 else st["activity_mode_low"]
        base = {"age": age, "male": male, "bmi": bmi,
                "alcohol_15plus": 1.0 if aw >= T.ALCOHOL_WEEK_CAP else 0.0, "alcohol_week": min(aw, T.ALCOHOL_WEEK_CAP), "alcohol_per_day": 1.0 if aw >= T.ALCOHOL_WEEK_CAP else ap_,
                "binge": 0.0 if np.isnan(v["binge"]) else v["binge"], "activity_low_flag": 1.0 if am < T.ACTIVITY_LOW_MIN_PER_WEEK else 0.0,
                "activity_600plus": 1.0 if am >= T.ACTIVITY_MINUTES_CAP else 0.0, "activity_minutes_week": min(am, T.ACTIVITY_MINUTES_CAP),
                "family_htn": 0.0 if np.isnan(v["family_htn"]) else v["family_htn"], "diabetes_flag": 0.0 if np.isnan(v["diabetes_flag"]) else v["diabetes_flag"],
                "fasting_glucose": st["modes"]["fasting_glucose"] if np.isnan(v["fasting_glucose"]) else v["fasting_glucose"],
                "resting_hr": st["modes"]["resting_hr"] if np.isnan(v["resting_hr"]) else v["resting_hr"]}
        w = v["waist_cm"]
        if np.isnan(w):
            w = float(_waist_design(np.array([male]), np.array([bmi]), np.array([age])) @ np.asarray(st["waist_beta"]))
        base["waist_cm"] = w
        # 기준 열 표준화(중심: 기준값 또는 평균)
        Z = {}
        for c in fe.base_columns:
            x = base[c]
            if c in CONTINUOUS:
                ref = reference_center(c, np.array([male])) if fe.center == "reference" else None
                Z[c] = (x - float(ref[0])) / fe.stats[c][1] if ref is not None else (x - fe.stats[c][0]) / fe.stats[c][1]
            else:
                Z[c] = x
        za, zm = Z["age"], Z["male"]
        inter = {"age_x_male": za * zm}
        for c in [c for c in fe.base_columns if c not in ("age", "male")]:
            inter[f"age_x_{c}"] = za * Z[c]; inter[f"male_x_{c}"] = zm * Z[c]
        for c, val in inter.items():
            mu, sd = fe.stats[c]; Z[c] = (val - mu) / sd
        return np.array([Z[c] for c in fe.columns], dtype=float), ""

    def predict_one(self, record: dict, with_factors: bool = True) -> dict:
        x, reason = self._vector_one(record)
        if x is None:
            return {"stage": None, "stage_probs": None, "top_factors": "", "note": f"예측 불가: {reason}", "model_version": self.meta.get("model_version", "")}
        P = np.asarray(self.model.booster_.predict(x[None, :]))[0]
        k = int(P.argmax())
        factors = self.top_factors(pd.DataFrame(x[None, :], columns=self.feats.columns), np.array([k]))[0] if with_factors else ""
        return {"stage": T.STAGES[k], "stage_probs": {s: round(float(P[i]), 4) for i, s in enumerate(T.STAGES)}, "top_factors": factors, "note": "", "model_version": self.meta.get("model_version", "")}

    def check_equivalence(self, df: pd.DataFrame, max_rows: int | None = None) -> dict:
        """단건 경로 = 배치 경로 검증: 같은 행에서 거부 사유·확률이 일치해야 한다."""
        d = df if max_rows is None else df.head(max_rows)
        batch = self.predict_frame(d, with_factors=False)
        recs = d.to_dict(orient="records")
        n_mis, max_diff = 0, 0.0
        for i, rec in enumerate(recs):
            one = self.predict_one(rec, with_factors=False)
            if batch["stage"].iloc[i] == "":
                if one["stage"] is not None or one["note"] != batch["note"].iloc[i]:
                    n_mis += 1
                continue
            if one["stage"] is None:
                n_mis += 1; continue
            diff = max(abs(one["stage_probs"][s] - float(batch[f"P_{s}"].iloc[i])) for s in T.STAGES)
            max_diff = max(max_diff, diff)
            if one["stage"] != batch["stage"].iloc[i] or diff > 1e-3:
                n_mis += 1
        return {"rows": int(len(d)), "mismatches": int(n_mis), "max_prob_diff": float(max_diff), "ok": n_mis == 0}

    def latency(self, record: dict, iters: int = 200, with_factors: bool = True) -> dict:
        self.predict_one(record, with_factors)
        t = []
        for _ in range(iters):
            t0 = time.perf_counter(); self.predict_one(record, with_factors); t.append((time.perf_counter() - t0) * 1000)
        return {"p50_ms": float(np.percentile(t, 50)), "p95_ms": float(np.percentile(t, 95)), "iters": iters, "with_factors": with_factors}

    # ------------------------------------------------------------ 저장
    def save(self, path: Path | str) -> None:
        path = Path(path); path.mkdir(parents=True, exist_ok=True)
        with open(path / "model.pkl", "wb") as f:
            pickle.dump({"pre": self.pre, "feats": self.feats, "model": self.model, "params": self.params, "seed": self.seed, "meta": self.meta}, f)
        (path / "meta.json").write_text(json.dumps(self.meta, ensure_ascii=False, indent=2, default=float), encoding="utf-8")

    @classmethod
    def load(cls, path: Path | str) -> "FinalStageModel":
        with open(Path(path) / "model.pkl", "rb") as f:
            d = pickle.load(f)
        m = cls(d["seed"], d["params"]); m.pre, m.feats, m.model, m.meta = d["pre"], d["feats"], d["model"], d["meta"]
        return m

"""
[파일] tests/test_final.py
[용도] m1/final_model.py 검증: 합성 자료로 학습 → 행별 예측 형태(단계·확률 합 1·제외 사유), 단건 = 배치 일치, 저장·복원 일치, 지연 측정, 기여 요인 형식.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd
import pytest

import thresholds as T
from m1.final_model import FinalStageModel
from tests.test_chain import _frame


@pytest.fixture(scope="module")
def model():
    df = _frame(1500, seed=5)
    return FinalStageModel(seed=1, params={"n_estimators": 200}).fit(df), df


def test_predict_frame_shape_and_probs(model):
    m, df = model
    t = df.copy(); t.loc[0, "bmi"] = np.nan; t.loc[1, "waist_cm"] = np.nan
    pred = m.predict_frame(t.drop(columns=["sbp", "dbp"]))
    assert len(pred) == len(t) and list(pred.columns) == ["person_id", "stage", *[f"P_{s}" for s in T.STAGES], "top_factors", "note"]
    assert pred["stage"].iloc[0] == "" and "bmi_missing" in pred["note"].iloc[0] and "waist_cm_missing" in pred["note"].iloc[1]
    ok = pred["stage"] != ""
    P = pred.loc[ok, [f"P_{s}" for s in T.STAGES]].to_numpy(float)
    assert np.allclose(P.sum(axis=1), 1.0, atol=2e-4) and set(pred.loc[ok, "stage"]) <= set(T.STAGES)
    assert all(np.asarray(T.STAGES)[P.argmax(1)] == pred.loc[ok, "stage"].to_numpy())
    tf = pred.loc[ok, "top_factors"]
    assert (tf != "").mean() > 0.5 and tf[tf != ""].str.contains(r"\(\+", regex=True).all()   # 예측 단계로 미는 양의 기여가 없는 행은 빈 칸


def test_predict_one_matches_frame_and_roundtrip(model, tmp_path):
    m, df = model
    rec = df.drop(columns=["sbp", "dbp"]).iloc[3].to_dict()
    one = m.predict_one(rec)
    row = m.predict_frame(df.drop(columns=["sbp", "dbp"]).iloc[[3]]).iloc[0]
    assert one["stage"] == row["stage"] and abs(one["stage_probs"]["htn"] - float(row["P_htn"])) < 1e-9
    m.save(tmp_path / "f")
    m2 = FinalStageModel.load(tmp_path / "f")
    assert m2.predict_one(rec) == one
    lat = m.latency(rec, iters=5)
    assert lat["p95_ms"] > 0 and lat["iters"] == 5


def test_fast_path_equals_batch(model):
    m, df = model
    t = df.drop(columns=["sbp", "dbp"]).head(300).copy()
    t.loc[2, "bmi"] = np.nan; t.loc[3, "fasting_glucose"] = np.nan; t.loc[4, "alcohol_week"] = 40; t.loc[5, "activity_minutes_week"] = np.nan; t.loc[5, "activity_low_flag"] = 1
    eq = m.check_equivalence(t)
    assert eq["ok"], eq
    rec = t.iloc[2].to_dict()
    assert m.predict_one(rec)["stage"] is None and "bmi_missing" in m.predict_one(rec)["note"]

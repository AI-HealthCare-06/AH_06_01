"""
[파일] tests/test_sex_chain.py
[용도] 성별 분리 역체인(train_sex_chain.py) 끝까지 돌리기: 합성 데이터로 학습·CV·테스트 예측·모델 저장이 되는지, 저장한 모델을 predict_sex_chain.py 가 읽어 같은 단계를 내는지,
      단계 규칙(라벨 설정)이 예측에 반영되는지, 행 검증에 걸린 행은 note 만 채우는지.
[쓰는 곳] pytest
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

import predict_sex_chain as P
import thresholds as T
import train_sex_chain as TS
from m1.chain import stage3_from_bp
from tests.test_chain import _frame


def _write(df: pd.DataFrame, folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True); df.to_csv(folder / name, index=False); return folder


def test_train_save_predict_roundtrip(tmp_path):
    df = _frame(n=900, seed=3); rng = np.random.default_rng(7)   # _frame 의 혈압은 대부분 htn 이라 세 단계가 섞이도록 다시 만든다
    df["sbp"] = 82 + 0.4 * df["age"] + 0.9 * df["bmi"] + 3 * (df["sex"] == "male") + rng.normal(0, 12, len(df))
    df["dbp"] = 48 + 0.1 * df["age"] + 0.5 * df["bmi"] + 0.25 * (df["sbp"] - 120) + rng.normal(0, 7, len(df))
    tr = _write(df.iloc[:700], tmp_path / "train", "synthetic_train.csv")
    te_df = df.iloc[700:].drop(columns=["sbp", "dbp"]).reset_index(drop=True); te_df.loc[0, "bmi"] = np.nan   # 행 검증 탈락 행
    te = _write(te_df, tmp_path / "test", "synthetic_test.csv")
    rep = TS.main(["--data", str(tr), "--test-data", str(te), "--label", "dbp_rule", "--cv-folds", "2", "--samples", "10", "--out", str(tmp_path / "reports"), "--artifacts", str(tmp_path / "artifacts")])
    assert (rep / "summary.md").exists() and (rep / "test_predictions.xlsx").exists()
    arts = sorted((tmp_path / "artifacts").glob("sexchain_dbp_rule_*")); assert len(arts) == 1
    meta = json.loads((arts[0] / "meta.json").read_text(encoding="utf-8"))
    assert meta["use_dbp"] is True and meta["train_file_count"] == 1 and "synthetic" not in json.dumps(meta)   # 파일 이름 미기록
    bundle = P.load_bundle(arts[0]); assert set(bundle["models"]) == {"male", "female"}
    out = P.predict_frame(bundle, te_df, K=10)
    assert len(out) == len(te_df)
    assert out.loc[0, "stage3_point"] == "" and out.loc[0, "note"].startswith("예측 불가")
    ok = out["stage3_point"] != ""
    assert ok.sum() >= len(te_df) - 5 and set(out.loc[ok, "stage3_point"]).issubset(set(T.STAGE3)) and set(out.loc[ok, "stage3_dist"]).issubset(set(T.STAGE3))
    # 점추정 단계 = 저장된 규칙(dbp 포함)으로 예측 sbp·dbp 를 자른 것
    exp = np.asarray(T.STAGE3)[stage3_from_bp(out.loc[ok, "sbp_pred"].to_numpy(float), out.loc[ok, "dbp_pred"].to_numpy(float), True)]
    assert (out.loc[ok, "stage3_point"].to_numpy() == exp).mean() > 0.95   # 소수점 반올림으로 경계 행만 다를 수 있음
    probs = out.loc[ok, [f"p_{s}" for s in T.STAGE3]].to_numpy(float); assert np.allclose(probs.sum(1), 1.0, atol=1e-6)
    # 학습 스크립트가 낸 테스트 예측과 같은 행에서 같은 점추정
    tp = pd.read_csv(rep / "test_predictions.csv", dtype=str).fillna("")
    j = out.merge(tp[["person_id", "stage3_point"]], on="person_id", suffixes=("", "_train_script"))
    assert (j["stage3_point"] == j["stage3_point_train_script"]).all()
    # CLI 단건
    res = P.main(["--model", str(arts[0]), "--json", json.dumps({"age": 55, "sex": "male", "bmi": 27.0, "waist_cm": 92, "alcohol_week": 7, "activity_minutes_week": 120, "family_htn": 1, "fasting_glucose": 98, "resting_hr": 72})])
    assert res["stage3_point"] in T.STAGE3 and res["note"] == ""

"""
[파일] predict_sex_chain.py
[용도] 성별 분리 역체인(dbp→sbp) 모델 추론 CLI. train_sex_chain.py 가 저장한 artifacts/sexchain_<라벨>_<시각>/model.pkl 을 읽어 단건(--json '{...}') 또는 파일(--data 경로, csv/xlsx, 혈압 열 불필요)에
      행마다 예측 dbp·sbp, 3단계 점추정(stage3_point), 분포 argmax(stage3_dist), 3단계 확률을 낸다. 단계 규칙은 저장된 라벨 설정(sbp 122/140 만 또는 dbp 80/90 포함)을 따른다.
      --model 을 주지 않으면 artifacts/sexchain_* 중 최신을 쓴다. 파일 입력은 <출력 폴더>/predictions.xlsx(시트 pred, stage_only)·csv 로 저장한다. 행 검증에서 떨어진 행은 note 에 사유를 적는다.
[쓰는 곳] python3 predict_sex_chain.py --json '{"age":52,"sex":"male","bmi":27.5,"waist_cm":95,...}' | python3 predict_sex_chain.py --data test/ --out reports
"""

from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from analysis_pack import style
from m1.chain import ChainPreprocessor, load_frame, stage3_from_bp
from m1.continuous import dispersion_groups
from train_sex_chain import ReverseChain  # noqa: F401  (pickle 에 train_sex_chain.ReverseChain 이 들어 있다)


def latest_model(root: str = "artifacts") -> Path:
    runs = sorted(p for p in Path(root).glob("sexchain_*") if (p / "model.pkl").exists())
    if not runs:
        raise SystemExit("artifacts/sexchain_* 가 없다. 먼저 train_sex_chain.py 를 실행한다.")
    return runs[-1]


def load_bundle(path: str | Path) -> dict:
    with open(Path(path) / "model.pkl", "rb") as fh:
        return pickle.load(fh)


def predict_frame(bundle: dict, df: pd.DataFrame, K: int | None = None) -> pd.DataFrame:
    """혈압 열 없는 입력 프레임 → 행별 예측. 성별이 없거나 행 검증에 걸린 행은 note 만 채운다."""
    K = K or bundle.get("samples", 100); use_dbp = bool(bundle["use_dbp"]); S3 = np.asarray(bundle["stage3"])
    dt = ChainPreprocessor.coerce(df)
    ids = dt["person_id"].astype(str).to_numpy() if "person_id" in dt.columns else np.array([f"row{i}" for i in range(len(dt))])
    out = pd.DataFrame({"person_id": ids, "sex": dt["sex"].astype(str).to_numpy() if "sex" in dt.columns else "", "sbp_pred": np.nan, "dbp_pred": np.nan, "stage3_point": "", "stage3_dist": ""})
    for st in bundle["stage3"]:
        out[f"p_{st}"] = np.nan
    out["note"] = ""
    for sex, parts in bundle["models"].items():
        msk = (out["sex"] == sex).to_numpy()
        if not msk.any():
            continue
        Xt, keep_t, dts = parts["pre"].transform(dt[msk]); idx_all = np.where(msk)[0]; idx_ok = idx_all[keep_t]
        out.loc[idx_all[~keep_t], "note"] = "예측 불가: " + dts.loc[~keep_t, "__reason"].astype(str).to_numpy()
        if not keep_t.any():
            continue
        ch, fd, fs = parts["chain"], parts["fd"], parts["fs"]; Xd_t = fd.transform(Xt)
        d_hat, s_hat = ch.predict_point(Xd_t, Xt, fs); P = ch.predict_dist(Xd_t, Xt, fs, dispersion_groups(Xt), K=K, use_dbp=use_dbp)
        out.loc[idx_ok, "sbp_pred"], out.loc[idx_ok, "dbp_pred"] = np.round(s_hat, 1), np.round(d_hat, 1)
        out.loc[idx_ok, "stage3_point"] = S3[stage3_from_bp(s_hat, d_hat, use_dbp)]; out.loc[idx_ok, "stage3_dist"] = S3[P.argmax(1)]
        for j, st in enumerate(bundle["stage3"]):
            out.loc[idx_ok, f"p_{st}"] = np.round(P[:, j], 3)
    unknown = ~out["sex"].isin(list(bundle["models"].keys())).to_numpy(); out.loc[unknown, "note"] = "예측 불가: sex_missing"
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="artifacts/sexchain_<라벨>_<시각> 폴더(기본: 최신)"); ap.add_argument("--json", default=None); ap.add_argument("--data", default=None)
    ap.add_argument("--out", default="reports"); ap.add_argument("--samples", type=int, default=None)
    a = ap.parse_args(argv)
    if not a.json and not a.data:
        raise SystemExit("--json 또는 --data 가 필요하다")
    mdir = Path(a.model) if a.model else latest_model(); bundle = load_bundle(mdir)
    if a.json:
        row = json.loads(a.json); row.setdefault("person_id", "input")
        res = predict_frame(bundle, pd.DataFrame([row]), a.samples).iloc[0].to_dict()
        print(json.dumps({k: (None if (isinstance(v, float) and np.isnan(v)) else v) for k, v in res.items()}, ensure_ascii=False, indent=2)); return res
    raw, _ = load_frame(a.data); out = predict_frame(bundle, raw, a.samples)
    rep = Path(a.out) / f"predict_sexchain_{datetime.now():%Y%m%d_%H%M%S}"; rep.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(rep / "predictions.xlsx", engine="openpyxl") as w:
        out.to_excel(w, sheet_name="pred", index=False); style(w.book["pred"], nd=1, freeze="B2")
        out[["person_id", "stage3_point", "stage3_dist", "note"]].to_excel(w, sheet_name="stage_only", index=False); style(w.book["stage_only"], nd=1, freeze="B2")
    out.to_csv(rep / "predictions.csv", index=False)
    n_ok = int((out["stage3_point"] != "").sum())
    print(f"모델 {bundle['model_version']} (라벨 {bundle['label']}): {len(out)}행 중 {n_ok}행 예측 → {rep}/predictions.xlsx")
    return rep


if __name__ == "__main__":
    main()

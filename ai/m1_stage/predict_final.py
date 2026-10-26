"""
[파일] predict_final.py
[용도] 최종 모델 M1-F 추론 CLI. 단건(--json '{...}') 또는 파일(--data 경로, csv/xlsx, 혈압 열 불필요)을 받아 행마다 단계·4단계 확률·기여 요인을 낸다.
      --model 을 주지 않으면 artifacts/final_* 중 최신을 쓴다. 파일 입력은 <출력 폴더>/predictions.xlsx(시트 pred, stage_only)·csv 로 저장한다.
[왜 필요한가] 최종 산출물은 "사용자가 정보를 입력하면 단계를 내는 모델"이어야 한다(사용자 요구 2026-10-19).
[쓰는 곳] python3 predict_final.py --json '{"age":52,"sex":"male","bmi":27.5,"waist_cm":95,...}' | python3 predict_final.py --data test/ --out reports
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from analysis_pack import style
from m1.chain import load_frame
from m1.final_model import FinalStageModel


def latest_final(root: str = "artifacts") -> Path:
    runs = sorted(p for p in Path(root).glob("final_*") if (p / "model.pkl").exists())
    if not runs:
        raise SystemExit("artifacts/final_* 가 없다. 먼저 train_final.py 를 실행한다.")
    return runs[-1]


def main(argv=None):
    ap = argparse.ArgumentParser(description="M1-F 추론")
    ap.add_argument("--model", default=None)
    ap.add_argument("--json", default=None, help="단건 입력(JSON 문자열)")
    ap.add_argument("--data", default=None, help="파일 또는 폴더(csv/xlsx)")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    m = FinalStageModel.load(a.model or latest_final())
    if a.json:
        print(json.dumps(m.predict_one(json.loads(a.json)), ensure_ascii=False, indent=2))
    if a.data:
        df, files = load_frame(a.data)
        pred = m.predict_frame(df)
        out = Path(a.out) / f"predict_final_{datetime.now():%Y%m%d_%H%M%S}"
        out.mkdir(parents=True, exist_ok=True)
        with pd.ExcelWriter(out / "predictions.xlsx", engine="openpyxl") as w:
            pred.to_excel(w, sheet_name="pred", index=False); style(w.book["pred"], nd=4, freeze="B2")
            pred[["person_id", "stage", "note"]].to_excel(w, sheet_name="stage_only", index=False); style(w.book["stage_only"], nd=1, freeze="B2")
        pred.to_csv(out / "predictions.csv", index=False)
        n_ok = int((pred["stage"] != "").sum())
        print(f"{len(pred)}행 중 예측 {n_ok}행, 제외 {len(pred) - n_ok}행 → {out}/predictions.xlsx (모델 {m.meta.get('model_version', '')})")
    if not a.json and not a.data:
        ap.error("--json 또는 --data 가 필요하다")


if __name__ == "__main__":
    main()

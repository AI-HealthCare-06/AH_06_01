"""
[파일] train_final.py
[용도] 최종 모델 M1-F(m1/final_model.py) 학습 CLI. ① 시간 분할(학습 70 / 검증 15 / 테스트 15, 연도 순)로 한 번 학습해 테스트 지표(정확도·AUROC·혼동행렬·나이대×성별)를 보고하고,
      ② 전체 라벨 행(내부 검증 15% 무작위)로 최종 모델을 학습해 artifacts/final_<run>/ 에 저장하며, ③ --test-data 파일의 행마다 단계·확률·기여 요인을 예측하고 단건 추론 지연(p95)을 잰다.
[왜 필요한가] 사용자 결정(2026-10-26): 현재 입력으로 가능한 최선인 다중분류 LightGBM으로 마무리. 결과 reports/final_<run>/
[쓰는 곳] python3 train_final.py --data train/ --test-data test/
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import thresholds as T
from analysis_pack import style
from m1.chain import ChainPreprocessor, load_frame, stage_from_bp
from m1.evaluate import age_groups, auroc, ece_binary
from m1.final_model import FinalStageModel
from m1.pipeline import log, sample_input
from m1.report import md_table
from m1.splits import make_splits

EXAMPLE = {"age": 52, "sex": "male", "bmi": 27.5, "waist_cm": 95, "alcohol_week": 21, "alcohol_per_day": 1, "binge": 1, "activity_minutes_week": 60, "activity_low_flag": 1,
           "family_htn": 1, "diabetes_flag": 0, "fasting_glucose": 104, "resting_hr": 72}


def evaluate(pred: pd.DataFrame, y: np.ndarray, age: np.ndarray, male: np.ndarray) -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    P = pred[[f"P_{s}" for s in T.STAGES]].to_numpy(float)
    st = P.argmax(1)
    rec = {s: float(((st == k) & (y == k)).sum() / max((y == k).sum(), 1)) for k, s in enumerate(T.STAGES)}
    m = {"accuracy": float((st == y).mean()), "adjacent_accuracy": float((np.abs(st - y) <= 1).mean()), "balanced_accuracy": float(np.mean(list(rec.values()))),
         **{f"recall_{s}": v for s, v in rec.items()}, **{f"pred_share_{s}": float((st == k).mean()) for k, s in enumerate(T.STAGES)},
         "auroc_140_90": auroc((y == 3).astype(int), P[:, 3]), "auroc_130_80": auroc((y >= 2).astype(int), P[:, 2] + P[:, 3]), "ece_140_90": ece_binary(y == 3, P[:, 3]),
         "expected_max_acc": float(P.max(1).mean()), "baseline_all_normal": float((y == 0).mean())}
    cm = pd.DataFrame([[int(((y == i) & (st == j)).sum()) for j in range(4)] for i in range(4)], index=[f"actual_{s}" for s in T.STAGES], columns=[f"pred_{s}" for s in T.STAGES]).reset_index().rename(columns={"index": "actual"})
    ag, sex = age_groups(age), np.where(male == 1, "male", "female")
    rows = []
    for s_ in ("female", "male"):
        for g in T.AGE_GROUP_LABELS:
            mm = (sex == s_) & (ag == g)
            rows.append({"sex": s_, "age_group": g, "n": int(mm.sum()), "accuracy": float((st[mm] == y[mm]).mean()), "baseline_all_normal": float((y[mm] == 0).mean()), "auroc_140_90": auroc((y[mm] == 3).astype(int), P[mm, 3])})
    return m, cm, pd.DataFrame(rows)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--test-data", default=None)
    ap.add_argument("--time-col", default="exam_year")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="reports")
    ap.add_argument("--artifacts", default="artifacts")
    a = ap.parse_args(argv)
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    rep, art = Path(a.out) / f"final_{run_id}", Path(a.artifacts) / f"final_{run_id}"
    rep.mkdir(parents=True, exist_ok=True)
    raw, files = load_frame(a.data)
    d = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d) == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy()
    d = d[keep].reset_index(drop=True)
    y = stage_from_bp(d["sbp"].to_numpy(float), d["dbp"].to_numpy(float))
    log(f"[1/4] 데이터 {len(raw)}행 → 사용 {len(d)}행 (제외 {int((~keep).sum())}행). 단계 분포 {dict(zip(T.STAGES, np.bincount(y, minlength=4).tolist()))}")

    # ① 시간 분할 평가
    splits, sinfo = make_splits(y, d[a.time_col], seed=a.seed)
    tr, va, te = splits["train"], splits["val"], splits["test"]
    trva = np.sort(np.concatenate([tr, va])); val_mask = np.isin(trva, va)
    m_ts = FinalStageModel(a.seed).fit(d.iloc[trva], val_mask=val_mask)
    pred_te = m_ts.predict_frame(d.iloc[te], with_factors=False)
    Xte, _, _ = m_ts.pre.transform(d.iloc[te])
    metrics, cm, sub = evaluate(pred_te, y[te], Xte["age"].to_numpy(), Xte["male"].to_numpy())
    log(f"[2/4] 시간 분할 테스트 {len(te)}행: 정확도 {metrics['accuracy']:.4f} (기준선 {metrics['baseline_all_normal']:.4f}), AUROC≥140/90 {metrics['auroc_140_90']:.4f}, ≥130/80 {metrics['auroc_130_80']:.4f}, 트리 {m_ts.meta['best_iteration']}")

    # ② 최종 모델: 전체 라벨 행
    final = FinalStageModel(a.seed).fit(d)
    final.meta["model_version"] = f"M1-F-{run_id}"
    final.meta["train_file_count"] = len(files)   # 파일 이름은 기록하지 않는다(데이터 출처 비공개 규칙)
    final.meta["time_split_metrics"] = metrics
    final.save(art)
    lat = final.latency(EXAMPLE); lat_nf = final.latency(EXAMPLE, with_factors=False)
    eq = final.check_equivalence(d.iloc[te].drop(columns=["sbp", "dbp"]))
    if not eq["ok"]:
        raise RuntimeError(f"단건 경로가 배치 경로와 불일치: {eq}")
    final.meta["latency"] = {"with_factors": lat, "without_factors": lat_nf}; final.meta["equivalence"] = eq; final.save(art)
    log(f"[3/4] 최종 모델: {final.meta['rows_train']}행 학습 / {final.meta['rows_val']}행 내부 검증(정확도 {final.meta['val_accuracy']:.4f}), 트리 {final.meta['best_iteration']}, "
        f"단건 p95 {lat['p95_ms']:.1f} ms(기여 요인 포함) / {lat_nf['p95_ms']:.1f} ms(제외), 단건=배치 검증 {eq['rows']}행 불일치 {eq['mismatches']} → {art}")

    # ③ 테스트 파일 예측
    test_info = None
    if a.test_data:
        dft, _ = load_frame(a.test_data)
        pred = final.predict_frame(dft)
        with pd.ExcelWriter(rep / "test_predictions.xlsx", engine="openpyxl") as w:
            pred.to_excel(w, sheet_name="pred", index=False); style(w.book["pred"], nd=4, freeze="B2")
            pred[["person_id", "stage", "note"]].to_excel(w, sheet_name="stage_only", index=False); style(w.book["stage_only"], nd=1, freeze="B2")
        pred.to_csv(rep / "test_predictions.csv", index=False)
        test_info = {"rows": int(len(pred)), "predicted": int((pred["stage"] != "").sum()), "dropped": pred.loc[pred["stage"] == "", "note"].value_counts().to_dict(), "stage_share": pred.loc[pred["stage"] != "", "stage"].value_counts(normalize=True).round(3).to_dict()}
        log(f"[4/4] 테스트 파일 {test_info['rows']}행 → 예측 {test_info['predicted']}행 → {rep}/test_predictions.xlsx")

    ex = final.predict_one(EXAMPLE)
    L = [f"# 최종 모델 M1-F — {rep.name}\n",
         f"- 구성: ChainPreprocessor(입력 {len(final.pre.columns)}열, 필수 {final.pre.required}, 대치 ≥{final.pre.max_imputed} 제외, 범위 {final.pre.ranges}) → ChainFeatures(문헌 기준값 중심, 추가 데이터) {len(final.feats.columns)}열 → LightGBM multiclass → argmax",
         f"- 데이터 {len(raw)}행 → 사용 {len(d)}행. 최종 모델: 학습 {final.meta['rows_train']} / 내부 검증 {final.meta['rows_val']}행, 트리 {final.meta['best_iteration']}, 내부 검증 정확도 {final.meta['val_accuracy']:.4f}",
         f"- 단건 추론 지연(예시 입력, {lat['iters']}회): 기여 요인 포함 p50 {lat['p50_ms']:.1f} / p95 {lat['p95_ms']:.1f} ms, 제외 p50 {lat_nf['p50_ms']:.1f} / p95 {lat_nf['p95_ms']:.1f} ms. 단건 경로 = 배치 경로 검증: 테스트 분할 {eq['rows']}행 불일치 {eq['mismatches']}, 최대 확률 차 {eq['max_prob_diff']:.1e}\n",
         f"## 1. 시간 분할 평가 (학습 {len(tr)} / 검증 {len(va)} / 테스트 {len(te)}행, {sinfo['method']})\n", md_table(pd.DataFrame([metrics]), nd=4),
         "\n### 혼동행렬 (행=실제, 열=예측)\n", md_table(cm, nd=0), "\n### 성별×연령대\n", md_table(sub, nd=4),
         "\n참고: 5겹 교차검증(reports/boost_20261026_111530) 정확도 0.518 ± 0.006, AUROC≥140/90 0.731 ± 0.007; 71개 학습기·설정 탐색(reports/maxsearch_20261026_125451) 최고 0.520 (잡음 범위).\n",
         "## 2. 예시 입력 → 출력\n", "```json\n" + json.dumps({"input": EXAMPLE, "output": ex}, ensure_ascii=False, indent=2) + "\n```"]
    if test_info:
        L += ["\n## 3. 테스트 파일\n", f"- {test_info['rows']}행 중 예측 {test_info['predicted']}행, 제외 {test_info['dropped']}", f"- 예측 단계 비율 {test_info['stage_share']}", "- 파일: test_predictions.xlsx (시트 pred: 확률·기여 요인 포함 / stage_only: person_id + stage)"]
    L += ["\n주의: 복약 컬럼이 없어 라벨은 비복약 가정. 혈압은 입력에 쓰지 않음. 모델 출력은 참고용이며 진단이 아님.\n"]
    (rep / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    with pd.ExcelWriter(rep / "results.xlsx", engine="openpyxl") as w:
        for name, df in (("시간분할지표", pd.DataFrame([metrics])), ("혼동행렬", cm), ("하위군", sub)):
            df.to_excel(w, sheet_name=name, index=False); style(w.book[name], nd=4, freeze="B2")
    log(f"완료: {rep}/summary.md")
    return rep


if __name__ == "__main__":
    main()

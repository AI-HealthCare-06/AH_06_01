"""build_dataset.py — KNHANES 2013~2022 → 계약 입력 + 라벨 parquet, schema_map.csv, 데이터 감사 리포트

실행:  cd ai && python build_dataset.py [--raw-dir PATH] [--out data/processed]

산출물
  data/processed/knhanes_contract_v1.parquet   포함 기준 통과 행. 계약 입력 열 + 라벨 + 가중치 + 분할 열
  data/schema_map.csv                          계약 피처 ← KNHANES 변수 매핑 + 연도별 결측률
  reports/data_audit_knhanes.md                결측·분포·라벨·분할 요약 (사람이 읽는 리포트)
  reports/missingness_by_year.csv              피처 × 연도 결측률(대치 전)

분할 열
  split_time       train 2013~2019 / val 2020 / test 2021~2022   (인수인계 5장, 주 분할)
  split_random_721 train/val/test = 7:2:1, label_htn × year 층화, seed 42   (보조 분할)
원시자료는 저장소에 올리지 않는다. 이 스크립트의 산출물 중 parquet 도 gitignore 대상이다.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

import labels as L  # noqa: E402
import thresholds_kr_v1 as T  # noqa: E402
from features import contract_v1 as C  # noqa: E402
from features import knhanes_v1 as K  # noqa: E402

AI_ROOT = Path(__file__).resolve().parent
SEED = 42
TIME_SPLIT = {"train": tuple(range(2013, 2020)), "val": (2020,), "test": (2021, 2022)}
LIFESTYLE = ("waist_cm", "smoking_status", "alcohol_units_week", "activity_minutes_week",
             "sleep_avg_h", "sodium_risk_score", "stress_score", "family_htn", "diabetes_flag")


def assign_time_split(year: pd.Series) -> pd.Series:
    m = {y: name for name, ys in TIME_SPLIT.items() for y in ys}
    return year.map(m)


def assign_random_split(df: pd.DataFrame, seed: int = SEED, frac=(0.7, 0.2, 0.1)) -> pd.Series:
    """label_htn × year 층화 7:2:1. 같은 seed 면 항상 같은 배정."""
    rng = np.random.default_rng(seed)
    out = pd.Series(index=df.index, dtype=object)
    for _, g in df.groupby([L.LABEL_HTN, "year"], sort=True):
        idx = g.index.to_numpy().copy()
        rng.shuffle(idx)
        n = len(idx)
        n_tr, n_va = int(round(n * frac[0])), int(round(n * frac[1]))
        out.loc[idx[:n_tr]] = "train"
        out.loc[idx[n_tr:n_tr + n_va]] = "val"
        out.loc[idx[n_tr + n_va:]] = "test"
    return out


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def build(raw_dir: Path, out_dir: Path, reports_dir: Path, schema_path: Path) -> None:
    C.check_ranges_match_thresholds()
    audit: list[str] = ["# KNHANES 2013~2022 데이터 감사 (Feature Contract v1)\n",
                        f"생성: build_dataset.py · 임계값 {T.THRESHOLDS_VERSION} · 피처 {C.FEATURE_VERSION}\n"]

    # 1. 연도별 로드 → 계약 입력
    per_year = {}
    for y in K.YEARS:
        raw = K.load_year(y, raw_dir)
        per_year[y] = K.to_contract(raw, y)
        print(f"[load] {y}: n={len(raw)}", flush=True)
    full = pd.concat(per_year.values(), ignore_index=True)

    # 2. 포함 기준·라벨 (labels.py)
    adults = full[full["age"] >= T.KNHANES_MIN_AGE]
    keep, reasons = L.inclusion_mask(full)
    labeled = L.make_labels(full)
    med_missing = int(keep.sum() - len(labeled))

    audit += ["\n## 1. 표본 흐름\n", "| 단계 | 행 수 |", "|---|---|",
              f"| 원시 전체 (10개년) | {len(full):,} |",
              f"| 성인 {T.KNHANES_MIN_AGE}세 이상 | {len(adults):,} (−{reasons['under_min_age']:,}) |",
              f"| 필수 열(age·sex·키·체중·혈압) 결측 제외 — 검진 미참여 등 | −{reasons['missing_required']:,} ({pct(reasons['missing_required'] / len(adults))} of adults) |",
              f"| 임신 중(HE_prg=1) 제외 | −{reasons['pregnant']:,} |",
              f"| 혈압약 복용 여부(DI1_2) 판정 불가 제외 | −{med_missing:,} |",
              f"| **라벨 생성 완료** | **{len(labeled):,}** |"]

    flow = labeled.groupby("year").agg(n=("age", "size"), htn=(L.LABEL_HTN, "mean"), prehtn=(L.LABEL_PREHTN, "mean"),
                                       on_med=("on_medication", "mean"), mean_age=("age", "mean"))
    flow["htn_weighted"] = [L.weighted_prevalence(g) for _, g in labeled.groupby("year")]
    audit += ["\n### 연도별 표본·유병률 (라벨 완료 행 기준)\n",
              "| 연도 | n | 고혈압(비가중) | 고혈압(가중) | 전단계 이상 | 약 복용 | 평균 나이 |", "|---|---|---|---|---|---|---|"]
    for y, r in flow.iterrows():
        audit.append(f"| {y} | {int(r.n):,} | {pct(r.htn)} | {pct(r.htn_weighted)} | {pct(r.prehtn)} | {pct(r.on_med)} | {r.mean_age:.1f} |")
    audit.append(f"| **전체** | **{len(labeled):,}** | **{pct(labeled[L.LABEL_HTN].mean())}** | **{pct(L.weighted_prevalence(labeled))}** | "
                 f"{pct(labeled[L.LABEL_PREHTN].mean())} | {pct(labeled['on_medication'].mean())} | {labeled['age'].mean():.1f} |")
    audit.append("\n가중 유병률은 전국 성인 고혈압 유병률(약 30%, 질병관리청 팩트시트 기준 2021년 28%)과 비교하는 용도. "
                 "비가중이 더 높은 것은 KNHANES 표본에 고령층 비중이 크기 때문이다.")

    # 혈압 측정 장비 변경(2021~22 성인: Microlife 진동형) 민감도 — 전환식 적용 라벨과 비교
    labeled[L.LABEL_HTN + "_devadj"] = L.label_htn(labeled["HE_sbp_devadj"], labeled["HE_dbp_devadj"], labeled["on_medication"])
    audit += ["\n### 혈압 측정 장비 변경 민감도 (2021~2022 성인은 Microlife 진동형, 전환식 적용 시)\n",
              "| 연도 | 고혈압(원값·공식) | 고혈압(전환식 적용) | SBP 중앙값 원값→전환 | DBP 중앙값 원값→전환 |", "|---|---|---|---|---|"]
    for y in K.DEVICE_CHANGE_YEARS_ADULT:
        g = labeled[labeled["year"] == y]
        audit.append(f"| {y} | {pct(g[L.LABEL_HTN].mean())} | {pct(g[L.LABEL_HTN + '_devadj'].mean())} | "
                     f"{g['HE_sbp'].median():.1f}→{g['HE_sbp_devadj'].median():.1f} | {g['HE_dbp'].median():.1f}→{g['HE_dbp_devadj'].median():.1f} |")
    audit.append("\n지침서(제8·9기): 2020 Greenlight300 은 수은과 차이가 오차범위 내(전환 불필요), 2021~ 성인 Microlife 는 전환식 제공. "
                 "공식 통계와 본 모델의 **주 라벨은 원값**. 전환식 라벨은 `label_htn_devadj` 로 저장해 테스트 세트 민감도 분석에만 쓴다. "
                 "2020년 커프 선정 오류 159건은 원시자료에서 식별할 수 없어 포함돼 있다.")

    # 3. 결측률 (대치 전) — 피처 × 연도
    miss = labeled.groupby("year")[list(LIFESTYLE)].apply(lambda g: g.isna().mean()).T
    miss["all_years"] = labeled[list(LIFESTYLE)].isna().mean()
    miss.to_csv(reports_dir / "missingness_by_year.csv", float_format="%.4f")
    audit += ["\n## 2. 생활습관 피처 결측률 (대치 전, 라벨 완료 행)\n",
              "| 피처 | " + " | ".join(str(y) for y in miss.columns) + " |", "|---|" + "---|" * len(miss.columns)]
    for f, r in miss.iterrows():
        audit.append(f"| {f} | " + " | ".join(pct(v) for v in r) + " |")
    audit.append("\n`age`·`sex`·`bmi` 는 포함 기준에서 이미 결측 0. 대치 규칙과 플래그는 feature_contract_v1.yaml 의 `missing` 항목.")

    # 4. 계약 변환 결과(범위 밖·fallback)
    imp = C.fit_imputers(labeled[labeled["year"].isin(TIME_SPLIT["train"])], source="knhanes_2013_2019")
    _, results = C.transform_frame(labeled.drop(columns=["_activity_raw_minutes"]), imp)
    dq = pd.Series([r.data_quality for r in results]).value_counts()
    oor = pd.Series([f for r in results for f in r.out_of_range]).value_counts()
    mc = pd.Series([int(r.features["missing_count"]) for r in results if r.accepted]).value_counts().sort_index()
    capped = int((labeled["_activity_raw_minutes"] > K.ACTIVITY_CAP_MINUTES).sum())
    audit += ["\n## 3. 계약 변환 (features/contract_v1.build_features)\n",
              "| data_quality | 행 수 |", "|---|---|"] + [f"| {k} | {v:,} |" for k, v in dq.items()]
    audit += ["\n범위 밖(out_of_range) 피처별 건수 — 클리핑하지 않고 제외:\n", "| 피처 | 건수 |", "|---|---|"]
    audit += [f"| {k} | {v:,} |" for k, v in oor.items()] or ["| (없음) | 0 |"]
    audit += [f"\n활동량 2,000분/주 상한 적용: {capped:,}행 ({pct(capped / len(labeled))}) — GPAQ 직업 활동 포함 때문. "
              "모델 입력은 상한값, 원값은 `_activity_raw_minutes` 로 보존.",
              "\nmissing_count 분포(수용 행):\n", "| missing_count | 행 수 |", "|---|---|"] + [f"| {int(k)} | {v:,} |" for k, v in mc.items()]
    lite = sum(1 for r in results if r.accepted and r.model_id == C.MODEL_LITE)
    audit.append(f"\n결측 ≥{C.FALLBACK_MISSING_COUNT} → lite fallback 대상: {lite:,}행 ({pct(lite / max(1, dq.get('ok', 0) + dq.get('partial', 0)))}). "
                 "학습은 full 피처로 대치 후 전부 사용하고, fallback 비율은 추론 시 참고치.")
    audit += [f"\n대치값(학습 2013~2019 에서 계산, 아티팩트에 저장): activity 중앙값 {imp.activity_median:.0f}분/주, "
              f"허리둘레 성별 중앙값 남 {imp.waist_by_sex['male']:.1f} / 여 {imp.waist_by_sex['female']:.1f} cm"]

    # 5. 분포 요약 — 연도 간 코드 변경 탐지용
    audit += ["\n## 4. 피처 분포 (연도별 중앙값) — 급변하면 코드 변경 의심\n"]
    num = ["bmi", "waist_cm", "alcohol_units_week", "activity_minutes_week", "sleep_avg_h", "sodium_risk_score", "stress_score", "HE_sbp", "HE_dbp"]
    med = labeled.groupby("year")[num].median().T
    audit += ["| 피처 | " + " | ".join(str(c) for c in med.columns) + " |", "|---|" + "---|" * len(med.columns)]
    for f, r in med.iterrows():
        audit.append(f"| {f} | " + " | ".join(f"{v:.1f}" for v in r) + " |")
    cat = labeled.groupby("year").agg(current_smoker=("smoking_status", lambda s: (s == "current").mean()),
                                      family_htn=("family_htn", lambda s: (s == True).mean()),  # noqa: E712
                                      diabetes=("diabetes_flag", lambda s: (s == True).mean()),  # noqa: E712
                                      female=("sex", lambda s: (s == "female").mean())).T
    audit += ["\n| 비율 | " + " | ".join(str(c) for c in cat.columns) + " |", "|---|" + "---|" * len(cat.columns)]
    for f, r in cat.iterrows():
        audit.append(f"| {f} | " + " | ".join(pct(v) for v in r) + " |")
    audit.append("\n주의: 2013 활동량은 IPAQ(격렬/중등도 일수·시간), 2014~ 는 GPAQ(일·여가 분리) 라 분포가 다를 수 있다. "
                 "2013~2015 수면은 주중·주말 구분 없는 BP8 이다.")

    # 6. 라벨 상식 점검 — 나이·BMI 로 단조 증가해야 정상
    audit += ["\n## 5. 라벨 상식 점검\n", "| 구간 | n | 고혈압 비율 |", "|---|---|---|"]
    ab = pd.cut(labeled["age"], [18, 29, 39, 49, 59, 69, 200], labels=["19-29", "30-39", "40-49", "50-59", "60-69", "70+"])
    for k, g in labeled.groupby(ab, observed=True):
        audit.append(f"| 나이 {k} | {len(g):,} | {pct(g[L.LABEL_HTN].mean())} |")
    bb = pd.cut(labeled["bmi"], [0, 18.5, 23, 25, 30, 100], labels=["<18.5", "18.5-23", "23-25", "25-30", "≥30"])
    for k, g in labeled.groupby(bb, observed=True):
        audit.append(f"| BMI {k} | {len(g):,} | {pct(g[L.LABEL_HTN].mean())} |")
    for sex, g in labeled.groupby("sex"):
        audit.append(f"| 성별 {sex} | {len(g):,} | {pct(g[L.LABEL_HTN].mean())} |")
    audit.append("\n하위군(성별 × 19~39 / 40~59 / 60+):\n")
    tbl = L.prevalence_table(labeled)
    audit += ["| 성별 | 연령대 | n | 양성 | 유병률 | 가중 유병률 |", "|---|---|---|---|---|---|"]
    audit += [f"| {r.sex} | {r.age_group} | {r.n:,} | {r.positives:,} | {pct(r.prevalence)} | {pct(r.weighted_prevalence)} |" for r in tbl.itertuples()]

    # 7. 분할
    labeled = labeled.copy()
    labeled["split_time"] = assign_time_split(labeled["year"])
    labeled["split_random_721"] = assign_random_split(labeled)
    audit += ["\n## 6. 분할\n", "| 분할 | train | val | test |", "|---|---|---|---|"]
    for col, name in (("split_time", "시간 분할 (주): 2013~19 / 2020 / 2021~22"), ("split_random_721", "무작위 7:2:1 (보조, label×year 층화, seed 42)")):
        vc = labeled[col].value_counts()
        pos = labeled.groupby(col)[L.LABEL_HTN].mean()
        audit.append(f"| {name} | " + " | ".join(f"{vc[s]:,} ({pct(vc[s] / len(labeled))}, 양성 {pct(pos[s])})" for s in ("train", "val", "test")) + " |")
    audit.append("\n시간 분할이 주 분할인 이유: 앱 배포 시점 이후 사용자(=미래 데이터)에 대한 성능을 흉내 내고, 연도별 코드·측정 변화에 강건한지 확인할 수 있다. "
                 "7:2:1 무작위 분할은 보조 지표로 함께 보고한다.")

    # 8. 저장
    out_dir.mkdir(parents=True, exist_ok=True)
    pq = out_dir / "knhanes_contract_v1.parquet"
    labeled.to_parquet(pq, index=False)

    # schema_map.csv — 매핑 + 연도별 결측률
    rows = []
    for m in K.SCHEMA_MAP:
        row = dict(m)
        feat = m["contract"]
        if feat in miss.index:
            for y in K.YEARS:
                row[f"missing_{y}"] = f"{miss.loc[feat, y]:.3f}"
        rows.append(row)
    pd.DataFrame(rows).to_csv(schema_path, index=False, encoding="utf-8-sig")

    audit += ["\n## 7. 산출물\n", f"- `{pq.relative_to(AI_ROOT)}` — {len(labeled):,}행 × {labeled.shape[1]}열 (gitignore)",
              f"- `{schema_path.relative_to(AI_ROOT)}`", f"- `{(reports_dir / 'missingness_by_year.csv').relative_to(AI_ROOT)}`"]
    (reports_dir / "data_audit_knhanes.md").write_text("\n".join(audit) + "\n", encoding="utf-8")
    print("\n".join(audit))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", type=Path, default=K.RAW_DIR)
    ap.add_argument("--out", type=Path, default=AI_ROOT / "data" / "processed")
    ap.add_argument("--reports", type=Path, default=AI_ROOT / "reports")
    ap.add_argument("--schema", type=Path, default=AI_ROOT / "data" / "schema_map.csv")
    a = ap.parse_args()
    a.reports.mkdir(parents=True, exist_ok=True)
    build(a.raw_dir, a.out, a.reports, a.schema)


if __name__ == "__main__":
    main()

# M1-S 작동 방식 — 어떤 데이터를 받아, 어떻게 처리해, 무엇을 내는가

작성 2026-10-21. 대상 코드: `ai/m1_stage/` (작업 사본 `/Users/mac/Desktop/M1`). 기준 run: 20261020_150607, 계약 v1.2.0.

## 0. 한 줄 요약

혈압을 재지 않은 사용자의 **생활습관·신체 변수 16개**를 받아, 그 사람이 혈압 4단계(normal / elevated / prehtn / htn) 각각에 속할 **보정된 확률**과 그중 **하나의 단계**, 그리고 **이유 코드**를 낸다. 혈압 mmHg 값은 내지 않고, 진단도 아니다(명세 1절·2-1). 화면 문구는 별도 템플릿이 만들고 "참고" 단서를 붙인다.

```
입력 dict ─▶ 정규화·대상 판정 ─▶ 결측 대치·범위 검사·표준화 ─▶ 모델(4단계 확률) ─▶ 단계 판정 ─▶ 이유 코드 ─▶ 출력 JSON
```

## 1. 받는 데이터

### 1-1. 학습 데이터 (파일, `train/`)

사용자가 엑셀/CSV 를 `train/` 에 넣고 명령으로만 읽는다(자동 로딩 없음). 한 행 = 한 사람의 한 검진. 현재 파일 46,691행, 2013~2022.

| 용도 | 컬럼 | 비고 |
|---|---|---|
| 라벨 (피처 금지) | `sbp`, `dbp` (또는 `sbp_mean`/`dbp_mean`, `sbp_1,sbp_2…`) | 2회 이상 측정 평균으로 간주 |
| 라벨 (복약) | `htn_med` | 현재 파일에는 없음 → `--assume-no-med` 로 전원 비복약 가정(명세 2-2 복약 규칙 미적용) |
| 필수 피처 | `age`(19~90), `sex`(male/female), `bmi`(14~50) | 결측이면 행 거부 |
| 피처 | `waist_cm`, `alcohol_week`, `alcohol_per_day`, `binge`, `activity_minutes_week`, `activity_low_flag`, `family_htn`, `sleep_short_flag`, `diabetes_flag`, `fasting_glucose`, `resting_hr`, `education_years` | 없거나 비면 원시 컬럼(`height_cm`·`weight_kg`, `sleep_hours`, `sodium_mg_day` 등)에서 산출 |
| 선택 피처 | `smoking`, `stress_score` | 현재 파일에 없음 → 해당 변형 자동 생략 |
| 시간 순서 | `exam_year` | 시간 분할에 사용 |
| 쓰지 않음 | `hypertension`(sbp≥140 or dbp≥90 과 100% 일치하는 파생값), 검사 변수(콜레스테롤·eGFR 등 — M3 영역) | |

제외된 변수: `sodium_risk_score`(명세 2-3 에 있었으나 결과 코호트 근거 불일치·자체 데이터 상관 0.00·모델 계수 0 → 계약 1.2.0 에서 제거).

### 1-2. 추론 입력 (dict 한 건)

같은 피처 이름의 키-값. 대소문자 무시, 성별 별칭(남/여/1/2/M/F), 불리언 별칭(예/아니오/true/1). 혈압 관련 키(`sbp`, `dbp`, `blood_pressure`…)가 값과 함께 오면 M1-S 대상이 아니다(`not_applicable`). 자세한 스키마는 `api_spec.md`.

## 2. 라벨을 만드는 법 (학습 때만)

명세 2-2 규칙을 `thresholds.py` 경계로 적용한다. 판정 순서 htn → prehtn → elevated → normal.

| 단계 | 규칙 |
|---|---|
| normal | sbp <120 and dbp <80 |
| elevated | 120 ≤ sbp <130 and dbp <80 |
| prehtn | 130 ≤ sbp <140 or 80 ≤ dbp <90 |
| htn | sbp ≥140 or dbp ≥90 or 복약 |

학습 파일 분포: normal 49.2%, elevated 10.8%, prehtn 24.5%, htn 15.5%. `label_data.py` 가 각 행의 단계를 `stage` 열로 만들어 보여준다.

## 3. 학습 과정 (`train.py`)

1. **로드·명세 변수화** — 컬럼명 정규화, 타입 변환, 원시 컬럼에서 산출(`m1/features.coerce_spec_table`).
2. **라벨 생성** — 2절. 혈압이 없는 행은 제외.
3. **행 검증** — 범위 밖(활동 >2,000분/주, 음주 >60잔/주, BMI 14~50 밖)은 클리핑하지 않고 제외(`out_of_range`), 필수 결측·대치 플래그 ≥5 는 `insufficient`. 현재 파일: 46,691 → 44,827행.
4. **분할** — 시간 순서: 학습 2013~2019 / 검증 2020 / 테스트 2021~2022. 학습·검증은 **대치 없는 완전한 행만**(26,105 / 5,714), 테스트는 전체 6,724행.
5. **전처리 fit** (학습 행에서만) — 중앙값(활동·공복혈당·심박수·교육), 성별×BMI 구간 허리둘레 중앙값, 연속형 표준화 평균·표준편차. 결측은 계약의 방식(중앙값/0/false)으로 채우고 플래그를 세운다. `activity_low_flag` 는 결측이면 true(명세).
6. **후보 3종 학습** — 같은 전처리·같은 단조(부호) 제약:
   - `ordinal` 누적 링크 순서형 로지스틱 + L2 (λ 검증 선택)
   - `nested` P(≥elevated), P(≥prehtn), P(≥htn) 이진 로지스틱 3개 + Platt 보정 → 단계 확률 합성
   - `lgbm` 단조 제약 LightGBM 누적 이진 3개 + Platt 보정 → 합성
   부호 제약: age·bmi·waist·음주·가족력·수면·당뇨·공복혈당·심박수 ↑, 활동·교육 ↓, 성별·상호작용·플래그 자유.
7. **단계 판정 τ 탐색** — 검증 분할에서 누적 임계값 τ₁τ₂τ₃ 를 목적함수별(accuracy / balanced)로 격자 탐색해 모델과 함께 저장.
8. **평가** (테스트) — 임계값별 AUROC·AUPRC, 보정 기울기·절편·ECE, 단계·인접 정확도, 혼동행렬, 성별×연령대 6셀, 판정 규칙 비교, 점검용 hypertension 이진·보조 혈압 회귀.
9. **단건 경로 동등성 검증** — 스칼라 추론 경로가 배치 경로와 테스트 6,724행 전부에서 입력 벡터·확률·기여도 일치해야 저장(불일치면 중단).
10. **저장** — `artifacts/<run>/<후보>__base/{model.pkl, preprocessor.json, meta.json}`, `artifacts/LATEST`; 보고서 `reports/<run>/summary.md`, `test_results.xlsx`, 보정 곡선 PNG.

## 4. 추론 과정 (`M1Predictor.predict`)

1. 키 소문자화. 혈압 키에 값이 있거나 `htn_med` 가 참이면 `not_applicable` 로 종료(확률 없음).
2. **스칼라 변환**(`m1/fast_path.py`, pandas 없이 p95 1~2 ms): 타입 변환 → 원시 컬럼 산출 → 필수 결측·범위 검사 → 대치·플래그 → missing_count → `data_quality`(ok / partial / insufficient / out_of_range) → 표준화·상호작용 → 벡터 x.
3. 거부(insufficient / out_of_range)면 확률 없이 사유(`problems`)만 낸다.
4. **모델** `predict_one(x)` → 4단계 확률 P (합 1) + 열별 기여도.
5. **단계 판정**(`m1/decision.py`, 규칙 한 곳): 현재 `cumulative/accuracy` — P(≥htn)≥τ₃ → htn, 아니면 P(≥prehtn)≥τ₂ → prehtn, 아니면 P(≥elevated)≥τ₁ → elevated, 아니면 normal. `stage_top` 과 `risk_level` 은 같은 값(4단계).
6. **이유 코드**(`m1/reasons.py`): 조건 통과 + 관측된(대치 아님) 값 + 기여도 순 정렬. 어휘 8개 — bmi_high(≥23), waist_high(남 ≥90/여 ≥85), age(남 ≥39/여 ≥50), alcohol_high(남 ≥1.25/여 ≥1.75잔/일 또는 폭음), activity_low(<150분), sleep_short(<6h), family_htn, diabetes.
7. **출력** JSON(5절). 배치 추론(`predict_cli.py --data`)은 같은 규칙을 파일 전체에 적용해 `person_id + step` 파일과 상세 엑셀을 만든다.

## 5. 내는 결과

```json
{
  "stage_probs": {"normal": 0.1744, "elevated": 0.0901, "prehtn": 0.4187, "htn": 0.3168},
  "stage_top": "prehtn",
  "risk_level": "prehtn",
  "reason_codes": ["alcohol_high", "family_htn", "bmi_high", "age", "waist_high", "sleep_short", "activity_low"],
  "data_quality": "ok",
  "model_version": "M1-20261020_150607-nested__base",
  "feature_version": "1.2.0"
}
```

| 필드 | 뜻 | 없을 때 |
|---|---|---|
| stage_probs | 보정된 4단계 확률, 합 1 | 거부 시 null |
| stage_top | 판정 규칙이 고른 단계 | null |
| risk_level | 4단계(= stage_top) | null |
| reason_codes | 고정 어휘, 기여도 순 | 빈 배열 |
| data_quality | ok / partial(대치 있음) / insufficient / out_of_range / not_applicable | 항상 있음 |
| problems | 거부 사유 코드(예: `age_out_of_range`, `bmi_missing`, `bp_input_present:sbp`) | 사유 있을 때만 |
| model_version, feature_version | 모델 run·조합, 계약 버전 | 항상 있음 |

## 6. 현재 성능 (테스트 2021~2022, 6,724행)

| 지표 | ordinal | nested | lgbm |
|---|---|---|---|
| AUROC ≥140/90 | 0.723 | 0.724 | 0.720 |
| AUROC ≥130/80 | 0.721 | 0.721 | 0.721 |
| 보정 기울기 / 절편 (≥140/90) | 1.00 / −0.32 | 1.00 / −0.21 | 0.95 / −0.19 |
| ECE (최상위 단계) | 0.040 | 0.034 | 0.020 |
| 단계 정확도 / 인접 | 0.518 / 0.734 | 0.513 / 0.734 | 0.520 / 0.721 |
| 단건 p95 | 1.0 ms | 1.0 ms | 1.9 ms |

합격선(AUROC ≥0.70 확정, 기울기 0.9~1.1, 성별 ECE 차 ≤0.05, p95 ≤20 ms) 모두 충족. 사용자 테스트 파일(11,673행) argmax 정답률 49.1~49.4%.

## 7. 알려진 한계와 명세와 다른 결정

- **연령이 지배적**: 전체 기여도의 33~41%가 연령, 성별까지 합치면 절반 이상. 연령대 안에서의 판별력은 약하다(60세 이상 AUROC 0.58~0.61).
- **정확도 상한 ≈0.52**: 판정 규칙을 바꿔도 전체 정확도는 "전부 normal"(≈49~51%) 수준. 규칙은 어느 단계를 더 잡을지만 바꾼다(argmax: htn 재현 0.17 / cumulative-accuracy: 0.03 / cumulative-balanced: 0.61, 정확도 0.44).
- **elevated**: 최대 확률 규칙으로는 거의 예측되지 않는다(어느 집단에서도 최다 단계가 아님).
- **복약 가정**: 복약 컬럼이 없어 전원 비복약으로 라벨링. 약으로 조절된 사람은 낮은 단계로 들어간다.
- **연도 변화**: 테스트 구간 유병률이 학습 구간보다 낮아 절편이 음수(과대추정).
- **이유 코드와 확률의 불일치**: diabetes·activity_low 는 모델 기여도 0 이어도 조건으로 붙음, BMI 23~24 와 남 39~50세는 기여도가 음수인데 코드가 붙음, 여성 음주 코드는 테스트에서 위험이 오히려 낮음(RR 0.76). 사용자가 인지하고 유지.
- **명세와 다른 결정**: 나트륨 변수·코드 제거, BMI 경계 23(WHO 2004), age·alcohol 경계 데이터 기반(Youden), 비복약 가정, 완전한 행만 학습, 중첩 이진에 P(≥elevated) 추가(4단계 출력용).
- **미정**: 최종 모델(후보 3종), 단계 판정 규칙(현재 cumulative/accuracy 시험 중), 미확정 합격선 3개, insufficient 결측 수(5), 일부 변수 범위.

## 8. 파일 지도

| 역할 | 파일 |
|---|---|
| 임계값 단일 정의 | `thresholds.py` |
| 피처 계약 | `feature_contract.yaml` |
| 변환(배치) / 변환(단건) | `m1/features.py` / `m1/fast_path.py` |
| 라벨 | `m1/labels.py` |
| 모델 3종·보정 | `m1/models/` |
| 단계 판정 | `m1/decision.py` |
| 이유 코드 | `m1/reasons.py` |
| 추론 API | `m1/predict.py` |
| 학습·평가·보고 | `train.py`, `m1/evaluate.py`, `m1/report.py` |
| 데이터 점검·검증 도구 | `profile_data.py`, `label_data.py`, `predict_cli.py`, `evaluate_cli.py`, `threshold_scan.py`, `reason_rule_compare.py`, `reason_audit.py`, `feature_importance.py`, `explore_data.py`, `analysis_pack.py`(둘의 결과를 엑셀 한 권으로), `age_profile.py`(나이대별 요약·변수별 혈압 영향), `train_continuous.py`(M1-C 연속형 혈압 분포 모델 실험, m1/continuous.py), `train_chain.py`(규칙 재설계 체인 파이프라인: 전처리 v2·추가 데이터·sbp→dbp→단계, m1/chain.py), `train_final.py`·`predict_final.py`(최종 모델 M1-F: 다중분류 LightGBM, m1/final_model.py), `boost_accuracy.py`·`max_search.py`·`verify_inputs_cv.py`·`experiments_chain.py`(정답률 탐색·검정), `step_compare.py`, `rule_adjust.py` |
| 근거 | `docs/reference_table.md`, `docs/reason_code_evidence.md` |
| 테스트 | `tests/` (30개, 합성 데이터) |

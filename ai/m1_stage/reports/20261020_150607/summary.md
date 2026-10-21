# M1 학습 보고 — run 20261020_150607

## 1. 실행 정보

- 로드 46691행 → 사용 46691행 (max_rows=None, sample_frac=None)
- seed 42, 피처 계약 v1.2.0, 분할 time_order {'train': 26105, 'val': 5714, 'test': 6724}
- 학습·검증은 대치 없는 행만 사용: train 에서 5274행, val 에서 1010행 제외(테스트 분할은 대치 행 포함 전체)
- 후보 ['ordinal', 'nested', 'lgbm'] × 변형 ['base', 'smoking', 'stress', 'smoking_stress'] (생략: {'smoking': ['smoking'], 'stress': ['stress_score'], 'smoking_stress': ['smoking', 'stress_score']})
- 행 단위 테스트 결과·전체 표: `test_results.xlsx`

## 2. 라벨·행 검증

- 수축기 출처: sbp 컬럼 사용(측정 횟수 검증 불가) / 이완기 출처: dbp 컬럼 사용(측정 횟수 검증 불가) / 복약 출처: 없음 → 비복약 가정 (명세 2-2 복약 규칙 미적용)
- **주의**: 복약 컬럼이 없어 전원 비복약으로 가정했다. 명세 2-2 의 '복약 → 고혈압' 규칙이 적용되지 않았으므로 약으로 조절된 사람은 측정 혈압 단계로 라벨링되었다.
- 라벨 생성 46691행, 제외 0행 (혈압·복약 결측: {'sbp_missing': 0, 'dbp_missing': 0, 'htn_med_missing': 0})
- 단계 분포(라벨 생성 행): {'normal': 22952, 'elevated': 5039, 'prehtn': 11458, 'htn': 7242}
- 행 상태(기본 변형 기준): {'ok': 37502, 'partial': 7325, 'out_of_range': 1155, 'insufficient': 709} / 제외 사유: {'activity_minutes_week_out_of_range': 812, 'missing_count_high': 416, 'alcohol_week_out_of_range': 347, 'bmi_missing': 295, 'bmi_out_of_range': 8}
- 분할별 단계 분포: {'train': {'normal': 13424, 'elevated': 2406, 'prehtn': 6410, 'htn': 3865}, 'val': {'normal': 2773, 'elevated': 613, 'prehtn': 1489, 'htn': 839}, 'test': {'normal': 3445, 'elevated': 954, 'prehtn': 1444, 'htn': 881}}

## 3. 테스트 집합 지표 (조합별)

| combo | auroc_ge_130_80 | auprc_ge_130_80 | auroc_ge_140_90 | auprc_ge_140_90 | cal_slope_ge_140_90 | cal_intercept_ge_140_90 | ece_ge_130_80 | ece_ge_140_90 | ece_top | accuracy | adjacent_accuracy | sex_ece_gap_ge_140_90 | latency_p95_ms | fit_seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ordinal__base | 0.721 | 0.529 | 0.723 | 0.249 | 0.996 | -0.322 | 0.079 | 0.037 | 0.040 | 0.518 | 0.734 | 0.003 | 1.032 | 0.345 |
| nested__base | 0.721 | 0.535 | 0.724 | 0.249 | 1.001 | -0.212 | 0.071 | 0.024 | 0.034 | 0.513 | 0.734 | 0.015 | 1.014 | 0.482 |
| lgbm__base | 0.721 | 0.536 | 0.720 | 0.242 | 0.954 | -0.190 | 0.066 | 0.021 | 0.020 | 0.520 | 0.721 | 0.011 | 1.933 | 2.188 |

임계값별 유병률(AUPRC 기준선): ge_elevated 0.488, ge_130_80 0.346, ge_140_90 0.131

## 4. 합격선 점검 (AUROC ≥140/90 ≥ 0.70 은 사용자 확정, 나머지는 명세 2-5 예시값 — 미확정)

| combo | auroc_ge_140_90 | cal_slope_ge_140_90 | sex_ece_gap_ge_140_90 | latency_p95_ms |
|---|---|---|---|---|
| ordinal__base | 충족 | 충족 | 충족 | 충족 |
| nested__base | 충족 | 충족 | 충족 | 충족 |
| lgbm__base | 충족 | 충족 | 충족 | 충족 |

기준: auroc_ge_140_90 >= 0.7; cal_slope_ge_140_90 between 0.9 1.1; sex_ece_gap_ge_140_90 <= 0.05; latency_p95_ms <= 20.0

## 5. 검증 vs 테스트 보정 비교

주의: nested·lgbm 은 Platt 보정기를 검증 집합에서 적합하므로 검증 집합의 기울기 1.000·절편 0.000 은 구조상 나오는 값이다. 보정 판단은 테스트 열을 본다.

### ge_elevated

| combo | val_auroc | test_auroc | val_cal_slope | test_cal_slope | val_cal_intercept | test_cal_intercept | val_ece | test_ece |
|---|---|---|---|---|---|---|---|---|
| lgbm__base | 0.766 | 0.758 | 1.000 | 1.043 | 0.000 | -0.208 | 0.009 | 0.041 |
| nested__base | 0.766 | 0.760 | 1.000 | 1.039 | 0.000 | -0.222 | 0.022 | 0.044 |
| ordinal__base | 0.766 | 0.760 | 1.143 | 1.190 | 0.051 | -0.150 | 0.032 | 0.032 |

### ge_130_80

| combo | val_auroc | test_auroc | val_cal_slope | test_cal_slope | val_cal_intercept | test_cal_intercept | val_ece | test_ece |
|---|---|---|---|---|---|---|---|---|
| lgbm__base | 0.727 | 0.721 | 0.999 | 1.062 | 0.001 | -0.325 | 0.013 | 0.066 |
| nested__base | 0.723 | 0.721 | 0.997 | 1.051 | 0.001 | -0.348 | 0.019 | 0.071 |
| ordinal__base | 0.718 | 0.721 | 0.898 | 0.978 | -0.021 | -0.396 | 0.021 | 0.079 |

### ge_140_90

| combo | val_auroc | test_auroc | val_cal_slope | test_cal_slope | val_cal_intercept | test_cal_intercept | val_ece | test_ece |
|---|---|---|---|---|---|---|---|---|
| lgbm__base | 0.738 | 0.720 | 1.000 | 0.954 | 0.000 | -0.190 | 0.007 | 0.021 |
| nested__base | 0.732 | 0.724 | 1.001 | 1.001 | -0.000 | -0.212 | 0.022 | 0.024 |
| ordinal__base | 0.731 | 0.723 | 0.994 | 0.996 | -0.124 | -0.322 | 0.018 | 0.037 |

## 6. 하위군 (성별 × 연령대, 테스트 집합)

### auroc_ge_140_90

| combo | female/19-39 | female/40-59 | female/60+ | male/19-39 | male/40-59 | male/60+ |
|---|---|---|---|---|---|---|
| lgbm__base | 0.750 | 0.648 | 0.598 | 0.783 | 0.686 | 0.580 |
| nested__base | 0.805 | 0.634 | 0.614 | 0.767 | 0.650 | 0.584 |
| ordinal__base | 0.801 | 0.636 | 0.612 | 0.768 | 0.656 | 0.582 |

### ece_ge_140_90

| combo | female/19-39 | female/40-59 | female/60+ | male/19-39 | male/40-59 | male/60+ |
|---|---|---|---|---|---|---|
| lgbm__base | 0.010 | 0.039 | 0.029 | 0.041 | 0.039 | 0.032 |
| nested__base | 0.015 | 0.026 | 0.047 | 0.045 | 0.022 | 0.024 |
| ordinal__base | 0.024 | 0.032 | 0.054 | 0.068 | 0.043 | 0.036 |

### auroc_ge_130_80

| combo | female/19-39 | female/40-59 | female/60+ | male/19-39 | male/40-59 | male/60+ |
|---|---|---|---|---|---|---|
| lgbm__base | 0.772 | 0.655 | 0.598 | 0.729 | 0.671 | 0.591 |
| nested__base | 0.774 | 0.646 | 0.606 | 0.709 | 0.662 | 0.591 |
| ordinal__base | 0.769 | 0.647 | 0.606 | 0.710 | 0.660 | 0.588 |

### ece_ge_130_80

| combo | female/19-39 | female/40-59 | female/60+ | male/19-39 | male/40-59 | male/60+ |
|---|---|---|---|---|---|---|
| lgbm__base | 0.063 | 0.097 | 0.062 | 0.142 | 0.070 | 0.023 |
| nested__base | 0.082 | 0.064 | 0.090 | 0.154 | 0.019 | 0.052 |
| ordinal__base | 0.063 | 0.061 | 0.135 | 0.128 | 0.018 | 0.071 |

셀 표본 수: female/19-39 890, female/40-59 1336, female/60+ 1562, male/19-39 708, male/40-59 1006, male/60+ 1222

## 7. 혼동행렬 (테스트 집합, 행=실제, 열=예측 최상위 단계)

### ordinal__base

|  | pred_normal | pred_elevated | pred_prehtn | pred_htn |
|---|---|---|---|---|
| true_normal | 2818 | 0 | 613 | 14 |
| true_elevated | 515 | 0 | 421 | 18 |
| true_prehtn | 786 | 0 | 636 | 22 |
| true_htn | 357 | 0 | 492 | 32 |

### nested__base

|  | pred_normal | pred_elevated | pred_prehtn | pred_htn |
|---|---|---|---|---|
| true_normal | 2695 | 0 | 740 | 10 |
| true_elevated | 496 | 0 | 448 | 10 |
| true_prehtn | 703 | 1 | 728 | 12 |
| true_htn | 325 | 1 | 531 | 24 |

### lgbm__base

|  | pred_normal | pred_elevated | pred_prehtn | pred_htn |
|---|---|---|---|---|
| true_normal | 2920 | 3 | 476 | 46 |
| true_elevated | 659 | 1 | 269 | 25 |
| true_prehtn | 855 | 3 | 521 | 65 |
| true_htn | 468 | 4 | 353 | 56 |

## 8. 보정 곡선 그림

- `calibration_ordinal__base.png`
- `calibration_nested__base.png`
- `calibration_lgbm__base.png`

## 9. 단건 추론 경로 동등성 검증 (테스트 집합 전체, 배치 경로 vs fast_path)

| combo | rows | max_abs_dx | max_abs_dp | max_abs_dcontrib | status_mismatch | problems_mismatch | flags_mismatch | observed_mismatch | raw_mismatch | ok |
|---|---|---|---|---|---|---|---|---|---|---|
| ordinal__base | 6724 | 0.00e+00 | 3.33e-16 | 0.00e+00 | 0 | 0 | 0 | 0 | 0 | True |
| nested__base | 6724 | 0.00e+00 | 4.44e-16 | 0.00e+00 | 0 | 0 | 0 | 0 | 0 | True |
| lgbm__base | 6724 | 0.00e+00 | 0.00e+00 | 0.00e+00 | 0 | 0 | 0 | 0 | 0 | True |

## 10. 사용자 결정이 필요한 항목 (근거 없음 또는 명세 미정의 — 임시값 사용 중)

- 단계 판정 규칙 m1/decision.py STAGE_RULE = cumulative, 목적 accuracy (stage_top·risk_level·정확도·step 공통). 10b 절 비교 후 확정
- insufficient 판정 결측 플래그 수 INSUFFICIENT_MISSING_COUNT = 5
- age·alcohol 이유 코드 경계: 데이터 기반 확정(REASON_RULE=youden; age {'male': 39, 'female': 50}, 음주 잔/일 {'male': 1.25, 'female': 1.75} 또는 폭음). 여성 음주 코드는 테스트 집합에서 RR 0.76(사용자 인지 후 유지)
- sodium_risk_score 피처 제거(계약 1.2.0) — 명세 2-3 과 다름
- 허리둘레 대치 BMI 구간 BMI_BINS = (18.5, 23.0, 25.0, 30.0) (≥25 외 경계 근거 없음)
- fasting_glucose / resting_hr / education_years 범위 미정의 → 범위 검사 생략
- smoking / stress_score 결측 처리(명세 미정의): never 대치 / 중앙값 대치 + 플래그
- 중첩 이진·LightGBM: 4단계 출력을 위해 P(≥elevated) 이진을 추가(명세는 ≥130/80, ≥140/90 두 개)
- Platt 보정과 조기 종료(LightGBM)·L2 선택이 같은 검증 집합을 사용
- 합격선·최종 모델 선택: 사용자 결정

## 10b. 단계 판정 규칙 비교 (테스트 집합; 적용 중: cumulative/accuracy)

argmax = 최대 확률. cumulative = P(≥elevated)≥τ1 / P(≥prehtn)≥τ2 / P(≥htn)≥τ3 중 넘는 가장 높은 단계, τ 는 검증 분할에서 목적함수별로 탐색.

| combo | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ordinal__base | argmax | - | 0.518 | 0.718 | 0.323 | 0.853 | 0.000 | 0.284 | 0.157 | 0.717 | 0.000 | 0.212 | 0.071 |
| ordinal__base | cumulative/accuracy | [0.64, 0.53, 0.48] | 0.518 | 0.734 | 0.324 | 0.818 | 0.000 | 0.440 | 0.036 | 0.666 | 0.000 | 0.322 | 0.013 |
| ordinal__base | cumulative/balanced | [0.5, 0.51, 0.18] | 0.429 | 0.712 | 0.378 | 0.599 | 0.212 | 0.000 | 0.699 | 0.411 | 0.182 | 0.000 | 0.407 |
| nested__base | argmax | - | 0.519 | 0.718 | 0.336 | 0.820 | 0.000 | 0.357 | 0.168 | 0.674 | 0.000 | 0.248 | 0.077 |
| nested__base | cumulative/accuracy | [0.75, 0.49, 0.48] | 0.513 | 0.734 | 0.328 | 0.782 | 0.000 | 0.504 | 0.027 | 0.627 | 0.000 | 0.364 | 0.008 |
| nested__base | cumulative/balanced | [0.5, 0.46, 0.18] | 0.436 | 0.712 | 0.381 | 0.588 | 0.193 | 0.128 | 0.613 | 0.396 | 0.158 | 0.095 | 0.352 |
| lgbm__base | argmax | - | 0.514 | 0.715 | 0.328 | 0.821 | 0.006 | 0.343 | 0.141 | 0.689 | 0.004 | 0.235 | 0.073 |
| lgbm__base | cumulative/accuracy | [0.77, 0.53, 0.36] | 0.520 | 0.721 | 0.318 | 0.848 | 0.001 | 0.361 | 0.064 | 0.729 | 0.002 | 0.241 | 0.029 |
| lgbm__base | cumulative/balanced | [0.5, 0.49, 0.22] | 0.437 | 0.737 | 0.385 | 0.564 | 0.309 | 0.202 | 0.464 | 0.374 | 0.234 | 0.138 | 0.254 |

## 11. hypertension 이진 판정 (점검용)

hypertension(= 측정 혈압 ≥140/90, 비복약 가정에서 stage htn 과 동일)을 P(htn) 으로 이진화한 결과. accuracy_htn_all_negative 는 전부 0 으로 판정했을 때의 정확도(= 1 − 유병률)이므로 정확도만으로는 판정 성능을 읽을 수 없다. Youden 임계값은 검증 집합에서 민감도+특이도−1 을 최대로 하는 값이다.

| combo | prevalence_ge_140_90 | accuracy_htn_all_negative | htn_threshold_youden | accuracy_htn_0.5 | sensitivity_htn_0.5 | specificity_htn_0.5 | ppv_htn_0.5 | n_pred_pos_htn_0.5 | accuracy_htn_youden | sensitivity_htn_youden | specificity_htn_youden | ppv_htn_youden | n_pred_pos_htn_youden |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ordinal__base | 0.131 | 0.869 | 0.154 | 0.866 | 0.027 | 0.993 | 0.364 | 66 | 0.579 | 0.782 | 0.548 | 0.207 | 3328 |
| nested__base | 0.131 | 0.869 | 0.113 | 0.868 | 0.015 | 0.996 | 0.382 | 34 | 0.502 | 0.874 | 0.446 | 0.192 | 4005 |
| lgbm__base | 0.131 | 0.869 | 0.140 | 0.867 | 0.015 | 0.996 | 0.351 | 37 | 0.552 | 0.808 | 0.513 | 0.200 | 3556 |

## 12. 보조 혈압 회귀 (점검용 — 명세 2-1 에 따라 mmHg 점 추정은 제품 출력이 아님)

같은 피처·같은 부호 제약으로 수축기·이완기를 회귀한 결과와, 그 예측 혈압으로 환산한 단계·hypertension 의 점검 지표. 정답 혈압과 비교해 오차를 확인하는 용도로만 쓴다.

| model | rmse_sbp_val | rmse_sbp_test | mae_sbp_test | bias_sbp_test | r2_sbp_test | rmse_dbp_val | rmse_dbp_test | mae_dbp_test | bias_dbp_test | r2_dbp_test | stage_accuracy_from_bp_test | stage_adjacent_accuracy_from_bp_test | accuracy_htn_from_bp_test | sensitivity_htn_from_bp_test | specificity_htn_from_bp_test | stage_counts_from_bp_test |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bp_regression__linear | 13.649 | 13.752 | 10.339 | -0.299 | 0.263 | 8.926 | 9.168 | 7.278 | 1.646 | 0.109 | 0.453 | 0.794 | 0.868 | 0.001 | 0.998 | {'normal': 3035, 'elevated': 2409, 'prehtn': 1270, 'htn': 10} |
| bp_regression__lgbm | 13.499 | 13.688 | 10.282 | 0.159 | 0.270 | 8.636 | 8.906 | 7.030 | 1.511 | 0.160 | 0.457 | 0.795 | 0.868 | 0.007 | 0.997 | {'normal': 2854, 'elevated': 2139, 'prehtn': 1710, 'htn': 21} |

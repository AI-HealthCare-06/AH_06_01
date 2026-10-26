# M1-C 연속형 혈압 분포 모델 — continuous_20261023_154705

- 데이터 `train/` 46691행, 분할 time_order {'train': 26105, 'val': 5714, 'test': 6724}(학습·검증은 완전한 행만, 테스트는 전체). 기존 후보 비교: `20261020_150607`
- 목표: 측정 sbp·dbp(연속). 평균 모델 ['linear', 'lgbm'] + 집단(10세 나이대×성별)별 검증 잔차 σ·ρ → (sbp, dbp) 결합 정규 분포 → 단계·구간 확률은 분포 적분
- 입력 47열 = 계약 26 + 확장 21: drinker(음주 여부), alcohol_week 는 15잔/주 상한, age², 나이×변수 11개, 성별×변수 8개. 혈압은 입력에 없음
- 단조 제약: 주효과는 계약 방향 유지(LightGBM), 확장 열은 제약 없음. 선형은 릿지(λ 검증 선택), 제약 없음

## 1. 기존 후보와 비교 (테스트 분할, 같은 행)

| model | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 ≥140/90 | 보정 절편 ≥140/90 | ECE ≥140/90 | ECE(top) | 정확도 | 인접 정확도 | 균형 정확도 | 재현 normal | 재현 elevated | 재현 prehtn | 재현 htn | 성별 ECE 차 ≥140/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| continuous_linear | 0.728 | 0.721 | 0.255 | 0.863 | -0.189 | 0.021 | 0.036 | 0.513 | 0.722 | 0.338 | 0.795 | 0.019 | 0.391 | 0.145 | 0.006 |
| continuous_lgbm | 0.724 | 0.720 | 0.246 | 0.832 | -0.216 | 0.024 | 0.032 | 0.517 | 0.696 | 0.310 | 0.891 | 0.046 | 0.168 | 0.136 | 0.003 |
| lgbm__base (기존) | 0.720 | 0.721 | 0.242 | 0.954 | -0.190 | 0.021 | 0.020 | 0.520 | 0.721 | 0.318 | 0.848 | 0.001 | 0.361 | 0.064 | 0.011 |
| nested__base (기존) | 0.724 | 0.721 | 0.249 | 1.001 | -0.212 | 0.024 | 0.034 | 0.513 | 0.734 | 0.328 | 0.782 | 0.000 | 0.504 | 0.027 | 0.015 |
| ordinal__base (기존) | 0.723 | 0.721 | 0.249 | 0.996 | -0.322 | 0.037 | 0.040 | 0.518 | 0.734 | 0.324 | 0.818 | 0.000 | 0.440 | 0.036 | 0.003 |

## 2. 판정 규칙 비교

| model | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| continuous_linear | argmax | - | 0.521 | 0.705 | 0.341 | 0.837 | 0.000 | 0.273 | 0.253 |
| continuous_linear | cumulative/accuracy | [0.71, 0.5, 0.35] | 0.513 | 0.722 | 0.338 | 0.795 | 0.019 | 0.391 | 0.145 |
| continuous_linear | cumulative/balanced | [0.51, 0.48, 0.22] | 0.442 | 0.740 | 0.392 | 0.567 | 0.285 | 0.208 | 0.506 |
| continuous_lgbm | argmax | - | 0.517 | 0.705 | 0.341 | 0.821 | 0.000 | 0.303 | 0.240 |
| continuous_lgbm | cumulative/accuracy | [0.76, 0.59, 0.34] | 0.517 | 0.696 | 0.310 | 0.891 | 0.046 | 0.168 | 0.136 |
| continuous_lgbm | cumulative/balanced | [0.52, 0.56, 0.29] | 0.438 | 0.790 | 0.389 | 0.562 | 0.539 | 0.164 | 0.292 |
| lgbm__base (기존) | argmax | - | 0.514 | 0.715 | 0.328 | 0.821 | 0.006 | 0.343 | 0.141 |
| lgbm__base (기존) | cumulative/accuracy | [0.77, 0.53, 0.36] | 0.520 | 0.721 | 0.318 | 0.848 | 0.001 | 0.361 | 0.064 |
| lgbm__base (기존) | cumulative/balanced | [0.5, 0.49, 0.22] | 0.437 | 0.737 | 0.385 | 0.564 | 0.309 | 0.202 | 0.464 |
| nested__base (기존) | argmax | - | 0.519 | 0.718 | 0.336 | 0.820 | 0.000 | 0.357 | 0.168 |
| nested__base (기존) | cumulative/accuracy | [0.75, 0.49, 0.48] | 0.513 | 0.734 | 0.328 | 0.782 | 0.000 | 0.504 | 0.027 |
| nested__base (기존) | cumulative/balanced | [0.5, 0.46, 0.18] | 0.436 | 0.712 | 0.381 | 0.588 | 0.193 | 0.128 | 0.613 |
| ordinal__base (기존) | argmax | - | 0.518 | 0.718 | 0.323 | 0.853 | 0.000 | 0.284 | 0.157 |
| ordinal__base (기존) | cumulative/accuracy | [0.64, 0.53, 0.48] | 0.518 | 0.734 | 0.324 | 0.818 | 0.000 | 0.440 | 0.036 |
| ordinal__base (기존) | cumulative/balanced | [0.5, 0.51, 0.18] | 0.429 | 0.712 | 0.378 | 0.599 | 0.212 | 0.000 | 0.699 |

## 3. 회귀·분포 보정 (M1-C)

| model | target | val_rmse | test_rmse | test_mae | test_bias(pred-actual) | test_r2 | coverage_50 | coverage_90 | mean_sigma | lambda | best_iteration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| continuous_linear | sbp | 13.517 | 13.693 | 10.309 | 0.036 | 0.269 | 0.543 | 0.917 | 13.592 | 0.000 | n/a |
| continuous_linear | dbp | 8.560 | 8.853 | 7.012 | 1.287 | 0.170 | 0.485 | 0.898 | 8.520 | 10.000 | n/a |
| continuous_lgbm | sbp | 13.445 | 13.685 | 10.285 | 0.117 | 0.270 | 0.539 | 0.918 | 13.525 | n/a | 185.000 |
| continuous_lgbm | dbp | 8.535 | 8.899 | 7.033 | 1.351 | 0.161 | 0.478 | 0.897 | 8.531 | n/a | 229.000 |

coverage_50/90 = 예측 분포의 중앙 50%/90% 구간에 실제 값이 들어간 비율(목표 0.50/0.90).

### 단계 비율: 예측 평균 확률 vs 실제

| model | stage | 예측 평균 확률 | 실제 비율 |
|---|---|---|---|
| continuous_linear | normal | 0.462 | 0.512 |
| continuous_linear | elevated | 0.122 | 0.142 |
| continuous_linear | prehtn | 0.265 | 0.215 |
| continuous_linear | htn | 0.152 | 0.131 |
| continuous_lgbm | normal | 0.459 | 0.512 |
| continuous_lgbm | elevated | 0.122 | 0.142 |
| continuous_lgbm | prehtn | 0.264 | 0.215 |
| continuous_lgbm | htn | 0.155 | 0.131 |

### 혈압 구간 확률 vs 실제 비율

| model | 구간 | 예측 평균 확률 | 실제 비율 | n 실제 |
|---|---|---|---|---|
| continuous_linear | sbp_<120 | 0.528 | 0.547 | 3677 |
| continuous_linear | sbp_120~129 | 0.214 | 0.218 | 1467 |
| continuous_linear | sbp_130~139 | 0.144 | 0.131 | 882 |
| continuous_linear | sbp_140~159 | 0.103 | 0.083 | 556 |
| continuous_linear | sbp_≥160 | 0.011 | 0.021 | 142 |
| continuous_linear | dbp_<80 | 0.693 | 0.746 | 5016 |
| continuous_linear | dbp_80~89 | 0.242 | 0.195 | 1313 |
| continuous_linear | dbp_90~99 | 0.059 | 0.046 | 312 |
| continuous_linear | dbp_≥100 | 0.006 | 0.012 | 83 |
| continuous_lgbm | sbp_<120 | 0.526 | 0.547 | 3677 |
| continuous_lgbm | sbp_120~129 | 0.215 | 0.218 | 1467 |
| continuous_lgbm | sbp_130~139 | 0.145 | 0.131 | 882 |
| continuous_lgbm | sbp_140~159 | 0.103 | 0.083 | 556 |
| continuous_lgbm | sbp_≥160 | 0.011 | 0.021 | 142 |
| continuous_lgbm | dbp_<80 | 0.691 | 0.746 | 5016 |
| continuous_lgbm | dbp_80~89 | 0.239 | 0.195 | 1313 |
| continuous_lgbm | dbp_90~99 | 0.062 | 0.046 | 312 |
| continuous_lgbm | dbp_≥100 | 0.008 | 0.012 | 83 |

## 4. 하위군 AUROC ≥140/90

| sex | age_group | continuous_lgbm | continuous_linear | lgbm__base (기존) | nested__base (기존) | ordinal__base (기존) |
|---|---|---|---|---|---|---|
| female | 19-39 | 0.753 | 0.780 | 0.750 | 0.805 | 0.801 |
| female | 40-59 | 0.632 | 0.645 | 0.648 | 0.634 | 0.636 |
| female | 60+ | 0.602 | 0.613 | 0.598 | 0.614 | 0.612 |
| male | 19-39 | 0.786 | 0.772 | 0.783 | 0.767 | 0.768 |
| male | 40-59 | 0.686 | 0.675 | 0.686 | 0.650 | 0.656 |
| male | 60+ | 0.582 | 0.593 | 0.580 | 0.584 | 0.582 |

## 5. 선형 계수 (표준화 1단위 또는 플래그 0→1 당 mmHg; 상호작용은 두 표준화 값의 곱 1단위당)

| feature | sbp_coef | dbp_coef |
|---|---|---|
| age | 7.631 | 1.128 |
| age_x_male | -3.999 | -1.931 |
| family_htn | 2.806 | 1.631 |
| male | 2.627 | 3.230 |
| bmi | 2.384 | 1.550 |
| age_sq | 1.986 | -1.953 |
| education_years | -1.528 | -0.404 |
| binge | 1.424 | 1.263 |
| alcohol_per_day | 1.398 | 0.824 |
| fasting_glucose | 1.299 | 0.713 |
| diabetes_flag | -0.969 | -2.614 |
| age_x_education_years | 0.809 | 0.462 |
| age_x_resting_hr | -0.679 | 0.037 |
| alcohol_week | 0.663 | 0.440 |
| age_x_fasting_glucose | -0.549 | -0.780 |
| activity_low_flag | 0.536 | 0.051 |
| drinker | -0.509 | -0.035 |
| male_x_bmi | 0.463 | 0.576 |
| activity_minutes_week | 0.391 | 0.152 |
| male_x_alcohol_week | 0.324 | 0.143 |
| male_x_waist_cm | -0.310 | -0.237 |
| age_x_bmi | -0.229 | -0.041 |
| age_x_alcohol_week | 0.193 | -0.134 |
| male_x_resting_hr | 0.191 | 0.129 |
| age_x_waist_cm | -0.174 | 0.023 |
| age_x_activity_minutes_week | 0.161 | 0.091 |
| age_x_drinker | 0.141 | 0.143 |
| waist_cm | 0.128 | 0.130 |
| age_x_family_htn | 0.125 | -0.207 |
| age_x_binge | 0.114 | 0.024 |
| sleep_short_flag | -0.112 | 0.584 |
| resting_hr | 0.088 | 1.039 |
| male_x_drinker | -0.073 | 0.054 |
| male_x_activity_minutes_week | 0.069 | -0.055 |
| age_x_sleep_short_flag | 0.057 | -0.046 |
| male_x_binge | -0.043 | -0.261 |
| male_x_sleep_short_flag | 0.028 | -0.083 |
| activity_missing | 0.000 | -0.000 |
| education_missing | -0.000 | -0.000 |
| diabetes_missing | -0.000 | 0.000 |
| resting_hr_missing | -0.000 | 0.000 |
| alcohol_missing | 0.000 | 0.000 |
| sleep_missing | 0.000 | 0.000 |
| missing_count | -0.000 | -0.000 |
| family_htn_missing | -0.000 | -0.000 |
| waist_missing | 0.000 | 0.000 |
| fasting_glucose_missing | -0.000 | -0.000 |

## 6. LightGBM gain 비중 (상위 25)

| feature | sbp_gain_share | dbp_gain_share |
|---|---|---|
| age | 0.403 | 0.033 |
| age_x_drinker | 0.062 | 0.006 |
| waist_cm | 0.060 | 0.064 |
| bmi | 0.054 | 0.099 |
| age_x_waist_cm | 0.052 | 0.020 |
| fasting_glucose | 0.044 | 0.023 |
| male_x_bmi | 0.037 | 0.096 |
| age_x_fasting_glucose | 0.036 | 0.076 |
| male | 0.027 | 0.010 |
| alcohol_week | 0.025 | 0.029 |
| age_x_alcohol_week | 0.024 | 0.021 |
| education_years | 0.022 | 0.002 |
| age_x_education_years | 0.021 | 0.015 |
| age_x_bmi | 0.016 | 0.015 |
| age_x_family_htn | 0.015 | 0.018 |
| age_x_resting_hr | 0.015 | 0.015 |
| family_htn | 0.015 | 0.021 |
| age_x_male | 0.013 | 0.067 |
| male_x_alcohol_week | 0.013 | 0.035 |
| male_x_waist_cm | 0.009 | 0.040 |
| age_sq | 0.007 | 0.170 |
| age_x_activity_minutes_week | 0.007 | 0.009 |
| resting_hr | 0.005 | 0.041 |
| male_x_activity_minutes_week | 0.004 | 0.008 |
| male_x_resting_hr | 0.003 | 0.022 |

## 7. 산포 집단 (검증 잔차)

| group | sig_s | sig_d | rho | n |
|---|---|---|---|---|
| __all__ | 13.518 | 8.561 | 0.705 | 5714.000 |
| 19~29|female | 8.613 | 7.666 | 0.653 | 413.000 |
| 19~29|male | 9.679 | 8.096 | 0.582 | 390.000 |
| 30~39|female | 10.299 | 7.549 | 0.779 | 443.000 |
| 30~39|male | 10.033 | 8.236 | 0.707 | 374.000 |
| 40~49|female | 12.525 | 8.736 | 0.808 | 596.000 |
| 40~49|male | 11.954 | 8.976 | 0.787 | 441.000 |
| 50~59|female | 15.790 | 9.107 | 0.783 | 621.000 |
| 50~59|male | 14.737 | 8.862 | 0.776 | 466.000 |
| 60~69|female | 15.163 | 8.319 | 0.687 | 637.000 |
| 60~69|male | 14.559 | 8.392 | 0.729 | 470.000 |
| 70+|female | 17.209 | 9.014 | 0.612 | 477.000 |
| 70+|male | 15.294 | 8.494 | 0.592 | 386.000 |

## 8. 혼동행렬 (현재 판정 규칙)

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | model |
|---|---|---|---|---|---|
| actual_normal | 2738 | 25 | 590 | 92 | continuous_linear |
| actual_elevated | 522 | 18 | 324 | 90 | continuous_linear |
| actual_prehtn | 735 | 18 | 565 | 126 | continuous_linear |
| actual_htn | 334 | 25 | 394 | 128 | continuous_linear |
| actual_normal | 3071 | 56 | 213 | 105 | continuous_lgbm |
| actual_elevated | 746 | 44 | 98 | 66 | continuous_lgbm |
| actual_prehtn | 1025 | 51 | 242 | 126 | continuous_lgbm |
| actual_htn | 570 | 62 | 129 | 120 | continuous_lgbm |
| actual_normal | 2920 | 3 | 476 | 46 | lgbm__base (기존) |
| actual_elevated | 659 | 1 | 269 | 25 | lgbm__base (기존) |
| actual_prehtn | 855 | 3 | 521 | 65 | lgbm__base (기존) |
| actual_htn | 468 | 4 | 353 | 56 | lgbm__base (기존) |
| actual_normal | 2695 | 0 | 740 | 10 | nested__base (기존) |
| actual_elevated | 496 | 0 | 448 | 10 | nested__base (기존) |
| actual_prehtn | 703 | 1 | 728 | 12 | nested__base (기존) |
| actual_htn | 325 | 1 | 531 | 24 | nested__base (기존) |
| actual_normal | 2818 | 0 | 613 | 14 | ordinal__base (기존) |
| actual_elevated | 515 | 0 | 421 | 18 | ordinal__base (기존) |
| actual_prehtn | 786 | 0 | 636 | 22 | ordinal__base (기존) |
| actual_htn | 357 | 0 | 492 | 32 | ordinal__base (기존) |

주의: mmHg 는 내부 중간값이며 제품 출력이 아니다(명세 2-1). 단건 추론 경로·배치 CLI 는 아직 없다. 복약 컬럼이 없어 라벨은 비복약 가정이다.


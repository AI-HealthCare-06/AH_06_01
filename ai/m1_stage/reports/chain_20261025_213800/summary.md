# 체인 파이프라인 — chain_20261025_213800

| 항목 | 값 |
|---|---|
| 데이터 | train/ 46691행 |
| 제외 행 | 나이·성별·BMI 결측 295행 |
| 사용 행 | 46396행 (대치 행 포함) |
| 분할 | time_order {'train': 32477, 'val': 6959, 'test': 6960} |
| 최빈값 대치 | {'fasting_glucose': 93.0, 'resting_hr': 68.0, 'education_years': 12.0} |
| 활동 결측 대치 | flag1 행 최빈값 0분 / flag0 행 최빈값 420분 |
| 허리둘레 추정 | waist ~ 1 + male + bmi + age + male·bmi + male·age, 계수 [19.862, 2.023, 2.28, 0.114, 0.145, -0.014], 학습 RMSE 4.42cm |
| 음주 | 3열 결측 0, 15잔 이상 → 15 + alcohol_15plus, per_day=1 |
| 활동 상한 | 600분 이상 → 600 + activity_600plus, flag = 분<150 |
| 입력 열 | 기준 19 → sbp 모델 54(나이×, 성별×) / dbp 모델 74(+ sbp, sbp×) |
| 부트스트랩 | 200개, 검증 잔차 나이대×성별 풀 |
| 판정 규칙 | cumulative/accuracy (τ 검증 분할) |

## 1. 점 추정 체인 (테스트 6960행)

| learner | target | rmse | mae | bias(pred-actual) | r2 |
|---|---|---|---|---|---|
| linear | sbp | 13.802 | 10.396 | -0.113 | 0.262 |
| linear | dbp(예측 sbp 투입) | 8.971 | 7.110 | 1.291 | 0.168 |
| linear | dbp(실제 sbp 투입) | 6.470 | 5.063 | 1.465 | 0.567 |
| linear | dbp(분포 평균) | 8.913 | 7.056 | 1.236 | 0.179 |
| lgbm | sbp | 13.757 | 10.338 | 0.243 | 0.267 |
| lgbm | dbp(예측 sbp 투입) | 8.966 | 7.105 | 1.566 | 0.169 |
| lgbm | dbp(실제 sbp 투입) | 6.133 | 4.815 | 1.222 | 0.611 |
| lgbm | dbp(분포 평균) | 8.839 | 6.981 | 1.200 | 0.192 |

### 단계(점 추정 → 경계)

| learner | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.452 | 0.796 | 0.353 | 0.620 | 0.460 | 0.322 | 0.010 | 0.434 | 0.338 | 0.225 | 0.003 |
| lgbm | 0.458 | 0.788 | 0.365 | 0.602 | 0.445 | 0.405 | 0.010 | 0.411 | 0.304 | 0.283 | 0.002 |

전부 normal 기준선 정확도 0.510


## 2. 분포 체인 (단계 확률)

| learner | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 | 보정 절편 | ECE ≥140/90 | 정확도(규칙) | 인접 정확도 | 균형 정확도 | 재현 elevated | 재현 htn | P평균_normal | P평균_elevated | P평균_prehtn | P평균_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.720 | 0.720 | 0.256 | 0.918 | -0.149 | 0.017 | 0.508 | 0.715 | 0.333 | 0.015 | 0.140 | 0.479 | 0.118 | 0.254 | 0.150 |
| lgbm | 0.718 | 0.720 | 0.248 | 0.901 | -0.149 | 0.017 | 0.503 | 0.714 | 0.339 | 0.024 | 0.176 | 0.481 | 0.116 | 0.252 | 0.150 |

### 판정 규칙 비교

| learner | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| linear | argmax | - | 0.520 | 0.705 | 0.337 | 0.839 | 0.014 | 0.302 | 0.193 |
| linear | cumulative/accuracy | [0.73, 0.49, 0.34] | 0.508 | 0.715 | 0.333 | 0.793 | 0.015 | 0.383 | 0.140 |
| linear | cumulative/balanced | [0.49, 0.55, 0.24] | 0.430 | 0.767 | 0.375 | 0.576 | 0.411 | 0.115 | 0.397 |
| lgbm | argmax | - | 0.514 | 0.700 | 0.332 | 0.829 | 0.008 | 0.305 | 0.186 |
| lgbm | cumulative/accuracy | [0.71, 0.49, 0.31] | 0.503 | 0.714 | 0.339 | 0.774 | 0.024 | 0.380 | 0.176 |
| lgbm | cumulative/balanced | [0.5, 0.54, 0.27] | 0.444 | 0.774 | 0.382 | 0.588 | 0.447 | 0.181 | 0.313 |

## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)

| column | dbp_lgbm | dbp_linear | sbp_lgbm | sbp_linear | spearman_sbp | spearman_dbp | 순위합 |
|---|---|---|---|---|---|---|---|
| age | 2.754 | 3.144 | 2.892 | 2.909 | 0.444 | -0.016 | 6.000 |
| bmi | 0.047 | 0.444 | 0.381 | 0.768 | 0.283 | 0.255 | 13.000 |
| male | 0.103 | 0.061 | 0.308 | 0.464 | 0.146 | 0.200 | 18.000 |
| resting_hr | 0.226 | 0.212 | 0.074 | 0.079 | -0.057 | 0.048 | 22.000 |
| fasting_glucose | 0.030 | 0.037 | 0.176 | 0.080 | 0.306 | 0.159 | 27.000 |
| waist_cm | 0.004 | 0.182 | 0.126 | 0.056 | 0.344 | 0.250 | 29.000 |
| family_htn | 0.007 | 0.010 | 0.125 | 0.111 | 0.035 | 0.119 | 32.000 |
| education_years | 0.003 | 0.106 | 0.038 | 0.101 | -0.323 | 0.026 | 33.000 |
| diabetes_flag | 0.096 | 0.135 | 0.009 | 0.011 | 0.183 | -0.026 | 36.000 |
| alcohol_week | 0.004 | 0.015 | 0.090 | 0.031 | -0.025 | 0.160 | 38.000 |
| binge | 0.007 | 0.050 | 0.008 | 0.015 | 0.014 | 0.160 | 41.000 |
| missing_count | 0.003 | 0.018 | 0.010 | 0.012 | 0.089 | -0.007 | 46.000 |
| activity_minutes_week | 0.001 | 0.008 | 0.009 | 0.002 | -0.062 | 0.023 | 57.000 |
| alcohol_per_day | -0.000 | 0.000 | 0.001 | 0.016 | 0.099 | 0.158 | 62.000 |
| activity_600plus | 0.000 | 0.008 | -0.004 | 0.004 | -0.006 | 0.028 | 64.000 |
| activity_low_flag | 0.001 | 0.006 | -0.000 | 0.000 | 0.063 | -0.015 | 65.000 |
| alcohol_15plus | -0.002 | 0.000 | 0.003 | 0.009 | 0.099 | 0.158 | 66.000 |
| sleep_short_flag | -0.000 | 0.002 | 0.000 | 0.000 | 0.063 | 0.014 | 69.000 |
| sodium_risk_score | -0.002 | 0.000 | -0.000 | 0.001 | -0.041 | 0.074 | 74.000 |
| sbp | 6.301 | 6.444 | n/a | n/a | n/a | n/a | n/a |

## 4. 하위군 AUROC ≥140/90 (분포 체인)

| sex | age_group | lgbm | linear |
|---|---|---|---|
| female | 19-39 | 0.733 | 0.762 |
| female | 40-59 | 0.617 | 0.622 |
| female | 60+ | 0.587 | 0.602 |
| male | 19-39 | 0.783 | 0.787 |
| male | 40-59 | 0.666 | 0.657 |
| male | 60+ | 0.573 | 0.577 |

## 5. 혼동행렬

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | path | learner |
|---|---|---|---|---|---|---|
| actual_normal | 2200 | 900 | 446 | 2 | 점 추정 | linear |
| actual_elevated | 261 | 454 | 267 | 4 | 점 추정 | linear |
| actual_prehtn | 420 | 592 | 482 | 5 | 점 추정 | linear |
| actual_htn | 141 | 408 | 369 | 9 | 점 추정 | linear |
| actual_normal | 2815 | 12 | 637 | 84 | 분포+규칙 | linear |
| actual_elevated | 563 | 15 | 332 | 76 | 분포+규칙 | linear |
| actual_prehtn | 788 | 9 | 574 | 128 | 분포+규칙 | linear |
| actual_htn | 384 | 12 | 401 | 130 | 분포+규칙 | linear |
| actual_normal | 2135 | 788 | 624 | 1 | 점 추정 | lgbm |
| actual_elevated | 241 | 439 | 305 | 1 | 점 추정 | lgbm |
| actual_prehtn | 367 | 523 | 607 | 2 | 점 추정 | lgbm |
| actual_htn | 118 | 363 | 437 | 9 | 점 추정 | lgbm |
| actual_normal | 2746 | 38 | 621 | 143 | 분포+규칙 | lgbm |
| actual_elevated | 536 | 24 | 306 | 120 | 분포+규칙 | lgbm |
| actual_prehtn | 735 | 23 | 570 | 171 | 분포+규칙 | lgbm |
| actual_htn | 352 | 22 | 390 | 163 | 분포+규칙 | lgbm |

## 6. 피처별 계수(표준화 단위당 mmHg) — sbp_linear 상위 25

| feature | value |
|---|---|
| age | 7.798 |
| male | 2.732 |
| family_htn | 2.390 |
| age_x_male | -2.341 |
| bmi | 2.068 |
| education_years | -1.846 |
| age_x_bmi | -1.242 |
| age_x_resting_hr | -1.030 |
| fasting_glucose | 0.917 |
| binge | 0.910 |
| alcohol_15plus | 0.889 |
| alcohol_per_day | 0.889 |
| age_x_waist_cm | 0.803 |
| diabetes_flag | 0.710 |
| male_x_education_years | 0.546 |
| alcohol_week | 0.540 |
| male_x_bmi | 0.520 |
| male_x_diabetes_flag | -0.474 |
| activity_low_flag | 0.414 |
| male_x_waist_cm | -0.389 |
| missing_count | 0.312 |
| activity_600plus | 0.268 |
| male_x_activity_600plus | 0.262 |
| sodium_risk_score | -0.254 |
| age_x_activity_minutes_week | -0.247 |

## 6. 피처별 계수(표준화 단위당 mmHg) — dbp_linear 상위 25

| feature | value |
|---|---|
| sbp | 7.896 |
| age | -3.081 |
| sbp_x_age | -2.648 |
| age_x_bmi | 1.421 |
| age_x_waist_cm | -1.165 |
| resting_hr | 0.824 |
| binge | 0.791 |
| diabetes_flag | -0.771 |
| age_x_diabetes_flag | -0.750 |
| age_x_education_years | 0.743 |
| male | 0.719 |
| age_x_resting_hr | 0.609 |
| age_x_male | 0.598 |
| male_x_bmi | 0.570 |
| age_x_binge | 0.478 |
| male_x_education_years | 0.450 |
| sleep_short_flag | 0.449 |
| sbp_x_waist_cm | 0.439 |
| family_htn | 0.412 |
| alcohol_week | 0.404 |
| sbp_x_bmi | -0.377 |
| alcohol_per_day | -0.363 |
| alcohol_15plus | -0.363 |
| age_x_fasting_glucose | -0.358 |
| bmi | 0.351 |

## 6. 피처별 gain 비중 — sbp_lgbm 상위 25

| feature | value |
|---|---|
| age | 0.447 |
| age_x_waist_cm | 0.068 |
| waist_cm | 0.049 |
| male_x_bmi | 0.048 |
| education_years | 0.048 |
| age_x_education_years | 0.044 |
| bmi | 0.040 |
| fasting_glucose | 0.032 |
| male | 0.028 |
| age_x_fasting_glucose | 0.027 |
| age_x_bmi | 0.021 |
| alcohol_week | 0.017 |
| age_x_resting_hr | 0.015 |
| family_htn | 0.015 |
| age_x_alcohol_week | 0.014 |
| age_x_male | 0.014 |
| male_x_alcohol_week | 0.011 |
| age_x_family_htn | 0.008 |
| male_x_fasting_glucose | 0.007 |
| resting_hr | 0.006 |
| age_x_missing_count | 0.006 |
| male_x_waist_cm | 0.004 |
| age_x_sodium_risk_score | 0.003 |
| activity_minutes_week | 0.003 |
| male_x_missing_count | 0.002 |

## 6. 피처별 gain 비중 — dbp_lgbm 상위 25

| feature | value |
|---|---|
| sbp | 0.506 |
| age | 0.196 |
| sbp_x_male | 0.063 |
| sbp_x_alcohol_week | 0.036 |
| sbp_x_age | 0.033 |
| sbp_x_binge | 0.021 |
| age_x_diabetes_flag | 0.016 |
| age_x_male | 0.016 |
| alcohol_week | 0.016 |
| age_x_resting_hr | 0.013 |
| resting_hr | 0.011 |
| sbp_x_missing_count | 0.006 |
| age_x_fasting_glucose | 0.005 |
| age_x_alcohol_week | 0.005 |
| male_x_education_years | 0.005 |
| male_x_waist_cm | 0.005 |
| sbp_x_resting_hr | 0.005 |
| male_x_bmi | 0.004 |
| sbp_x_bmi | 0.004 |
| bmi | 0.003 |
| fasting_glucose | 0.002 |
| education_years | 0.002 |
| sbp_x_education_years | 0.002 |
| age_x_family_htn | 0.002 |
| sbp_x_fasting_glucose | 0.002 |

## 7. 테스트 파일 예측

- 11673행 중 예측 11594행, 제외 79행. 점 추정 단계 분포: {'linear': {'normal': 0.468, 'elevated': 0.313, 'prehtn': 0.209, '': 0.007, 'htn': 0.004}, 'lgbm': {'normal': 0.455, 'elevated': 0.278, 'prehtn': 0.258, '': 0.007, 'htn': 0.002}}
- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv

주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.


# 체인 파이프라인 — chain_20261026_110736

| 항목 | 값 |
|---|---|
| 데이터 | train/ 46691행 |
| 제외 행 | {'imputed_ge_5': 409, 'bmi_missing': 295, 'waist_cm_missing': 196, 'fasting_glucose_out_of_range': 65, 'resting_hr_out_of_range': 29, 'bmi_out_of_range': 8} |
| 사용 행 | 45689행 (대치 행 포함) |
| 분할 | time_order {'train': 31982, 'val': 6853, 'test': 6854} |
| 최빈값 대치 | {'fasting_glucose': 93.0, 'resting_hr': 68.0, 'education_years': 12.0} |
| 활동 결측 대치 | flag1 행 최빈값 0분 / flag0 행 최빈값 420분 |
| 허리둘레 추정 | waist ~ 1 + male + bmi + age + male·bmi + male·age, 계수 [19.866, 2.007, 2.279, 0.114, 0.146, -0.013], 학습 RMSE 4.41cm |
| 음주 | 3열 결측 0, 15잔 이상 → 15 + alcohol_15plus, per_day=1 |
| 활동 상한 | 600분 이상 → 600 + activity_600plus, flag = 분<150 |
| 제외 열 | sodium_risk_score, sleep_short_flag, missing_count, education_years |
| 입력 열 | 기준 15 → sbp 모델 66(나이×, 성별×) / dbp 모델 90(+ sbp, sbp×) |
| 부트스트랩 | 200개, 검증 잔차 나이대×성별 풀 |
| 판정 규칙 | cumulative/accuracy (τ 검증 분할) |
| 행 검증 | 필수 ['age', 'sex', 'bmi', 'waist_cm'], 대치 ≥5 제외, 범위 {'bmi': (14.0, 50.0), 'waist_cm': (50.0, 150.0), 'fasting_glucose': (50.0, 300.0), 'resting_hr': (40.0, 150.0)} |
| 편차 중심·힌지 | 중심 reference ({'bmi': 23.0, 'waist_cm': {'male': 90.0, 'female': 85.0}, 'fasting_glucose': 100.0, 'resting_hr': 100.0, 'activity_minutes_week': 150.0, 'alcohol_week': 14.0}), 힌지 True |

## 1. 점 추정 체인 (테스트 6854행)

| learner | target | rmse | mae | bias(pred-actual) | r2 |
|---|---|---|---|---|---|
| linear | sbp | 13.768 | 10.444 | 0.311 | 0.260 |
| linear | dbp(예측 sbp 투입) | 8.979 | 7.123 | 1.333 | 0.162 |
| linear | dbp(실제 sbp 투입) | 6.515 | 5.099 | 1.354 | 0.559 |
| linear | dbp(분포 평균) | 8.904 | 7.049 | 1.283 | 0.176 |
| lgbm | sbp | 13.727 | 10.351 | 0.421 | 0.264 |
| lgbm | dbp(예측 sbp 투입) | 8.967 | 7.109 | 1.567 | 0.165 |
| lgbm | dbp(실제 sbp 투입) | 6.126 | 4.810 | 1.161 | 0.610 |
| lgbm | dbp(분포 평균) | 8.844 | 6.994 | 1.234 | 0.188 |

### 단계(점 추정 → 경계)

| learner | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.447 | 0.803 | 0.355 | 0.598 | 0.463 | 0.350 | 0.009 | 0.410 | 0.341 | 0.247 | 0.003 |
| lgbm | 0.454 | 0.791 | 0.365 | 0.589 | 0.453 | 0.414 | 0.004 | 0.399 | 0.310 | 0.289 | 0.002 |

전부 normal 기준선 정확도 0.509


## 2. 분포 체인 (단계 확률)

| learner | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 | 보정 절편 | ECE ≥140/90 | 정확도(규칙) | 인접 정확도 | 균형 정확도 | 재현 elevated | 재현 htn | P평균_normal | P평균_elevated | P평균_prehtn | P평균_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.718 | 0.720 | 0.247 | 0.891 | -0.174 | 0.019 | 0.514 | 0.696 | 0.325 | 0.000 | 0.234 | 0.477 | 0.118 | 0.254 | 0.151 |
| lgbm | 0.715 | 0.718 | 0.238 | 0.856 | -0.167 | 0.019 | 0.509 | 0.703 | 0.321 | 0.000 | 0.136 | 0.480 | 0.117 | 0.252 | 0.151 |

### 판정 규칙 비교

| learner | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| linear | argmax | - | 0.515 | 0.707 | 0.330 | 0.834 | 0.010 | 0.305 | 0.170 |
| linear | cumulative/accuracy | [0.82, 0.55, 0.29] | 0.514 | 0.696 | 0.325 | 0.862 | 0.000 | 0.204 | 0.234 |
| linear | cumulative/balanced | [0.49, 0.49, 0.24] | 0.438 | 0.752 | 0.380 | 0.572 | 0.331 | 0.217 | 0.398 |
| lgbm | argmax | - | 0.518 | 0.706 | 0.333 | 0.839 | 0.014 | 0.299 | 0.178 |
| lgbm | cumulative/accuracy | [0.81, 0.52, 0.33] | 0.509 | 0.703 | 0.321 | 0.830 | 0.000 | 0.318 | 0.136 |
| lgbm | cumulative/balanced | [0.51, 0.54, 0.23] | 0.437 | 0.751 | 0.379 | 0.593 | 0.371 | 0.110 | 0.444 |

## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)

| column | dbp_lgbm | dbp_linear | sbp_lgbm | sbp_linear | spearman_sbp | spearman_dbp | 순위합 |
|---|---|---|---|---|---|---|---|
| age | 2.934 | 3.471 | 3.641 | 3.780 | 0.444 | -0.010 | 6.000 |
| bmi | 0.060 | 0.415 | 0.440 | 0.710 | 0.286 | 0.257 | 14.000 |
| male | 0.119 | 0.097 | 0.343 | 0.479 | 0.147 | 0.199 | 20.000 |
| resting_hr | 0.248 | 0.223 | 0.079 | 0.130 | -0.059 | 0.048 | 20.000 |
| alcohol_week | 0.007 | 0.652 | 0.097 | 0.210 | -0.021 | 0.158 | 22.000 |
| fasting_glucose | 0.010 | 0.060 | 0.192 | 0.125 | 0.308 | 0.160 | 29.000 |
| diabetes_flag | 0.107 | 0.172 | 0.006 | 0.013 | 0.185 | -0.027 | 35.000 |
| family_htn | 0.002 | 0.013 | 0.125 | 0.108 | 0.037 | 0.119 | 36.000 |
| waist_cm | -0.004 | 0.210 | 0.053 | 0.102 | 0.348 | 0.254 | 38.000 |
| alcohol_per_day | 0.000 | 0.168 | 0.001 | 0.085 | 0.101 | 0.158 | 43.000 |
| alcohol_15plus | 0.000 | 0.141 | 0.001 | 0.084 | 0.101 | 0.158 | 45.000 |
| binge | -0.002 | 0.067 | 0.025 | 0.032 | 0.016 | 0.159 | 46.000 |
| activity_minutes_week | 0.007 | 0.006 | 0.008 | 0.008 | -0.060 | 0.018 | 47.000 |
| activity_600plus | 0.004 | 0.009 | 0.000 | 0.011 | -0.005 | 0.026 | 51.000 |
| activity_low_flag | 0.001 | 0.001 | -0.001 | 0.002 | 0.061 | -0.011 | 58.000 |
| sbp | 6.340 | 6.584 | n/a | n/a | n/a | n/a | n/a |

## 4. 하위군 AUROC ≥140/90 (분포 체인)

| sex | age_group | lgbm | linear |
|---|---|---|---|
| female | 19-39 | 0.731 | 0.689 |
| female | 40-59 | 0.633 | 0.636 |
| female | 60+ | 0.591 | 0.599 |
| male | 19-39 | 0.777 | 0.780 |
| male | 40-59 | 0.632 | 0.641 |
| male | 60+ | 0.575 | 0.587 |

## 5. 혼동행렬

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | path | learner |
|---|---|---|---|---|---|---|
| actual_normal | 2088 | 921 | 478 | 2 | 점 추정 | linear |
| actual_elevated | 229 | 450 | 289 | 4 | 점 추정 | linear |
| actual_prehtn | 375 | 588 | 520 | 4 | 점 추정 | linear |
| actual_htn | 115 | 379 | 404 | 8 | 점 추정 | linear |
| actual_normal | 3007 | 0 | 282 | 200 | 분포+규칙 | linear |
| actual_elevated | 693 | 0 | 118 | 161 | 분포+규칙 | linear |
| actual_prehtn | 939 | 0 | 304 | 244 | 분포+규칙 | linear |
| actual_htn | 504 | 0 | 190 | 212 | 분포+규칙 | linear |
| actual_normal | 2056 | 807 | 622 | 4 | 점 추정 | lgbm |
| actual_elevated | 226 | 440 | 305 | 1 | 점 추정 | lgbm |
| actual_prehtn | 343 | 526 | 615 | 3 | 점 추정 | lgbm |
| actual_htn | 109 | 351 | 442 | 4 | 점 추정 | lgbm |
| actual_normal | 2895 | 0 | 476 | 118 | 분포+규칙 | lgbm |
| actual_elevated | 662 | 0 | 226 | 84 | 분포+규칙 | lgbm |
| actual_prehtn | 879 | 0 | 473 | 135 | 분포+규칙 | lgbm |
| actual_htn | 477 | 0 | 306 | 123 | 분포+규칙 | lgbm |

## 6. 피처별 계수(표준화 단위당 mmHg) — sbp_linear 상위 25

| feature | value |
|---|---|
| age | 5.775 |
| fasting_glucose | 3.641 |
| age_x_resting_hr | -3.186 |
| age_x_male | -2.843 |
| fasting_glucose_over | -2.807 |
| male | 2.187 |
| family_htn | 2.110 |
| bmi_over | 1.745 |
| age_x_waist_cm | 1.629 |
| age_x_alcohol_week_over | -1.379 |
| age_x_fasting_glucose | 1.366 |
| age_x_fasting_glucose_over | -1.362 |
| binge | 0.952 |
| diabetes_flag | 0.899 |
| age_x_alcohol_15plus | 0.882 |
| age_x_alcohol_per_day | 0.882 |
| age_x_bmi | -0.854 |
| age_x_waist_cm_over | -0.800 |
| waist_cm | 0.711 |
| bmi | 0.681 |
| alcohol_week | 0.634 |
| activity_minutes_week_under | 0.591 |
| age_x_alcohol_week | -0.587 |
| male_x_alcohol_week_over | -0.574 |
| alcohol_week_over | 0.527 |

## 6. 피처별 계수(표준화 단위당 mmHg) — dbp_linear 상위 25

| feature | value |
|---|---|
| sbp | 8.520 |
| sbp_x_age | -2.726 |
| age | -2.542 |
| sbp_x_alcohol_week_over | -2.143 |
| age_x_waist_cm | -1.637 |
| age_x_resting_hr | 1.592 |
| age_x_fasting_glucose | -1.346 |
| age_x_bmi | 1.258 |
| sbp_x_alcohol_per_day | 1.130 |
| sbp_x_alcohol_15plus | 1.130 |
| age_x_fasting_glucose_over | 1.051 |
| age_x_diabetes_flag | -0.956 |
| binge | 0.844 |
| sbp_x_waist_cm | 0.713 |
| age_x_binge | 0.649 |
| male | 0.636 |
| resting_hr | 0.631 |
| diabetes_flag | -0.604 |
| family_htn | 0.603 |
| age_x_alcohol_week_over | 0.563 |
| male_x_bmi | 0.546 |
| sbp_x_resting_hr | 0.514 |
| sbp_x_fasting_glucose_over | -0.511 |
| resting_hr_under | -0.497 |
| male_x_fasting_glucose | 0.486 |

## 6. 피처별 gain 비중 — sbp_lgbm 상위 25

| feature | value |
|---|---|
| age | 0.197 |
| age_x_alcohol_week | 0.186 |
| age_x_resting_hr | 0.135 |
| age_x_resting_hr_over | 0.067 |
| age_x_bmi_over | 0.051 |
| bmi_over | 0.041 |
| fasting_glucose | 0.037 |
| male_x_bmi | 0.030 |
| age_x_bmi_under | 0.026 |
| bmi | 0.024 |
| age_x_fasting_glucose | 0.018 |
| male_x_bmi_under | 0.017 |
| male_x_alcohol_week | 0.014 |
| waist_cm | 0.014 |
| family_htn | 0.013 |
| male | 0.012 |
| age_x_waist_cm | 0.012 |
| alcohol_week | 0.011 |
| male_x_bmi_over | 0.010 |
| age_x_family_htn | 0.008 |
| age_x_bmi | 0.007 |
| age_x_fasting_glucose_over | 0.006 |
| male_x_resting_hr_under | 0.005 |
| age_x_male | 0.005 |
| resting_hr | 0.005 |

## 6. 피처별 gain 비중 — dbp_lgbm 상위 25

| feature | value |
|---|---|
| sbp | 0.506 |
| age | 0.117 |
| age_x_resting_hr | 0.069 |
| sbp_x_resting_hr | 0.052 |
| sbp_x_resting_hr_under | 0.031 |
| sbp_x_resting_hr_over | 0.029 |
| age_x_resting_hr_over | 0.027 |
| sbp_x_age | 0.016 |
| age_x_diabetes_flag | 0.013 |
| age_x_resting_hr_under | 0.011 |
| sbp_x_male | 0.011 |
| sbp_x_bmi_under | 0.009 |
| male_x_bmi | 0.008 |
| age_x_bmi_under | 0.008 |
| age_x_fasting_glucose_over | 0.008 |
| sbp_x_alcohol_week | 0.006 |
| sbp_x_alcohol_week_over | 0.006 |
| age_x_alcohol_week | 0.006 |
| sbp_x_binge | 0.005 |
| sbp_x_bmi | 0.005 |
| resting_hr | 0.005 |
| age_x_male | 0.004 |
| sbp_x_waist_cm_over | 0.003 |
| male_x_resting_hr_under | 0.003 |
| sbp_x_bmi_over | 0.002 |

## 7. 테스트 파일 예측

- 11673행 중 예측 11413행, 제외 260행. 점 추정 단계 분포: {'linear': {'normal': 0.452, 'elevated': 0.305, 'prehtn': 0.218, '': 0.022, 'htn': 0.003}, 'lgbm': {'normal': 0.446, 'elevated': 0.269, 'prehtn': 0.261, '': 0.022, 'htn': 0.001}}
- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv

주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.


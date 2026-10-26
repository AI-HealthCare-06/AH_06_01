# 체인 파이프라인 — chain_20261025_222745

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
| 제외 열 | sodium_risk_score, sleep_short_flag, missing_count, education_years |
| 입력 열 | 기준 15 → sbp 모델 42(나이×, 성별×) / dbp 모델 58(+ sbp, sbp×) |
| 부트스트랩 | 200개, 검증 잔차 나이대×성별 풀 |
| 판정 규칙 | cumulative/accuracy (τ 검증 분할) |

## 1. 점 추정 체인 (테스트 6960행)

| learner | target | rmse | mae | bias(pred-actual) | r2 |
|---|---|---|---|---|---|
| linear | sbp | 13.811 | 10.446 | 0.169 | 0.261 |
| linear | dbp(예측 sbp 투입) | 8.987 | 7.124 | 1.284 | 0.165 |
| linear | dbp(실제 sbp 투입) | 6.518 | 5.093 | 1.353 | 0.561 |
| linear | dbp(분포 평균) | 8.903 | 7.049 | 1.264 | 0.181 |
| lgbm | sbp | 13.764 | 10.361 | 0.437 | 0.266 |
| lgbm | dbp(예측 sbp 투입) | 8.979 | 7.123 | 1.603 | 0.166 |
| lgbm | dbp(실제 sbp 투입) | 6.120 | 4.806 | 1.163 | 0.613 |
| lgbm | dbp(분포 평균) | 8.843 | 6.989 | 1.225 | 0.191 |

### 단계(점 추정 → 경계)

| learner | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.441 | 0.802 | 0.350 | 0.599 | 0.487 | 0.306 | 0.009 | 0.413 | 0.365 | 0.219 | 0.003 |
| lgbm | 0.456 | 0.790 | 0.366 | 0.592 | 0.450 | 0.412 | 0.010 | 0.401 | 0.310 | 0.287 | 0.002 |

전부 normal 기준선 정확도 0.510


## 2. 분포 체인 (단계 확률)

| learner | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 | 보정 절편 | ECE ≥140/90 | 정확도(규칙) | 인접 정확도 | 균형 정확도 | 재현 elevated | 재현 htn | P평균_normal | P평균_elevated | P평균_prehtn | P평균_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.720 | 0.720 | 0.256 | 0.937 | -0.156 | 0.018 | 0.517 | 0.698 | 0.329 | 0.000 | 0.246 | 0.478 | 0.118 | 0.253 | 0.151 |
| lgbm | 0.718 | 0.719 | 0.244 | 0.886 | -0.157 | 0.018 | 0.501 | 0.711 | 0.332 | 0.006 | 0.174 | 0.480 | 0.117 | 0.252 | 0.151 |

### 판정 규칙 비교

| learner | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| linear | argmax | - | 0.520 | 0.707 | 0.335 | 0.844 | 0.013 | 0.292 | 0.190 |
| linear | cumulative/accuracy | [0.79, 0.54, 0.29] | 0.517 | 0.698 | 0.329 | 0.864 | 0.000 | 0.205 | 0.246 |
| linear | cumulative/balanced | [0.5, 0.6, 0.3] | 0.432 | 0.796 | 0.368 | 0.587 | 0.541 | 0.125 | 0.218 |
| lgbm | argmax | - | 0.514 | 0.702 | 0.332 | 0.831 | 0.011 | 0.297 | 0.188 |
| lgbm | cumulative/accuracy | [0.74, 0.49, 0.31] | 0.501 | 0.711 | 0.332 | 0.782 | 0.006 | 0.366 | 0.174 |
| lgbm | cumulative/balanced | [0.53, 0.56, 0.26] | 0.453 | 0.765 | 0.385 | 0.620 | 0.426 | 0.134 | 0.361 |

## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)

| column | dbp_lgbm | dbp_linear | sbp_lgbm | sbp_linear | spearman_sbp | spearman_dbp | 순위합 |
|---|---|---|---|---|---|---|---|
| age | 2.798 | 3.226 | 3.311 | 3.693 | 0.444 | -0.016 | 6.000 |
| bmi | 0.047 | 0.513 | 0.423 | 0.854 | 0.283 | 0.255 | 13.000 |
| male | 0.111 | 0.089 | 0.303 | 0.473 | 0.146 | 0.200 | 17.000 |
| resting_hr | 0.235 | 0.185 | 0.083 | 0.095 | -0.057 | 0.048 | 19.000 |
| waist_cm | 0.004 | 0.258 | 0.091 | 0.081 | 0.344 | 0.250 | 26.000 |
| fasting_glucose | 0.015 | 0.048 | 0.187 | 0.057 | 0.306 | 0.159 | 27.000 |
| family_htn | 0.004 | 0.013 | 0.112 | 0.090 | 0.035 | 0.119 | 32.000 |
| binge | 0.008 | 0.069 | 0.011 | 0.021 | 0.014 | 0.160 | 34.000 |
| diabetes_flag | 0.105 | 0.149 | 0.008 | 0.010 | 0.183 | -0.026 | 35.000 |
| alcohol_week | 0.001 | 0.014 | 0.080 | 0.031 | -0.025 | 0.160 | 39.000 |
| activity_minutes_week | 0.001 | 0.007 | 0.008 | 0.001 | -0.062 | 0.023 | 49.000 |
| activity_low_flag | 0.004 | 0.008 | -0.003 | -0.000 | 0.063 | -0.015 | 51.000 |
| activity_600plus | 0.000 | 0.005 | -0.002 | 0.010 | -0.006 | 0.028 | 54.000 |
| alcohol_15plus | -0.002 | 0.001 | 0.007 | 0.013 | 0.099 | 0.158 | 54.000 |
| alcohol_per_day | -0.000 | 0.001 | 0.002 | 0.020 | 0.099 | 0.158 | 54.000 |
| sbp | 6.271 | 6.592 | n/a | n/a | n/a | n/a | n/a |

## 4. 하위군 AUROC ≥140/90 (분포 체인)

| sex | age_group | lgbm | linear |
|---|---|---|---|
| female | 19-39 | 0.743 | 0.754 |
| female | 40-59 | 0.617 | 0.622 |
| female | 60+ | 0.591 | 0.610 |
| male | 19-39 | 0.784 | 0.782 |
| male | 40-59 | 0.669 | 0.658 |
| male | 60+ | 0.561 | 0.571 |

## 5. 혼동행렬

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | path | learner |
|---|---|---|---|---|---|---|
| actual_normal | 2125 | 983 | 437 | 3 | 점 추정 | linear |
| actual_elevated | 242 | 480 | 261 | 3 | 점 추정 | linear |
| actual_prehtn | 384 | 652 | 458 | 5 | 점 추정 | linear |
| actual_htn | 126 | 423 | 370 | 8 | 점 추정 | linear |
| actual_normal | 3065 | 3 | 289 | 191 | 분포+규칙 | linear |
| actual_elevated | 681 | 0 | 143 | 162 | 분포+규칙 | linear |
| actual_prehtn | 956 | 0 | 308 | 235 | 분포+규칙 | linear |
| actual_htn | 503 | 0 | 196 | 228 | 분포+규칙 | linear |
| actual_normal | 2101 | 821 | 624 | 2 | 점 추정 | lgbm |
| actual_elevated | 222 | 444 | 319 | 1 | 점 추정 | lgbm |
| actual_prehtn | 352 | 527 | 617 | 3 | 점 추정 | lgbm |
| actual_htn | 113 | 368 | 437 | 9 | 점 추정 | lgbm |
| actual_normal | 2773 | 7 | 629 | 139 | 분포+규칙 | lgbm |
| actual_elevated | 576 | 6 | 284 | 120 | 분포+규칙 | lgbm |
| actual_prehtn | 758 | 4 | 548 | 189 | 분포+규칙 | lgbm |
| actual_htn | 364 | 4 | 398 | 161 | 분포+규칙 | lgbm |

## 6. 피처별 계수(표준화 단위당 mmHg) — sbp_linear 상위 25

| feature | value |
|---|---|
| age | 9.194 |
| age_x_male | -2.931 |
| male | 2.294 |
| bmi | 2.213 |
| family_htn | 2.048 |
| age_x_bmi | -1.326 |
| age_x_resting_hr | -1.072 |
| binge | 1.043 |
| alcohol_per_day | 0.974 |
| alcohol_15plus | 0.974 |
| age_x_waist_cm | 0.948 |
| diabetes_flag | 0.943 |
| fasting_glucose | 0.902 |
| activity_600plus | 0.572 |
| alcohol_week | 0.557 |
| male_x_waist_cm | -0.543 |
| male_x_bmi | 0.531 |
| male_x_diabetes_flag | -0.519 |
| activity_low_flag | 0.492 |
| age_x_binge | -0.304 |
| male_x_activity_600plus | 0.293 |
| age_x_activity_minutes_week | -0.230 |
| waist_cm | 0.195 |
| male_x_resting_hr | 0.185 |
| male_x_activity_minutes_week | -0.177 |

## 6. 피처별 계수(표준화 단위당 mmHg) — dbp_linear 상위 25

| feature | value |
|---|---|
| sbp | 7.996 |
| age | -3.561 |
| sbp_x_age | -2.732 |
| age_x_bmi | 1.620 |
| age_x_waist_cm | -1.407 |
| male | 0.983 |
| binge | 0.881 |
| age_x_diabetes_flag | -0.862 |
| diabetes_flag | -0.756 |
| resting_hr | 0.740 |
| age_x_male | 0.708 |
| age_x_binge | 0.633 |
| age_x_resting_hr | 0.612 |
| family_htn | 0.612 |
| sbp_x_waist_cm | 0.537 |
| male_x_bmi | 0.520 |
| sbp_x_bmi | -0.468 |
| alcohol_per_day | -0.418 |
| alcohol_15plus | -0.418 |
| alcohol_week | 0.413 |
| age_x_fasting_glucose | -0.373 |
| bmi | 0.351 |
| sbp_x_activity_low_flag | 0.343 |
| activity_600plus | -0.317 |
| age_x_activity_low_flag | -0.311 |

## 6. 피처별 gain 비중 — sbp_lgbm 상위 25

| feature | value |
|---|---|
| age | 0.409 |
| waist_cm | 0.094 |
| fasting_glucose | 0.063 |
| age_x_fasting_glucose | 0.058 |
| bmi | 0.047 |
| age_x_waist_cm | 0.044 |
| male_x_bmi | 0.044 |
| age_x_bmi | 0.038 |
| age_x_alcohol_week | 0.021 |
| male | 0.020 |
| age_x_activity_low_flag | 0.020 |
| age_x_resting_hr | 0.018 |
| alcohol_week | 0.016 |
| male_x_alcohol_week | 0.016 |
| age_x_family_htn | 0.015 |
| family_htn | 0.012 |
| age_x_male | 0.012 |
| male_x_waist_cm | 0.010 |
| resting_hr | 0.007 |
| age_x_binge | 0.005 |
| activity_minutes_week | 0.004 |
| male_x_fasting_glucose | 0.004 |
| male_x_activity_minutes_week | 0.003 |
| binge | 0.003 |
| age_x_alcohol_15plus | 0.003 |

## 6. 피처별 gain 비중 — dbp_lgbm 상위 25

| feature | value |
|---|---|
| sbp | 0.507 |
| age | 0.212 |
| sbp_x_male | 0.048 |
| sbp_x_binge | 0.045 |
| sbp_x_alcohol_week | 0.035 |
| sbp_x_age | 0.019 |
| age_x_male | 0.015 |
| age_x_diabetes_flag | 0.015 |
| age_x_resting_hr | 0.012 |
| resting_hr | 0.011 |
| sbp_x_family_htn | 0.010 |
| alcohol_week | 0.008 |
| age_x_fasting_glucose | 0.006 |
| sbp_x_resting_hr | 0.006 |
| sbp_x_bmi | 0.005 |
| male_x_waist_cm | 0.005 |
| sbp_x_activity_low_flag | 0.004 |
| male_x_bmi | 0.004 |
| fasting_glucose | 0.004 |
| bmi | 0.003 |
| sbp_x_fasting_glucose | 0.003 |
| sbp_x_waist_cm | 0.003 |
| diabetes_flag | 0.002 |
| age_x_family_htn | 0.002 |
| age_x_alcohol_week | 0.002 |

## 7. 테스트 파일 예측

- 11673행 중 예측 11594행, 제외 79행. 점 추정 단계 분포: {'linear': {'normal': 0.459, 'elevated': 0.328, 'prehtn': 0.202, '': 0.007, 'htn': 0.004}, 'lgbm': {'normal': 0.453, 'elevated': 0.279, 'prehtn': 0.259, '': 0.007, 'htn': 0.002}}
- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv

주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.


# 체인 파이프라인 — chain_20261026_110615

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
| 입력 열 | 기준 15 → sbp 모델 42(나이×, 성별×) / dbp 모델 58(+ sbp, sbp×) |
| 부트스트랩 | 200개, 검증 잔차 나이대×성별 풀 |
| 판정 규칙 | cumulative/accuracy (τ 검증 분할) |
| 행 검증 | 필수 ['age', 'sex', 'bmi', 'waist_cm'], 대치 ≥5 제외, 범위 {'bmi': (14.0, 50.0), 'waist_cm': (50.0, 150.0), 'fasting_glucose': (50.0, 300.0), 'resting_hr': (40.0, 150.0)} |
| 편차 중심·힌지 | 중심 mean (학습 평균), 힌지 False |

## 1. 점 추정 체인 (테스트 6854행)

| learner | target | rmse | mae | bias(pred-actual) | r2 |
|---|---|---|---|---|---|
| linear | sbp | 13.753 | 10.422 | 0.199 | 0.261 |
| linear | dbp(예측 sbp 투입) | 8.968 | 7.119 | 1.332 | 0.165 |
| linear | dbp(실제 sbp 투입) | 6.514 | 5.095 | 1.396 | 0.559 |
| linear | dbp(분포 평균) | 8.895 | 7.051 | 1.293 | 0.178 |
| lgbm | sbp | 13.730 | 10.351 | 0.431 | 0.264 |
| lgbm | dbp(예측 sbp 투입) | 8.978 | 7.137 | 1.622 | 0.163 |
| lgbm | dbp(실제 sbp 투입) | 6.128 | 4.816 | 1.202 | 0.610 |
| lgbm | dbp(분포 평균) | 8.839 | 6.992 | 1.242 | 0.188 |

### 단계(점 추정 → 경계)

| learner | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.440 | 0.803 | 0.348 | 0.596 | 0.472 | 0.315 | 0.009 | 0.413 | 0.359 | 0.225 | 0.003 |
| lgbm | 0.454 | 0.794 | 0.362 | 0.592 | 0.443 | 0.410 | 0.004 | 0.401 | 0.309 | 0.289 | 0.002 |

전부 normal 기준선 정확도 0.509


## 2. 분포 체인 (단계 확률)

| learner | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 | 보정 절편 | ECE ≥140/90 | 정확도(규칙) | 인접 정확도 | 균형 정확도 | 재현 elevated | 재현 htn | P평균_normal | P평균_elevated | P평균_prehtn | P평균_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.722 | 0.721 | 0.253 | 0.909 | -0.170 | 0.019 | 0.503 | 0.710 | 0.345 | 0.000 | 0.245 | 0.478 | 0.118 | 0.254 | 0.151 |
| lgbm | 0.716 | 0.719 | 0.241 | 0.860 | -0.168 | 0.019 | 0.517 | 0.709 | 0.315 | 0.000 | 0.085 | 0.481 | 0.116 | 0.252 | 0.151 |

### 판정 규칙 비교

| learner | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| linear | argmax | - | 0.518 | 0.708 | 0.332 | 0.842 | 0.009 | 0.291 | 0.185 |
| linear | cumulative/accuracy | [0.76, 0.47, 0.29] | 0.503 | 0.710 | 0.345 | 0.767 | 0.000 | 0.369 | 0.245 |
| linear | cumulative/balanced | [0.48, 0.54, 0.25] | 0.426 | 0.776 | 0.375 | 0.559 | 0.427 | 0.149 | 0.366 |
| lgbm | argmax | - | 0.516 | 0.703 | 0.333 | 0.834 | 0.006 | 0.303 | 0.189 |
| lgbm | cumulative/accuracy | [0.81, 0.54, 0.36] | 0.517 | 0.709 | 0.315 | 0.861 | 0.000 | 0.312 | 0.085 |
| lgbm | cumulative/balanced | [0.52, 0.49, 0.21] | 0.444 | 0.718 | 0.382 | 0.605 | 0.251 | 0.143 | 0.529 |

## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)

| column | dbp_lgbm | dbp_linear | sbp_lgbm | sbp_linear | spearman_sbp | spearman_dbp | 순위합 |
|---|---|---|---|---|---|---|---|
| age | 2.903 | 3.346 | 3.482 | 3.835 | 0.444 | -0.010 | 6.000 |
| bmi | 0.025 | 0.428 | 0.339 | 0.706 | 0.286 | 0.257 | 13.000 |
| male | 0.100 | 0.082 | 0.317 | 0.483 | 0.147 | 0.199 | 18.000 |
| resting_hr | 0.212 | 0.198 | 0.071 | 0.097 | -0.059 | 0.048 | 21.000 |
| waist_cm | 0.009 | 0.235 | 0.100 | 0.085 | 0.348 | 0.254 | 25.000 |
| fasting_glucose | 0.013 | 0.055 | 0.194 | 0.082 | 0.308 | 0.160 | 27.000 |
| family_htn | 0.003 | 0.016 | 0.123 | 0.103 | 0.037 | 0.119 | 32.000 |
| diabetes_flag | 0.106 | 0.155 | 0.004 | 0.018 | 0.185 | -0.027 | 33.000 |
| alcohol_week | 0.013 | 0.028 | 0.082 | 0.026 | -0.021 | 0.158 | 34.000 |
| binge | 0.008 | 0.069 | 0.021 | 0.034 | 0.016 | 0.159 | 35.000 |
| alcohol_15plus | 0.001 | 0.007 | 0.004 | 0.022 | 0.101 | 0.158 | 46.000 |
| activity_minutes_week | 0.005 | 0.003 | 0.004 | 0.002 | -0.060 | 0.018 | 52.000 |
| activity_600plus | 0.001 | 0.008 | -0.002 | 0.017 | -0.005 | 0.026 | 53.000 |
| alcohol_per_day | 0.000 | 0.004 | 0.001 | 0.018 | 0.101 | 0.158 | 54.000 |
| activity_low_flag | 0.000 | 0.003 | -0.005 | 0.001 | 0.061 | -0.011 | 61.000 |
| sbp | 6.205 | 6.533 | n/a | n/a | n/a | n/a | n/a |

## 4. 하위군 AUROC ≥140/90 (분포 체인)

| sex | age_group | lgbm | linear |
|---|---|---|---|
| female | 19-39 | 0.712 | 0.685 |
| female | 40-59 | 0.627 | 0.632 |
| female | 60+ | 0.593 | 0.615 |
| male | 19-39 | 0.789 | 0.782 |
| male | 40-59 | 0.639 | 0.648 |
| male | 60+ | 0.573 | 0.585 |

## 5. 혼동행렬

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | path | learner |
|---|---|---|---|---|---|---|
| actual_normal | 2080 | 970 | 436 | 3 | 점 추정 | linear |
| actual_elevated | 244 | 459 | 266 | 3 | 점 추정 | linear |
| actual_prehtn | 382 | 632 | 468 | 5 | 점 추정 | linear |
| actual_htn | 125 | 399 | 374 | 8 | 점 추정 | linear |
| actual_normal | 2677 | 0 | 627 | 185 | 분포+규칙 | linear |
| actual_elevated | 521 | 0 | 303 | 148 | 분포+규칙 | linear |
| actual_prehtn | 700 | 0 | 549 | 238 | 분포+규칙 | linear |
| actual_htn | 329 | 1 | 354 | 222 | 분포+규칙 | linear |
| actual_normal | 2065 | 815 | 608 | 1 | 점 추정 | lgbm |
| actual_elevated | 222 | 431 | 318 | 1 | 점 추정 | lgbm |
| actual_prehtn | 346 | 526 | 610 | 5 | 점 추정 | lgbm |
| actual_htn | 114 | 345 | 443 | 4 | 점 추정 | lgbm |
| actual_normal | 3005 | 0 | 426 | 58 | 분포+규칙 | lgbm |
| actual_elevated | 712 | 0 | 219 | 41 | 분포+규칙 | lgbm |
| actual_prehtn | 944 | 0 | 464 | 79 | 분포+규칙 | lgbm |
| actual_htn | 521 | 2 | 306 | 77 | 분포+규칙 | lgbm |

## 6. 피처별 계수(표준화 단위당 mmHg) — sbp_linear 상위 25

| feature | value |
|---|---|
| age | 9.207 |
| age_x_male | -2.979 |
| male | 2.247 |
| bmi | 2.187 |
| family_htn | 2.039 |
| age_x_bmi | -1.324 |
| age_x_resting_hr | -1.082 |
| fasting_glucose | 1.066 |
| binge | 1.045 |
| alcohol_per_day | 0.994 |
| alcohol_15plus | 0.994 |
| age_x_waist_cm | 0.977 |
| diabetes_flag | 0.571 |
| activity_600plus | 0.560 |
| alcohol_week | 0.549 |
| male_x_bmi | 0.526 |
| male_x_waist_cm | -0.524 |
| male_x_diabetes_flag | -0.502 |
| activity_low_flag | 0.490 |
| age_x_binge | -0.321 |
| male_x_activity_600plus | 0.288 |
| age_x_activity_minutes_week | -0.287 |
| waist_cm | 0.205 |
| male_x_resting_hr | 0.177 |
| age_x_activity_600plus | 0.177 |

## 6. 피처별 계수(표준화 단위당 mmHg) — dbp_linear 상위 25

| feature | value |
|---|---|
| sbp | 7.992 |
| age | -3.588 |
| sbp_x_age | -2.687 |
| age_x_bmi | 1.580 |
| age_x_waist_cm | -1.373 |
| diabetes_flag | -1.013 |
| male | 0.968 |
| binge | 0.854 |
| age_x_diabetes_flag | -0.814 |
| resting_hr | 0.798 |
| age_x_male | 0.730 |
| age_x_binge | 0.641 |
| family_htn | 0.625 |
| age_x_resting_hr | 0.617 |
| male_x_bmi | 0.526 |
| sbp_x_waist_cm | 0.501 |
| age_x_fasting_glucose | -0.440 |
| sbp_x_bmi | -0.421 |
| alcohol_15plus | -0.406 |
| alcohol_per_day | -0.406 |
| alcohol_week | 0.380 |
| sbp_x_activity_low_flag | 0.334 |
| bmi | 0.333 |
| male_x_activity_minutes_week | -0.299 |
| age_x_activity_low_flag | -0.280 |

## 6. 피처별 gain 비중 — sbp_lgbm 상위 25

| feature | value |
|---|---|
| age | 0.407 |
| waist_cm | 0.094 |
| fasting_glucose | 0.064 |
| age_x_fasting_glucose | 0.057 |
| bmi | 0.047 |
| male_x_bmi | 0.047 |
| age_x_waist_cm | 0.041 |
| age_x_bmi | 0.038 |
| age_x_alcohol_week | 0.021 |
| alcohol_week | 0.021 |
| male | 0.021 |
| age_x_activity_low_flag | 0.019 |
| age_x_resting_hr | 0.019 |
| male_x_alcohol_week | 0.016 |
| age_x_family_htn | 0.015 |
| family_htn | 0.012 |
| age_x_male | 0.011 |
| male_x_waist_cm | 0.009 |
| resting_hr | 0.006 |
| activity_minutes_week | 0.005 |
| age_x_binge | 0.004 |
| male_x_fasting_glucose | 0.004 |
| male_x_activity_minutes_week | 0.003 |
| age_x_activity_minutes_week | 0.003 |
| male_x_family_htn | 0.003 |

## 6. 피처별 gain 비중 — dbp_lgbm 상위 25

| feature | value |
|---|---|
| sbp | 0.518 |
| age | 0.210 |
| sbp_x_male | 0.056 |
| sbp_x_binge | 0.038 |
| sbp_x_alcohol_week | 0.031 |
| sbp_x_age | 0.017 |
| sbp_x_family_htn | 0.017 |
| age_x_diabetes_flag | 0.016 |
| age_x_resting_hr | 0.012 |
| age_x_male | 0.011 |
| resting_hr | 0.010 |
| alcohol_week | 0.008 |
| sbp_x_resting_hr | 0.006 |
| age_x_fasting_glucose | 0.006 |
| sbp_x_bmi | 0.006 |
| male_x_bmi | 0.005 |
| male_x_waist_cm | 0.004 |
| sbp_x_activity_low_flag | 0.003 |
| bmi | 0.003 |
| fasting_glucose | 0.002 |
| age_x_alcohol_week | 0.002 |
| sbp_x_fasting_glucose | 0.002 |
| age_x_family_htn | 0.002 |
| male_x_resting_hr | 0.001 |
| age_x_waist_cm | 0.001 |

## 7. 테스트 파일 예측

- 11673행 중 예측 11413행, 제외 260행. 점 추정 단계 분포: {'linear': {'normal': 0.455, 'elevated': 0.319, 'prehtn': 0.199, '': 0.022, 'htn': 0.004}, 'lgbm': {'normal': 0.45, 'elevated': 0.269, 'prehtn': 0.257, '': 0.022, 'htn': 0.002}}
- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv

주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.


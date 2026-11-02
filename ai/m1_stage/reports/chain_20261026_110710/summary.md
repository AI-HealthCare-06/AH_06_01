# 체인 파이프라인 — chain_20261026_110710

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
| 편차 중심·힌지 | 중심 reference ({'bmi': 23.0, 'waist_cm': {'male': 90.0, 'female': 85.0}, 'fasting_glucose': 100.0, 'resting_hr': 100.0, 'activity_minutes_week': 150.0, 'alcohol_week': 14.0}), 힌지 False |

## 1. 점 추정 체인 (테스트 6854행)

| learner | target | rmse | mae | bias(pred-actual) | r2 |
|---|---|---|---|---|---|
| linear | sbp | 13.756 | 10.425 | 0.197 | 0.261 |
| linear | dbp(예측 sbp 투입) | 8.965 | 7.115 | 1.326 | 0.165 |
| linear | dbp(실제 sbp 투입) | 6.516 | 5.093 | 1.390 | 0.559 |
| linear | dbp(분포 평균) | 8.894 | 7.050 | 1.295 | 0.178 |
| lgbm | sbp | 13.725 | 10.347 | 0.432 | 0.264 |
| lgbm | dbp(예측 sbp 투입) | 8.962 | 7.108 | 1.593 | 0.166 |
| lgbm | dbp(실제 sbp 투입) | 6.114 | 4.807 | 1.173 | 0.612 |
| lgbm | dbp(분포 평균) | 8.842 | 6.994 | 1.242 | 0.188 |

### 단계(점 추정 → 경계)

| learner | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.441 | 0.804 | 0.349 | 0.597 | 0.475 | 0.316 | 0.009 | 0.413 | 0.358 | 0.226 | 0.003 |
| lgbm | 0.453 | 0.793 | 0.363 | 0.587 | 0.447 | 0.416 | 0.004 | 0.398 | 0.309 | 0.291 | 0.002 |

전부 normal 기준선 정확도 0.509


## 2. 분포 체인 (단계 확률)

| learner | AUROC ≥140/90 | AUROC ≥130/80 | AUPRC ≥140/90 | 보정 기울기 | 보정 절편 | ECE ≥140/90 | 정확도(규칙) | 인접 정확도 | 균형 정확도 | 재현 elevated | 재현 htn | P평균_normal | P평균_elevated | P평균_prehtn | P평균_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| linear | 0.722 | 0.721 | 0.252 | 0.908 | -0.170 | 0.019 | 0.501 | 0.710 | 0.341 | 0.000 | 0.217 | 0.477 | 0.118 | 0.254 | 0.151 |
| lgbm | 0.716 | 0.720 | 0.237 | 0.866 | -0.168 | 0.019 | 0.510 | 0.687 | 0.325 | 0.000 | 0.289 | 0.480 | 0.116 | 0.253 | 0.151 |

### 판정 규칙 비교

| learner | rule | tau | accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn |
|---|---|---|---|---|---|---|---|---|---|
| linear | argmax | - | 0.517 | 0.708 | 0.332 | 0.842 | 0.010 | 0.289 | 0.185 |
| linear | cumulative/accuracy | [0.76, 0.47, 0.3] | 0.501 | 0.710 | 0.341 | 0.766 | 0.000 | 0.381 | 0.217 |
| linear | cumulative/balanced | [0.48, 0.56, 0.25] | 0.426 | 0.780 | 0.378 | 0.559 | 0.455 | 0.128 | 0.371 |
| lgbm | argmax | - | 0.518 | 0.708 | 0.332 | 0.839 | 0.008 | 0.311 | 0.170 |
| lgbm | cumulative/accuracy | [0.81, 0.56, 0.27] | 0.510 | 0.687 | 0.325 | 0.862 | 0.000 | 0.151 | 0.289 |
| lgbm | cumulative/balanced | [0.5, 0.55, 0.25] | 0.438 | 0.766 | 0.381 | 0.586 | 0.443 | 0.130 | 0.362 |

## 3. 컬럼 영향력 (검증 분할 순열 중요도 ΔRMSE mmHg, 기준 컬럼 단위 — 파생·상호작용 열까지 함께 뒤섞음; Spearman 은 학습 행)

| column | dbp_lgbm | dbp_linear | sbp_lgbm | sbp_linear | spearman_sbp | spearman_dbp | 순위합 |
|---|---|---|---|---|---|---|---|
| age | 2.958 | 3.371 | 3.591 | 3.857 | 0.444 | -0.010 | 6.000 |
| bmi | 0.052 | 0.420 | 0.395 | 0.714 | 0.286 | 0.257 | 13.000 |
| male | 0.126 | 0.081 | 0.339 | 0.482 | 0.147 | 0.199 | 17.000 |
| resting_hr | 0.237 | 0.200 | 0.080 | 0.101 | -0.059 | 0.048 | 20.000 |
| fasting_glucose | 0.009 | 0.056 | 0.181 | 0.082 | 0.308 | 0.160 | 27.000 |
| family_htn | 0.006 | 0.015 | 0.124 | 0.104 | 0.037 | 0.119 | 29.000 |
| alcohol_week | 0.007 | 0.040 | 0.084 | 0.027 | -0.021 | 0.158 | 33.000 |
| waist_cm | -0.003 | 0.228 | 0.065 | 0.085 | 0.348 | 0.254 | 34.000 |
| binge | 0.004 | 0.062 | 0.029 | 0.033 | 0.016 | 0.159 | 35.000 |
| diabetes_flag | 0.117 | 0.154 | 0.004 | 0.018 | 0.185 | -0.027 | 35.000 |
| alcohol_15plus | 0.001 | 0.005 | 0.012 | 0.024 | 0.101 | 0.158 | 46.000 |
| activity_600plus | 0.003 | 0.011 | -0.000 | 0.015 | -0.005 | 0.026 | 51.000 |
| alcohol_per_day | 0.000 | 0.004 | 0.001 | 0.020 | 0.101 | 0.158 | 52.000 |
| activity_low_flag | -0.000 | 0.006 | -0.000 | 0.001 | 0.061 | -0.011 | 55.000 |
| activity_minutes_week | -0.001 | 0.003 | 0.007 | 0.000 | -0.060 | 0.018 | 57.000 |
| sbp | 6.341 | 6.542 | n/a | n/a | n/a | n/a | n/a |

## 4. 하위군 AUROC ≥140/90 (분포 체인)

| sex | age_group | lgbm | linear |
|---|---|---|---|
| female | 19-39 | 0.711 | 0.686 |
| female | 40-59 | 0.630 | 0.634 |
| female | 60+ | 0.591 | 0.615 |
| male | 19-39 | 0.786 | 0.784 |
| male | 40-59 | 0.632 | 0.645 |
| male | 60+ | 0.577 | 0.584 |

## 5. 혼동행렬

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn | path | learner |
|---|---|---|---|---|---|---|
| actual_normal | 2083 | 967 | 436 | 3 | 점 추정 | linear |
| actual_elevated | 244 | 462 | 263 | 3 | 점 추정 | linear |
| actual_prehtn | 382 | 630 | 470 | 5 | 점 추정 | linear |
| actual_htn | 124 | 397 | 377 | 8 | 점 추정 | linear |
| actual_normal | 2671 | 0 | 656 | 162 | 분포+규칙 | linear |
| actual_elevated | 522 | 0 | 315 | 135 | 분포+규칙 | linear |
| actual_prehtn | 704 | 0 | 567 | 216 | 분포+규칙 | linear |
| actual_htn | 327 | 1 | 381 | 197 | 분포+규칙 | linear |
| actual_normal | 2049 | 814 | 621 | 5 | 점 추정 | lgbm |
| actual_elevated | 230 | 434 | 307 | 1 | 점 추정 | lgbm |
| actual_prehtn | 342 | 524 | 618 | 3 | 점 추정 | lgbm |
| actual_htn | 104 | 349 | 449 | 4 | 점 추정 | lgbm |
| actual_normal | 3008 | 0 | 214 | 267 | 분포+규칙 | lgbm |
| actual_elevated | 692 | 0 | 83 | 197 | 분포+규칙 | lgbm |
| actual_prehtn | 951 | 0 | 224 | 312 | 분포+규칙 | lgbm |
| actual_htn | 518 | 0 | 126 | 262 | 분포+규칙 | lgbm |

## 6. 피처별 계수(표준화 단위당 mmHg) — sbp_linear 상위 25

| feature | value |
|---|---|
| age | 6.000 |
| age_x_resting_hr | -3.498 |
| age_x_male | -2.690 |
| bmi | 2.188 |
| family_htn | 2.045 |
| male | 1.947 |
| age_x_bmi | -1.313 |
| age_x_waist_cm | 1.053 |
| fasting_glucose | 1.050 |
| binge | 0.974 |
| alcohol_per_day | 0.914 |
| alcohol_15plus | 0.914 |
| alcohol_week | 0.648 |
| activity_600plus | 0.591 |
| diabetes_flag | 0.590 |
| male_x_bmi | 0.584 |
| male_x_waist_cm | -0.561 |
| male_x_diabetes_flag | -0.500 |
| age_x_alcohol_week | -0.496 |
| activity_low_flag | 0.464 |
| male_x_resting_hr | 0.299 |
| age_x_binge | -0.258 |
| age_x_activity_minutes_week | -0.256 |
| male_x_activity_600plus | 0.256 |
| waist_cm | 0.198 |

## 6. 피처별 계수(표준화 단위당 mmHg) — dbp_linear 상위 25

| feature | value |
|---|---|
| sbp | 7.754 |
| sbp_x_age | -2.706 |
| age_x_resting_hr | 2.066 |
| age | -1.709 |
| age_x_bmi | 1.560 |
| age_x_waist_cm | -1.465 |
| diabetes_flag | -1.018 |
| binge | 0.847 |
| age_x_diabetes_flag | -0.806 |
| resting_hr | 0.803 |
| male | 0.681 |
| family_htn | 0.618 |
| age_x_alcohol_week | 0.597 |
| male_x_bmi | 0.568 |
| age_x_binge | 0.567 |
| sbp_x_alcohol_week | -0.526 |
| sbp_x_waist_cm | 0.487 |
| age_x_fasting_glucose | -0.451 |
| alcohol_15plus | -0.430 |
| alcohol_per_day | -0.430 |
| sbp_x_activity_low_flag | 0.422 |
| alcohol_week | 0.400 |
| sbp_x_bmi | -0.391 |
| bmi | 0.319 |
| age_x_activity_low_flag | -0.316 |

## 6. 피처별 gain 비중 — sbp_lgbm 상위 25

| feature | value |
|---|---|
| age | 0.233 |
| age_x_resting_hr | 0.203 |
| age_x_alcohol_week | 0.188 |
| bmi | 0.077 |
| male_x_bmi | 0.067 |
| fasting_glucose | 0.041 |
| age_x_fasting_glucose | 0.023 |
| age_x_waist_cm | 0.019 |
| male_x_alcohol_week | 0.018 |
| waist_cm | 0.017 |
| family_htn | 0.013 |
| age_x_bmi | 0.012 |
| male | 0.012 |
| age_x_male | 0.010 |
| male_x_waist_cm | 0.010 |
| alcohol_week | 0.009 |
| age_x_family_htn | 0.007 |
| resting_hr | 0.006 |
| male_x_fasting_glucose | 0.005 |
| activity_minutes_week | 0.004 |
| male_x_binge | 0.004 |
| male_x_family_htn | 0.003 |
| age_x_activity_minutes_week | 0.003 |
| age_x_binge | 0.003 |
| age_x_alcohol_15plus | 0.003 |

## 6. 피처별 gain 비중 — dbp_lgbm 상위 25

| feature | value |
|---|---|
| sbp | 0.481 |
| age | 0.146 |
| sbp_x_resting_hr | 0.120 |
| age_x_resting_hr | 0.083 |
| sbp_x_alcohol_week | 0.020 |
| sbp_x_age | 0.019 |
| age_x_diabetes_flag | 0.015 |
| sbp_x_binge | 0.014 |
| sbp_x_male | 0.013 |
| male_x_bmi | 0.010 |
| resting_hr | 0.009 |
| age_x_male | 0.009 |
| age_x_alcohol_week | 0.007 |
| sbp_x_bmi | 0.007 |
| sbp_x_family_htn | 0.005 |
| age_x_fasting_glucose | 0.005 |
| sbp_x_waist_cm | 0.004 |
| waist_cm | 0.003 |
| fasting_glucose | 0.003 |
| bmi | 0.003 |
| sbp_x_activity_low_flag | 0.002 |
| age_x_waist_cm | 0.002 |
| age_x_activity_minutes_week | 0.002 |
| male_x_resting_hr | 0.002 |
| sbp_x_fasting_glucose | 0.002 |

## 7. 테스트 파일 예측

- 11673행 중 예측 11413행, 제외 260행. 점 추정 단계 분포: {'linear': {'normal': 0.456, 'elevated': 0.319, 'prehtn': 0.2, '': 0.022, 'htn': 0.004}, 'lgbm': {'normal': 0.445, 'elevated': 0.27, 'prehtn': 0.262, '': 0.022, 'htn': 0.001}}
- 파일: test_predictions.xlsx(시트 pred_<learner>), test_predictions_<learner>.csv

주의: 상관·계수·중요도는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다. 단건 추론 경로는 아직 없다.


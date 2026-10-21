# 이유 코드 2·3단계 점검 — reason_audit_20261020_142905

- 모델 artifacts/20261020_141943, 내부 테스트 분할 6724행, 규칙 youden

## 2단계 — 관측값 규칙

| code | source | imputed_rows | imputed_share | code_on_imputed(should be 0) | suppressed_by_rule | fires_now | would_fire_without_rule |
|---|---|---|---|---|---|---|---|
| bmi_high | bmi | 0 | 0.000 | 0 | 0 | 4015 | 4015 |
| waist_high | waist_cm | 114 | 0.017 | 0 | 40 | 2407 | 2447 |
| age | age | 0 | 0.000 | 0 | 0 | 4561 | 4561 |
| alcohol_high | alcohol_week | 32 | 0.005 | 0 | 0 | 1992 | 1992 |
| activity_low | activity_minutes_week | 446 | 0.066 | 0 | 446 | 2185 | 2631 |
| sleep_short | sleep_short_flag | 278 | 0.041 | 0 | 0 | 837 | 837 |
| family_htn | family_htn | 433 | 0.064 | 0 | 0 | 2820 | 2820 |
| diabetes | diabetes_flag | 0 | 0.000 | 0 | 0 | 1023 | 1023 |

`code_on_imputed` 가 0 이면 규칙이 지켜진 것. `suppressed_by_rule` 은 대치값이 조건을 만족해 규칙 때문에 붙지 않은 코드 수(= 규칙의 효과).

## 3단계 — 모델 간 정렬 일치율 (집합은 조건 기반이라 같아야 하고, 순서는 기여도라 다를 수 있음)

| pair | same_set | same_first | same_order |
|---|---|---|---|
| lgbm__base vs nested__base | 1.000 | 0.792 | 0.496 |
| lgbm__base vs ordinal__base | 1.000 | 0.793 | 0.498 |
| nested__base vs ordinal__base | 1.000 | 0.988 | 0.975 |

## 3단계 — 기여도 ≤0 인 채 붙은 코드 (조건 기반이라 모델이 쓰지 않은 요인도 붙는다)

| model | code | fires | contrib_le_0_when_fires | share_le_0 | median_contrib_when_fires | rank1_share |
|---|---|---|---|---|---|---|
| lgbm__base | bmi_high | 4015 | 1828 | 0.455 | 0.133 | 0.115 |
| lgbm__base | waist_high | 2407 | 0 | 0.000 | 0.722 | 0.062 |
| lgbm__base | age | 4561 | 191 | 0.042 | 1.256 | 0.531 |
| lgbm__base | alcohol_high | 1992 | 228 | 0.114 | 0.637 | 0.148 |
| lgbm__base | activity_low | 2185 | 255 | 0.117 | 0.022 | 0.027 |
| lgbm__base | sleep_short | 837 | 0 | 0.000 | 0.010 | 0.007 |
| lgbm__base | family_htn | 2820 | 0 | 0.000 | 0.636 | 0.110 |
| lgbm__base | diabetes | 1023 | 1023 | 1.000 | 0.000 | 0.000 |
| nested__base | bmi_high | 4015 | 712 | 0.177 | 0.508 | 0.178 |
| nested__base | waist_high | 2407 | 0 | 0.000 | 0.071 | 0.001 |
| nested__base | age | 4561 | 766 | 0.168 | 1.158 | 0.415 |
| nested__base | alcohol_high | 1992 | 0 | 0.000 | 0.767 | 0.159 |
| nested__base | activity_low | 2185 | 2185 | 1.000 | 0.000 | 0.023 |
| nested__base | sleep_short | 837 | 0 | 0.000 | 0.025 | 0.007 |
| nested__base | family_htn | 2820 | 0 | 0.000 | 1.082 | 0.216 |
| nested__base | diabetes | 1023 | 1023 | 1.000 | 0.000 | 0.000 |
| ordinal__base | bmi_high | 4015 | 712 | 0.177 | 0.175 | 0.183 |
| ordinal__base | waist_high | 2407 | 0 | 0.000 | 0.018 | 0.001 |
| ordinal__base | age | 4561 | 766 | 0.168 | 0.374 | 0.417 |
| ordinal__base | alcohol_high | 1992 | 0 | 0.000 | 0.252 | 0.157 |
| ordinal__base | activity_low | 2185 | 2185 | 1.000 | 0.000 | 0.023 |
| ordinal__base | sleep_short | 837 | 0 | 0.000 | 0.004 | 0.007 |
| ordinal__base | family_htn | 2820 | 0 | 0.000 | 0.354 | 0.212 |
| ordinal__base | diabetes | 1023 | 1023 | 1.000 | 0.000 | 0.000 |

## 3단계 — 개수 상한 3개를 두면 잘리는 코드 (기여도 순 하위)

| model | mean_codes | rows_over_cap | share_over_cap | dropped_bmi_high | dropped_waist_high | dropped_age | dropped_alcohol_high | dropped_activity_low | dropped_sleep_short | dropped_family_htn | dropped_diabetes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| lgbm__base | 2.951 | 2443 | 0.363 | 1242 | 23 | 306 | 230 | 828 | 404 | 272 | 675 |
| nested__base | 2.951 | 2443 | 0.363 | 358 | 965 | 542 | 30 | 989 | 363 | 3 | 730 |
| ordinal__base | 2.951 | 2443 | 0.363 | 349 | 962 | 542 | 32 | 989 | 375 | 1 | 730 |

## 단건 경로(predict) vs 배치 경로(predict_frame) 이유 코드 일치

| model | rows_checked | mismatch |
|---|---|---|
| lgbm__base | 1500 | 0 |
| nested__base | 1500 | 0 |
| ordinal__base | 1500 | 0 |

## 알려진 불일치

- 피처 alcohol_per_day 는 명세 2-3 정의(하루 2.0잔 초과)로 산출되고, 이유 코드 alcohol_high 는 데이터 경계({'male': 1.25, 'female': 1.75})를 쓴다. 둘은 역할이 다르지만 같은 변수에 두 경계가 있다.

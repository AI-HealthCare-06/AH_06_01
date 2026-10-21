# 이유 코드 규칙 비교 — reason_rules_20261020_142048

- 모델 artifacts/20261020_141943/nested__base, 내부 테스트 분할 6724행 (time_order), ≥130/80 비율 0.346

- 규칙별 경계: youden: age {'male': 39, 'female': 50}, 음주 잔/일 {'male': 1.25, 'female': 1.75}; rr125: age {'male': None, 'female': 41}, 음주 잔/일 {'male': 2.25, 'female': None}

## 코드 빈도 (행 비율)

| rule | age | alcohol_high | bmi_high | waist_high | activity_low | sleep_short | family_htn | diabetes |
|---|---|---|---|---|---|---|---|---|
| youden | 0.678 | 0.296 | 0.597 | 0.358 | 0.325 | 0.124 | 0.419 | 0.152 |
| rr125 | 0.422 | 0.285 | 0.597 | 0.358 | 0.325 | 0.124 | 0.419 | 0.152 |

## 행당 코드 수

| rule | mean_codes | n0 | n1 | n2 | n3 | n4 | n5 | n6 | n7 |
|---|---|---|---|---|---|---|---|---|---|
| youden | 2.95 | 298 | 981 | 1456 | 1546 | 1297 | 812 | 282 | 47 |
| rr125 | 2.68 | 391 | 1123 | 1618 | 1631 | 1219 | 569 | 147 | 26 |

## age·alcohol 코드 유무별 실제 ≥130/80 비율 (테스트 분할)

| rule | code | sex | fires | ge130_if_fires | ge130_if_not | rr | htn_if_fires | htn_if_not |
|---|---|---|---|---|---|---|---|---|
| youden | age | all | 0.678 | 0.439 | 0.150 | 2.918 | 0.174 | 0.040 |
| youden | age | male | 0.777 | 0.482 | 0.229 | 2.106 | 0.185 | 0.058 |
| youden | age | female | 0.602 | 0.395 | 0.116 | 3.402 | 0.163 | 0.032 |
| youden | alcohol_high | all | 0.296 | 0.396 | 0.325 | 1.218 | 0.150 | 0.123 |
| youden | alcohol_high | male | 0.453 | 0.481 | 0.380 | 1.265 | 0.186 | 0.133 |
| youden | alcohol_high | female | 0.174 | 0.224 | 0.296 | 0.755 | 0.077 | 0.118 |
| rr125 | age | all | 0.422 | 0.354 | 0.340 | 1.043 | 0.143 | 0.122 |
| rr125 | age | male | 0.000 | n/a | 0.426 | n/a | n/a | 0.157 |
| rr125 | age | female | 0.748 | 0.354 | 0.075 | 4.754 | 0.143 | 0.016 |
| rr125 | alcohol_high | all | 0.285 | 0.395 | 0.326 | 1.212 | 0.150 | 0.124 |
| rr125 | alcohol_high | male | 0.429 | 0.485 | 0.382 | 1.270 | 0.188 | 0.134 |
| rr125 | alcohol_high | female | 0.173 | 0.224 | 0.296 | 0.756 | 0.076 | 0.118 |

# 규칙 기반 가감점 실험 — rule_adjust_20261021_134709

- 모델 ordinal__base (run 20261020_150607), 분할 train/val/test = 31379/6724/6724, 플래그 ('alcohol_per_day', 'binge', 'activity_low_flag', 'sleep_short_flag', 'family_htn', 'diabetes_flag')
- 규칙: η' = (η − c_age − c_bmi) + (w_age·c_age + w_bmi·c_bmi)·(1 − d·정상도), 정상도 = 전부 정상(binary) 또는 정상 플래그 비율(graded)

## 기준 vs 검증 최적 설정의 테스트 성적

| 설정 | variant | w_age | w_bmi | d | val_acc_argmax | val_acc_cum | test_auroc_140 | test_auroc_130 | test_acc_argmax | test_acc_cum | test_adjacent_argmax | recall_normal_argmax | recall_elevated_argmax | recall_prehtn_argmax | recall_htn_argmax |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 기준(모델 그대로) | binary | 1.000 | 1.000 | 0.000 | 0.497 | 0.503 | 0.723 | 0.721 | 0.518 | 0.518 | 0.718 | 0.853 | 0.000 | 0.284 | 0.157 |
| 검증 argmax 최적 | graded | 1.000 | 1.500 | 0.500 | 0.500 | 0.505 | 0.710 | 0.718 | 0.517 | 0.520 | 0.703 | 0.904 | 0.000 | 0.194 | 0.091 |
| 검증 cumulative 최적 | graded | 1.000 | 2.000 | 0.500 | 0.499 | 0.509 | 0.703 | 0.712 | 0.515 | 0.518 | 0.703 | 0.887 | 0.000 | 0.206 | 0.124 |

## 검증 정확도(argmax) 상위 10 설정

| variant | w_age | w_bmi | d | val_acc_argmax | val_acc_cum |
|---|---|---|---|---|---|
| graded | 1.500 | 2.000 | 0.750 | 0.500 | 0.506 |
| graded | 1.000 | 1.500 | 0.500 | 0.500 | 0.505 |
| graded | 1.250 | 1.500 | 0.500 | 0.500 | 0.506 |
| graded | 1.250 | 2.000 | 0.750 | 0.500 | 0.509 |
| graded | 1.000 | 2.000 | 0.750 | 0.500 | 0.507 |
| graded | 1.000 | 2.000 | 0.250 | 0.499 | 0.505 |
| graded | 1.000 | 1.250 | 0.500 | 0.499 | 0.507 |
| graded | 1.000 | 1.500 | 0.250 | 0.499 | 0.506 |
| graded | 1.000 | 1.250 | 0.250 | 0.499 | 0.505 |
| graded | 1.250 | 2.000 | 0.500 | 0.499 | 0.506 |

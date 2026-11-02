# 최종 모델 M1-F — final_20261026_164706

- 구성: ChainPreprocessor(입력 15열, 필수 ['age', 'sex', 'bmi', 'waist_cm'], 대치 ≥5 제외, 범위 {'bmi': (14.0, 50.0), 'waist_cm': (50.0, 150.0), 'fasting_glucose': (50.0, 300.0), 'resting_hr': (40.0, 150.0)}) → ChainFeatures(문헌 기준값 중심, 추가 데이터) 42열 → LightGBM multiclass → argmax
- 데이터 46691행 → 사용 45689행. 최종 모델: 학습 38836 / 내부 검증 6853행, 트리 126, 내부 검증 정확도 0.5180
- 단건 추론 지연(예시 입력, 200회): 기여 요인 포함 p50 2.6 / p95 3.1 ms, 제외 p50 0.1 / p95 0.2 ms. 단건 경로 = 배치 경로 검증: 테스트 분할 6854행 불일치 0, 최대 확률 차 0.0e+00

## 1. 시간 분할 평가 (학습 31982 / 검증 6853 / 테스트 6854행, time_order)

| accuracy | adjacent_accuracy | balanced_accuracy | recall_normal | recall_elevated | recall_prehtn | recall_htn | pred_share_normal | pred_share_elevated | pred_share_prehtn | pred_share_htn | auroc_140_90 | auroc_130_80 | ece_140_90 | expected_max_acc | baseline_all_normal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5127 | 0.7063 | 0.3362 | 0.8209 | 0.0031 | 0.3013 | 0.2196 | 0.6833 | 0.0025 | 0.2050 | 0.1093 | 0.7157 | 0.7169 | 0.0417 | 0.4953 | 0.5090 |

### 혼동행렬 (행=실제, 열=예측)

| actual | pred_normal | pred_elevated | pred_prehtn | pred_htn |
|---|---|---|---|---|
| actual_normal | 2864 | 2 | 432 | 191 |
| actual_elevated | 584 | 3 | 237 | 148 |
| actual_prehtn | 823 | 5 | 448 | 211 |
| actual_htn | 412 | 7 | 288 | 199 |

### 성별×연령대

| sex | age_group | n | accuracy | baseline_all_normal | auroc_140_90 |
|---|---|---|---|---|---|
| female | 19-39 | 891 | 0.9012 | 0.9024 | 0.7485 |
| female | 40-59 | 1342 | 0.6595 | 0.6647 | 0.6294 |
| female | 60+ | 1570 | 0.3471 | 0.3535 | 0.5773 |
| male | 19-39 | 751 | 0.5206 | 0.5286 | 0.7976 |
| male | 40-59 | 1051 | 0.4377 | 0.4044 | 0.6766 |
| male | 60+ | 1249 | 0.3443 | 0.3331 | 0.5616 |

참고: 5겹 교차검증(reports/boost_20261026_111530) 정확도 0.518 ± 0.006, AUROC≥140/90 0.731 ± 0.007; 71개 학습기·설정 탐색(reports/maxsearch_20261026_125451) 최고 0.520 (잡음 범위).

## 2. 예시 입력 → 출력

```json
{
  "input": {
    "age": 52,
    "sex": "male",
    "bmi": 27.5,
    "waist_cm": 95,
    "alcohol_week": 21,
    "alcohol_per_day": 1,
    "binge": 1,
    "activity_minutes_week": 60,
    "activity_low_flag": 1,
    "family_htn": 1,
    "diabetes_flag": 0,
    "fasting_glucose": 104,
    "resting_hr": 72
  },
  "output": {
    "stage": "prehtn",
    "stage_probs": {
      "normal": 0.1606,
      "elevated": 0.054,
      "prehtn": 0.3959,
      "htn": 0.3896
    },
    "top_factors": "bmi(+0.16), alcohol_week(+0.10), resting_hr(+0.09)",
    "note": "",
    "model_version": "M1-F-20261026_164706"
  }
}
```

## 3. 테스트 파일

- 11673행 중 예측 11413행, 제외 {'예측 불가: imputed_ge_5': 98, '예측 불가: bmi_missing': 79, '예측 불가: waist_cm_missing': 58, '예측 불가: fasting_glucose_out_of_range': 18, '예측 불가: resting_hr_out_of_range': 6, '예측 불가: bmi_out_of_range': 1}
- 예측 단계 비율 {'normal': 0.726, 'prehtn': 0.178, 'htn': 0.094, 'elevated': 0.002}
- 파일: test_predictions.xlsx (시트 pred: 확률·기여 요인 포함 / stage_only: person_id + stage)

주의: 복약 컬럼이 없어 라벨은 비복약 가정. 혈압은 입력에 쓰지 않음. 모델 출력은 참고용이며 진단이 아님.


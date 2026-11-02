# 성별 최고 후보 테스트 파일 예측 — sexbest_20261029_223900

- 남성: CatBoost 역체인(점추정 단계; stage3_alt = 분포 argmax). 여성: LightGBM 역체인 + 분류기 스택(argmax; stage3_alt = 체인 점추정).
- 학습 분할: 무작위 층화 70/15/15(seed 42), train_sex_chain.py 와 동일. 3단계: sbp <122 / 122~139 / ≥140.
- 테스트 파일 11673행 중 11413행 예측, 단계 비율 {'normal': 0.678, 'elevated_prehtn': 0.307, 'htn': 0.015}

## 내부 테스트 15% 지표

| sex | model | n_train | n_test | baseline_all_normal | accuracy | accuracy_alt | auroc_ge140 | recall_htn | sbp_rmse | dbp_rmse |
|---|---|---|---|---|---|---|---|---|---|---|
| male | catboost_reverse_chain(점추정) | 14046 | 3011 | 0.547 | 0.573 | 0.563 | 0.714 | 0.000 | 14.061 | 9.207 |
| female | lgbm_reverse_chain+stack_classifier(argmax) | 17935 | 3844 | 0.648 | 0.672 | 0.663 | 0.778 | 0.067 | 14.325 | 8.853 |

## 기존 lgbm 역체인 예측과의 일치율 (같은 행)

| sex | n | 일치율_vs_lgbm점추정 | 일치율_vs_lgbm분포 |
|---|---|---|---|
| female | 6510.000 | 0.860 | 0.863 |
| male | 4903.000 | 0.936 | 0.778 |

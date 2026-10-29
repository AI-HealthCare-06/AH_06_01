# 성별 분리 역체인(dbp→sbp) 3단계 — sexchain_dbp_rule_20261029_232918

- 모델 저장: artifacts/sexchain_dbp_rule_20261029_232918 (model.pkl: 성별 lgbm 역체인 + 전처리 + 추가 데이터, meta.json). 추론: python3 predict_sex_chain.py --model artifacts/sexchain_dbp_rule_20261029_232918 --data <파일>
- 3단계 라벨: sbp (122.0, 140.0) 또는 dbp (80.0, 90.0) (normal / elevated_prehtn / htn). 분포 {'normal': 23804, 'elevated_prehtn': 14842, 'htn': 7043}. point_acc_alt_rule·stage3_point_alt_rule 은 반대 규칙(비교용)
- 역체인: 전 열 → dbp, 전 열 + dbp(학습 실제·추론 예측) → sbp. 분포 경로 = 검증 잔차 부트스트랩. 여성 모델은 음주 4열 제외, 남성은 포함. 분할 = 무작위 층화 70/15/15(시간 순 아님)
- 과학습 점검: train 행과 test 행의 지표 차이(train 이 크게 좋으면 과학습). 조기 종료는 검증 15%

## 1. 성별 모델 결과 (train / test)

| model | sex | split | n | baseline_all_normal | dbp_rmse | dbp_r2 | sbp_rmse | sbp_r2 | sbp_rmse_actual_dbp | point_acc | point_acc_alt_rule | dist_accuracy | dist_auroc_ge140 | dist_auroc_ge122 | dist_recall_normal | dist_recall_elevated_prehtn | dist_recall_htn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| male_linear | male | train | 14046 | 0.435 | 9.409 | 0.176 | 13.803 | 0.152 | 10.739 | 0.501 | 0.561 | 0.492 | 0.675 | 0.680 | 0.664 | 0.495 | 0.063 |
| male_linear | male | test | 3011 | 0.435 | 9.212 | 0.194 | 13.873 | 0.154 | 10.922 | 0.492 | 0.563 | 0.495 | 0.681 | 0.671 | 0.669 | 0.496 | 0.064 |
| male_lgbm | male | train | 14046 | 0.435 | 8.796 | 0.280 | 13.498 | 0.189 | 9.532 | 0.511 | 0.580 | 0.509 | 0.705 | 0.704 | 0.721 | 0.482 | 0.048 |
| male_lgbm | male | test | 3011 | 0.435 | 8.876 | 0.252 | 13.776 | 0.166 | 10.305 | 0.493 | 0.575 | 0.494 | 0.689 | 0.676 | 0.696 | 0.466 | 0.056 |
| male_direct_mc | male | train | 14046 | 0.435 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.563 | 0.774 | 0.747 | 0.697 | 0.647 | 0.052 |
| male_direct_mc | male | test | 3011 | 0.435 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.500 | 0.699 | 0.688 | 0.638 | 0.560 | 0.024 |
| female_linear | female | train | 17935 | 0.588 | 9.044 | 0.104 | 14.451 | 0.326 | 10.789 | 0.614 | 0.661 | 0.607 | 0.748 | 0.770 | 0.852 | 0.342 | 0.083 |
| female_linear | female | test | 3844 | 0.588 | 9.125 | 0.101 | 14.485 | 0.322 | 10.794 | 0.615 | 0.660 | 0.621 | 0.751 | 0.772 | 0.859 | 0.378 | 0.088 |
| female_lgbm | female | train | 17935 | 0.588 | 8.612 | 0.187 | 14.068 | 0.361 | 9.757 | 0.620 | 0.667 | 0.617 | 0.765 | 0.783 | 0.864 | 0.365 | 0.062 |
| female_lgbm | female | test | 3844 | 0.588 | 8.916 | 0.141 | 14.357 | 0.334 | 10.085 | 0.617 | 0.663 | 0.629 | 0.753 | 0.776 | 0.864 | 0.410 | 0.055 |
| female_direct_mc | female | train | 17935 | 0.588 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.662 | 0.823 | 0.814 | 0.882 | 0.468 | 0.106 |
| female_direct_mc | female | test | 3844 | 0.588 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.621 | 0.762 | 0.778 | 0.855 | 0.407 | 0.048 |
| pooled_linear | male | test | 3011 | 0.435 | 9.223 | n/a | 13.916 | 0.149 | n/a | 0.493 | n/a | 0.493 | 0.681 | 0.672 | 0.672 | 0.484 | 0.070 |
| pooled_linear | female | test | 3844 | 0.588 | 9.078 | n/a | 14.442 | 0.326 | n/a | 0.619 | n/a | 0.620 | 0.750 | 0.775 | 0.851 | 0.392 | 0.090 |
| pooled_lgbm | male | test | 3011 | 0.435 | 8.874 | n/a | 13.796 | 0.164 | n/a | 0.494 | n/a | 0.498 | 0.687 | 0.675 | 0.694 | 0.482 | 0.051 |
| pooled_lgbm | female | test | 3844 | 0.588 | 8.851 | n/a | 14.271 | 0.342 | n/a | 0.620 | n/a | 0.627 | 0.756 | 0.780 | 0.867 | 0.395 | 0.065 |

## 2. 5겹 교차검증 (분포 경로 정확도·AUROC, 점 추정 정확도)

| model | point_acc_mean | point_acc_std | dist_acc_mean | dist_acc_std | auroc_ge140_mean | auroc_ge140_std | sbp_rmse_mean | sbp_rmse_std |
|---|---|---|---|---|---|---|---|---|
| female_direct_mc | n/a | n/a | 0.6174 | 0.0081 | 0.7573 | 0.0126 | n/a | n/a |
| female_lgbm | 0.6169 | 0.0049 | 0.6083 | 0.0044 | 0.7460 | 0.0096 | 14.3447 | 0.2668 |
| female_linear | 0.6163 | 0.0068 | 0.6047 | 0.0041 | 0.7416 | 0.0104 | 14.4595 | 0.2772 |
| male_direct_mc | n/a | n/a | 0.4978 | 0.0061 | 0.6830 | 0.0074 | n/a | n/a |
| male_lgbm | 0.5003 | 0.0039 | 0.4898 | 0.0061 | 0.6568 | 0.0038 | 13.8537 | 0.1210 |
| male_linear | 0.5009 | 0.0057 | 0.4833 | 0.0049 | 0.6575 | 0.0053 | 13.8717 | 0.1072 |

## 3. 테스트 파일

- 11673행 중 11413행 예측, 점 추정 단계 비율 {'normal': 0.533, 'elevated_prehtn': 0.464, 'htn': 0.003}
- 열: sbp_pred, dbp_pred, stage3_point(라벨 규칙), stage3_dist(분포 argmax, 라벨 규칙), stage3_point_alt_rule(반대 규칙), note

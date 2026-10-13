# B1 (단조 LightGBM) vs B0 (부호 제약 로지스틱) — 채택 판단

버전 2026.10.13-b1 · 분할 time · 생성 2026-10-13

채택 규칙(인수인계 5장): 검증 AUROC Δ ≥ +0.02 이고 보정(테스트 기울기 0.9~1.1, 검증 ECE 악화 ≤ 0.01)이 나쁘지 않을 때만 B1 채택.

**결정: B0 유지 — B1 은 artifacts/candidates/ 에 보관 (full ΔAUROC val +0.003, 규칙 미달)**

| 모델 | 지표 | B0 검증 | B1 검증 | Δ | B0 테스트 | B1 테스트 | Δ |
|---|---|---|---|---|---|---|---|
| htn_risk_full | AUROC | 0.837 | 0.840 | +0.003 | 0.844 | 0.846 | +0.002 |
| htn_risk_full | AUPRC | 0.686 | 0.695 | +0.009 | 0.715 | 0.723 | +0.008 |
| htn_risk_full | Brier | 0.154 | 0.152 | -0.002 | 0.152 | 0.150 | -0.001 |
| htn_risk_full | ECE | 0.015 | 0.005 | -0.011 | 0.011 | 0.009 | -0.002 |
| htn_risk_full | 보정 기울기 | 1.000 | 1.000 | -0.000 | 1.050 | 1.050 | -0.000 |
| htn_risk_lite | AUROC | 0.817 | 0.821 | +0.004 | 0.824 | 0.827 | +0.004 |
| htn_risk_lite | AUPRC | 0.642 | 0.649 | +0.007 | 0.677 | 0.688 | +0.011 |
| htn_risk_lite | Brier | 0.162 | 0.160 | -0.002 | 0.161 | 0.159 | -0.002 |
| htn_risk_lite | ECE | 0.022 | 0.010 | -0.012 | 0.013 | 0.009 | -0.004 |
| htn_risk_lite | 보정 기울기 | 1.000 | 1.000 | -0.000 | 1.050 | 1.046 | -0.004 |

## B1 설정

- htn_risk_full: {'learning_rate': 0.03, 'num_leaves': 15, 'min_child_samples': 200}, trees 279/300, depth ≤4, 성별 ECE 차 0.001, 전환식 라벨 AUROC 0.840, gates {'auroc>=0.80': True, 'slope 0.9~1.1': True}
- htn_risk_lite: {'learning_rate': 0.03, 'num_leaves': 7, 'min_child_samples': 200}, trees 296/300, depth ≤4, 성별 ECE 차 0.003, 전환식 라벨 AUROC 0.822, gates {'auroc>=0.80': True, 'slope 0.9~1.1': True}

단조성 probe 위반 0건, BMI 22→30 Δrisk_index {'male/25': 1, 'male/40': 4, 'male/60': 17, 'female/25': 0, 'female/40': 1, 'female/60': 15}

## 피처 중요도 (full, gain 비중 / 테스트 세트 mean|SHAP| logit)

| 피처 | gain | mean\|SHAP\| | 단조 |
|---|---|---|---|
| age | 63.3% | 1.269 | +1 |
| waist_cm | 12.9% | 0.317 | +1 |
| bmi | 6.8% | 0.261 | +1 |
| family_htn | 6.3% | 0.382 | +0 |
| diabetes_flag | 4.0% | 0.138 | +0 |
| alcohol_units_week | 3.4% | 0.184 | +1 |
| sex_female | 1.7% | 0.088 | +0 |
| missing_count | 0.5% | 0.040 | +0 |
| sleep_avg_h | 0.5% | 0.023 | +0 |
| activity_minutes_week | 0.3% | 0.023 | -1 |
| stress_score | 0.2% | 0.013 | +0 |
| smoking_former | 0.1% | 0.005 | +0 |
| activity_low_flag | 0.0% | 0.001 | +1 |
| smoking_current | 0.0% | 0.000 | +1 |
| sodium_risk_score | 0.0% | 0.000 | +1 |

## 해석

- 단조 제약 덕에 sodium/activity/smoking 은 B0 처럼 '반대 방향'이 아니라 0 또는 근거표 방향으로만 기여한다. mean|SHAP| 가 0 에 가까우면 B1 도 그 피처에서 독립 신호를 찾지 못한 것이다.
- 검증 세트는 조기 종료·그리드 선택·보정에 모두 쓰여 검증 Δ 는 낙관적일 수 있다. 테스트(2021~22) Δ 가 더 공정하다.
- 60+ 하위군 AUROC 는 두 모델 모두 낮다(나이가 판별력의 대부분). 연령대 안 판별은 B1 로도 크게 좋아지지 않으면 피처 한계로 본다.

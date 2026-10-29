# 정답률 탐색 — boost_20261026_111530

- 사용 45689행, 시간 분할 train 31982 / val 6853 / test 6854; 전부 normal 기준선(test) 0.5090
- 규칙: argmax / cumulative_tau(검증 τ) / weighted_argmax(검증에서 클래스 가중 최적화) / weighted_by_age(나이대별 가중). best_rule_acc = 네 규칙 중 최고
- 시간 분할 최고: mc_mid_recency / weighted_argmax = 0.5177

## 1. 시간 분할

| candidate | argmax | cumulative_tau | weighted_argmax | weighted_by_age | AUROC_140_90 | AUROC_130_80 | best_rule_acc |
|---|---|---|---|---|---|---|---|
| mc_mid_recency | 0.5096 | 0.5083 | 0.5177 | 0.5128 | 0.7158 | 0.7169 | 0.5177 |
| ensemble | 0.5177 | 0.5064 | 0.5165 | 0.4987 | 0.7201 | 0.7208 | 0.5177 |
| mc_mid | 0.5128 | 0.5092 | 0.5174 | 0.5130 | 0.7157 | 0.7169 | 0.5174 |
| mc_small | 0.5115 | 0.5117 | 0.5159 | 0.5146 | 0.7161 | 0.7188 | 0.5159 |
| ensemble_mc | 0.5117 | 0.5088 | 0.5121 | 0.5142 | 0.7161 | 0.7176 | 0.5142 |
| chain_linear | 0.5124 | 0.5012 | 0.5117 | 0.5026 | 0.7123 | 0.7146 | 0.5124 |
| mc_mid+year | 0.5089 | 0.5058 | 0.5101 | 0.5123 | 0.7161 | 0.7172 | 0.5123 |
| chain_lgbm | 0.5118 | 0.5102 | 0.5121 | 0.5090 | 0.7073 | 0.7141 | 0.5121 |
| ordreg | 0.4179 | 0.5121 | 0.4734 | 0.4733 | 0.7140 | 0.7174 | 0.5121 |
| mc_big | 0.5073 | 0.5114 | 0.5112 | 0.5069 | 0.7146 | 0.7167 | 0.5114 |

가중·τ:

| candidate | weights | tau |
|---|---|---|
| mc_mid_recency | [1.0, 0.5, 0.9, 0.8] | [0.78, 0.57, 0.29] |
| ensemble | [1.0, 1.0, 0.9, 1.1] | [0.74, 0.53, 0.27] |
| mc_mid | [1.0, 0.7, 1.0, 0.8] | [0.75, 0.56, 0.29] |
| mc_small | [1.0, 0.8, 1.0, 0.9] | [0.75, 0.56, 0.31] |
| ensemble_mc | [1.0, 1.0, 0.9, 1.0] | [0.75, 0.58, 0.29] |
| chain_linear | [1.0, 1.0, 1.0, 0.9] | [0.76, 0.5, 0.31] |
| mc_mid+year | [1.0, 0.7, 1.0, 0.9] | [0.74, 0.55, 0.29] |
| chain_lgbm | [1.0, 0.9, 1.0, 1.0] | [0.83, 0.56, 0.32] |
| ordreg | [1.0, 0.5, 1.4, 1.4] | [0.94, 0.46, 0.33] |
| mc_big | [1.0, 1.0, 1.0, 0.9] | [0.78, 0.58, 0.32] |

## 2. 5겹 교차검증 (상위 후보 + 기준)

| candidate | argmax_mean | argmax_std | cumulative_tau_mean | cumulative_tau_std | weighted_argmax_mean | weighted_argmax_std | weighted_by_age_mean | weighted_by_age_std | AUROC_140_90_mean | AUROC_140_90_std |
|---|---|---|---|---|---|---|---|---|---|---|
| chain_lgbm | 0.5084 | 0.0063 | 0.5093 | 0.0062 | 0.5078 | 0.0072 | 0.5054 | 0.0062 | 0.7139 | 0.0085 |
| ensemble | 0.5153 | 0.0069 | 0.5114 | 0.0065 | 0.5145 | 0.0075 | 0.5124 | 0.0064 | 0.7290 | 0.0079 |
| mc_mid | 0.5179 | 0.0060 | 0.5128 | 0.0076 | 0.5149 | 0.0083 | 0.5150 | 0.0077 | 0.7309 | 0.0072 |
| mc_mid_recency | 0.5175 | 0.0071 | 0.5149 | 0.0072 | 0.5151 | 0.0082 | 0.5147 | 0.0069 | 0.7303 | 0.0070 |

### 기준(chain_lgbm argmax) 대비 짝지은 차이

| candidate | Δargmax vs chain_lgbm argmax | ci95_argmax | 판정_argmax | Δcumulative_tau vs chain_lgbm argmax | ci95_cumulative_tau | 판정_cumulative_tau | Δweighted_argmax vs chain_lgbm argmax | ci95_weighted_argmax | 판정_weighted_argmax | Δweighted_by_age vs chain_lgbm argmax | ci95_weighted_by_age | 판정_weighted_by_age |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mc_mid_recency | 0.0091 | 0.0010 | 개선 | 0.0065 | 0.0023 | 개선 | 0.0067 | 0.0021 | 개선 | 0.0063 | 0.0014 | 개선 |
| ensemble | 0.0069 | 0.0016 | 개선 | 0.0030 | 0.0052 | 잡음 범위 | 0.0061 | 0.0021 | 개선 | 0.0040 | 0.0023 | 개선 |
| mc_mid | 0.0095 | 0.0014 | 개선 | 0.0044 | 0.0038 | 개선 | 0.0065 | 0.0037 | 개선 | 0.0066 | 0.0020 | 개선 |

## 3. 테스트 파일

- 11673행 중 11413행 예측. 열: ['chain_lgbm__argmax', 'chain_lgbm__cumulative_tau', 'chain_lgbm__weighted_argmax', 'chain_lgbm__weighted_by_age', 'mc_small__argmax', 'mc_small__cumulative_tau', 'mc_small__weighted_argmax', 'mc_small__weighted_by_age', 'mc_mid__argmax', 'mc_mid__cumulative_tau', 'mc_mid__weighted_argmax', 'mc_mid__weighted_by_age', 'mc_big__argmax', 'mc_big__cumulative_tau', 'mc_big__weighted_argmax', 'mc_big__weighted_by_age', 'mc_mid+year__argmax', 'mc_mid+year__cumulative_tau', 'mc_mid+year__weighted_argmax', 'mc_mid+year__weighted_by_age', 'ensemble_mc__argmax', 'ensemble_mc__cumulative_tau', 'ensemble_mc__weighted_argmax', 'ensemble_mc__weighted_by_age']
- 최종 모델은 전체 라벨 행(검증 15% 제외) 으로 재학습, 가중·τ 는 그 검증에서 선택

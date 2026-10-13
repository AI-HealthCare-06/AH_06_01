# experiments.md — 실험 기록

모든 실험은 한 줄씩 남긴다 (AI 평가 "성능 검증 기록"). 지표는 **테스트 세트(2021~2022)** 기준,
괄호 안은 검증 세트(2020). 데이터 버전은 `data/processed/` 의 parquet 파일명으로 적는다.

| 날짜 | 실험 ID | 모델 | 피처셋 | 데이터 버전 | 시드 | AUROC | AUPRC | Brier | 보정 기울기/절편 | ECE | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | — | — | — | — | — | — | — | — | — | — | 폴더 생성, 인수인계 자료 반영 |
| 2026-10-12 | 2026.10.12-b0/time | B0 LR (htn_risk_full) | full 14 (부호 제약 없음) | knhanes_contract_v1.parquet | 42 | 0.844 (0.837) | 0.716 | 0.152 | 1.05 / +0.02 | 0.012 | platt 보정, 테스트=2021~22, 가중 AUROC 0.851, 성별 ECE 차 0.002, gates 통과, 단조 위반 5, 전환식 라벨 AUROC 0.837 |
| 2026-10-12 | 2026.10.12-b0/time | B0 LR (htn_risk_lite) | lite 5 (부호 제약 없음) | knhanes_contract_v1.parquet | 42 | 0.824 (0.817) | 0.678 | 0.161 | 1.05 / +0.02 | 0.013 | platt 보정, 테스트=2021~22, 가중 AUROC 0.829, 성별 ECE 차 0.000, gates 통과, 단조 위반 5, 전환식 라벨 AUROC 0.818 |
| 2026-10-12 | 2026.10.12-b0/random721 | B0 LR (htn_risk_full) | full 14 (부호 제약 없음) | knhanes_contract_v1.parquet | 42 | 0.839 (0.840) | 0.686 | 0.152 | 1.00 / +0.02 | 0.018 | platt 보정, 테스트=무작위 10%, 가중 AUROC 0.849, 성별 ECE 차 0.010, gates 통과, 단조 위반 4, 전환식 라벨 AUROC 0.837 |
| 2026-10-12 | 2026.10.12-b0/random721 | B0 LR (htn_risk_lite) | lite 5 (부호 제약 없음) | knhanes_contract_v1.parquet | 42 | 0.818 (0.822) | 0.654 | 0.160 | 0.98 / +0.02 | 0.013 | platt 보정, 테스트=무작위 10%, 가중 AUROC 0.826, 성별 ECE 차 0.020, gates 통과, 단조 위반 4, 전환식 라벨 AUROC 0.818 |
| 2026-10-12 | 2026.10.12-b0/time | B0 LR (htn_risk_full) | full 14 | knhanes_contract_v1.parquet | 42 | 0.844 (0.837) | 0.715 | 0.152 | 1.05 / +0.01 | 0.011 | platt 보정, 테스트=2021~22, 가중 AUROC 0.851, 성별 ECE 차 0.002, gates 통과, 단조 위반 0, 전환식 라벨 AUROC 0.837 |
| 2026-10-12 | 2026.10.12-b0/time | B0 LR (htn_risk_lite) | lite 5 | knhanes_contract_v1.parquet | 42 | 0.824 (0.817) | 0.678 | 0.161 | 1.05 / +0.02 | 0.013 | platt 보정, 테스트=2021~22, 가중 AUROC 0.829, 성별 ECE 차 0.000, gates 통과, 단조 위반 0, 전환식 라벨 AUROC 0.818 |
| 2026-10-12 | 2026.10.12-b0/random721 | B0 LR (htn_risk_full) | full 14 | knhanes_contract_v1.parquet | 42 | 0.839 (0.841) | 0.687 | 0.152 | 1.00 / +0.02 | 0.018 | platt 보정, 테스트=무작위 10%, 가중 AUROC 0.849, 성별 ECE 차 0.012, gates 통과, 단조 위반 0, 전환식 라벨 AUROC 0.837 |
| 2026-10-12 | 2026.10.12-b0/random721 | B0 LR (htn_risk_lite) | lite 5 | knhanes_contract_v1.parquet | 42 | 0.818 (0.822) | 0.654 | 0.160 | 0.98 / +0.02 | 0.013 | platt 보정, 테스트=무작위 10%, 가중 AUROC 0.826, 성별 ECE 차 0.020, gates 통과, 단조 위반 0, 전환식 라벨 AUROC 0.818 |
| 2026-10-13 | 2026.10.13-b1/time | B1 LGBM mono (htn_risk_full) | full 14 | knhanes_contract_v1.parquet | 42 | 0.846 (0.840) | 0.723 | 0.150 | 1.05 / +0.03 | 0.009 | platt 보정, hp {'learning_rate': 0.03, 'num_leaves': 15, 'min_child_samples': 200}, trees 279, ΔAUROC vs B0 val +0.003 / test +0.002, 성별 ECE 차 0.001, 단조 위반 0, B0 유지 |
| 2026-10-13 | 2026.10.13-b1/time | B1 LGBM mono (htn_risk_lite) | lite 5 | knhanes_contract_v1.parquet | 42 | 0.827 (0.821) | 0.688 | 0.159 | 1.05 / +0.02 | 0.009 | platt 보정, hp {'learning_rate': 0.03, 'num_leaves': 7, 'min_child_samples': 200}, trees 296, ΔAUROC vs B0 val +0.004 / test +0.004, 성별 ECE 차 0.003, 단조 위반 0, B0 유지 |

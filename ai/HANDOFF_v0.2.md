# AI팀 인수인계 v0.2 — v0.1(2026-10-12) 대비 변경 사항

작성 2026-10-15 (AI팀). v0.1 「고혈압 위험도 모델 v0.1」은 계속 유효하며, 아래는 **범위 확장과 그에 따른 계약·인터페이스 변경**만 적는다.

## 1. 범위: "혈압 없는 고혈압 위험도 모델" → "질환 예측 + 혈압 증감 예측 (M1~M4)"

팀 제품 그림(10/15 확인): 앱은 혈압 + 생활습관으로 혈압 관련 질환을 추정하고 관리(퀘스트)를 돕는다.
AI팀은 입력 건강 데이터로 **질환과 혈압의 증감을 예측**해 질환 예측·퀘스트 선정을 보조한다. v0.1 의 모델은 그중 M1.

| 모델 | 입력 | 출력 | 데이터 | 상태 |
|---|---|---|---|---|
| M1 고혈압 선별 (= v0.1 B0) | 계약 피처 14개, **혈압 금지** | risk_index, risk_level, reason_codes | KNHANES | 완료 |
| M2 예상 혈압·what-if | 계약 피처 14개 | expected_sbp/dbp ± RMSE, whatif[], bp_vs_expected | KNHANES 미복용자 + 근거표 | 완료 (2026.10.15-m2) |
| M3 동반 질환 위험 | **혈압 포함** + 14개 (+검진값 선택) — 계약 v2 | 당뇨·CKD·대사증후군·이상지질 위험지수 | KNHANES | 진행 중 |
| M4 혈압 추이 | 앱 가정혈압 로그 | 7일 추세, 목표 도달 예상 | 앱 데이터 | 1단계 규칙 스펙 |
| Quest Ranker | 트리 + M1~M4 + 근거표 + 이력 | 퀘스트 5개 | — | 다음 문서 |

v0.1 의 "혈압값은 어떤 버전에도 피처로 넣지 않는다"는 **M1 에만** 적용한다. M3 은 라벨이 다른 질환이라 혈압을 피처로 써도 누수가 아니다.

## 2. 설계 결정 (v0.1 에 없던 것)

- **생활습관 요인의 방향·효과 크기는 문헌 근거표가 기준** (`knowledge/lifestyle_evidence_v1.yaml`, 팀 문헌표 17편). KNHANES 단면 계수는 역인과로 방향이 뒤집히므로(나트륨·활동·흡연) 근거로 쓰지 않는다. 모델 부호 제약은 이 표와 일치해야 하며 `tests/test_evidence.py` 가 강제한다.
- **B0 = 부호 제약 L2 로지스틱** (v0.1 "로지스틱"에 부호 경계 추가). B1 LightGBM 은 ΔAUROC +0.002 로 채택 규칙(+0.02) 미달, `artifacts/candidates/` 보관.
- **BMI 효과 테스트** (v0.1 7장 "≥ +8"): 전원 보정 확률 1.8배 이상 + 60세 절대 +8 로 개정. 멘토 승인 대기.
- **혈압계 변경(2021~22 성인 Microlife)**: 주 라벨은 공식 정의(원값), 전환식 라벨은 `label_htn_devadj` 민감도 분석.
- **M2 what-if 는 두 값을 함께 낸다**: 모델 반사실 예측 차이(`delta_sbp_model`)와 RCT 효과 크기(`delta_sbp_literature`). 모델 쪽은 나트륨·활동·흡연에서 0 이 나오므로 화면은 문헌 값을 주로 쓴다.
- **활동량 정의**: 계약은 걷기 포함(≥150분 62%), 공식 유산소 실천율은 걷기 제외(39%). 기획 결정 대기.

## 3. 추론 인터페이스 변경 (`predict_htn_risk(features) -> dict`)

입력 추가 (선택): `measured_sbp`, `measured_dbp` — **M1 위험지수에는 영향 없음**, `bp_vs_expected` 계산에만 사용. (sbp/dbp/home_sbp_avg_7d 등 never_features 는 여전히 무시+경고.)

출력 추가:

| 필드 | 타입 | 의미 |
|---|---|---|
| `lifestyle_evidence` | list | 근거표 기준 개입 대상 요인: code, direction, modifiable, severity, expected_sbp_reduction_mmhg, evidence_level, sources(키) |
| `evidence_version` | str | 근거표 버전 (v1) |
| `expected_sbp`, `expected_dbp` | float \| null | M2 예상 혈압 (미복용자 기준 모집단 평균 참고치). data_quality=ok 일 때만 |
| `expected_bp_rmse` | {sbp, dbp} \| null | 테스트 RMSE (SBP 13.5, DBP 9.2) — 화면은 ± 띠로 |
| `bp_model_version` | str \| null | M2 버전 |
| `whatif` | list | 요인별 반사실: code, target, delta_sbp_model, delta_dbp_model, delta_sbp_literature |
| `bp_vs_expected` | dict \| null | measured_* 가 오면 실측 − 예상 (sbp_diff, dbp_diff) |

`expected_sbp` 는 v0.1 에서 항상 null 이었고 이제 값이 들어간다. API 명세(POST /predictions/htn-risk)·ERD predictions 스냅샷·FR-PRED-07 에 위 필드를 반영해야 한다. 화면 문구는 v0.1 7장 준법 규칙 그대로(“참고”, “높은 편/낮은 편”).

## 4. 아티팩트

| 파일 | 내용 | 크기 |
|---|---|---|
| `artifacts/htn_risk_full.joblib`, `htn_risk_lite.joblib` | M1 B0 (모델·Platt 보정기·대치값·버전) | 4 KB · 3 KB |
| `artifacts/expected_bp.joblib` | M2 (SBP·DBP 부호 제약 릿지 2개, 대치값, 메타·RMSE) | 4 KB |
| `artifacts/candidates/*_b1.joblib` | B1 후보 (미채택) | 171 · 102 KB |

세 파일 모두 프로세스 시작 시 1회 로드, 단건 p95 < 1 ms. `expected_bp.joblib` 이 없으면 M2 필드만 null 로 동작한다.

## 5. 남은 일정 (10/27 동결)

M3 (계약 v2 + 라벨 4개) → M4 규칙 스펙·개발팀 연동(pyproject, CI, API 동기화) → Quest Ranker 문서 → 모델 카드·골든 20건. 공단 100만 표본은 확보 시 M1 lite 외부 검증.

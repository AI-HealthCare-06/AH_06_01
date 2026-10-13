# 생활습관 요인: KNHANES 단면 계수 vs 문헌 근거 — 해석과 역할 분담

작성 2026-10-12 (AI팀) · B0 `2026.10.12-b0` · 근거표 `knowledge/lifestyle_evidence_v1.yaml` (팀 문헌표 17편)

## 결론 한 줄

**위험도(얼마나 위험한가)는 KNHANES 로 학습한 모델이, 요인의 방향과 "이렇게 하면 내려가요"의 크기는 RCT·메타분석 근거표가 기준이다.**
KNHANES 단면 자료는 역인과 때문에 생활습관의 방향을 뒤집어 보여주므로, 모델 계수를 생활습관 효과의 근거로 쓰지 않는다.

## 1. 무엇이 관찰됐나 (B0, 부호 제약 없이 학습, 표준화 계수)

| 피처 | KNHANES 계수 | 데이터가 말하는 것 | 문헌이 말하는 것 | 문헌 출처 |
|---|---|---|---|---|
| sodium_risk_score | **−0.046** | 나트륨 많이 먹는 사람이 고혈압 ↓ | 나트륨 제한 SBP **−3.6** (105 RCT); 기존 SBP ≥150 이면 저염+DASH **−20.8**; 노인 혈압 악화 HR 0.69 | Dickinson 2006, Juraschek 2017, TONE 1998 |
| activity_minutes_week | **+0.019** | 활동 많은 사람이 고혈압 ↑ | 유산소 운동 SBP **−4.6**; 한국인 RCT 식이+운동 **−5.2**; 용량-반응 | Dickinson 2006, Lee 2018, Blumenthal 2000, Frisoli 2011 |
| smoking_current | **−0.039** | 현재 흡연자가 고혈압 ↓ | 니코틴은 **지속적 혈압 상승 없음**(급성만); 금연은 심혈관 예방 1차 권고 | Frisoli 2011, ISH 2023 |
| stress_score | +0.001 | 무관 | 이완요법은 비중재 대조 비교에서만 유의; 스트레스 관리 권고 | Dickinson 2006, ISH 2023 |
| sleep_avg_h | +0.009 | 무관 | 수면 관리 권고(수면무호흡); 혈압 수치 근거 없음 | ISH 2023 |
| alcohol_units_week | **+0.255** | 음주 ↑ → 고혈압 ↑ | 알코올 제한 SBP **−3.8** | Dickinson 2006 |
| bmi / waist_cm | **+0.449 / +0.174** | 비만 ↑ → 고혈압 ↑ | 체중 감량 고혈압 발생 **OR 0.23**(7년), 체중관리 SBP −7 | He 2000(TOHP), Blumenthal 2000, TONE |
| family_htn / diabetes | +0.426 / +0.193 | ↑ | (생활습관 아님) | — |

세 피처(나트륨·활동·흡연)만 데이터와 문헌이 **반대**이고, 나머지는 일치한다.

## 2. 왜 반대로 나오나 — 역인과(reverse causation)

KNHANES 는 한 시점에 "지금 혈압"과 "지금 생활습관"을 같이 묻는다. 고혈압 진단을 받은 사람은 의사 권고대로
**소금을 줄이고 운동을 시작하고 담배를 끊는다**. 그래서 단면에서는 "소금 적게 먹는 사람 중에 고혈압이 많다"가 된다.
소금이 혈압을 낮춘 것이 아니라 **고혈압이 소금 섭취를 낮춘 것**인데, 단면 자료는 그 방향을 구분하지 못한다.
흡연은 여기에 연령 교란(흡연자는 젊다)이 더해진다.

반대로 문헌표의 근거는 **무작위 배정 시험**이다: 사람을 무작위로 나눠 한쪽만 소금을 줄이게 하고 혈압 변화를 봤으므로 방향이 확실하다.
TOHP 는 7년을 추적해 체중 감량군의 고혈압 **발생**이 77% 적었음을 보였다(OR 0.23). 이것이 "기준"이 문헌이어야 하는 이유다.

흡연은 문헌도 "혈압 지속 상승은 없다"고 하므로, 계수 0 은 문헌과 모순이 아니다. 금연 퀘스트의 근거는 혈압이 아니라 심혈관질환 예방이다.

## 3. 그래서 코드에서 무엇을 했나

| 층 | 규칙 | 구현 |
|---|---|---|
| 방향의 기준 | 근거표의 `direction` 이 기준. 모델 부호 제약은 이와 일치해야 한다 | `knowledge/evidence.py::EVIDENCE_DIRECTION` ↔ `contract_v1.MONOTONE_CONSTRAINTS`, `tests/test_evidence.py` |
| B0 모델 | 부호 제약 L2 로지스틱. 반대 방향 계수는 0 에 수렴 → 단조성 보장, "소금 더 드시면 내려갑니다" 류 출력 원천 차단 | `features/sk_transforms.SignConstrainedLogisticRegression` |
| B1 모델 | LightGBM `monotone_constraints` 에 같은 표 사용 | (10/20) |
| 출력 | `reason_codes` = 모델 기여도(현재 B0 는 age·bmi·waist·alcohol·family·diabetes 만 나옴) / **`lifestyle_evidence`** = 근거표 기준 개입 대상 요인 + SBP 감소 효과 + 출처 키. 두 필드는 섞지 않는다 | `inference/predictor.py` |
| 퀘스트 | Quest Ranker 는 `lifestyle_evidence`(문헌 효과 크기) + 트리 결과 + 퀘스트 이력으로 우선순위 | (다음 문서) |
| 숫자 출처 | 근거표의 수치는 팀 문헌표 CSV 에 적힌 값만. 지어낸 숫자 방지 테스트 | `tests/test_evidence.py::test_numbers_come_from_team_csv` |

## 4. 결과 해석 예시

40세 남성, 나트륨 점수 2, 활동 30분/주, BMI 23 → 모델 `risk_index` 는 age·bmi 중심으로 낮게 나오고(`reason_codes`: age, bmi_high …),
`lifestyle_evidence` 에는 `activity_low`(−4.6 mmHg, Dickinson 2006) 과 `sodium_high`(−3.6, 심각도 2) 가 따로 실린다.
화면은 "참고 위험지수는 낮은 편 / 그래도 활동량과 나트륨은 문헌상 혈압을 올리는 요인" 으로 두 정보를 분리해 보여줄 수 있다.

## 5. 한계와 확인 항목 (10/15 멘토링)

- 근거표의 효과 크기는 **고혈압 환자·전단계 대상 중재 시험** 값이 많다. 정상 혈압의 젊은 사용자에게 같은 mmHg 를 약속하면 과장이다 → 화면 문구는 "문헌상 평균 감소" 수준으로, 수치는 참고 표기.
- `smoking_current`·`stress_high` 는 혈압 효과 수치가 표에 없어 `expected_sbp_reduction_mmhg: null`. 퀘스트는 지침 권고(ISH 2023)로 정당화.
- KNHANES 의 나트륨은 24시간 회상(설문), 앱은 식단 사진 AI 점수 — 같은 3단 척도로 맞추기로 했으나 측정 방식이 다르다(인수인계 열린 질문).
- B1 이 비선형 상호작용(예: 젊은 층에서 나트륨 효과)을 찾는다면 `reason_codes` 에 생활습관 코드가 다시 나타날 수 있다. 그래도 방향 기준은 근거표로 유지.

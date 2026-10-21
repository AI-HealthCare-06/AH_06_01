# 결정 필요 항목 목록 (v0.2.0 — M1 step 기반)

구분: **A** = 지금 열려 있어 M2 구현에 바로 영향이 있는 항목, **B** = M1 안정화 후 함께 정할 항목(지금은 자리만), **C** = M1 로 넘어간 항목(M2 에서는 닫힘), **D** = 명세 안에서 어긋나 확인이 필요한 항목.
각 항목은 현재 구현과 선택지를 같은 무게로 적는다. 선택지 순서에 뜻은 없다. v0.1 번호는 그대로 쓴다.

## A. 지금 열려 있는 항목

### D-31 HTN_SUSPECT 를 복약자(11=3)에게 어떻게 낼지
- 현재: M1 htn 이 복약을 포함하므로 복약자의 step 으로는 혈압 수준을 알 수 없다 → `not_evaluable(m1_bp_step.bp_level_step)`, notes `htn_step_includes_medication`.
- 선택지: (a) 지금처럼 `bp_level_step` 대기 (b) 복약자는 HTN_SUSPECT 적용 제외 → `not_applicable` (c) 복약자도 step=htn 이면 positive.

### D-32 NOCTURNAL_SCREEN 에서 증상 <2 일 때의 상태
- 현재: 저녁 분기(저녁 step)를 평가할 수 없어 `not_evaluable(m1_bp_step.evening_step)`. 증상 ≥2 면 positive.
- 선택지: (a) 지금처럼 not_evaluable (b) 증상 분기만으로 negative 를 내고 notes 에 `evening_branch:pending_m1` (c) 저녁 step 이 올 때까지 상태 자체를 출력에서 숨김.

### D-30 복약자인데 step ≠ htn 인 입력
- 현재: 거부하지 않고 그대로 판정. 데이터 적용 보고에서 건수만 센다.
- 선택지: (a) 그대로 (b) `data_quality = invalid` 로 거부 (c) 해당 subject 의 혈압 관련 상태만 not_evaluable.

### D-20 동시 판정 표시 우선순위 — 출력 `display_priority`
- 현재: 10개 독립 출력, `display_priority = null`. 지금 구현에서 동시에 positive 가 될 수 있는 조합은 HTN_SUSPECT + NOCTURNAL_SCREEN(증상), ELEVATED/PREHTN + NOCTURNAL_SCREEN(증상) 뿐이다(골든 G17·G18). M1 필드가 늘면 조합도 는다.
- 선택지: (a) 전체 순서 1개 (b) 그룹별 병렬 표시 (c) 전부 표시하고 템플릿이 정렬.

### D-07 PREHTN 위험인자 수치 기준 — `RISK_BMI_MIN, RISK_WAIST_CM_MIN_M/F, RISK_ACTIVITY_MIN_PER_WEEK_BELOW`
- 현재: None → `risk_factors_pending = [bmi, waist, activity]` 로 표시만. 현재흡연·폭음·짠식습관·식단사진 플래그·가족력은 불리언 그대로 목록에 넣는다.
- 기준을 주면 바로 켜진다(테스트 `test_step_PREHTN_risk_factor_numeric_when_thresholds_set`).

### D-13 PREHTN "+ 위험인자 문항"
- 현재: 위험인자는 목록·개수만 내고 판정 조건이 아니다(위험인자 0 이어도 step=prehtn 이면 positive).
- 대안: 위험인자 ≥1(또는 ≥n) 을 positive 조건에 포함.

### D-06 당뇨·CKD 동반 확인 기준 — `DIABETES_FPG_MIN, DIABETES_HBA1C_MIN, CKD_CREATININE_MIN, CKD_URINE_PROTEIN_MIN`
- 현재: 전부 None → 목표 혈압 전환 불가(`target_bp.diabetes/ckd = null`). 기준을 주면 기전은 동작.
- 확인할 것: 공복혈당·HbA1c 기준, 크레아티닌 단독인지 eGFR 산식(성별·나이 필요)인지, 요단백 등급 기준.

### D-09 목표 혈압 기본값 — `TARGET_BP_DEFAULT`
- 현재: None. 동반질환 없을 때 `target_bp.sbp/dbp = null`.

### D-08 타입·형식 오류 처리 — `data_quality = invalid`
- 현재: 파싱 불가(step 오타, enum 밖 값, 숫자 자리 문자)는 `invalid` 로 입력 전체 거부. step 의 대소문자·공백 정규화는 하지 않는다.
- 대안: out_of_range 로 통합 / 해당 필드만 결측으로 보고 진행 / step 은 소문자·공백 제거 후 비교.

### D-10 변수 범위 임시값 (feature_contract.yaml)
| 필드 | 임시 range | 필드 | 임시 range |
|---|---|---|---|
| resting_hr | 20~250 bpm | age / own_onset_age | 0~120 |
| height_cm | 100~250 | weight_kg | 20~300 |
| waist_cm | 40~200 | alcohol_per_week | 0~30 |
| drinks_per_occasion | 0~50 | sleep_hours | 0~24 |
| eating_out_per_week | 0~30 | moderate_min_per_week | 0~10080 |
| steps_per_day | 0~100000 | sedentary_hours | 0~24 |
| fpg | 20~1000 mg/dL | hba1c | 2~20 % |
| tc / tg / hdl / ldl | 50~1000 / 10~5000 / 5~300 / 5~800 | creatinine | 0.1~30 mg/dL |
- 범위를 바꾸면 계약 버전을 올린다.

### D-29 `height_weight_waist` 존재 조건
- 현재: 키·체중·허리둘레 셋 다 있어야 존재(PREHTN·HTN_SUSPECT 필수). 허리둘레만 없어도 두 상태가 `not_evaluable`.
- 대안: 키·체중만 필수, 허리둘레 선택.

### D-16 WHITE_COAT·MASKED 에서 약 복용자 + 다른 필수 결측
- 현재: `not_applicable` 이 `not_evaluable` 보다 우선.
- 대안: 결측을 먼저 보고 `not_evaluable`.

### D-18 NOCTURNAL_SCREEN 야뇨 출처
- 현재: `sleep_snoring.nocturia` 또는 `symptom_flags.nocturia` 중 하나라도 true.
- 대안: 13 만 / 8 만.

### D-19 출력 스키마 (§5 가 비어 있음)
- 현재: `docs/rules_spec.md` §6 의 임시 스키마. 필드 추가·삭제·이름을 정해 주면 맞춘다.

### D-27 모델 적용 지점
- 명세: 규칙만. 모델 지점은 지정 시 구현.
- 이번 지시에 "예측" 이라는 말이 있었다. 규칙 판정을 뜻하는지, 학습 모델을 넣는다는 뜻인지 확인 필요. 현재는 전부 규칙.

### D-28 Git 브랜치
- 현재: 폴더가 git 저장소가 아니다. `.gitignore`(데이터 파일 제외)만 준비. 브랜치명과 원격을 알려 주면 초기화·커밋한다.

## B. M1 안정화 후 함께 정할 항목 (지금은 자리만)

| 번호 | 항목 | 관련 M1 필드 | 메모 |
|---|---|---|---|
| D-01 | 아침−저녁 SBP 차 경계 15~20 | morning_step·evening_step 으로는 mmHg 차를 알 수 없음 | step 만 받으면 이 분기는 M1 이 `morning_evening_diff_flag` 같은 플래그로 줘야 한다. 아니면 분기 폐기 |
| D-02 | 판정 보류(측정일 <5, 아침/저녁 결측 비율) | M1 의 보류 플래그 | M1 이 보류를 알려 주는 필드가 있는지 |
| D-05 | ISH "노인은 기립 측정 권유" 연령 | ish_flag | ISH 가 켜질 때 함께 |
| D-15 | HTN_STAGE2_SCREEN 재측정 데이터 | stage2_flag | 재측정 결과까지 M1 이 주는지 |
| D-17 | MASKED "가정 ≥135/85(아침 중심)" | office_step + morning_step/step | 어느 step 을 가정 쪽으로 쓸지 |
| D-14 | HTN_SUSPECT "아침 평균 지속" | morning_step | step 이 지속성을 담는지 |
| D-21 | 참고 밴드 표시 여부 | — | 밴드가 M1 역할이 되어 M2 출력에서 빠짐. M1 쪽 표시 문제 |

## C. M1 로 넘어간 항목 (M2 에서는 닫힘)

D-03 밴드 소속 규칙, D-04 첫날 제외, D-11 프로토콜 위반 처리, D-12 가드 하한 해석, D-22 진료실 조건 결합 방식, D-24 가드 적용 대상, D-25 전체 평균·결측 비율 분모, D-26 HTN_STAGE2_SCREEN 보류 미적용. 모두 혈압 계산 쪽 결정이라 M1 의 몫이 됐다. v0.1 의 구현과 선택지는 `archive/v0.1_raw_bp/docs/decisions_needed.md` 에 남아 있다.

## D. 명세 안에서 어긋나는 항목

### D-23 필수 변수: §3 "필수 5개(1, 2, 9, 11, 가드 시 8)" vs §4 표의 ●
- v0.2 에서 1·2(가정혈압)는 `m1_bp_step` 하나로, 3(진료실)은 M1 의 `office_step` 으로 바뀌었다.
- 현재: §4 표를 따르되, HTN_SUSPECT·HTN_STAGE2_SCREEN·RESISTANT_SUSPECT 의 3(진료실) 필수는 `office_step` 이 아직 없으므로 **적용하지 않는다**. 그래서 HTN_SUSPECT 는 step 만으로 positive 가 된다.
- 확인: (a) 지금처럼 진료실 없이 평가 (b) `office_step` 이 들어오면 다시 필수로 올림 (c) 11 을 ELEVATED·PREHTN 에도 필수로.

---
코드 위치: 저장소 `ai/m2_state/` (독립 패키지, 이 폴더 안에서 실행).

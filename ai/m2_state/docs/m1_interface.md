# M1 → M2 인터페이스 (v0.2.0)

M2 가 M1 에서 받는 것과, M1 안정화 후 추가로 받아야 A군 나머지 상태가 켜지는 것을 적는다.
수치 정의는 원 명세 §2·§4 의 것이며 M2 코드에는 두지 않는다(M1 이 계산).

## 1. 지금 받는 것

| 필드 | 타입 | 정의(M1 제공) | M2 사용처 |
|---|---|---|---|
| `m1_bp_step.step` | enum normal / elevated / prehtn / htn | normal: SBP <120 and DBP <80 · elevated: 120≤SBP<130 and DBP<80 · prehtn: 130≤SBP<140 or 80≤DBP<90 · htn: SBP≥140 or DBP≥90 **or 항고혈압제 복약** | ELEVATED, PREHTN, HTN_SUSPECT |
| `m1_bp_step.step_date` | date (선택) | 분류 기준일 | 출력에 그대로 |

미정 사항(명세 없음): step 이 분류하는 혈압이 무엇인지(가정 7일 평균 / 진료실 / 최근 1회), 사용자당 1개인지 시계열인지. 시계열이면 M2 변환기는 첫 비결측값을 쓴다(feature_contract.yaml conventions.table_layout).

## 2. M1 안정화 후 받아야 하는 것 (계약에 `status: pending_m1` 로 자리만 둠)

| 필드 | 타입 | 요청 정의(원 명세 기준) | 켜지는 상태 |
|---|---|---|---|
| `bp_level_step` | enum(step 과 동일) | 복약 조항을 뺀 순수 혈압 단계 | HTN_SUSPECT(복약자), RESISTANT_SUSPECT |
| `morning_step` | enum | 아침(기상 1시간 내, 복약 전) 측정의 단계 | MORNING |
| `evening_step` | enum | 저녁(취침 전) 측정의 단계 | MORNING, NOCTURNAL_SCREEN(저녁 분기) |
| `office_step` | enum | 최근 진료실 혈압의 단계 | WHITE_COAT, MASKED |
| `stage2_flag` | bool | 1회라도 ≥160/100 (§4 HTN_STAGE2_SCREEN) | HTN_STAGE2_SCREEN |
| `ish_flag` | bool | SBP 만 높고 DBP 는 낮음 (§4 ISH: 가정 평균 SBP ≥135 이고 DBP <85) | ISH |
| `guard_flag` | bool | 입력 혈압 ≥180/120 또는 <90/60 발생 (§2 가드) | A군 전체 중단 + 증상 문항 분기 |

이 필드가 들어오면 지금도 계약 검증은 통과하지만 규칙은 쓰지 않는다(테스트 `test_step_pending_fields_accepted_but_unused`).
각 필드의 규칙은 들어오는 시점에 §4 를 step 언어로 옮겨 구현한다(이전 답변의 매핑표 참고).

## 3. M1 step 정의에서 비롯되는 제약

- htn 이 "복약"을 포함하므로 복약자(11=3)의 step 은 혈압 정보를 담지 않는다. 그래서 HTN_SUSPECT·RESISTANT_SUSPECT 의 혈압 조건은 복약자에서 `bp_level_step` 을 기다린다.
- 복약자인데 step ≠ htn 인 행은 M1 정의와 어긋난다. M2 는 거부하지 않고 데이터 적용 보고에서 건수만 센다(D-30).
- step 의 기준선(120/80, 130/80~, 140/90)은 §2 의 가정혈압 참고 밴드(115/75, 125/80, 135/85)와 다르다. M2 는 step 을 그대로 받아들이고 조정하지 않는다.

# M2 A군 규칙 명세서 (구현 기준, v0.2.0 — M1 step 기반)

이 문서는 구현된 그대로를 적는다. 원 명세(프롬프트 §1~§4)와 다르게 해석한 곳은 `D-nn` 으로 표시하고
`docs/decisions_needed.md` 에서 묻는다. 임계값·코드는 `thresholds.py` 의 이름으로만 적는다.
v0.1.0(가정혈압 원시값 기반)은 `archive/v0.1_raw_bp/` 에 보관했다.

## 1. 경계와 원칙

- **M1**: 혈압 측정값을 분류해 step(normal / elevated / prehtn / htn)을 준다. 7일 평균, 아침·저녁·진료실 구분, 참고 밴드, 가드(≥180/120, <90/60), 2기 범위, ISH 판별은 M1 쪽이다.
- **M2**: M1 step + 생활 데이터(7·8·9·10·11·12·13·14·15·16·17·19·20)로 A군 10개 상태를 판정한다. 혈압 수치는 받지도 계산하지도 않는다.
- M1 step 정의(M1 이 알려 준 것): normal = SBP <120 and DBP <80, elevated = 120≤SBP<130 and DBP<80, prehtn = 130≤SBP<140 or 80≤DBP<90, htn = SBP≥140 or DBP≥90 **or 항고혈압제 복약**. 이 숫자는 M1 의 것이라 M2 코드에 두지 않는다.
- 임계값·코드: `thresholds.py` 한 파일. 입력 계약: `feature_contract.yaml`(0.2.0). 범위 밖 값은 클리핑 없이 `data_quality = out_of_range` 로 입력 전체 거부.
- 출력: 상태 코드와 숫자만. 금지 표현과 비ASCII 문구 없음을 테스트로 고정.
- 임상 기준: KSH2022 1순위, 아침 고혈압 ISH2023, 저항성 TRIUMPH(Blumenthal 2021).

## 2. 구현 상태

| 구분 | 상태 | 지금 내는 것 |
|---|---|---|
| 구현됨 | ELEVATED, PREHTN, HTN_SUSPECT(미치료자), NOCTURNAL_SCREEN(증상 분기) | positive / negative |
| M1 대기 | HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, RESISTANT_SUSPECT | 지금 결정 가능한 부분만 판정하고, 혈압 조건은 `not_evaluable` + `missing_required = ["m1_bp_step.<필드>"]` + notes `pending_m1` |

M1 이 추가로 줘야 켜지는 필드와 그 정의는 `docs/m1_interface.md`.

## 3. 처리 순서 (`inference/judge_m2.py`)

1. `feature_contract.validate()` — 타입 정규화, 범위 검사, 변수 존재(presence). `out_of_range` / `invalid`(D-08)면 거부: 모든 상태 `not_evaluated(reason=data_rejected)`.
2. 컨텍스트 — 성별, 복약 상태, M1 step. (만 나이 계산은 ISH 의 연령 기준(D-05)이 정해질 때 넣는다.)
3. `rules_m2.evaluate_all()` — 10개 규칙(§4).
4. 목표 혈압 필드(§5), 출력(§6).

가드는 M1 의 `guard_flag` 가 정의되면 연결한다. 지금은 `guard = {triggered: null, pending_m1_field: "guard_flag"}` 로 낸다.

## 4. 규칙별 명세 (`rules_m2.py`)

공통: 필수 변수 결측 → `not_evaluable(missing_required=[변수명])`. 필수·보조 목록은 계약의 `required_for / auxiliary_for`. 보조 변수는 판정을 바꾸지 않고 `auxiliary_present` 에 이름만 적는다. 모든 evidence 에 `step` 을 넣는다.

| 코드 | 구현된 규칙 | 필수 ● | 보조 ○ | 결과 | 해석 |
|---|---|---|---|---|---|
| ELEVATED | step = `ELEVATED_STEP`(elevated) | M1, 9 | 7,10,11,12,14,15,19 | positive / negative | 밴드 계산은 M1. 진료실 보조 조건(§4 "120~129/<80")은 M1 elevated 정의와 같아 별도 처리 없음 |
| PREHTN | step = `PREHTN_STEP`(prehtn). 위험인자는 목록만(`risk_factors[]`, `n_risk_factors`, `risk_factors_pending[]`, `bmi`) | M1, 9, 10, 12, 14, 15, 19 | 7,11,13,16 | positive / negative | D-07(수치 기준), D-13(위험인자는 조건 아님) |
| HTN_SUSPECT | 11∈{1,2}: step = `HTN_SUSPECT_STEP`(htn). 11=3: htn 이 복약을 포함해 혈압 수준 확정 불가 → `not_evaluable(m1_bp_step.bp_level_step)` | M1, 9, 10, 11, 12, 14, 15, 19 | 7,8,13,16,17,20 | positive / negative / not_evaluable | D-31(복약자 처리), D-23(§4 의 3 진료실 필수는 M1 office_step 으로 이관) |
| HTN_STAGE2_SCREEN | 2기 범위 1회 여부는 step 에 없음 | M1, 8, 9, 11 | 7,10,12,14,16,17,19,20 | `not_evaluable(m1_bp_step.stage2_flag)` | D-15 |
| ISH | 수축기 단독 여부는 step 에 없음 | M1, 9, 11 | 7,8,10,14,15,20 | `not_evaluable(m1_bp_step.ish_flag)` | D-05 |
| WHITE_COAT | 11=3 → `not_applicable`(결측보다 우선, D-16). 그 외 진료실 step 대기 | M1, 9, 11 | 없음 | not_applicable / `not_evaluable(m1_bp_step.office_step)` | — |
| MASKED | 11=3 → `not_applicable`. 그 외 진료실 step 대기 | M1, 9, 11, 12 | 10,13 | not_applicable / `not_evaluable(m1_bp_step.office_step)` | D-17 |
| MORNING | 아침·저녁 step 대기 | M1, 9, 11, 12, 13 | 7,8,14 | `not_evaluable(m1_bp_step.morning_step, evening_step)` | D-01, D-02 |
| NOCTURNAL_SCREEN | (코골이, 주간졸림, 야뇨) ≥ `NOCTURNAL_SYMPTOM_MIN` → positive. 미만이면 저녁 분기(저녁 step) 대기 → `not_evaluable(m1_bp_step.evening_step)`. 야뇨는 13 또는 8 | M1, 8, 9, 11, 13 | 7,10,12,14,17 (✕4) | positive / not_evaluable | D-18, D-32(음성 확정 불가) |
| RESISTANT_SUSPECT | 11∈{1,2} → negative. 11=3 & `triple_with_diuretic` 결측 → `not_evaluable(medication.triple_with_diuretic)`. 11=3 & triple=false → negative. 11=3 & triple=true → 혈압 조건 대기 `not_evaluable(m1_bp_step.bp_level_step)` | M1, 9, 11, 12, 13, 14, 17 | 8,10,15,16,20 | negative / not_evaluable | §4 의 3 진료실 필수는 M1 로 이관 |

규칙 간 관계(명세 그대로): WHITE_COAT·MASKED 는 약 복용자에게 적용 안 함. 동시 판정은 10개를 독립으로 내고 `display_priority = null`(D-20).

## 5. 목표 혈압 필드 (`rules_m2.target_bp`)

16·17 로 당뇨·CKD 동반이 확인되면 `target_bp = TARGET_BP_COMORBID(130/80)`. 확인 기준(`DIABETES_*`, `CKD_*`)은 결정 대기(D-06) — None 이면 `diabetes/ckd = null`, 목표 혈압 `null`(기본값 D-09). A군 규칙은 바꾸지 않는다.

## 6. 출력 스키마 (§5 명세 없음 — 임시, D-19)

```
module, contract_version, thresholds_version, subject_id, as_of,
data_quality: ok | out_of_range | invalid,
violations: [{variable, field, index, kind, value, detail}],
presence: {변수명: bool},
m1_bp_step: {step, step_date},
guard: {triggered: null, pending_m1_field: "guard_flag"},
target_bp: {sbp, dbp, diabetes, ckd, basis},
states: {CODE: {status, evidence{}, missing_required[], auxiliary_present[], notes[]}},
implemented_states[], pending_m1_states[],
display_priority: null
```

## 7. 상태 코드

| status | 뜻 |
|---|---|
| positive | 규칙 충족 |
| negative | 규칙 평가함, 미충족 |
| not_evaluable | 필수 항목 결측. M1 미제공 필드는 `m1_bp_step.<field>` 로 적고 notes 에 `pending_m1` |
| not_applicable | 적용 대상 아님(약 복용자에 WHITE_COAT/MASKED) |
| not_evaluated | 입력 거부로 평가하지 않음 |

## 8. 테스트 구성 (`tests/`)

| 파일 | 내용 |
|---|---|
| test_rules_step.py | step 4값 × 상태 기대표, 수면 증상 개수(=, −1, +1), 위험인자 목록, 복약자 HTN_SUSPECT, M1 대기 상태가 step 에 무관함, pending 필드가 들어와도 미사용 |
| test_rules_missing.py | 상태별 필수 항목 하나씩 제거 → not_evaluable; 보조 항목 제거 → 결과 불변 |
| test_rules_medication.py | 상태 × 복약 상태(①②③) 기대표 |
| test_contract.py | 원시 혈압 변수 제거 확인, 범위 밖 거부(클리핑 없음), step enum 오류, 존재 규칙, pending 필드 검증, 평탄 표 변환 왕복, 컬럼 대조 |
| test_output_wording.py | 금지 표현·비ASCII 없음, 스키마, 목표 혈압 전환 |
| test_golden.py | 골든 20건 회귀(초안) |

mmHg 경계값(=, −1, +1), 측정일 4·5·7일, 아침/저녁 결측 비율 테스트는 M1 역할로 넘어가 여기 없다(v0.1 에는 있었다).

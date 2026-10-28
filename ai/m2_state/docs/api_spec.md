# M2 API 명세서 (v0.2.0)

M2 는 HTTP 서버가 아니라 **순수 Python 함수**다. 백엔드가 이 함수를 감싸 API 로 노출한다(HTTP 경로·메서드·상태 코드 매핑은 명세 없음, D-19).
이 문서는 함수 수준의 요청·응답 계약을 적는다. 작동 원리는 `how_it_works.md`, 규칙 조건은 `rules_spec.md`.

## 1. 호출

| 항목 | 값 |
|---|---|
| 함수 | `inference.judge_m2.judge(payload: dict, as_of: date \| str \| None = None) -> dict` |
| 실행 위치 | `ai/m2_state/` 안에서 (`pythonpath="."`). 상위 패키지와 import 관계 없음 |
| 의존성 | `requirements.txt` (pyyaml, pandas, pytest). pandas 는 표 변환·결측 판정에만 쓴다 |
| 상태 | 무상태·결정론적. 계약 yaml 은 프로세스당 1회 로드(캐시). 외부 I/O 없음 |
| 스레드 | 입력을 변경하지 않으므로 동시 호출 안전 |
| 지연 (이 Mac, 2,000회, PREHTN 표준 입력) | p50 0.12 ms · p95 0.14 ms · 최대 0.27 ms |
| 버전 | 응답의 `contract_version`(계약 0.2.0), `thresholds_version`(0.2.0) |

```python
from inference.judge_m2 import judge
out = judge(payload)                 # as_of 생략 시 payload["as_of"]
out["states"]["HTN_SUSPECT"]["status"]
```

보조 함수(배치·점검용):

| 함수 | 용도 |
|---|---|
| `feature_contract.validate(payload) -> ValidationResult` | 검증만 (data_quality, violations, presence, 정규화 payload) |
| `feature_contract.from_table(df, subject_id, column_aliases=None, subject_col="subject_id") -> dict` | 평탄 표 한 행 → payload |
| `feature_contract.compare_columns(columns, column_aliases=None) -> dict` | 실제 컬럼 ↔ 계약 컬럼 대조 |
| CLI `python3 scripts/apply_data.py <파일> [--aliases a.json]` | 컬럼 대조 → 결측·범위 → 판정 분포 → 동시 발생표 보고서 |

## 2. 요청 (payload)

### 2.1 형태

중첩 dict 하나. 최상위 키는 메타 2개 + 변수 14개. 없는 변수는 키를 생략하거나 `null` 로 보낸다.

```json
{
  "subject_id": "U-004",
  "as_of": "2026-10-21",
  "m1_bp_step": {"step": "prehtn", "step_date": null},
  "pulse_hr": {"resting_hr": 70, "irregular_pulse": false},
  "symptom_flags": {"headache": false, "...": false, "nocturia": false},
  "age_sex": {"age": 55, "sex": "F"},
  "height_weight_waist": {"height_cm": 170, "weight_kg": 65, "waist_cm": 80},
  "medication": {"status": 2, "drugs": [], "triple_with_diuretic": false},
  "smoking_alcohol": {"smoking": "current", "alcohol_per_week": 0, "drinks_per_occasion": 0, "binge": false},
  "sleep_snoring": {"bedtime": "23:00", "wake_time": "06:30", "sleep_hours": 7.0, "snoring": false, "daytime_sleepiness": false, "nocturia": false},
  "diet_sodium": {"salty_habit": true, "eating_out_per_week": 2},
  "activity": {"moderate_min_per_week": 150, "steps_per_day": 7000, "sedentary_hours": 8},
  "lab_glucose_lipid": {"fpg": 95, "hba1c": 5.4, "tc": 180, "tg": 100, "hdl": 55, "ldl": 100},
  "lab_kidney": {"creatinine": 0.9, "urine_protein": "negative"},
  "family_history": {"htn": true, "stroke": false, "mi": false},
  "clinical_exam": null
}
```

### 2.2 공통 규칙

| 규칙 | 내용 |
|---|---|
| 결측 | `null`, 빈 문자열, NaN. 위반이 아니다. 그 변수가 필수인 상태만 `not_evaluable` |
| 범위 밖 | 클리핑하지 않고 `data_quality = out_of_range` 로 **입력 전체** 거부. 값은 `violations[].value` 에 원값 그대로 |
| 형식 오류 | 타입 변환 실패, enum 밖 값 → `data_quality = invalid` 로 전체 거부. `step` 은 소문자 정확 일치만 허용 |
| 날짜·시각 | `YYYY-MM-DD`, `HH:MM`(24h). 문자열 또는 date/time 객체 |
| bool | `true/false`, `1/0`, `"yes"/"no"`, `"y"/"n"`, `"t"/"f"` 허용 |
| 숫자 enum | `medication.status` 는 `3` 과 `"3"` 모두 허용 |
| 메타 | `subject_id` 필수(없으면 `invalid`). `as_of` 선택, 응답에 그대로 실린다 |
| 미정 범위 | 모든 수치 범위는 임시값이다(D-10). 바뀌면 `contract_version` 이 오른다 |

### 2.3 변수별 필드 (feature_contract.yaml 0.2.0 에서 생성)

### `m1_bp_step` (§3 #M1) — M1 이 분류한 혈압 단계. normal / elevated / prehtn / htn (htn 은 M1 정의상 항고혈압제 복약을 포함)

- 수집: M1 출력 · 존재 조건: all: step
- 필수(●): ELEVATED, PREHTN, HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, NOCTURNAL_SCREEN, RESISTANT_SUSPECT
- 보조(○): —

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `step` | enum | — | normal, elevated, prehtn, htn | 필수. |
| `step_date` | date | — | — | M1 분류 기준일(선택) |
| `morning_step` | enum | — | normal, elevated, prehtn, htn | **pending_m1** — 켜지는 상태: MORNING. |
| `evening_step` | enum | — | normal, elevated, prehtn, htn | **pending_m1** — 켜지는 상태: MORNING, NOCTURNAL_SCREEN. |
| `office_step` | enum | — | normal, elevated, prehtn, htn | **pending_m1** — 켜지는 상태: WHITE_COAT, MASKED. |
| `bp_level_step` | enum | — | normal, elevated, prehtn, htn | **pending_m1** — 켜지는 상태: HTN_SUSPECT, RESISTANT_SUSPECT. 복약 조항을 뺀 순수 혈압 단계 |
| `stage2_flag` | bool | — | — | **pending_m1** — 켜지는 상태: HTN_STAGE2_SCREEN. 1회라도 2기 범위 |
| `ish_flag` | bool | — | — | **pending_m1** — 켜지는 상태: ISH. 수축기만 높음 |
| `guard_flag` | bool | — | — | **pending_m1** — 켜지는 상태: GUARD. §2 가드 범위 입력 발생 |

### `pulse_hr` (§3 #7) — 맥박·심박(안정시), 불규칙맥 표시

- 수집: 혈압계·웨어러블 · 존재 조건: any: resting_hr, irregular_pulse
- 필수(●): —
- 보조(○): ELEVATED, PREHTN, HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, MORNING, NOCTURNAL_SCREEN

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `resting_hr` | int | bpm | 20~250 |  |
| `irregular_pulse` | bool | — | — |  |

### `symptom_flags` (§3 #8) — 두통·시야장애·흉통·호흡곤란·마비·언어장애·어지럼·실신·야뇨

- 수집: 앱 탭 입력 · 존재 조건: any: headache, visual_disturbance, chest_pain, dyspnea, paralysis, speech_disturbance, dizziness, syncope, nocturia
- 필수(●): HTN_STAGE2_SCREEN, NOCTURNAL_SCREEN
- 보조(○): HTN_SUSPECT, ISH, MORNING, RESISTANT_SUSPECT

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `headache` | bool | — | — |  |
| `visual_disturbance` | bool | — | — |  |
| `chest_pain` | bool | — | — |  |
| `dyspnea` | bool | — | — |  |
| `paralysis` | bool | — | — |  |
| `speech_disturbance` | bool | — | — |  |
| `dizziness` | bool | — | — |  |
| `syncope` | bool | — | — |  |
| `nocturia` | bool | — | — |  |

### `age_sex` (§3 #9) — 생년월일(만 나이), 성별

- 수집: 가입 · 존재 조건: all: sex / any: birth_date, age
- 필수(●): ELEVATED, PREHTN, HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, NOCTURNAL_SCREEN, RESISTANT_SUSPECT
- 보조(○): —

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `birth_date` | date | — | — | 만 나이 계산은 연령 기준(D-05)이 정해질 때 구현 |
| `age` | int | years | 0~120 | birth_date 없을 때 대체 |
| `sex` | enum | — | M, F |  |

### `height_weight_waist` (§3 #10) — 키, 체중, 허리둘레

- 수집: 수기 / 체중계 · 존재 조건: all: height_cm, weight_kg, waist_cm
- 필수(●): PREHTN, HTN_SUSPECT
- 보조(○): ELEVATED, HTN_STAGE2_SCREEN, ISH, MASKED, NOCTURNAL_SCREEN, RESISTANT_SUSPECT

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `height_cm` | float | cm | 100~250 |  |
| `weight_kg` | float | kg | 20~300 |  |
| `waist_cm` | float | cm | 40~200 |  |

### `medication` (§3 #11) — 치료 상태 코드(1 진단 없음, 2 진단·미치료, 3 약 복용 중), 약 이름·복용 시각, 이뇨제 포함 3제 이상 여부

- 수집: 온보딩 + 복약 등록 · 존재 조건: all: status
- 필수(●): HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, NOCTURNAL_SCREEN, RESISTANT_SUSPECT
- 보조(○): ELEVATED, PREHTN

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `status` | enum | — | 1, 2, 3 |  |
| `drugs` | list | — | — | 항목 {'name': 'str', 'dose_time': 'time'}. 복약 등록 목록 |
| `triple_with_diuretic` | bool | — | — | 이뇨제 포함 3제 이상. RESISTANT_SUSPECT 에서 필수 하위 필드 |

### `smoking_alcohol` (§3 #12) — 흡연(현재/과거/비흡연), 음주(주당 횟수·1회 잔 수·폭음)

- 수집: 문항 · 존재 조건: all: smoking, alcohol_per_week
- 필수(●): PREHTN, HTN_SUSPECT, MASKED, MORNING, RESISTANT_SUSPECT
- 보조(○): ELEVATED, HTN_STAGE2_SCREEN, NOCTURNAL_SCREEN

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `smoking` | enum | — | current, former, never |  |
| `alcohol_per_week` | int | times/week | 0~30 |  |
| `drinks_per_occasion` | float | drinks | 0~50 |  |
| `binge` | bool | — | — |  |

### `sleep_snoring` (§3 #13) — 취침·기상 시각, 수면시간, 코골이·주간졸림·야뇨

- 수집: 웨어러블 + 문항 · 존재 조건: all: snoring, daytime_sleepiness, nocturia
- 필수(●): MORNING, NOCTURNAL_SCREEN, RESISTANT_SUSPECT
- 보조(○): PREHTN, HTN_SUSPECT, MASKED

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `bedtime` | time | — | — |  |
| `wake_time` | time | — | — |  |
| `sleep_hours` | float | h | 0~24 |  |
| `snoring` | bool | — | — |  |
| `daytime_sleepiness` | bool | — | — |  |
| `nocturia` | bool | — | — |  |

### `diet_sodium` (§3 #14) — 식단 사진(국·찌개·가공식품), 짜게 먹는 습관, 외식 빈도

- 수집: 식단 사진 + 문항 · 존재 조건: all: salty_habit
- 필수(●): PREHTN, HTN_SUSPECT, RESISTANT_SUSPECT
- 보조(○): ELEVATED, HTN_STAGE2_SCREEN, ISH, MORNING, NOCTURNAL_SCREEN

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `salty_habit` | bool | — | — |  |
| `eating_out_per_week` | int | times/week | 0~30 |  |
| `photo_soup_stew` | bool | — | — | 식단 사진 분류 결과(선택) |
| `photo_processed` | bool | — | — |  |

### `activity` (§3 #15) — 주당 중강도 분, 걸음 수, 좌식 시간

- 수집: 자동 수집 · 존재 조건: any: moderate_min_per_week, steps_per_day, sedentary_hours
- 필수(●): PREHTN, HTN_SUSPECT
- 보조(○): ELEVATED, ISH, RESISTANT_SUSPECT

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `moderate_min_per_week` | int | min/week | 0~10080 |  |
| `steps_per_day` | int | steps/day | 0~100000 |  |
| `sedentary_hours` | float | h/day | 0~24 |  |

### `lab_glucose_lipid` (§3 #16) — 공복혈당, HbA1c, 총콜레스테롤, TG, HDL, LDL

- 수집: 검진 결과 입력 · 존재 조건: any: fpg, hba1c, tc, tg, hdl, ldl
- 필수(●): —
- 보조(○): PREHTN, HTN_SUSPECT, HTN_STAGE2_SCREEN, RESISTANT_SUSPECT
- 역할: 당뇨 동반 확인 시 목표 혈압 필드만 130/80 으로 전환 (확인 기준은 D-06)

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `fpg` | float | mg/dL | 20~1000 |  |
| `hba1c` | float | % | 2~20 |  |
| `tc` | float | mg/dL | 50~1000 |  |
| `tg` | float | mg/dL | 10~5000 |  |
| `hdl` | float | mg/dL | 5~300 |  |
| `ldl` | float | mg/dL | 5~800 |  |
| `date` | date | — | — |  |

### `lab_kidney` (§3 #17) — 크레아티닌, 요단백

- 수집: 검진 결과 입력 · 존재 조건: any: creatinine, urine_protein
- 필수(●): RESISTANT_SUSPECT
- 보조(○): HTN_SUSPECT, HTN_STAGE2_SCREEN, NOCTURNAL_SCREEN
- 역할: CKD 동반 확인 시 목표 혈압 필드만 130/80 으로 전환 (확인 기준은 D-06)

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `creatinine` | float | mg/dL | 0.1~30 |  |
| `urine_protein` | enum | — | negative, trace, 1+, 2+, 3+, 4+ |  |
| `date` | date | — | — |  |

### `family_history` (§3 #19) — 부모·형제 고혈압·뇌졸중·심근경색, 본인 발병 연령

- 수집: 온보딩 · 존재 조건: all: htn
- 필수(●): PREHTN, HTN_SUSPECT
- 보조(○): ELEVATED, HTN_STAGE2_SCREEN

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `htn` | bool | — | — | 부모·형제 고혈압 |
| `stroke` | bool | — | — |  |
| `mi` | bool | — | — |  |
| `own_onset_age` | int | years | 0~120 |  |

### `clinical_exam` (§3 #20) — 심전도·심초음파·안저 (앱 불가, 보조)

- 수집: 의료기관 · 존재 조건: any: ecg, echo, fundus
- 필수(●): —
- 보조(○): HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, RESISTANT_SUSPECT

| 필드 | 타입 | 단위 | 범위(임시, D-10) / 허용값 | 비고 |
|---|---|---|---|---|
| `ecg` | str | — | — |  |
| `echo` | str | — | — |  |
| `fundus` | str | — | — |  |


## 3. 응답

### 3.1 최상위

| 필드 | 타입 | 의미 |
|---|---|---|
| `module` | str | `"M2"` |
| `contract_version` / `thresholds_version` | str | 계약·임계값 버전 |
| `subject_id` | str | 요청 echo |
| `as_of` | date str \| null | 인자 또는 요청의 `as_of` |
| `data_quality` | `ok` \| `out_of_range` \| `invalid` | `ok` 가 아니면 `states` 는 전부 `not_evaluated` |
| `violations` | list | `{variable, field, kind, value, detail}`. `kind` 는 `out_of_range` \| `invalid` |
| `presence` | {변수명: bool} | 변수가 "있다"로 판정됐는지 (존재 조건은 2.3) |
| `m1_bp_step` | `{step, step_date}` | 요청 echo |
| `guard` | `{triggered: null, pending_m1_field: "guard_flag"}` | §2 가드는 M1 플래그 정의 후 연결. 지금은 항상 `null` |
| `target_bp` | `{sbp, dbp, diabetes, ckd, basis}` | 동반질환 확인 시 130/80. 기준 미정(D-06)이라 지금은 전부 `null` |
| `states` | {상태코드: 상태 결과} | 10개 고정 순서 (3.2) |
| `implemented_states` | list | `["ELEVATED","PREHTN","HTN_SUSPECT","NOCTURNAL_SCREEN"]` |
| `pending_m1_states` | list | 나머지 6개 |
| `display_priority` | null | 동시 판정 우선순위 미정(D-20). 호출자가 정렬하지 않는다면 그대로 표시 |

### 3.2 상태 결과 (`states[CODE]`)

| 필드 | 타입 | 의미 |
|---|---|---|
| `status` | enum | 3.3 |
| `evidence` | dict | 근거 숫자·코드. 상태별 키는 3.4. 항상 `step` 포함 |
| `missing_required` | list[str] | 빠진 필수 항목. 변수명(`age_sex`), 하위 필드(`medication.triple_with_diuretic`), M1 대기 필드(`m1_bp_step.<field>`) 세 형태 |
| `auxiliary_present` | list[str] | 존재하는 보조 변수 이름(판정에는 영향 없음) |
| `notes` | list[str] | 고정 어휘 코드. 3.5 |

상태 코드 순서: `ELEVATED, PREHTN, HTN_SUSPECT, HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, NOCTURNAL_SCREEN, RESISTANT_SUSPECT`

### 3.3 `status`

| 값 | 뜻 | 호출자가 할 일 |
|---|---|---|
| `positive` | 규칙 충족 | 상태 카드 표시 |
| `negative` | 평가했고 미충족 | 표시 없음 |
| `not_evaluable` | 결론 불가. `missing_required` 가 사유 | 접두사 `m1_bp_step.` 이면 사용자 입력으로 해소되지 않음(M1 대기). 그 외는 해당 변수 입력 유도 |
| `not_applicable` | 적용 대상 아님(약 복용자의 WHITE_COAT·MASKED) | 표시 없음 |
| `not_evaluated` | 입력 거부(`data_quality ≠ ok`)로 평가 안 함 | `violations` 확인 후 재요청 |

### 3.4 상태별 `evidence` 키

| 상태 | 키 |
|---|---|
| ELEVATED | `step`, `target_step`(="elevated") |
| PREHTN | `step`, `target_step`(="prehtn"), `risk_factors[]`, `n_risk_factors`, `risk_factors_pending[]`, `bmi`, `waist_cm`, `moderate_min_per_week` |
| HTN_SUSPECT | `step`, `target_step`(="htn"), `medication_status` |
| HTN_STAGE2_SCREEN | `step` |
| ISH | `step` |
| WHITE_COAT / MASKED | `step`, `medication_status` |
| MORNING | `step`, `medication_status` |
| NOCTURNAL_SCREEN | `step`, `symptoms{snoring, daytime_sleepiness, nocturia}`, `n_symptoms`, `symptoms_ge_min`, `abpm_used`(=false) |
| RESISTANT_SUSPECT | `step`, `medication_status`, `on_treatment`, `triple_with_diuretic`, `n_drugs`, `min_drugs`(=3), `not_a_substitute_for_medication`(=true) |

`risk_factors` 어휘: `smoking_current`, `binge_drinking`, `high_sodium_habit`, `sodium_photo_flag`, `family_history`, (기준 확정 후) `bmi_high`, `waist_high`, `low_activity`. `risk_factors_pending` 어휘: `bmi`, `waist`, `activity`.

### 3.5 `notes` 어휘

| 코드 | 붙는 곳 | 뜻 |
|---|---|---|
| `pending_m1` | M1 필드 대기 결과 전부 | `missing_required` 의 `m1_bp_step.*` 가 오면 해소 |
| `htn_step_includes_medication` | HTN_SUSPECT, 복약자 | M1 htn 이 복약을 포함해 혈압 수준 확정 불가 |
| `evening_branch:pending_m1` | NOCTURNAL_SCREEN, 증상 <2 | 저녁 분기 평가 불가 |
| `risk_factors_listed_not_conditioning` | PREHTN | 위험인자는 목록일 뿐 판정 조건이 아님 |

### 3.6 상태별 결론 규칙 요약

| 상태 | positive | negative | not_evaluable (M1 대기) | not_applicable |
|---|---|---|---|---|
| ELEVATED | step=elevated | 그 외 | — | — |
| PREHTN | step=prehtn | 그 외 | — | — |
| HTN_SUSPECT | 복약 1·2 & step=htn | 복약 1·2 & step≠htn | 복약 3 → `bp_level_step` | — |
| HTN_STAGE2_SCREEN | — | — | 항상 → `stage2_flag` | — |
| ISH | — | — | 항상 → `ish_flag` | — |
| WHITE_COAT | — | — | 복약 1·2 → `office_step` | 복약 3 |
| MASKED | — | — | 복약 1·2 → `office_step` | 복약 3 |
| MORNING | — | — | 항상 → `morning_step`, `evening_step` | — |
| NOCTURNAL_SCREEN | 수면 증상 ≥2 | — | 증상 <2 → `evening_step` | — |
| RESISTANT_SUSPECT | — | 복약 1·2, 또는 복약 3 & 3제 이뇨제=false | 복약 3 & 3제 이뇨제=true → `bp_level_step`; 3제 여부 결측 → `medication.triple_with_diuretic` | — |

모든 상태는 그 전에 필수 변수가 빠지면 `not_evaluable`(빠진 변수명)이다. 필수 목록은 2.3 의 "필수(●)".

## 4. 예시

### 4.1 요청 — PREHTN (진단·미치료, 위험인자 3)

```json
{
  "subject_id": "U-004",
  "as_of": "2026-10-21",
  "m1_bp_step": {
    "step": "prehtn",
    "step_date": null
  },
  "pulse_hr": {
    "resting_hr": 70,
    "irregular_pulse": false
  },
  "symptom_flags": {
    "headache": false,
    "visual_disturbance": false,
    "chest_pain": false,
    "dyspnea": false,
    "paralysis": false,
    "speech_disturbance": false,
    "dizziness": false,
    "syncope": false,
    "nocturia": false
  },
  "age_sex": {
    "age": 55,
    "sex": "F"
  },
  "height_weight_waist": {
    "height_cm": 170,
    "weight_kg": 65,
    "waist_cm": 80
  },
  "medication": {
    "status": 2,
    "drugs": [],
    "triple_with_diuretic": false
  },
  "smoking_alcohol": {
    "smoking": "current",
    "alcohol_per_week": 0,
    "drinks_per_occasion": 0,
    "binge": false
  },
  "sleep_snoring": {
    "bedtime": "23:00",
    "wake_time": "06:30",
    "sleep_hours": 7.0,
    "snoring": false,
    "daytime_sleepiness": false,
    "nocturia": false
  },
  "diet_sodium": {
    "salty_habit": true,
    "eating_out_per_week": 2
  },
  "activity": {
    "moderate_min_per_week": 150,
    "steps_per_day": 7000,
    "sedentary_hours": 8
  },
  "lab_glucose_lipid": {
    "fpg": 95,
    "hba1c": 5.4,
    "tc": 180,
    "tg": 100,
    "hdl": 55,
    "ldl": 100
  },
  "lab_kidney": {
    "creatinine": 0.9,
    "urine_protein": "negative"
  },
  "family_history": {
    "htn": true,
    "stroke": false,
    "mi": false
  },
  "clinical_exam": null
}
```

### 4.2 응답 — 위 요청

```json
{
  "module": "M2",
  "contract_version": "0.2.0",
  "thresholds_version": "0.2.0",
  "subject_id": "U-004",
  "as_of": "2026-10-21",
  "data_quality": "ok",
  "violations": [],
  "presence": {
    "m1_bp_step": true,
    "pulse_hr": true,
    "symptom_flags": true,
    "age_sex": true,
    "height_weight_waist": true,
    "medication": true,
    "smoking_alcohol": true,
    "sleep_snoring": true,
    "diet_sodium": true,
    "activity": true,
    "lab_glucose_lipid": true,
    "lab_kidney": true,
    "family_history": true,
    "clinical_exam": false
  },
  "m1_bp_step": {
    "step": "prehtn",
    "step_date": null
  },
  "guard": {
    "triggered": null,
    "pending_m1_field": "guard_flag"
  },
  "target_bp": {
    "sbp": null,
    "dbp": null,
    "diabetes": null,
    "ckd": null,
    "basis": null
  },
  "states": {
    "ELEVATED": {
      "status": "negative",
      "evidence": {
        "step": "prehtn",
        "target_step": "elevated"
      },
      "missing_required": [],
      "auxiliary_present": [
        "pulse_hr",
        "height_weight_waist",
        "medication",
        "smoking_alcohol",
        "diet_sodium",
        "activity",
        "family_history"
      ],
      "notes": []
    },
    "PREHTN": {
      "status": "positive",
      "evidence": {
        "step": "prehtn",
        "target_step": "prehtn",
        "risk_factors": [
          "smoking_current",
          "high_sodium_habit",
          "family_history"
        ],
        "n_risk_factors": 3,
        "risk_factors_pending": [
          "bmi",
          "waist",
          "activity"
        ],
        "bmi": 22.5,
        "waist_cm": 80.0,
        "moderate_min_per_week": 150
      },
      "missing_required": [],
      "auxiliary_present": [
        "pulse_hr",
        "medication",
        "sleep_snoring",
        "lab_glucose_lipid"
      ],
      "notes": [
        "risk_factors_listed_not_conditioning"
      ]
    },
    "HTN_SUSPECT": {
      "status": "negative",
      "evidence": {
        "step": "prehtn",
        "target_step": "htn",
        "medication_status": 2
      },
      "missing_required": [],
      "auxiliary_present": [
        "pulse_hr",
        "symptom_flags",
        "sleep_snoring",
        "lab_glucose_lipid",
        "lab_kidney"
      ],
      "notes": []
    },
    "HTN_STAGE2_SCREEN": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn"
      },
      "missing_required": [
        "m1_bp_step.stage2_flag"
      ],
      "auxiliary_present": [
        "pulse_hr",
        "height_weight_waist",
        "smoking_alcohol",
        "diet_sodium",
        "lab_glucose_lipid",
        "lab_kidney",
        "family_history"
      ],
      "notes": [
        "pending_m1"
      ]
    },
    "ISH": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn"
      },
      "missing_required": [
        "m1_bp_step.ish_flag"
      ],
      "auxiliary_present": [
        "pulse_hr",
        "symptom_flags",
        "height_weight_waist",
        "diet_sodium",
        "activity"
      ],
      "notes": [
        "pending_m1"
      ]
    },
    "WHITE_COAT": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn",
        "medication_status": 2
      },
      "missing_required": [
        "m1_bp_step.office_step"
      ],
      "auxiliary_present": [],
      "notes": [
        "pending_m1"
      ]
    },
    "MASKED": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn",
        "medication_status": 2
      },
      "missing_required": [
        "m1_bp_step.office_step"
      ],
      "auxiliary_present": [
        "height_weight_waist",
        "sleep_snoring"
      ],
      "notes": [
        "pending_m1"
      ]
    },
    "MORNING": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn",
        "medication_status": 2
      },
      "missing_required": [
        "m1_bp_step.morning_step",
        "m1_bp_step.evening_step"
      ],
      "auxiliary_present": [
        "pulse_hr",
        "symptom_flags",
        "diet_sodium"
      ],
      "notes": [
        "pending_m1"
      ]
    },
    "NOCTURNAL_SCREEN": {
      "status": "not_evaluable",
      "evidence": {
        "step": "prehtn",
        "symptoms": {
          "snoring": false,
          "daytime_sleepiness": false,
          "nocturia": false
        },
        "n_symptoms": 0,
        "symptoms_ge_min": false,
        "abpm_used": false
      },
      "missing_required": [
        "m1_bp_step.evening_step"
      ],
      "auxiliary_present": [
        "pulse_hr",
        "height_weight_waist",
        "smoking_alcohol",
        "diet_sodium",
        "lab_kidney"
      ],
      "notes": [
        "evening_branch:pending_m1",
        "pending_m1"
      ]
    },
    "RESISTANT_SUSPECT": {
      "status": "negative",
      "evidence": {
        "step": "prehtn",
        "medication_status": 2,
        "on_treatment": false,
        "triple_with_diuretic": false,
        "n_drugs": 0,
        "min_drugs": 3,
        "not_a_substitute_for_medication": true
      },
      "missing_required": [],
      "auxiliary_present": [
        "symptom_flags",
        "height_weight_waist",
        "activity",
        "lab_glucose_lipid"
      ],
      "notes": []
    }
  },
  "implemented_states": [
    "ELEVATED",
    "PREHTN",
    "HTN_SUSPECT",
    "NOCTURNAL_SCREEN"
  ],
  "pending_m1_states": [
    "HTN_STAGE2_SCREEN",
    "ISH",
    "WHITE_COAT",
    "MASKED",
    "MORNING",
    "RESISTANT_SUSPECT"
  ],
  "display_priority": null
}
```

### 4.3 응답 일부 — 약 복용자 + step=htn + 수면 증상 2 (M1 대기·not_applicable·positive 가 섞인 경우)

```json
{
  "subject_id": "U-002",
  "m1_bp_step": {
    "step": "htn",
    "step_date": null
  },
  "states": {
    "HTN_SUSPECT": {
      "status": "not_evaluable",
      "evidence": {
        "step": "htn",
        "target_step": "htn",
        "medication_status": 3
      },
      "missing_required": [
        "m1_bp_step.bp_level_step"
      ],
      "auxiliary_present": [
        "pulse_hr",
        "symptom_flags",
        "sleep_snoring",
        "lab_glucose_lipid",
        "lab_kidney"
      ],
      "notes": [
        "htn_step_includes_medication",
        "pending_m1"
      ]
    },
    "WHITE_COAT": {
      "status": "not_applicable",
      "evidence": {
        "step": "htn",
        "medication_status": 3
      },
      "missing_required": [],
      "auxiliary_present": [],
      "notes": []
    },
    "NOCTURNAL_SCREEN": {
      "status": "positive",
      "evidence": {
        "step": "htn",
        "symptoms": {
          "snoring": true,
          "daytime_sleepiness": true,
          "nocturia": false
        },
        "n_symptoms": 2,
        "symptoms_ge_min": true,
        "abpm_used": false
      },
      "missing_required": [],
      "auxiliary_present": [
        "pulse_hr",
        "height_weight_waist",
        "smoking_alcohol",
        "diet_sodium",
        "lab_kidney"
      ],
      "notes": []
    },
    "RESISTANT_SUSPECT": {
      "status": "negative",
      "evidence": {
        "step": "htn",
        "medication_status": 3,
        "on_treatment": true,
        "triple_with_diuretic": false,
        "n_drugs": 1,
        "min_drugs": 3,
        "not_a_substitute_for_medication": true
      },
      "missing_required": [],
      "auxiliary_present": [
        "symptom_flags",
        "height_weight_waist",
        "activity",
        "lab_glucose_lipid"
      ],
      "notes": []
    }
  },
  "...": "나머지 상태 생략"
}
```

### 4.4 응답 — 거부 (체중 범위 밖 + step 형식 오류)

```json
{
  "subject_id": "U-003",
  "data_quality": "out_of_range",
  "violations": [
    {
      "variable": "m1_bp_step",
      "field": "step",
      "kind": "invalid",
      "value": "PREHTN",
      "detail": "enum value 'PREHTN' not in ['normal', 'elevated', 'prehtn', 'htn']"
    },
    {
      "variable": "height_weight_waist",
      "field": "weight_kg",
      "kind": "out_of_range",
      "value": 999.0,
      "detail": "range [20, 300]"
    }
  ],
  "m1_bp_step": {
    "step": null,
    "step_date": null
  },
  "target_bp": null,
  "states": {
    "ELEVATED": {
      "status": "not_evaluated",
      "evidence": {
        "reason": "data_rejected"
      },
      "missing_required": [],
      "auxiliary_present": [],
      "notes": []
    },
    "...": "10개 모두 같은 형태(not_evaluated)"
  }
}
```

## 5. 보장과 금지

- 응답에는 상태 코드, 숫자, 불리언, 변수·필드 이름만 있다. 한글·문구 없음(비ASCII 금지 테스트). "진단", "고혈압입니다", "발병 확률"은 쓰지 않는다.
- 입력을 변경하거나 보관하지 않는다. 로그에는 subject_id, data_quality, 위반 수, step, positive 상태 코드만 남긴다.
- 같은 입력·같은 버전이면 같은 출력.
- pending_m1 필드(2.3 의 `m1_bp_step`)는 지금 보내도 검증만 하고 규칙은 쓰지 않는다. 켜지면 `contract_version` 이 오른다.

## 6. 평탄 표 입력 (배치)

- 한 행 = 사용자 한 명. 컬럼명 `<변수>__<필드>` (예: `m1_bp_step__step`, `age_sex__sex`). 행 키 `subject_id`, 선택 `as_of`.
- `medication__drugs` 는 JSON 문자열(`[{"name": "...", "dose_time": "08:00"}]`).
- 같은 subject 행이 여러 개면 첫 비결측값을 쓴다.
- 실제 컬럼이 다르면 `--aliases` JSON(`{"실제컬럼": "계약컬럼"}`)으로 매핑한다. 기대 컬럼 목록은 `feature_contract.expected_columns()`.

## 7. 변경 이력

| 버전 | 내용 |
|---|---|
| 0.2.0 (2026-10-21) | M1 step 기반으로 전환. 혈압 원시값 변수 제거, `m1_bp_step` 추가, pending_m1 필드 7개 |
| 0.1.0 | 가정혈압 원시값 기반 (보관) |

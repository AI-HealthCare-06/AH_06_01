# M1-S API 명세 (초안 v0.1, 2026-10-21)

상태: **검토용 초안**. 서버 구현은 이 패키지에 없고, 백엔드가 `m1.predict.M1Predictor.predict(dict)` 를 감싸는 형태를 전제로 한다.
엔드포인트 위치(별도 vs 기존 `/predictions/htn-risk` 확장)와 형식(OpenAPI yaml 전환)은 결정 사항.

## 1. 엔드포인트

| 항목 | 값 |
|---|---|
| 메서드·경로 | `POST /predictions/bp-stage` (안 A: 별도) · 안 B: `POST /predictions/htn-risk` 응답에 `bp_stage` 객체로 포함 |
| 요청 본문 | `application/json`, 사용자 한 명의 생활습관·신체 변수 |
| 응답 | `200` + JSON (아래 3절). 입력이 규약을 벗어나도 **200 으로 `data_quality` 로 알린다**(도메인 거부). `400` 은 JSON 자체가 깨졌거나 타입이 맞지 않을 때만 |
| 상태 | 무상태. 아티팩트는 프로세스 시작 시 1회 로드 |
| 지연 | 단건 p95 ≤ 20 ms 기준, 현재 1~2 ms(모델 계산 기준, 네트워크 제외) |
| 로그 | 입력값·개인 식별자를 남기지 않는다. 출력에 "진단"·"발병 확률"·"고혈압입니다" 류 문구 금지(명세 1절) |

## 2. 요청 스키마

키는 대소문자 무시. 모르는 키는 무시한다. 단위·범위를 벗어나면 클리핑하지 않고 `out_of_range` 로 거부한다.

### 2-1. 필수

| 필드 | 타입 | 단위·범위 | 비고 |
|---|---|---|---|
| `age` | integer | 19~90 세 | 만 나이 |
| `sex` | string | `male` / `female` | 별칭 허용: m, f, 남, 여, 남성, 여성, 1(남), 2(여) |
| `bmi` | number | 14~50 kg/m² | 없으면 `height_cm`(cm) + `weight_kg`(kg) 로 산출 |

### 2-2. 선택 (없으면 대치하고 `data_quality = partial`)

| 필드 | 타입 | 단위·범위 | 결측 처리 | 대체 원시 입력 |
|---|---|---|---|---|
| `waist_cm` | number | 50~150 cm | 성별×BMI 구간 중앙값 | — |
| `alcohol_week` | number | 0~60 표준잔/주 | 0 | `alcohol_freq_per_week` × `alcohol_drinks_per_occasion` |
| `alcohol_per_day` | boolean | 하루 평균 2잔 초과 | false | `alcohol_week`/7 > 2 |
| `binge` | boolean | 1회 남 7잔/여 5잔 이상 월 1회 이상 | false | `binge_freq_per_month` ≥ 1 |
| `activity_minutes_week` | integer | 0~2000 분/주 | 중앙값 | `moderate_min_week` + 2×`vigorous_min_week` + `walk_min_week` |
| `activity_low_flag` | boolean | <150분/주 | **true**(결측이면 활동 부족으로 간주, 명세) | `activity_minutes_week` 에서 산출 |
| `family_htn` | boolean | 부모·형제 고혈압 | false | `family_htn_father` / `_mother` / `_sibling` |
| `sleep_short_flag` | boolean | 평균 수면 <6h | false | `sleep_hours` |
| `diabetes_flag` | boolean | 진단·약·공복혈당 ≥126·HbA1c ≥6.5 | false | `dm_dx`, `dm_med`, `fasting_glucose`, `hba1c` |
| `fasting_glucose` | number | mg/dL (범위 미정의) | 중앙값 | — |
| `resting_hr` | integer | bpm (범위 미정의) | 중앙값 | — |
| `education_years` | integer | 년 (범위 미정의) | 중앙값 | — |
| `smoking` | string | never / former / current | never | 현재 모델은 사용하지 않음(데이터에 없어 변형 생략) |
| `stress_score` | integer | 1~4 | 중앙값 | 위와 같음 |

불리언 별칭: `true/false`, `1/0`, `yes/no`, `예/아니오`, `있음/없음`.

### 2-3. 보내면 안 되는 것 (보내면 `not_applicable`)

| 키 패턴 | 이유 |
|---|---|
| `sbp`, `dbp`, `systolic`, `diastolic`, `blood_pressure`, `*_bp`, `혈압` 등에 값이 있을 때 | 혈압을 아는 사용자는 M1-S 대상이 아님(M3/판정 트리로) |
| `htn_med` = true | 항고혈압제 복용자는 정의상 htn 단계 |

### 2-4. 요청 예시

```json
{
  "age": 52, "sex": "male", "bmi": 27.5, "waist_cm": 95,
  "alcohol_week": 21, "binge": true, "activity_minutes_week": 60,
  "family_htn": true, "sleep_short_flag": true, "diabetes_flag": false,
  "fasting_glucose": 102, "resting_hr": 78, "education_years": 12
}
```

## 3. 응답 스키마

| 필드 | 타입 | 뜻 | null 조건 |
|---|---|---|---|
| `stage_probs` | object | `{normal, elevated, prehtn, htn}` 보정 확률, 소수 4자리, 합 1 | 거부·대상 아님 |
| `stage_top` | string | 판정 규칙이 고른 단계 (`normal`/`elevated`/`prehtn`/`htn`) | 위와 같음 |
| `risk_level` | string | 4단계(= stage_top). 템플릿 분기용 | 위와 같음 |
| `reason_codes` | string[] | 고정 어휘 8개 중 조건 충족 코드, 기여도 큰 순. 대치된 값에는 붙지 않음 | 빈 배열 |
| `data_quality` | string | `ok` / `partial` / `insufficient` / `out_of_range` / `not_applicable` | 항상 |
| `problems` | string | 거부 사유 코드(`;` 구분). 예: `age_out_of_range`, `bmi_missing`, `missing_count_high`, `bp_input_present:sbp,dbp`, `htn_med_true` | 사유 없으면 생략 |
| `model_version` | string | `M1-<run>-<후보>__<변형>` | 항상 |
| `feature_version` | string | 피처 계약 버전 (현재 `1.2.0`) | 항상 |

### 3-1. data_quality 의미와 동작

| 값 | 조건 | 확률·단계 | 템플릿 처리 |
|---|---|---|---|
| `ok` | 모든 사용 변수가 입력됨 | 있음 | 정상 표시 |
| `partial` | 선택 변수 일부를 대치함 | 있음 | 정상 표시 + "입력하면 더 정확" 류 안내 가능. 대치된 변수의 이유 코드는 나오지 않음 |
| `insufficient` | age·sex·bmi 결측, 또는 대치 플래그 5개 이상 | 없음 | 추가 입력 요청 |
| `out_of_range` | 범위 밖 값 | 없음 | 입력 확인 요청(`problems` 에 어느 변수인지) |
| `not_applicable` | 혈압값 입력 또는 복약 | 없음 | 혈압 기반 경로(M3·판정 트리)로 |

### 3-2. reason_codes 어휘 (고정)

| 코드 | 조건 | 근거 |
|---|---|---|
| `bmi_high` | BMI ≥ 23 | WHO 2004 아시아 행동점 |
| `waist_high` | 남 ≥90 / 여 ≥85 cm | 대한비만학회 2022 |
| `age` | 남 ≥39 / 여 ≥50 세 | 학습 데이터 Youden 경계 |
| `alcohol_high` | 남 ≥1.25 / 여 ≥1.75 잔/일, 또는 폭음 | 학습 데이터 Youden 경계 + 질병관리청 폭음 정의 |
| `activity_low` | <150 분/주 | Liu 2017, Park 2023 |
| `sleep_short` | <6 시간 | Qi 2025, Yadav 2017 |
| `family_htn` | 부모·형제 고혈압 | Takase 2025, Lim 2013 |
| `diabetes` | 당뇨 플래그 | Ahn 2021 |

### 3-3. 응답 예시

정상(`ok`):
```json
{
  "stage_probs": {"normal": 0.1744, "elevated": 0.0901, "prehtn": 0.4187, "htn": 0.3168},
  "stage_top": "prehtn", "risk_level": "prehtn",
  "reason_codes": ["alcohol_high", "family_htn", "bmi_high", "age", "waist_high", "sleep_short", "activity_low"],
  "data_quality": "ok",
  "model_version": "M1-20261020_150607-nested__base", "feature_version": "1.2.0"
}
```

대치 있음(`partial`, waist_cm 없이 보냄):
```json
{
  "stage_probs": {"normal": 0.1775, "elevated": 0.0898, "prehtn": 0.4160, "htn": 0.3168},
  "stage_top": "prehtn", "risk_level": "prehtn",
  "reason_codes": ["alcohol_high", "family_htn", "bmi_high", "age", "sleep_short", "activity_low"],
  "data_quality": "partial",
  "model_version": "M1-20261020_150607-nested__base", "feature_version": "1.2.0"
}
```

거부(`out_of_range`, age 95):
```json
{
  "stage_probs": null, "stage_top": null, "risk_level": null, "reason_codes": [],
  "data_quality": "out_of_range", "problems": "age_out_of_range",
  "model_version": "M1-20261020_150607-nested__base", "feature_version": "1.2.0"
}
```

대상 아님(`not_applicable`, sbp 128 포함):
```json
{
  "stage_probs": null, "stage_top": null, "risk_level": null, "reason_codes": [],
  "data_quality": "not_applicable", "problems": "bp_input_present:sbp",
  "model_version": "M1-20261020_150607-nested__base", "feature_version": "1.2.0"
}
```

## 4. 배치 (선택)

| 항목 | 값 |
|---|---|
| 경로 | `POST /predictions/bp-stage/batch` 또는 오프라인 `predict_cli.py --data <파일>` |
| 입력 | 행 배열(같은 스키마) 또는 엑셀/CSV |
| 출력 | 행마다 3절 응답 + `person_id`. 오프라인은 `step_filled.xlsx`(person_id + step), `predictions.xlsx`(상세) |

## 5. 버전·구성

| 항목 | 위치 | 바뀌면 |
|---|---|---|
| 피처 계약 | `feature_contract.yaml` → `feature_version` | 요청 스키마 변경 → API 버전도 올림 |
| 모델 | `artifacts/<run>/` → `model_version` | 확률·단계 분포 변경 |
| 단계 판정 규칙·τ | `m1/decision.py`, 모델 meta `stage_thresholds` | `stage_top`/`risk_level` 변경(확률은 그대로) |
| 이유 코드 경계 | `thresholds.py` (REASON_RULE, AGE_HIGH_YEARS, ALCOHOL_HIGH_DRINKS_PER_DAY, BMI_HIGH, WAIST_HIGH_CM) | `reason_codes` 변경 |

규칙·경계 변경은 재학습 없이 적용되므로 응답에 `rule_version`(예: `cumulative/accuracy`)을 추가할지 결정 필요.

## 6. 결정이 필요한 항목

1. 안 A(별도 엔드포인트) vs 안 B(`/predictions/htn-risk` 응답에 `bp_stage` 포함). 기존 M1(B0)의 `risk_index` 와 M1-S 의 `stage_top` 을 한 화면에 같이 쓸지.
2. 도메인 거부를 200 + `data_quality` 로 할지, 422 로 할지.
3. `problems` 필드를 외부 응답에 노출할지(디버그 전용으로 숨길지).
4. `rule_version` 필드 추가 여부.
5. 문서 형식: 이 마크다운 유지 vs OpenAPI yaml.

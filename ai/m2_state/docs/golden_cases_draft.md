# 골든 케이스 20건 초안 (검토 전, v0.2.0 M1 step 기반)

- 상태별 2건. `expected` 는 현재 엔진 출력을 고정한 것이며 검토·확정 전까지 draft.
- 기호: `+` positive, `-` negative, `NE` not_evaluable(필수 결측 또는 M1 필드 대기), `NA` not_applicable, `X` not_evaluated.
- 11 = medication.status (1 진단 없음 / 2 진단·미치료 / 3 약 복용 중). 수면증상 = 코골이·주간졸림·야뇨 개수.
- M1 대기 상태(ST2·ISH·WC·MASK·MORN·RES)는 지금 결정 가능한 부분(복약자 NA, 미복약 RES −)만 내고 나머지는 NE.
- 열 약어: ELEV=ELEVATED, PRE=PREHTN, SUSP=HTN_SUSPECT, ST2=HTN_STAGE2_SCREEN, WC=WHITE_COAT, MASK=MASKED, MORN=MORNING, NOCT=NOCTURNAL_SCREEN, RES=RESISTANT_SUSPECT

| ID | 설명 | step | 11 | 수면증상 | ELEV | PRE | SUSP | ST2 | ISH | WC | MASK | MORN | NOCT | RES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01_ELEVATED_a | step=elevated, 진단 없음, 42세 남 | elevated | 1 | 0 | + | - | - | NE | NE | NE | NE | NE | NE | - |
| G02_ELEVATED_b | step=elevated, 진단·미치료, 60세 여, 위험인자 있어도 ELEVATED 는 step 만 봄 | elevated | 2 | 0 | + | - | - | NE | NE | NE | NE | NE | NE | - |
| G03_PREHTN_a | step=prehtn, 진단 없음, 위험인자 3(현재흡연·짠식습관·가족력) | prehtn | 1 | 0 | - | + | - | NE | NE | NE | NE | NE | NE | - |
| G04_PREHTN_b | step=prehtn, 진단·미치료, 위험인자 0 | prehtn | 2 | 0 | - | + | - | NE | NE | NE | NE | NE | NE | - |
| G05_HTN_SUSPECT_a | step=htn, 진단 없음(미치료) → positive | htn | 1 | 0 | - | - | + | NE | NE | NE | NE | NE | NE | - |
| G06_HTN_SUSPECT_b | step=htn, 약 복용 중 → htn 이 복약 포함이라 bp_level_step 대기 | htn | 3 | 0 | - | - | NE | NE | NE | NA | NA | NE | NE | - |
| G07_HTN_STAGE2_SCREEN_a | step=htn, 미치료, 증상 문항 있음 → stage2_flag 대기 | htn | 1 | 0 | - | - | + | NE | NE | NE | NE | NE | NE | - |
| G08_HTN_STAGE2_SCREEN_b | step=prehtn, 진단·미치료 → stage2_flag 대기 (step 과 무관) | prehtn | 2 | 0 | - | + | - | NE | NE | NE | NE | NE | NE | - |
| G09_ISH_a | step=htn, 72세 여 미치료 → ish_flag 대기 | htn | 1 | 0 | - | - | + | NE | NE | NE | NE | NE | NE | - |
| G10_ISH_b | step=elevated, 68세 남 → ish_flag 대기 | elevated | 1 | 0 | + | - | - | NE | NE | NE | NE | NE | NE | - |
| G11_WHITE_COAT_a | step=prehtn, 진단 없음 → office_step 대기 | prehtn | 1 | 0 | - | + | - | NE | NE | NE | NE | NE | NE | - |
| G12_WHITE_COAT_b | step=htn, 약 복용 중 → not_applicable | htn | 3 | 0 | - | - | NE | NE | NE | NA | NA | NE | NE | - |
| G13_MASKED_a | step=normal, 진단·미치료 → office_step 대기 | normal | 2 | 0 | - | - | - | NE | NE | NE | NE | NE | NE | - |
| G14_MASKED_b | step=htn, 약 복용 중 → not_applicable | htn | 3 | 0 | - | - | NE | NE | NE | NA | NA | NE | NE | - |
| G15_MORNING_a | step=htn, 미치료 → morning_step·evening_step 대기 | htn | 1 | 0 | - | - | + | NE | NE | NE | NE | NE | NE | - |
| G16_MORNING_b | step=prehtn, 진단·미치료 → 대기 | prehtn | 2 | 0 | - | + | - | NE | NE | NE | NE | NE | NE | - |
| G17_NOCTURNAL_SCREEN_a | step=normal, 코골이+주간졸림 → 증상 분기 positive | normal | 1 | 2 | - | - | - | NE | NE | NE | NE | NE | + | - |
| G18_NOCTURNAL_SCREEN_b | step=htn 미치료, 증상 1(야뇨) → 저녁 분기 대기, HTN_SUSPECT 는 positive | htn | 1 | 1 | - | - | + | NE | NE | NE | NE | NE | NE | - |
| G19_RESISTANT_SUSPECT_a | 약 4제(이뇨제 포함), step=htn → 혈압 조건 bp_level_step 대기 | htn | 3 | 0 | - | - | NE | NE | NE | NA | NA | NE | NE | NE |
| G20_RESISTANT_SUSPECT_b | 약 복용 중이나 3제 이뇨제 아님 → negative (혈압 무관) | htn | 3 | 0 | - | - | NE | NE | NE | NA | NA | NE | NE | - |

## 의도한 상태 ↔ 엔진 출력 대조

불일치 없음 (의도한 상태 전부 엔진 출력과 같음).

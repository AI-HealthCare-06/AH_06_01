"""thresholds.py — M2 A군 임계값·코드 단일 정의 (v0.2.0, M1 step 기반).

경계
- 혈압 분류(7일 평균, 밴드, 가드, 2기 범위, ISH, 아침/저녁/진료실 구분)는 M1 역할이다.
- M2 는 M1 이 준 step(normal / elevated / prehtn / htn)과 생활 데이터만 쓴다.
- M1 step 의 mmHg 기준은 M1 의 정의이므로 이 파일에 적지 않는다(docs/m1_interface.md 참고).

규칙
- 모든 임계값은 이 파일에서만 정의한다. 다른 모듈은 `import thresholds as T` 후 호출 시점에 `T.NAME` 으로 읽는다.
- 값이 None 인 항목은 결정 대기(명세 없음). None 이면 해당 분기는 적용하지 않고 evidence 에 수치만 낸다.
- 결정 항목 번호(D-nn)는 docs/decisions_needed.md 와 같다.
- 근거 약어: KSH2022 = 대한고혈압학회 2022 진료지침, ISH2023, TRIUMPH = Blumenthal 2021
"""
from __future__ import annotations

from typing import Final, Optional

THRESHOLDS_VERSION: Final[str] = "0.2.0"

BP = tuple[int, int]  # (SBP, DBP) mmHg

# ───────────────────────────── M1 step 코드 ─────────────────────────────
STEP_NORMAL: Final[str] = "normal"
STEP_ELEVATED: Final[str] = "elevated"
STEP_PREHTN: Final[str] = "prehtn"
STEP_HTN: Final[str] = "htn"          # M1 정의상 "혈압 ≥기준 또는 항고혈압제 복약" 을 함께 뜻한다
STEPS: Final[tuple[str, ...]] = (STEP_NORMAL, STEP_ELEVATED, STEP_PREHTN, STEP_HTN)

# ───────────────────────────── §4 step 매핑 (구현됨) ─────────────────────────────
ELEVATED_STEP: Final[str] = STEP_ELEVATED        # ELEVATED  ⇐ step = elevated
PREHTN_STEP: Final[str] = STEP_PREHTN            # PREHTN    ⇐ step = prehtn (+ 위험인자 목록)
HTN_SUSPECT_STEP: Final[str] = STEP_HTN          # HTN_SUSPECT ⇐ step = htn, 미치료자(11=1,2)에서만 혈압 의미가 확정됨

# ───────────────────────────── §4 NOCTURNAL_SCREEN (증상 분기, 구현됨) ─────────────────────────────
NOCTURNAL_SYMPTOM_MIN: Final[int] = 2            # 코골이·주간졸림·야뇨 중 2개 이상 → ABPM 권유

# ───────────────────────────── §4 RESISTANT_SUSPECT (TRIUMPH, 혈압 조건은 M1 대기) ─────────────────────────────
RESISTANT_MIN_DRUGS: Final[int] = 3              # 이뇨제 포함 3제 이상 복용 중

# ───────────────────────────── §4 동반질환 시 목표 혈압 ─────────────────────────────
TARGET_BP_COMORBID: Final[BP] = (130, 80)        # 당뇨·CKD 동반 확인 시 목표 혈압 필드만 전환 (KSH2022)
TARGET_BP_DEFAULT: Optional[BP] = None           # 명세 없음 — D-09

# ───────────────────────────── 결정 대기 (None = 미적용) ─────────────────────────────
DIABETES_FPG_MIN: Optional[float] = None         # 16 으로 당뇨 동반 확인 기준. D-06
DIABETES_HBA1C_MIN: Optional[float] = None       # D-06
CKD_CREATININE_MIN: Optional[float] = None       # 17 로 CKD 동반 확인 기준. D-06
CKD_URINE_PROTEIN_MIN: Optional[str] = None      # D-06 (예: "1+")
RISK_BMI_MIN: Optional[float] = None             # PREHTN 위험인자(10) 기준. D-07
RISK_WAIST_CM_MIN_M: Optional[float] = None      # D-07
RISK_WAIST_CM_MIN_F: Optional[float] = None      # D-07
RISK_ACTIVITY_MIN_PER_WEEK_BELOW: Optional[int] = None   # PREHTN 위험인자(15) 기준. D-07

# ───────────────────────────── 코드 상수 (임계값 아님) ─────────────────────────────
MED_NO_DIAGNOSIS: Final[int] = 1          # ① 진단 없음
MED_DIAGNOSED_UNTREATED: Final[int] = 2   # ② 진단·미치료
MED_ON_TREATMENT: Final[int] = 3          # ③ 약 복용 중

STATE_CODES: Final[tuple[str, ...]] = (
    "ELEVATED", "PREHTN", "HTN_SUSPECT", "HTN_STAGE2_SCREEN", "ISH",
    "WHITE_COAT", "MASKED", "MORNING", "NOCTURNAL_SCREEN", "RESISTANT_SUSPECT",
)
# 지금 M1 step 1개 + 생활 데이터로 판정 로직이 있는 상태 / M1 추가 필드를 기다리는 상태
IMPLEMENTED_STATES: Final[tuple[str, ...]] = ("ELEVATED", "PREHTN", "HTN_SUSPECT", "NOCTURNAL_SCREEN")
PENDING_M1_STATES: Final[tuple[str, ...]] = tuple(c for c in STATE_CODES if c not in IMPLEMENTED_STATES)

# 판정 상태 코드
STATUS_POSITIVE: Final[str] = "positive"             # 규칙 충족
STATUS_NEGATIVE: Final[str] = "negative"             # 규칙 평가함, 미충족
STATUS_NOT_EVALUABLE: Final[str] = "not_evaluable"   # 필수 항목 결측 (M1 미제공 필드 포함)
STATUS_NOT_APPLICABLE: Final[str] = "not_applicable" # 적용 대상 아님 (예: 약 복용자에 WHITE_COAT)
STATUS_NOT_EVALUATED: Final[str] = "not_evaluated"   # 입력 거부로 평가 안 함

# 데이터 품질 코드
DQ_OK: Final[str] = "ok"
DQ_OUT_OF_RANGE: Final[str] = "out_of_range"
DQ_INVALID: Final[str] = "invalid"   # 타입·형식 오류 (명세 없음 — D-08)

# 출력·로그 금지 표현 (테스트에서 검사)
FORBIDDEN_OUTPUT_TERMS: Final[tuple[str, ...]] = ("진단", "고혈압입니다", "발병 확률")

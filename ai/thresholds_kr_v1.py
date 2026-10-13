"""thresholds_kr_v1.py — 혈압 관련 임계값 상수 (한국 기준, v1)

모든 임계값은 이 파일 한 곳에서만 정의한다. 라벨 생성(labels.py), 규칙 트리(개발팀),
상식 검증 테스트(tests/test_sanity.py)가 전부 여기를 import 한다.
기준: 대한고혈압학회 2022 진료지침. 〔참고〕 표시는 한국 지침에 수치가 없어
외국 기준을 보조로 쓴 값이며, 10/15 멘토링 확인 항목이다.

값을 바꾸면 THRESHOLDS_VERSION 을 올리고, 예측 스냅샷(predictions 테이블)에
함께 저장되는 feature_version 과 같이 관리한다.
"""
from __future__ import annotations

from dataclasses import dataclass

THRESHOLDS_VERSION = "kr_v1"  # 상수 세트 버전. 바뀌면 올린다.


@dataclass(frozen=True)
class BP:
    """수축기/이완기 한 쌍 (mmHg). frozen → 실수로 덮어쓰지 못하게."""

    sbp: int
    dbp: int


# ── 1. 고혈압 판정 기준 (KSH 2022) ───────────────────────────────────────────
OFFICE_HTN = BP(140, 90)      # 진료실 고혈압. KNHANES 라벨은 반드시 이 값 + 약 복용 여부로만 만든다.
HOME_HTN = BP(135, 85)        # 가정혈압 고혈압 (7일 평균). 앱 규칙 트리의 유일한 공식 가정 기준.
ABPM_24H_HTN = BP(130, 80)    # 24시간 활동혈압 — 앱에서는 판정 불가, 문서용.

# 진료실 분류 (진료실 값 office_sbp/dbp 입력 시에만 사용)
OFFICE_NORMAL_MAX = BP(119, 79)        # 정상: <120 and <80
OFFICE_ELEVATED = (120, 129)           # 주의혈압: SBP 120~129 and DBP <80
OFFICE_PREHTN = (BP(130, 80), BP(139, 89))   # 전단계: 130~139 or 80~89
OFFICE_STAGE1 = (BP(140, 90), BP(159, 99))   # 1기
OFFICE_STAGE2 = BP(160, 100)                 # 2기: ≥160 or ≥100

# 가정혈압 참고 밴드 〔참고〕 — KSH 미명시, JSH 2019 대응값. 화면에 '참고'로 표기.
HOME_BAND_REF_NORMAL_MAX = BP(114, 74)   # 정상권(참고): <115 and <75
HOME_BAND_REF_ELEVATED = BP(115, 75)     # 주의권(참고): 115~124 or 75~79
HOME_BAND_REF_PREHTN = BP(125, 80)       # 전단계권(참고): 125~134 or 80~84

# ── 2. 표현형 ───────────────────────────────────────────────────────────────
ISH_HOME = BP(135, 85)            # 수축기 단독: SBP ≥135 and DBP <85 (가정)
PULSE_PRESSURE_WIDE = 60          # 맥압 ≥60 표시 〔참고〕
MORNING_EVENING_SBP_DIFF = 15     # 아침-저녁 SBP 차이 ≥15 → 아침 고혈압 플래그
RESISTANT_MIN_DRUGS = 3           # 이뇨제 포함 3제 이상에도 ≥135/85 → 저항성 의심
OFFICE_VALUE_MAX_AGE_DAYS = 365   # 백의/가면 판정에 쓰는 진료실 값 유효 기간

# ── 3. 가정혈압 측정 프로토콜 ───────────────────────────────────────────────
WINDOW_DAYS = 7          # 7일 이동 창
MIN_VALID_DAYS = 5       # KSH: 최소 5일
MIN_READINGS = 12        # ESH 보조 기준 〔참고〕: 유효 측정값 12회
READINGS_PER_SESSION = 2 # 아침·저녁 각 2회
DISCARD_FIRST_DAY_NEW_USER = True  # 신규 사용자 첫 7일만 1일차 제외

# ── 4. 응급·저혈압 ─────────────────────────────────────────────────────────
CRISIS = BP(180, 120)             # 고혈압 위기 선별 〔참고 ACC/AHA 2017〕
CRISIS_RECHECK_MINUTES = 5
HYPO = BP(90, 60)                 # 저혈압: 수치 + 증상일 때만 표시
DRUG_HYPO_HOME = BP(110, 70)      # 치료 중 7일 평균 <110/70 + 증상 → 약물성 의심
OH_DROP = BP(20, 10)              # 기립성: 3분 내 SBP ≥20 or DBP ≥10 하강
OH_DROP_TREATED_SBP = 30          # 혈압약 복용자는 SBP ≥30
OH_HR_RISE_NEUROGENIC_MAX = 15    # 심박 상승 <15 → 신경성 의심
POTS_HR_RISE = 30                 # 〔참고〕 기립 10분 내 심박 ≥30
POTS_HR_RISE_TEEN = 40            # 12~19세 ≥40
PPH_SBP_DROP = 20                 # 식후 저혈압 〔참고〕: 식후 2h 내 SBP ≥20 하강
PPH_PRE_MIN_SBP = 100             # 또는 식전 ≥100 → 식후 <90
PPH_POST_MAX_SBP = 90

# ── 5. 목표 혈압 (KSH 2022) ────────────────────────────────────────────────
TARGET_GENERAL = BP(140, 90)      # 일반, 노인, 일반 당뇨, CKD(알부민뇨 없음), 뇌졸중
TARGET_HIGH_RISK = BP(130, 80)    # 심혈관질환, 열공경색, CKD+알부민뇨, 당뇨 고위험, 위험인자 ≥3(고려)
HIGH_RISK_FACTOR_COUNT = 3

# ── 6. 임신·연령·선별 ───────────────────────────────────────────────────────
PREG = BP(140, 90)                # 임신 20주 이후 2회
PREG_SEVERE = BP(160, 110)
PREG_WEEKS_MIN = 20
ADULT_AGE = 18                    # 18세 미만: 성인 트리·모델 미적용
KNHANES_MIN_AGE = 19              # 학습 데이터는 19세 이상
SCREEN_INTERVAL_YEARS_DEFAULT = 2 # 20세 이상 2년마다
SCREEN_INTERVAL_YEARS_HIGH = 1    # 40세 이상·가족력·전단계·비만은 매년

# ── 7. 모델 입력 범위 (Feature Contract v1 과 동일해야 함) ───────────────────
FEATURE_RANGES = {
    "age": (19, 90),
    "bmi": (14.0, 50.0),
    "waist_cm": (50.0, 150.0),
    "alcohol_units_week": (0.0, 60.0),
    "activity_minutes_week": (0, 2000),
    "sleep_avg_h": (3.0, 12.0),
    "sodium_risk_score": (0, 2),
    "stress_score": (1, 4),
}

# 위험 등급 경계 (보정 확률 기준, 임시 — 기획팀과 확정)
RISK_LEVELS = (("low", 0.0), ("moderate", 0.15), ("high", 0.30), ("very_high", 0.50))


def risk_level(p: float) -> str:
    """보정 확률 p(0~1) → 등급 문자열. 경계는 RISK_LEVELS 한 곳에서만 바꾼다."""
    level = RISK_LEVELS[0][0]
    for name, lo in RISK_LEVELS:
        if p >= lo:
            level = name
    return level


def is_office_htn(sbp: float, dbp: float, on_medication: bool) -> bool:
    """KNHANES 라벨 규칙 (T1). 약 복용 중이면 혈압값과 무관하게 1."""
    return bool(on_medication or sbp >= OFFICE_HTN.sbp or dbp >= OFFICE_HTN.dbp)

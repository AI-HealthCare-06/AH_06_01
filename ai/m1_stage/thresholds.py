"""
[파일] thresholds.py
[용도] 혈압 단계 경계, 피처 산출 임계값, 이유 코드 임계값, 위험 등급 경계, 데이터 품질 기준을 상수로 정의한다.
[왜 필요한가] 명세 1절 "임계값은 thresholds.py 한 파일에서만 정의하고 import 한다"를 지키기 위해서다.
             숫자가 여러 파일에 흩어지면 라벨·피처·이유 코드·보고서가 서로 다른 기준을 쓰게 된다.
             근거가 없는 값은 '근거 없음'으로 표시해 사용자 결정 대기 목록에 올린다.
[쓰는 곳] m1/labels.py, m1/features.py, m1/reasons.py, m1/predict.py, m1/evaluate.py, m1/plots.py, train.py
"""

# ---------------------------------------------------------------------------
# 혈압 단계 (라벨 생성 전용. M1 피처에는 혈압을 어떤 형태로도 쓰지 않는다.)
# 근거: 참고 수치표 — 대한고혈압학회 2018·2022 (Clin Hypertens 2019;25:20, 2023;29:11)
# ---------------------------------------------------------------------------
STAGES = ("normal", "elevated", "prehtn", "htn")
STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}

SBP_ELEVATED_MIN = 120  # 주의혈압: 수축기 120~129 and 이완기 <80, 비복약
SBP_PREHTN_MIN = 130    # 전단계: 수축기 130~139 or 이완기 80~89, 비복약
DBP_PREHTN_MIN = 80
SBP_HTN_MIN = 140       # 고혈압: 수축기 ≥140 or 이완기 ≥90 or 복약 (1기·2기 합침)
DBP_HTN_MIN = 90

# 라벨용 측정 혈압은 2회 이상 측정의 평균 (명세 2-2)
LABEL_MIN_MEASUREMENTS = 2

# 누적 이진 임계값: 단계 인덱스 k 이상 (평가·중첩 이진 모델·위험 등급에서 사용)
CUMULATIVE_THRESHOLDS = {
    "ge_elevated": 1,  # 정상 아님 (≥120 or ≥80 or 복약)
    "ge_130_80": 2,    # ≥130/80 or 복약
    "ge_140_90": 3,    # ≥140/90 or 복약
}

# ---------------------------------------------------------------------------
# 피처 산출 임계값 (feature_contract.yaml 의 derive 식에서 참조)
# ---------------------------------------------------------------------------
# 음주: RCT 에서 ≤2잔/일은 감량 효과 없음 → 하루 평균 2잔 초과를 alcohol_per_day 로 본다.
# 근거: Roerecke 2017 Lancet Public Health (참고 수치표). 해석(초과 기준)은 명세 2-3 'alcohol_per_day' 정의에 대한 가정.
ALCOHOL_DRINKS_PER_DAY_HIGH = 2.0
# 폭음: 1회 남 7잔 / 여 5잔 이상, 월 1회 이상. 근거: 명세 2-3
BINGE_DRINKS = {"male": 7, "female": 5}
BINGE_MIN_PER_MONTH = 1
# 연속형 실험(M1-C, m1/continuous.py) 입력 규칙: 음주 0(비음주)은 drinker 플래그로 분리하고, 주당 잔 수는 이 값 이상을 같은 값으로 본다.
# 근거: 사용자 결정 2026-10-23(학습 데이터 히스토그램에서 15잔/주 이상 묶음). 문헌 근거 없음.
ALCOHOL_WEEK_CAP = 15.0
# 체인 파이프라인(m1/chain.py) 활동량 상한: 600분/주 이상은 같은 값으로 본다. 근거: 사용자 결정 2026-10-25. 문헌 근거 없음.
ACTIVITY_MINUTES_CAP = 600.0
# 체인 파이프라인 행 검증(사용자 결정 2026-10-26): 필수 열, 대치 개수 상한, 학습에 쓰는 값 범위(밖이면 행 제외).
# 범위 근거: bmi·waist 는 명세 계약 범위, fasting_glucose·resting_hr 은 생리적으로 가능한 폭으로 둔 임시값(문헌 근거 없음; 학습 파일에서 각 65행·29행 해당).
CHAIN_REQUIRED = ("age", "sex", "bmi", "waist_cm")
CHAIN_MAX_IMPUTED = 5
CHAIN_RANGES = {"bmi": (14.0, 50.0), "waist_cm": (50.0, 150.0), "fasting_glucose": (50.0, 300.0), "resting_hr": (40.0, 150.0)}
# 편차 중심값(사용자 결정 2026-10-26: 평균 대신 문헌 기준값). 0 = 정상 경계, 양수 = 위험 쪽. 나이는 기준값이 없어 평균 사용.
# 근거: bmi 23 WHO 2004(아시아 행동점), waist 90/85 대한비만학회 2022, fasting_glucose 100 대한당뇨병학회 공복혈당장애 기준(참고표 미기재),
#       resting_hr 100 일반 정상 범위 상한(문헌 근거 없음), activity 150 지침, alcohol_week 14 = 2잔/일×7 (Roerecke 2017).
REFERENCE_CENTERS = {"bmi": 23.0, "waist_cm": {"male": 90.0, "female": 85.0}, "fasting_glucose": 100.0, "resting_hr": 100.0, "activity_minutes_week": 150.0, "alcohol_week": 14.0}
# 정상 범위 초과·미달량(힌지) 경계: (하한, 상한). None 은 해당 쪽 없음. resting_hr 하한 60 은 일반 정상 범위(문헌 근거 없음).
REFERENCE_RANGES = {"bmi": (18.5, 23.0), "waist_cm": (None, {"male": 90.0, "female": 85.0}), "fasting_glucose": (None, 100.0), "resting_hr": (60.0, 100.0),
                    "activity_minutes_week": (150.0, None), "alcohol_week": (None, 14.0)}
# 신체활동 부족: <150 분/주 (결측이면 true). 근거: 명세 2-3
ACTIVITY_LOW_MIN_PER_WEEK = 150
# 고강도 분 가중치 (activity_minutes_week = 중강도 + 고강도×2 + 걷기). 근거: 명세 2-3
ACTIVITY_VIGOROUS_WEIGHT = 2
# 짧은 수면: <6 시간. 근거: 명세 2-3 (긴 수면은 넣지 않는다)
SLEEP_SHORT_HOURS = 6.0
# 나트륨 점수 구간(SODIUM_MG_BANDS)·Na/K 비는 sodium_risk_score 피처 제거(2026-10-20)와 함께 삭제
# 당뇨: 공복혈당 ≥126 mg/dL or HbA1c ≥6.5 %. 근거: 대한당뇨병학회 2021 (참고 수치표)
FASTING_GLUCOSE_DM = 126.0
HBA1C_DM = 6.5

# 허리둘레 대치용 BMI 구간 경계 (성별×BMI 구간 중앙값, 명세 2-3)
# 근거: ≥25 는 참고 수치표(대한비만학회 2022). 18.5·23·30 은 참고 수치표에 없음 — 근거 없음(확인 필요)
BMI_BINS = (18.5, 23.0, 25.0, 30.0)

# ---------------------------------------------------------------------------
# 이유 코드 임계값 (고정 어휘: m1/reasons.py REASON_CODES)
# ---------------------------------------------------------------------------
BMI_HIGH = 23.0                                  # 근거: WHO Expert Consultation, Lancet 2004;363:157 — 아시아인 공중보건 행동점 23.0 (사용자 결정 2026-10-20; 이전 25.0 대한비만학회 2022)
WAIST_HIGH_CM = {"male": 90.0, "female": 85.0}   # 근거: 대한비만학회 2022 (참고 수치표)
# sodium_high 이유 코드와 sodium_risk_score 피처는 제거(사용자 결정 2026-10-20): 결과 코호트(NEJM 2014·Lancet 2018)는 J형,
# 한국 KNHANES 는 최저점 3,000 mg·>4,500 mg OR 1.04, 이 데이터에서 단계와 상관 0.00, 모델 계수 0.
# activity_low / sleep_short / family_htn / diabetes: 플래그 그대로.
#
# 데이터 기반 경계 (문헌 경계가 없는 age·alcohol — 사용자 결정 2026-10-20). 출처: threshold_scan.py, 학습 분할 31,233행(시간 분할, 테스트 미사용).
#   youden : ≥130/80 판별의 Youden J(민감도+특이도−1) 최대 경계
#   rr125  : x ≥ t 군의 ≥130/80 비율이 전체의 1.25배 이상이 되는 최초 경계(고위험군 ≥5%); None = 그런 경계 없음 → 코드 미부여
# 성별로 값이 다르다(남성 연령 효과 완만, 여성 음주는 무관). 규칙은 REASON_RULE 로 고른다.
REASON_RULE = "youden"                       # 사용자 확정 2026-10-20: 연령 Youden(남 ≥39, 여 ≥50), 음주 데이터 경계 + 폭음 유지. rr125 는 비교용으로만 남김
AGE_HIGH_YEARS = {
    "youden": {"male": 39, "female": 50},
    "rr125": {"male": None, "female": 41},
}
ALCOHOL_HIGH_DRINKS_PER_DAY = {              # alcohol_week / 7 기준. 폭음(binge)은 별도로 alcohol_high 를 켠다
    "youden": {"male": 1.25, "female": 1.75},   # 여성 1.75 는 RR 1.04 로 위험 차이가 없음(스캔 결과) — 규칙을 기계적으로 적용한 값
    "rr125": {"male": 2.25, "female": None},
}


def reason_threshold(table: dict, sex: str):
    """REASON_RULE 과 성별에 맞는 경계. 없으면 None."""
    return table.get(REASON_RULE, {}).get(sex)

# ---------------------------------------------------------------------------
# 위험 등급 = 혈압 단계 4단계(STAGES 와 동일). 사용자 결정(2026-10-20): 별도 3등급·임시 경계값 폐기.
# 단계를 고르는 규칙은 m1/decision.py 한 곳에서 정의한다.
# ---------------------------------------------------------------------------
RISK_LEVELS = STAGES

# ---------------------------------------------------------------------------
# 데이터 품질
# ---------------------------------------------------------------------------
# 대치된 결측 플래그 합이 이 값 이상이면 insufficient. 근거 없음(명세 미정의). 임시값.
INSUFFICIENT_MISSING_COUNT = 5

# 하위군 평가 연령대 경계: 19~39 / 40~59 / 60+. 근거: 명세 2-5
AGE_GROUP_BINS = (40, 60)
AGE_GROUP_LABELS = ("19-39", "40-59", "60+")

"""
[파일] m1/reasons.py
[용도] 이유 코드 생성. 고정 어휘 8개(bmi_high, waist_high, age, alcohol_high, activity_low, sleep_short, family_htn, diabetes)만 쓰고,
      thresholds.py 조건을 만족하는 코드를 모델 기여도 순으로 정렬해 돌려준다. age·alcohol 경계는 데이터 기반이며 성별·규칙(REASON_RULE)에 따라 다르다.
[왜 필요한가] 명세 1절 "이유 코드는 고정 어휘만 쓴다"와 2-6 출력 형식을 지킨다. 대치된(관측되지 않은) 값에는 코드를 주지 않아
             결측을 위험 요인으로 보여주는 일을 막는다. 문구는 만들지 않고 코드만 낸다(문구는 별도 템플릿).
[쓰는 곳] m1/predict.py
"""

from __future__ import annotations

import thresholds as T

REASON_CODES = ("bmi_high", "waist_high", "age", "alcohol_high", "activity_low", "sleep_short", "family_htn", "diabetes")

# 코드 → 기여도를 합산할 모델 열 (정렬용)
CODE_FEATURES = {
    "bmi_high": ["bmi"],
    "waist_high": ["waist_cm"],
    "age": ["age", "age_x_male"],
    "alcohol_high": ["alcohol_week", "alcohol_per_day", "binge"],
    "activity_low": ["activity_low_flag", "activity_minutes_week"],
    "sleep_short": ["sleep_short_flag"],
    "family_htn": ["family_htn"],
    "diabetes": ["diabetes_flag"],
}


def _true(v) -> bool:
    try:
        return float(v) == 1.0
    except (TypeError, ValueError):
        return False


def _ge(v, thr) -> bool:
    return thr is not None and v is not None and float(v) >= float(thr)


def reason_codes(raw: dict, observed: dict, contrib: dict[str, float]) -> list[str]:
    """raw: 대치 후 원 척도 값, observed: 관측 여부, contrib: 열별 로짓 기여도. 관측되지 않은(대치된) 값에는 코드를 주지 않는다."""
    sex = raw.get("sex")
    drinks_per_day = None if raw.get("alcohol_week") is None else float(raw["alcohol_week"]) / 7.0
    conds = {
        "bmi_high": observed.get("bmi", False) and _ge(raw.get("bmi"), T.BMI_HIGH),
        "waist_high": observed.get("waist_cm", False) and sex in T.WAIST_HIGH_CM and _ge(raw.get("waist_cm"), T.WAIST_HIGH_CM[sex]),
        "age": observed.get("age", False) and _ge(raw.get("age"), T.reason_threshold(T.AGE_HIGH_YEARS, sex)),
        "alcohol_high": observed.get("alcohol_week", False) and (_ge(drinks_per_day, T.reason_threshold(T.ALCOHOL_HIGH_DRINKS_PER_DAY, sex)) or _true(raw.get("binge"))),
        "activity_low": observed.get("activity_minutes_week", False) and _true(raw.get("activity_low_flag")),
        "sleep_short": observed.get("sleep_short_flag", False) and _true(raw.get("sleep_short_flag")),
        "family_htn": observed.get("family_htn", False) and _true(raw.get("family_htn")),
        "diabetes": observed.get("diabetes_flag", False) and _true(raw.get("diabetes_flag")),
    }
    score = {c: float(sum(contrib.get(f, 0.0) for f in feats)) for c, feats in CODE_FEATURES.items()}
    return sorted([c for c in REASON_CODES if conds[c]], key=lambda c: score[c], reverse=True)

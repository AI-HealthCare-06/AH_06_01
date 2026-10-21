"""
[파일] tests/synth.py
[용도] 합성(난수) 데이터 생성기. 명세 변수와 라벨용 혈압·복약 컬럼을 가진 표를 만든다. 결측 주입, 원시 컬럼/명세 컬럼 두 형태 지원.
[왜 필요한가] 실제 데이터 없이도 파이프라인(산출·대치·학습·평가·추론)이 끝까지 도는지 검사하기 위해서다.
             실제 데이터와 무관한 난수 표이므로 성능 수치의 근거로 쓰지 않는다. 테스트 코드만 import 한다.
[쓰는 곳] tests/test_features.py, tests/test_models.py, tests/test_pipeline.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.special import expit

import thresholds as T


def make_synthetic(n: int = 3000, seed: int = 0, missing: bool = True, raw_components: bool = True) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    age = rng.integers(19, 86, n)
    male = rng.integers(0, 2, n)
    height = np.where(male == 1, rng.normal(172, 6, n), rng.normal(159, 6, n))
    bmi = rng.normal(24, 3.3, n).clip(16, 42)
    weight = bmi * (height / 100) ** 2
    waist = 38 + 2.0 * bmi + 5 * male + rng.normal(0, 4, n)
    freq = rng.poisson(1.2, n) * rng.binomial(1, 0.65, n)
    drinks = 1 + rng.poisson(2.0, n)
    alcohol_week = (freq * drinks).astype(float)
    binge_freq = np.where(alcohol_week > 6, rng.poisson(1.0, n), 0)
    moderate, vigorous, walk = rng.exponential(60, n), rng.exponential(25, n), rng.exponential(90, n)
    activity = moderate + T.ACTIVITY_VIGOROUS_WEIGHT * vigorous + walk
    fam_f, fam_m, fam_s = rng.binomial(1, 0.2, n), rng.binomial(1, 0.22, n), rng.binomial(1, 0.1, n)
    family = np.maximum.reduce([fam_f, fam_m, fam_s])
    sodium = rng.normal(3600, 1200, n).clip(800, 9000)
    sodium_score = np.digitize(sodium, (2000, 4000))   # 합성 데이터 전용 구간(피처에서는 제거됨)
    sleep = rng.normal(6.8, 1.1, n).clip(3, 11)
    sleep_short = (sleep < T.SLEEP_SHORT_HOURS).astype(int)
    fg = rng.normal(94 + 0.25 * (age - 40), 14, n)
    dm_dx = rng.binomial(1, expit(-5 + 0.06 * (age - 40) + 0.1 * (bmi - 24)), n)
    fg = np.where(dm_dx == 1, fg + 45, fg).clip(60, 350)
    dm_med = dm_dx * rng.binomial(1, 0.7, n)
    diabetes = ((dm_dx == 1) | (dm_med == 1) | (fg >= T.FASTING_GLUCOSE_DM)).astype(int)
    hr = rng.normal(72, 9, n).clip(45, 120)
    edu = (16 - 0.12 * (age - 19) + rng.normal(0, 2.5, n)).clip(0, 22).round()
    smoking = rng.choice(["never", "former", "current"], n, p=[0.6, 0.2, 0.2])
    stress = rng.integers(1, 5, n)
    sbp_true = (96 + 0.48 * (age - 19) + 1.2 * (bmi - 24) + 0.12 * (waist - 85) + 0.22 * alcohol_week + 3 * (binge_freq >= 1)
                - 0.008 * activity + 3.5 * family + 2.5 * sodium_score + 2.5 * sleep_short + 5 * diabetes + 0.12 * (hr - 72)
                - 0.3 * (edu - 12) + 6 * male - 0.06 * (age - 19) * male + rng.normal(0, 10, n))
    dbp_true = (62 + 0.12 * (age - 19) + 0.8 * (bmi - 24) + 0.08 * (waist - 85) + 0.15 * alcohol_week + 2 * (binge_freq >= 1)
                - 0.004 * activity + 2 * family + 1.5 * sodium_score + 1.5 * sleep_short + 2 * diabetes + 0.1 * (hr - 72)
                + 3 * male + rng.normal(0, 7, n))
    med = rng.binomial(1, expit(-7 + 0.07 * (age - 40) + 0.07 * (sbp_true - 130)), n)
    sbp_meas = np.where(med == 1, sbp_true - 10, sbp_true)
    dbp_meas = np.where(med == 1, dbp_true - 6, dbp_true)
    df = pd.DataFrame({
        "age": age, "sex": np.where(male == 1, "male", "female"),
        "waist_cm": waist.round(1), "fasting_glucose": fg.round(), "resting_hr": hr.round(), "education_years": edu,
        "smoking": smoking, "stress_score": stress,
        "sbp_1": (sbp_meas + rng.normal(0, 4, n)).round(), "sbp_2": (sbp_meas + rng.normal(0, 4, n)).round(),
        "dbp_1": (dbp_meas + rng.normal(0, 3, n)).round(), "dbp_2": (dbp_meas + rng.normal(0, 3, n)).round(),
        "htn_med": med,
    })
    if raw_components:
        df = df.assign(height_cm=height.round(1), weight_kg=weight.round(1), alcohol_freq_per_week=freq, alcohol_drinks_per_occasion=drinks,
                       binge_freq_per_month=binge_freq, moderate_min_week=moderate.round(), vigorous_min_week=vigorous.round(), walk_min_week=walk.round(),
                       family_htn_father=fam_f, family_htn_mother=fam_m, family_htn_sibling=fam_s, sodium_mg_day=sodium.round(),
                       sleep_hours=sleep.round(1), dm_dx=dm_dx, dm_med=dm_med)
    else:
        df = df.assign(bmi=bmi.round(2), alcohol_week=alcohol_week, alcohol_per_day=(alcohol_week / 7 > T.ALCOHOL_DRINKS_PER_DAY_HIGH).astype(int),
                       binge=(binge_freq >= T.BINGE_MIN_PER_MONTH).astype(int), activity_minutes_week=activity.round(), family_htn=family,
                       sodium_risk_score=sodium_score, sleep_short_flag=sleep_short, diabetes_flag=diabetes)
    if missing:
        rates = {"waist_cm": 0.10, "alcohol_freq_per_week": 0.08, "alcohol_week": 0.08, "moderate_min_week": 0.10, "activity_minutes_week": 0.10,
                 "sodium_mg_day": 0.15, "sodium_risk_score": 0.15, "sleep_hours": 0.05, "sleep_short_flag": 0.05, "fasting_glucose": 0.20,
                 "resting_hr": 0.30, "education_years": 0.05, "family_htn_mother": 0.10, "family_htn": 0.10, "smoking": 0.05, "stress_score": 0.05}
        for col, r in rates.items():
            if col in df.columns:
                m = rng.random(n) < r
                if pd.api.types.is_numeric_dtype(df[col]):
                    df[col] = df[col].astype(float)
                    df.loc[m, col] = np.nan
                else:
                    df[col] = df[col].astype(object)
                    df.loc[m, col] = None
    return df

"""features/knhanes_v1.py — KNHANES 원시자료(HNyy_ALL.sas7bdat) → Feature Contract v1 입력 열

연도별 변수명·코드 차이를 여기서 전부 흡수한다. 출력 열 이름은 feature_contract_v1.yaml 의 피처 이름과
labels.py 의 표준 열 이름(age, sex, HE_ht, HE_wt, HE_sbp, HE_dbp, on_medication, pregnant, wt)이다.
코드값 정의는 원시자료 이용지침서(제6기~제9기)의 변수 설명표와 '주요지표 산출 SAS 프로그램'을 따랐다.

연도별 차이 요약 (10개년 메타데이터 스캔 결과, 2026-10-12)
  - 신체활동: 2013 은 IPAQ 형식(BE3_11~23: 격렬/중등도 일수·시간), 2014~ 는 GPAQ(BE3_71~88: 일·여가 × 고/중강도)
  - 수면:    2013~2015 BP8(시간) / 2016~2018·2021 BP16_11~24(취침·기상 시각) / 2019·2020·2022 BP16_1·2(주중·주말 시간)
  - HE_HP:   2022 부터 4단계 코드 → 라벨에 쓰지 않고 HE_sbp/HE_dbp + DI1_2 로 직접 계산
  - 복약:    공식 SAS  IF 140<=HE_SBP or 90<=HE_DBP or DI1_2 in (1,2,3,4) THEN 고혈압
  - 임신:    HE_prg(현재 임신 여부). LW_pr 은 '임신 경험'이라 쓰지 않는다
결측 코드 관행: 한 자리 코드 8=비해당, 9=모름/무응답; 두 자리 88/99; 세 자리 888/999.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

import thresholds_kr_v1 as T

YEARS: tuple[int, ...] = tuple(range(2013, 2023))
RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "knhanes"

# ── 변환 상수 (contract: "환산표는 transforms.alcohol 에 고정") ───────────────
WEEKS_PER_MONTH = 365.25 / 12 / 7                       # 4.345
ALCOHOL_FREQ_PER_WEEK = {                               # BD1_11 1년간 음주빈도 → 주당 횟수
    1: 0.0,                     # 최근 1년간 전혀 마시지 않았다
    2: 0.5 / WEEKS_PER_MONTH,   # 월 1회 미만
    3: 1.0 / WEEKS_PER_MONTH,   # 월 1회 정도
    4: 3.0 / WEEKS_PER_MONTH,   # 월 2~4회
    5: 2.5,                     # 주 2~3회
    6: 4.5,                     # 주 4회 이상
    8: 0.0,                     # 비해당(평생 비음주)
}
ALCOHOL_DRINKS_PER_OCCASION = {                         # BD2_1 한 번에 마시는 음주량 → 잔(구간 중앙)
    1: 1.5, 2: 3.5, 3: 5.5, 4: 8.0, 5: 11.0, 8: 0.0,
}
ACTIVITY_CAP_MINUTES = 2000     # contract 범위 상한. GPAQ 직업활동이 넘는 경우 상한으로 자르고 건수를 보고한다
SODIUM_BINS_MG = (2000.0, 4000.0)   # N_NA <2000→0, 2000~3999→1, ≥4000→2  (contract knhanes_source)

# ── 연도별 원시 변수 ──────────────────────────────────────────────────────────
COMMON_VARS = [
    "year", "age", "sex", "HE_ht", "HE_wt", "HE_BMI", "HE_wc", "HE_sbp", "HE_dbp", "DI1_2", "HE_prg",
    "BS3_1", "BD1_11", "BD2_1", "BE3_31", "BE3_32", "BE3_33", "BP1", "N_NA",
    "HE_HPfh1", "HE_HPfh2", "HE_HPfh3", "HE_glu", "HE_HbA1c", "DE1_dg", "DE1_31", "DE1_32",
    "wt_itvex", "psu", "kstrata",
    # M3 동반 질환 라벨 재료 (검진값·이상지질 진단/복약·공복시간). 피처가 아니라 라벨에만 쓴다 (lab_ 접두)
    "HE_fst", "HE_chol", "HE_TG", "HE_HDL_st2", "HE_LDL_drct", "HE_crea", "HE_Upro", "HE_Ualb", "HE_Ucrea", "DI2_dg", "DI2_2",
]
ACTIVITY_IPAQ_2013 = ["BE3_11", "BE3_12", "BE3_13", "BE3_21", "BE3_22", "BE3_23"]
ACTIVITY_GPAQ = ["BE3_71", "BE3_72", "BE3_73", "BE3_74", "BE3_75", "BE3_76", "BE3_77", "BE3_78",
                 "BE3_81", "BE3_82", "BE3_83", "BE3_84", "BE3_85", "BE3_86", "BE3_87", "BE3_88"]
SLEEP_HOURS_2013_2015 = ["BP8"]
SLEEP_CLOCK = ["BP16_11", "BP16_12", "BP16_13", "BP16_14", "BP16_21", "BP16_22", "BP16_23", "BP16_24"]
SLEEP_HOURS_WK_WE = ["BP16_1", "BP16_2"]


def raw_path(year: int, raw_dir: Path = RAW_DIR) -> Path:
    return raw_dir / str(year) / f"hn{str(year)[2:]}_all.sas7bdat"


def variables_for(year: int) -> list[str]:
    v = list(COMMON_VARS)
    v += ACTIVITY_IPAQ_2013 if year == 2013 else ACTIVITY_GPAQ
    if year <= 2015:
        v += SLEEP_HOURS_2013_2015
    elif year in (2016, 2017, 2018, 2021):
        v += SLEEP_CLOCK
    else:
        v += SLEEP_HOURS_WK_WE
    return v


def load_year(year: int, raw_dir: Path = RAW_DIR) -> pd.DataFrame:
    """필요한 열만 읽는다. 해당 연도에 없는 열은 NaN 으로 채워 열 집합을 맞춘다."""
    path = raw_path(year, raw_dir)
    _, meta = pyreadstat.read_sas7bdat(str(path), metadataonly=True)
    want = variables_for(year)
    have = [c for c in want if c in set(meta.column_names)]
    df, _ = pyreadstat.read_sas7bdat(str(path), usecols=have)
    df = pd.DataFrame(df)
    for c in want:
        if c not in df:
            df[c] = np.nan
    df["year"] = year
    return df


# ── 코드 → 값 도우미 ──────────────────────────────────────────────────────────


def _num(s: pd.Series) -> pd.Series:
    return pd.Series(pd.to_numeric(s, errors="coerce"), index=s.index, dtype=float)


def _drop_codes(s: pd.Series, codes: tuple[int, ...]) -> pd.Series:
    s = _num(s)
    return s.where(~s.isin(codes))


def _days_from_code(s: pd.Series) -> pd.Series:
    """'1. 전혀 하지 않음 2. 1일 … 8. 7일' 형식 → 일수. 88/99 → NaN."""
    s = _drop_codes(s, (88, 99))
    return (s - 1).where(s.between(1, 8))


def _duration_minutes(hours: pd.Series, minutes: pd.Series, not_applicable_zero: pd.Series) -> pd.Series:
    """시간(88/99 결측)·분(88/99 결측) → 분. not_applicable_zero 가 True 인 행은 0."""
    h = _drop_codes(hours, (88, 99))
    m = _drop_codes(minutes, (88, 99))
    d = h * 60 + m
    return d.mask(not_applicable_zero, 0.0)


def _gpaq_block(yes: pd.Series, days: pd.Series, hours: pd.Series, minutes: pd.Series) -> pd.Series:
    """GPAQ 한 블록(여부 1예/2아니오, 일수, 시간, 분) → 주당 분. 아니오 → 0, 모름 → NaN."""
    yes = _num(yes)
    no = yes == 2
    dd = _drop_codes(days, (8, 9, 88, 99))
    dur = _duration_minutes(hours, minutes, no)
    out = dd * dur
    out = out.mask(no, 0.0)
    return out.where(yes.isin([1, 2]))     # 8/9/결측 → NaN


def _ipaq_block(days_code: pd.Series, hours: pd.Series, minutes: pd.Series) -> pd.Series:
    """2013 IPAQ 블록(일수 코드, 시간, 분) → 주당 분. '전혀 하지 않음' → 0."""
    d = _days_from_code(days_code)
    none = d == 0
    return (d * _duration_minutes(hours, minutes, none)).mask(none, 0.0)


def _clock_sleep_hours(bed_h, bed_m, wake_h, wake_m) -> pd.Series:
    """취침·기상 시각 → 수면 시간(h). 지침서 SAS: 음수면 1440분 더한다."""
    bh, bm, wh, wm = (_drop_codes(x, (88, 99)) for x in (bed_h, bed_m, wake_h, wake_m))
    mins = (wh * 60 + wm) - (bh * 60 + bm)
    mins = mins.where(mins >= 0, mins + 1440)
    return mins / 60.0


# ── 혈압 측정 장비 변경 (지침서 제8기·제9기) ────────────────────────────────────
# 1998~2019 수은혈압계 → 2020 비수은 청진형(Greenlight 300; 수은과 차이 오차범위 내, 전환 불필요)
# → 2021~2022 성인(19세 이상) 비수은 진동형(Microlife WatchBP Office). 공식 통계는 원값을 쓰지만
# 연구자용 전환식(Microlife → Greenlight 상당값)이 제공된다. 라벨은 공식 정의(원값)로 만들고,
# 전환식 적용값은 *_devadj 열로 보존해 2021~22 테스트 세트 민감도 분석에 쓴다.
DEVICE_CHANGE_YEARS_ADULT = (2021, 2022)


def device_adjusted_bp(sbp: pd.Series, dbp: pd.Series, age: pd.Series, year: int) -> tuple[pd.Series, pd.Series]:
    if year not in DEVICE_CHANGE_YEARS_ADULT:
        return sbp.copy(), dbp.copy()
    pp = sbp - dbp
    adult = age >= T.KNHANES_MIN_AGE
    sbp_adj = 10.773 + 0.771 * sbp + 0.039 * age + 0.374 * pp     # R² = 0.893 (지침서 제8기)
    dbp_adj = 13.480 + 0.952 * dbp - 0.051 * age - 0.098 * pp     # R² = 0.823
    return sbp_adj.where(adult, sbp).round(1), dbp_adj.where(adult, dbp).round(1)


# ── 원시 → 계약 입력 ──────────────────────────────────────────────────────────


def activity_minutes_week(df: pd.DataFrame, year: int) -> tuple[pd.Series, pd.Series]:
    """contract: 일·여가 중강도 분 + 고강도 분×2 + 걷기 분. (상한 적용값, 상한 전 원값) 을 돌려준다."""
    walk = _ipaq_block(df["BE3_31"], df["BE3_32"], df["BE3_33"])
    if year == 2013:
        vig = _ipaq_block(df["BE3_11"], df["BE3_12"], df["BE3_13"])
        mod = _ipaq_block(df["BE3_21"], df["BE3_22"], df["BE3_23"])
    else:
        vig = _gpaq_block(df["BE3_71"], df["BE3_72"], df["BE3_73"], df["BE3_74"]) \
            + _gpaq_block(df["BE3_75"], df["BE3_76"], df["BE3_77"], df["BE3_78"])
        mod = _gpaq_block(df["BE3_81"], df["BE3_82"], df["BE3_83"], df["BE3_84"]) \
            + _gpaq_block(df["BE3_85"], df["BE3_86"], df["BE3_87"], df["BE3_88"])
    raw = mod + 2.0 * vig + walk
    return raw.clip(upper=ACTIVITY_CAP_MINUTES).round(), raw


def sleep_avg_h(df: pd.DataFrame, year: int) -> pd.Series:
    """contract: (5×주중 + 2×주말)/7. 2013~2015 는 주중·주말 구분이 없어 BP8 그대로."""
    if year <= 2015:
        return _drop_codes(df["BP8"], (88, 99))
    if year in (2016, 2017, 2018, 2021):
        wk = _clock_sleep_hours(df["BP16_11"], df["BP16_12"], df["BP16_13"], df["BP16_14"])
        we = _clock_sleep_hours(df["BP16_21"], df["BP16_22"], df["BP16_23"], df["BP16_24"])
    else:
        wk = _drop_codes(df["BP16_1"], (88, 99))
        we = _drop_codes(df["BP16_2"], (88, 99))
    return (5.0 * wk + 2.0 * we) / 7.0


def to_contract(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """한 연도 원시 프레임 → 계약 입력 열 + 라벨 재료 열. 범위 검사·대치는 하지 않는다(contract_v1 담당)."""
    out = pd.DataFrame(index=df.index)
    out["year"] = year
    out["age"] = _num(df["age"])
    out["sex"] = _num(df["sex"]).map({1: "male", 2: "female"})
    out["HE_ht"], out["HE_wt"] = _num(df["HE_ht"]), _num(df["HE_wt"])
    bmi = _num(df["HE_BMI"])
    out["bmi"] = bmi.fillna(out["HE_wt"] / (out["HE_ht"] / 100.0) ** 2)
    out["waist_cm"] = _num(df["HE_wc"])
    out["HE_sbp"], out["HE_dbp"] = _num(df["HE_sbp"]), _num(df["HE_dbp"])
    out["HE_sbp_devadj"], out["HE_dbp_devadj"] = device_adjusted_bp(out["HE_sbp"], out["HE_dbp"], out["age"], year)

    di = _num(df["DI1_2"])   # 공식 SAS: in (1,2,3,4) 복용, (5,8) 미복용, 9/결측 → 판정 불가
    out["on_medication"] = pd.Series(np.where(di.isin([1, 2, 3, 4]), 1.0, np.where(di.isin([5, 8]), 0.0, np.nan)), index=df.index)
    out["pregnant"] = (_num(df["HE_prg"]) == 1).astype(int)

    bs = _num(df["BS3_1"])
    out["smoking_status"] = bs.map({1: "current", 2: "current", 3: "former", 8: "never"})

    freq = _num(df["BD1_11"]).map(ALCOHOL_FREQ_PER_WEEK)
    drinks = _num(df["BD2_1"]).map(ALCOHOL_DRINKS_PER_OCCASION)
    units = freq * drinks
    out["alcohol_units_week"] = units.mask(freq == 0, 0.0)   # 비음주자는 음주량 문항이 비해당이어도 0

    act, act_raw = activity_minutes_week(df, year)
    out["activity_minutes_week"] = act
    out["_activity_raw_minutes"] = act_raw            # 감사용(상한 전). 모델 입력 아님

    out["sleep_avg_h"] = sleep_avg_h(df, year)

    na = _num(df["N_NA"])
    out["sodium_risk_score"] = pd.Series(
        np.select([na < SODIUM_BINS_MG[0], na < SODIUM_BINS_MG[1], na >= SODIUM_BINS_MG[1]], [0, 1, 2], default=np.nan),
        index=df.index)

    bp1 = _num(df["BP1"])
    out["stress_score"] = (5 - bp1).where(bp1.between(1, 4))   # 역코딩: 4 = 많이 느낌

    fh = pd.concat([_num(df[c]) for c in ("HE_HPfh1", "HE_HPfh2", "HE_HPfh3")], axis=1)
    any_yes = (fh == 1).any(axis=1)
    all_known_no = fh.isin([0, 8]).all(axis=1)
    out["family_htn"] = pd.Series(np.where(any_yes, True, np.where(all_known_no, False, None)), index=df.index, dtype=object)

    glu, a1c, fst = _num(df["HE_glu"]), _num(df["HE_HbA1c"]), _num(df["HE_fst"])
    dg, ins, oral = _num(df["DE1_dg"]), _num(df["DE1_31"]), _num(df["DE1_32"])
    # 공식 HE_DM: 공복 8시간 이상일 때만 공복혈당 기준을 쓴다 (2026-10-15 SAS 대조 후 추가). HbA1c·진단·약은 공복 무관
    glu_fasting = glu.where(fst >= 8)
    dm_yes = (glu_fasting >= 126) | (a1c >= 6.5) | (dg == 1) | (ins == 1) | (oral == 1)
    dg_known_no = dg.isin([0, 8])
    out["diabetes_flag"] = pd.Series(np.where(dm_yes, True, np.where(dg_known_no, False, None)), index=df.index, dtype=object)

    # ── M3 라벨 재료 (피처 아님) ──
    out["lab_fst_h"] = fst
    out["lab_glu"], out["lab_hba1c"] = glu, a1c
    out["lab_chol"], out["lab_tg"], out["lab_hdl"], out["lab_ldl"] = (_num(df[c]) for c in ("HE_chol", "HE_TG", "HE_HDL_st2", "HE_LDL_drct"))
    out["lab_crea"] = _num(df["HE_crea"])                       # mg/dL
    out["lab_upro"] = _num(df["HE_Upro"])                       # 요단백 스틱 코드 0 − / 1 ± / 2 1+ / 3 2+ / 4 3+ / 5 4+
    ualb, ucrea = _num(df["HE_Ualb"]), _num(df["HE_Ucrea"])     # ㎍/mL, mg/dL → ACR mg/g = Ualb/Ucrea×100 (2013~14, 2019~)
    out["lab_acr"] = (ualb / ucrea * 100).where(ucrea > 0)
    di2 = _num(df["DI2_2"])                                     # 이상지질혈증 약 복용 (DI1_2 와 같은 코드)
    out["lipid_medication"] = pd.Series(np.where(di2.isin([1, 2, 3, 4]), 1.0, np.where(di2.isin([5, 8]), 0.0, np.nan)), index=df.index)
    out["lipid_dx"] = (_num(df["DI2_dg"]) == 1).astype(int)
    out["dm_medication"] = ((ins == 1) | (oral == 1)).astype(int)

    out["wt"] = _num(df["wt_itvex"])
    out["psu"], out["kstrata"] = _num(df["psu"]), _num(df["kstrata"])
    return out


def load_all(years: tuple[int, ...] = YEARS, raw_dir: Path = RAW_DIR) -> pd.DataFrame:
    frames = [to_contract(load_year(y, raw_dir), y) for y in years]
    return pd.concat(frames, ignore_index=True)


# ── schema_map 재료: 계약 피처 ← KNHANES 변수 · 변환 설명 ───────────────────────
SCHEMA_MAP: list[dict[str, str]] = [
    {"contract": "age", "knhanes": "age", "years": "2013-2022", "transform": "정수 그대로 (만 나이). 80세 이상 탑코딩"},
    {"contract": "sex", "knhanes": "sex", "years": "2013-2022", "transform": "1→male, 2→female"},
    {"contract": "bmi", "knhanes": "HE_BMI (없으면 HE_wt, HE_ht)", "years": "2013-2022", "transform": "HE_BMI, 결측이면 HE_wt/(HE_ht/100)^2"},
    {"contract": "waist_cm", "knhanes": "HE_wc", "years": "2013-2022", "transform": "cm 그대로"},
    {"contract": "smoking_status", "knhanes": "BS3_1", "years": "2013-2022", "transform": "1,2→current / 3→former / 8→never / 9→결측"},
    {"contract": "alcohol_units_week", "knhanes": "BD1_11 × BD2_1", "years": "2013-2022",
     "transform": "빈도 1→0, 2→0.5/월, 3→1/월, 4→3/월, 5→2.5/주, 6→4.5/주 (월→주 ÷4.345) × 양 1→1.5, 2→3.5, 3→5.5, 4→8, 5→11잔; 비음주 0; 9→결측"},
    {"contract": "activity_minutes_week", "knhanes": "2013: BE3_11~13(격렬), BE3_21~23(중등도), BE3_31~33(걷기) / 2014~: BE3_71~74·75~78(일·여가 고강도), BE3_81~84·85~88(일·여가 중강도), BE3_31~33(걷기)",
     "years": "2013-2022", "transform": "중강도 분 + 2×고강도 분 + 걷기 분 (일수×하루 분). 2000분 상한, 상한 건수 보고. 블록 중 하나라도 모름(9/99)이면 결측"},
    {"contract": "sleep_avg_h", "knhanes": "2013-2015: BP8 / 2016-2018·2021: BP16_11~14(주중 취침·기상), BP16_21~24(주말) / 2019·2020·2022: BP16_1(주중), BP16_2(주말)",
     "years": "2013-2022", "transform": "(5×주중 + 2×주말)/7. 시각형은 기상−취침(음수면 +24h). 2013-2015 는 구분 없어 BP8 그대로"},
    {"contract": "sodium_risk_score", "knhanes": "N_NA", "years": "2013-2022", "transform": "mg/일 <2000→0, 2000~3999→1, ≥4000→2"},
    {"contract": "stress_score", "knhanes": "BP1", "years": "2013-2022", "transform": "5−BP1 (1 대단히 많이→4 … 4 거의 없음→1); 8,9→결측"},
    {"contract": "family_htn", "knhanes": "HE_HPfh1, HE_HPfh2, HE_HPfh3", "years": "2013-2022", "transform": "하나라도 1→true; 전부 0/8→false; 그 외(9 포함)→결측"},
    {"contract": "diabetes_flag", "knhanes": "HE_glu, HE_HbA1c, DE1_dg, DE1_31, DE1_32", "years": "2013-2022",
     "transform": "공복혈당≥126 or HbA1c≥6.5 or 의사진단 or 인슐린 or 혈당강하제 →true (공식 HE_DM 정의); DE1_dg∈{0,8}이면 false; 그 외 결측"},
    {"contract": "label: HE_sbp, HE_dbp", "knhanes": "HE_sbp, HE_dbp", "years": "2013-2022", "transform": "최종 혈압(2·3차 평균, 원시자료 제공값) 그대로"},
    {"contract": "label(sensitivity): HE_sbp_devadj, HE_dbp_devadj", "knhanes": "HE_sbp, HE_dbp, age", "years": "2021-2022 (성인)",
     "transform": "혈압계 변경(Microlife→Greenlight 상당) 연구자용 전환식 적용값. 공식 라벨에는 쓰지 않고 민감도 분석용"},
    {"contract": "label: on_medication", "knhanes": "DI1_2", "years": "2013-2022", "transform": "공식 SAS: 1,2,3,4→1 / 5,8→0 / 9·결측→라벨 불가(제외)"},
    {"contract": "exclude: pregnant", "knhanes": "HE_prg", "years": "2013-2022", "transform": "1→제외. LW_pr(임신 경험)은 사용하지 않음"},
    {"contract": "weight: wt", "knhanes": "wt_itvex (psu, kstrata)", "years": "2013-2022", "transform": "건강설문·검진 연관성 가중치. 성능 보고의 가중 유병률에만 사용"},
]

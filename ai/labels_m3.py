"""labels_m3.py — M3 동반 질환 라벨 4개 (KNHANES, 공식 산출 기준·학회 정의)

입력: knhanes_v1.to_contract() 가 만든 프레임 (계약 입력 + lab_* 라벨 재료). 출력: 0/1/NaN 열 4개.
판정 불가(필요 검사값 결측)는 NaN — 0 으로 바꾸지 않는다. 임계값은 이 파일 한 곳에 둔다.

| 라벨 | 규칙 | 출처 |
|---|---|---|
| label_diabetes | 공복(≥8h) 혈당 ≥126 or HbA1c ≥6.5 or 의사진단 or 인슐린·경구약 | KNHANES 공식 HE_DM_HbA1c |
| label_ckd | eGFR(CKD-EPI 2021) <60 or 요단백 스틱 ≥1+ or ACR ≥30 mg/g(있을 때) | KDIGO 2012, docs/datasets.md |
| label_dyslipidemia | 공복 8h 총콜 ≥240 or 약 복용 or LDL ≥160 or 공복 12h TG ≥200 or HDL <40 or 의사진단 | KNHANES 공식 HE_hCHOL·HE_hTG + 팀 정의서 |
| label_metsyn | 5개 중 3개↑: 허리 남≥90/여≥85, 혈압 ≥130/85 or 약, 공복혈당 ≥100 or 약, TG ≥150 or 약, HDL 남<40/여<50 or 약 | NCEP ATP-III (한국인 허리 기준), 팀 정의서 |
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# ── 임계값 (M3) ────────────────────────────────────────────────────────────────
FASTING_H_GLU, FASTING_H_TG = 8, 12
GLU_DM, HBA1C_DM, GLU_IFG = 126.0, 6.5, 100.0
EGFR_CKD, ACR_CKD, UPRO_POSITIVE_CODE = 60.0, 30.0, 2            # 요단백 스틱 코드: 0 −, 1 ±, 2 1+, 3 2+, 4 3+, 5 4+ (데이터 분포로 확인)
CHOL_HIGH, LDL_HIGH, TG_HIGH, HDL_LOW = 240.0, 160.0, 200.0, 40.0
MS_WAIST = {"male": 90.0, "female": 85.0}
MS_BP = (130.0, 85.0)
MS_TG, MS_HDL = 150.0, {"male": 40.0, "female": 50.0}
MS_MIN_COMPONENTS = 3

LABELS_M3 = ("label_diabetes", "label_ckd", "label_dyslipidemia", "label_metsyn")


def egfr_ckd_epi_2021(creatinine_mg_dl: pd.Series, age: pd.Series, sex: pd.Series) -> pd.Series:
    """CKD-EPI 2021 (인종 항 없음). κ 0.7/0.9, α −0.241/−0.302 (여/남), 여성 ×1.012."""
    scr, a = pd.to_numeric(creatinine_mg_dl, errors="coerce"), pd.to_numeric(age, errors="coerce")
    female = (sex == "female")
    kappa = np.where(female, 0.7, 0.9)
    alpha = np.where(female, -0.241, -0.302)
    r = scr / kappa
    egfr = 142 * np.minimum(r, 1) ** alpha * np.maximum(r, 1) ** -1.200 * 0.9938 ** a * np.where(female, 1.012, 1.0)
    return pd.Series(egfr, index=scr.index).where(scr > 0)


def _tri(pos: pd.Series, decidable: pd.Series) -> pd.Series:
    """pos 가 True → 1, 아니면 decidable 이면 0, 아니면 NaN."""
    return pd.Series(np.where(pos, 1.0, np.where(decidable, 0.0, np.nan)), index=pos.index)


def label_diabetes(d: pd.DataFrame) -> pd.Series:
    glu = d["lab_glu"].where(d["lab_fst_h"] >= FASTING_H_GLU)
    dx = d["diabetes_flag"].map({True: 1.0, False: 0.0})
    pos = (glu >= GLU_DM) | (d["lab_hba1c"] >= HBA1C_DM) | (dx == 1)
    decidable = dx.notna() & (glu.notna() | d["lab_hba1c"].notna())
    return _tri(pos.fillna(False), decidable)


def label_ckd(d: pd.DataFrame) -> pd.Series:
    egfr = egfr_ckd_epi_2021(d["lab_crea"], d["age"], d["sex"])
    pos = (egfr < EGFR_CKD) | (d["lab_upro"] >= UPRO_POSITIVE_CODE) | (d["lab_acr"] >= ACR_CKD)
    decidable = egfr.notna() | d["lab_upro"].notna()
    out = _tri(pos.fillna(False), decidable)
    return out


def label_dyslipidemia(d: pd.DataFrame) -> pd.Series:
    chol = d["lab_chol"].where(d["lab_fst_h"] >= FASTING_H_GLU)
    tg = d["lab_tg"].where(d["lab_fst_h"] >= FASTING_H_TG)
    med = d["lipid_medication"]
    pos = (chol >= CHOL_HIGH) | (d["lab_ldl"] >= LDL_HIGH) | (tg >= TG_HIGH) | (d["lab_hdl"] < HDL_LOW) | (med == 1) | (d["lipid_dx"] == 1)
    decidable = chol.notna() | d["lab_ldl"].notna() | tg.notna() | d["lab_hdl"].notna() | (med == 1) | (d["lipid_dx"] == 1)
    return _tri(pos.fillna(False), decidable)


def metsyn_components(d: pd.DataFrame) -> pd.DataFrame:
    """대사증후군 5개 구성요소 (1/0/NaN)."""
    sex = d["sex"]
    waist = _tri(d["waist_cm"] >= sex.map(MS_WAIST), d["waist_cm"].notna())
    bp = _tri((d["HE_sbp"] >= MS_BP[0]) | (d["HE_dbp"] >= MS_BP[1]) | (d["on_medication"] == 1), d["HE_sbp"].notna() & d["HE_dbp"].notna())
    glu_f = d["lab_glu"].where(d["lab_fst_h"] >= FASTING_H_GLU)
    glu = _tri((glu_f >= GLU_IFG) | (d["dm_medication"] == 1), glu_f.notna() | (d["dm_medication"] == 1))
    tg_f = d["lab_tg"].where(d["lab_fst_h"] >= FASTING_H_GLU)
    tg = _tri((tg_f >= MS_TG) | (d["lipid_medication"] == 1), tg_f.notna() | (d["lipid_medication"] == 1))
    hdl = _tri((d["lab_hdl"] < sex.map(MS_HDL)) | (d["lipid_medication"] == 1), d["lab_hdl"].notna() | (d["lipid_medication"] == 1))
    return pd.DataFrame({"ms_waist": waist, "ms_bp": bp, "ms_glu": glu, "ms_tg": tg, "ms_hdl": hdl})


def label_metsyn(d: pd.DataFrame) -> pd.Series:
    comp = metsyn_components(d)
    n_pos, n_known = comp.sum(axis=1, skipna=True), comp.notna().sum(axis=1)
    pos = n_pos >= MS_MIN_COMPONENTS
    # 양성은 확정; 음성은 5개가 다 알려져 있거나, 남은 미지 요소를 다 더해도 3 미만일 때만 확정
    decidable = pos | ((n_pos + (5 - n_known)) < MS_MIN_COMPONENTS)
    return _tri(pos, decidable)


def make_labels_m3(d: pd.DataFrame) -> pd.DataFrame:
    out = d.copy()
    out["label_diabetes"] = label_diabetes(d)
    out["label_ckd"] = label_ckd(d)
    out["label_dyslipidemia"] = label_dyslipidemia(d)
    out["label_metsyn"] = label_metsyn(d)
    out["egfr"] = egfr_ckd_epi_2021(d["lab_crea"], d["age"], d["sex"])
    return out

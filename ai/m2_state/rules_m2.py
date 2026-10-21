"""rules_m2.py — A군 10개 상태의 판정 규칙 (v0.2.0, M1 step 기반).

입력: M1 step(m1_bp_step.step) + 생활 데이터. 혈압 수치는 다루지 않는다(M1 역할).
- 임계값·코드는 thresholds 에서만 읽는다(호출 시점 참조).
- 필수(●)·보조(○) 변수 목록은 feature_contract.yaml 의 required_for / auxiliary_for.
- 상태 코드와 숫자만 낸다. 화면 문구는 만들지 않는다.

구현 상태 (thresholds.IMPLEMENTED_STATES / PENDING_M1_STATES)
- 구현됨: ELEVATED, PREHTN, HTN_SUSPECT(미치료자), NOCTURNAL_SCREEN(증상 분기)
- M1 대기: HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, RESISTANT_SUSPECT 의 혈압 조건.
  대기 상태는 지금 결정 가능한 부분(복약자 제외, 미복약자 negative 등)만 내고 나머지는
  not_evaluable + missing_required 에 기다리는 M1 필드 이름("m1_bp_step.<field>")을 적는다.

공통 순서
  1) 필수 변수 결측 → not_evaluable (missing_required 에 변수명)
  2) 적용 대상 아님(약 복용자에 WHITE_COAT/MASKED) → not_applicable
  3) 규칙 평가 → positive / negative, 또는 M1 필드 대기 → not_evaluable(notes: pending_m1)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import thresholds as T
from feature_contract import load_contract

M1 = "m1_bp_step"

# 상태별로 기다리는 M1 필드 (계약 m1_bp_step 의 status: pending_m1 필드와 같다)
PENDING_M1_FIELDS: dict[str, tuple[str, ...]] = {
    "HTN_SUSPECT": ("bp_level_step",),            # 복약자(11=3)에서만 필요
    "HTN_STAGE2_SCREEN": ("stage2_flag",),
    "ISH": ("ish_flag",),
    "WHITE_COAT": ("office_step",),
    "MASKED": ("office_step",),
    "MORNING": ("morning_step", "evening_step"),
    "NOCTURNAL_SCREEN": ("evening_step",),        # 증상 분기 불충족일 때만 필요
    "RESISTANT_SUSPECT": ("bp_level_step",),      # 복약자 + 3제 이뇨제일 때만 필요
}


# ───────────────────────────── 컨텍스트·결과 ─────────────────────────────
@dataclass
class Ctx:
    payload: dict                   # feature_contract.validate() 의 정규화 payload
    presence: dict[str, bool]
    sex: Optional[str]
    med_status: Optional[int]
    step: Optional[str]             # M1 step

    def var(self, name: str) -> dict:
        return self.payload.get(name) or {}


@dataclass
class StateResult:
    code: str
    status: str
    evidence: dict = field(default_factory=dict)
    missing_required: list[str] = field(default_factory=list)
    auxiliary_present: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)   # 코드 형태 메모 (예: "pending_m1")

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "evidence": self.evidence,
            "missing_required": list(self.missing_required),
            "auxiliary_present": list(self.auxiliary_present),
            "notes": list(self.notes),
        }


def required_vars(code: str) -> list[str]:
    return [v["name"] for v in load_contract()["variables"] if code in v.get("required_for", [])]


def auxiliary_vars(code: str) -> list[str]:
    return [v["name"] for v in load_contract()["variables"] if code in v.get("auxiliary_for", [])]


def _r1(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(float(x), 1)


def _start(ctx: Ctx, code: str) -> tuple[StateResult, bool]:
    """공통 전처리. (결과 골격, 계속 평가 여부)"""
    missing = [v for v in required_vars(code) if not ctx.presence.get(v)]
    aux = [v for v in auxiliary_vars(code) if ctx.presence.get(v)]
    res = StateResult(code=code, status=T.STATUS_NEGATIVE, missing_required=missing, auxiliary_present=aux)
    res.evidence["step"] = ctx.step
    if missing:
        res.status = T.STATUS_NOT_EVALUABLE
        return res, False
    return res, True


def _set(res: StateResult, positive: bool) -> StateResult:
    res.status = T.STATUS_POSITIVE if positive else T.STATUS_NEGATIVE
    return res


def _pending(res: StateResult, fields: tuple[str, ...], *extra_notes: str) -> StateResult:
    """M1 필드를 기다리는 상태. missing_required 에 'm1_bp_step.<field>' 를 적는다."""
    res.status = T.STATUS_NOT_EVALUABLE
    res.missing_required = [f"{M1}.{f}" for f in fields]
    res.notes.extend([*extra_notes, "pending_m1"])
    return res


def _not_applicable_if_treated(ctx: Ctx, code: str) -> Optional[StateResult]:
    """약 복용자(11=3)에게 적용하지 않는 상태. 결측 확인보다 먼저 본다(해석 D-16)."""
    if ctx.presence.get("medication") and ctx.med_status == T.MED_ON_TREATMENT:
        res = StateResult(code=code, status=T.STATUS_NOT_APPLICABLE,
                          auxiliary_present=[v for v in auxiliary_vars(code) if ctx.presence.get(v)])
        res.evidence.update({"step": ctx.step, "medication_status": ctx.med_status})
        return res
    return None


# ───────────────────────────── 위험인자 (PREHTN 출력용) ─────────────────────────────
def risk_factors(ctx: Ctx) -> dict:
    """위험인자 목록. 수치형 기준(BMI·허리둘레·활동량)은 결정 대기(D-07) — None 이면 pending 에 적는다."""
    rf: list[str] = []
    pending: list[str] = []
    sa, ds, fh, hw, act = ctx.var("smoking_alcohol"), ctx.var("diet_sodium"), ctx.var("family_history"), \
        ctx.var("height_weight_waist"), ctx.var("activity")
    if sa.get("smoking") == "current":
        rf.append("smoking_current")
    if sa.get("binge") is True:
        rf.append("binge_drinking")
    if ds.get("salty_habit") is True:
        rf.append("high_sodium_habit")
    if ds.get("photo_soup_stew") is True or ds.get("photo_processed") is True:
        rf.append("sodium_photo_flag")
    if any(fh.get(k) is True for k in ("htn", "stroke", "mi")):
        rf.append("family_history")

    bmi = None
    if hw.get("height_cm") and hw.get("weight_kg"):
        h = hw["height_cm"] / 100.0
        bmi = hw["weight_kg"] / (h * h)
    if bmi is not None:
        if T.RISK_BMI_MIN is None:
            pending.append("bmi")
        elif bmi >= T.RISK_BMI_MIN:
            rf.append("bmi_high")
    waist = hw.get("waist_cm")
    if waist is not None:
        thr = T.RISK_WAIST_CM_MIN_M if ctx.sex == "M" else T.RISK_WAIST_CM_MIN_F
        if thr is None:
            pending.append("waist")
        elif waist >= thr:
            rf.append("waist_high")
    mins = act.get("moderate_min_per_week")
    if mins is not None:
        if T.RISK_ACTIVITY_MIN_PER_WEEK_BELOW is None:
            pending.append("activity")
        elif mins < T.RISK_ACTIVITY_MIN_PER_WEEK_BELOW:
            rf.append("low_activity")
    return {"risk_factors": rf, "n_risk_factors": len(rf), "risk_factors_pending": pending,
            "bmi": _r1(bmi), "waist_cm": waist, "moderate_min_per_week": mins}


# ───────────────────────────── 구현된 규칙 ─────────────────────────────
def rule_elevated(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "ELEVATED")
    if not go:
        return res
    res.evidence["target_step"] = T.ELEVATED_STEP
    return _set(res, ctx.step == T.ELEVATED_STEP)


def rule_prehtn(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "PREHTN")
    if not go:
        return res
    res.evidence["target_step"] = T.PREHTN_STEP
    res.evidence.update(risk_factors(ctx))
    res.notes.append("risk_factors_listed_not_conditioning")   # 해석 D-13
    return _set(res, ctx.step == T.PREHTN_STEP)


def rule_htn_suspect(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "HTN_SUSPECT")
    if not go:
        return res
    res.evidence.update({"target_step": T.HTN_SUSPECT_STEP, "medication_status": ctx.med_status})
    if ctx.med_status == T.MED_ON_TREATMENT:
        # M1 정의상 복약자는 혈압과 무관하게 htn → step 으로 혈압 수준을 알 수 없다 (D-31)
        return _pending(res, PENDING_M1_FIELDS["HTN_SUSPECT"], "htn_step_includes_medication")
    return _set(res, ctx.step == T.HTN_SUSPECT_STEP)


def rule_nocturnal_screen(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "NOCTURNAL_SCREEN")
    if not go:
        return res
    sl, sy = ctx.var("sleep_snoring"), ctx.var("symptom_flags")
    symptoms = {
        "snoring": sl.get("snoring") is True,
        "daytime_sleepiness": sl.get("daytime_sleepiness") is True,
        "nocturia": sl.get("nocturia") is True or sy.get("nocturia") is True,   # 13 또는 8 — 해석 D-18
    }
    n_sym = sum(symptoms.values())
    sym_ok = n_sym >= T.NOCTURNAL_SYMPTOM_MIN
    res.evidence.update({"symptoms": symptoms, "n_symptoms": n_sym, "symptoms_ge_min": sym_ok, "abpm_used": False})
    if sym_ok:
        return _set(res, True)
    # 증상 분기 불충족: 저녁 분기(저녁 step)는 M1 대기 → 음성 확정 불가 (D-32)
    return _pending(res, PENDING_M1_FIELDS["NOCTURNAL_SCREEN"], "evening_branch:pending_m1")


# ───────────────────────────── M1 대기 상태 (결정 가능한 부분만 판정) ─────────────────────────────
def rule_htn_stage2_screen(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "HTN_STAGE2_SCREEN")
    if not go:
        return res
    return _pending(res, PENDING_M1_FIELDS["HTN_STAGE2_SCREEN"])


def rule_ish(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "ISH")
    if not go:
        return res
    return _pending(res, PENDING_M1_FIELDS["ISH"])


def rule_white_coat(ctx: Ctx) -> StateResult:
    na = _not_applicable_if_treated(ctx, "WHITE_COAT")
    if na:
        return na
    res, go = _start(ctx, "WHITE_COAT")
    if not go:
        return res
    res.evidence["medication_status"] = ctx.med_status
    return _pending(res, PENDING_M1_FIELDS["WHITE_COAT"])


def rule_masked(ctx: Ctx) -> StateResult:
    na = _not_applicable_if_treated(ctx, "MASKED")
    if na:
        return na
    res, go = _start(ctx, "MASKED")
    if not go:
        return res
    res.evidence["medication_status"] = ctx.med_status
    return _pending(res, PENDING_M1_FIELDS["MASKED"])


def rule_morning(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "MORNING")
    if not go:
        return res
    res.evidence["medication_status"] = ctx.med_status
    return _pending(res, PENDING_M1_FIELDS["MORNING"])


def rule_resistant_suspect(ctx: Ctx) -> StateResult:
    res, go = _start(ctx, "RESISTANT_SUSPECT")
    if not go:
        return res
    med = ctx.var("medication")
    triple = med.get("triple_with_diuretic")
    drugs = med.get("drugs") or []
    on_tx = ctx.med_status == T.MED_ON_TREATMENT
    res.evidence.update({"medication_status": ctx.med_status, "on_treatment": on_tx,
                         "triple_with_diuretic": triple if on_tx else False, "n_drugs": len(drugs),
                         "min_drugs": T.RESISTANT_MIN_DRUGS, "not_a_substitute_for_medication": True})
    if not on_tx:
        return _set(res, False)                       # 복용 중이 아니면 규칙 불충족 (혈압 무관)
    if triple is None:
        res.status = T.STATUS_NOT_EVALUABLE
        res.missing_required = ["medication.triple_with_diuretic"]
        return res
    if triple is False:
        return _set(res, False)                       # 3제 이뇨제 조건 불충족 (혈압 무관)
    return _pending(res, PENDING_M1_FIELDS["RESISTANT_SUSPECT"])   # 혈압 조건은 M1 대기


RULES: dict[str, Callable[[Ctx], StateResult]] = {
    "ELEVATED": rule_elevated,
    "PREHTN": rule_prehtn,
    "HTN_SUSPECT": rule_htn_suspect,
    "HTN_STAGE2_SCREEN": rule_htn_stage2_screen,
    "ISH": rule_ish,
    "WHITE_COAT": rule_white_coat,
    "MASKED": rule_masked,
    "MORNING": rule_morning,
    "NOCTURNAL_SCREEN": rule_nocturnal_screen,
    "RESISTANT_SUSPECT": rule_resistant_suspect,
}
assert tuple(RULES) == T.STATE_CODES


def evaluate_all(ctx: Ctx) -> dict[str, StateResult]:
    return {code: fn(ctx) for code, fn in RULES.items()}


# ───────────────────────────── 목표 혈압 필드 (A군 규칙과 독립) ─────────────────────────────
def target_bp(ctx: Ctx) -> dict:
    """16·17 로 당뇨·CKD 동반이 확인되면 목표 혈압 필드만 TARGET_BP_COMORBID. 확인 기준은 결정 대기(D-06)."""
    gl, kd = ctx.var("lab_glucose_lipid"), ctx.var("lab_kidney")

    def dm() -> Optional[bool]:
        checks = []
        if gl.get("fpg") is not None and T.DIABETES_FPG_MIN is not None:
            checks.append(gl["fpg"] >= T.DIABETES_FPG_MIN)
        if gl.get("hba1c") is not None and T.DIABETES_HBA1C_MIN is not None:
            checks.append(gl["hba1c"] >= T.DIABETES_HBA1C_MIN)
        return any(checks) if checks else None

    def ckd() -> Optional[bool]:
        checks = []
        if kd.get("creatinine") is not None and T.CKD_CREATININE_MIN is not None:
            checks.append(kd["creatinine"] >= T.CKD_CREATININE_MIN)
        if kd.get("urine_protein") is not None and T.CKD_URINE_PROTEIN_MIN is not None:
            order = ["negative", "trace", "1+", "2+", "3+", "4+"]
            checks.append(order.index(kd["urine_protein"]) >= order.index(T.CKD_URINE_PROTEIN_MIN))
        return any(checks) if checks else None

    d, c = dm(), ckd()
    comorbid = (d is True) or (c is True)
    bp = T.TARGET_BP_COMORBID if comorbid else T.TARGET_BP_DEFAULT
    return {"sbp": bp[0] if bp else None, "dbp": bp[1] if bp else None,
            "diabetes": d, "ckd": c, "basis": "comorbidity" if comorbid else ("default" if bp else None)}

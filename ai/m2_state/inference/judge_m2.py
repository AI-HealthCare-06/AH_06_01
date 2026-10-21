"""inference/judge_m2.py — M2 A군 판정기 (v0.2.0, M1 step 기반).

순서: 계약 검증(범위 밖·형식 오류 → 거부) → 컨텍스트(성별, 복약 상태, M1 step) → 10개 규칙 → 출력.
혈압 수치·가드는 M1 역할이라 여기서 계산하지 않는다. 가드는 M1 의 guard_flag 가 정의되면 연결한다.
출력은 상태 코드와 숫자만 담는다. 출력 스키마(§5 명세 없음 — 임시, D-19):
{
  module, contract_version, thresholds_version, subject_id, as_of,
  data_quality, violations[], presence{}, m1_bp_step{step, step_date},
  guard{triggered: null, pending_m1_field}, target_bp{},
  states{CODE: {status, evidence, missing_required, auxiliary_present, notes}},
  implemented_states[], pending_m1_states[], display_priority: null
}
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Optional

import thresholds as T
import feature_contract as fc
import rules_m2 as R

log = logging.getLogger("m2.judge")


def _blank_states(reason: str) -> dict:
    return {code: {"status": T.STATUS_NOT_EVALUATED, "evidence": {"reason": reason},
                   "missing_required": [], "auxiliary_present": [], "notes": []} for code in T.STATE_CODES}


def build_ctx(payload: dict, presence: dict) -> R.Ctx:
    med = payload.get("medication") or {}
    m1 = payload.get(R.M1) or {}
    return R.Ctx(payload=payload, presence=presence, sex=(payload.get("age_sex") or {}).get("sex"),
                 med_status=med.get("status"), step=m1.get("step") if presence.get(R.M1) else None)


def judge(payload_raw: dict, as_of: Optional[dt.date | str] = None) -> dict:
    if isinstance(as_of, str):
        as_of = fc.to_date(as_of)
    vr = fc.validate(payload_raw)
    payload = vr.payload
    if as_of is None:
        as_of = payload.get("as_of")
    m1 = payload.get(R.M1) or {}
    out: dict[str, Any] = {
        "module": "M2",
        "contract_version": fc.load_contract()["version"],
        "thresholds_version": T.THRESHOLDS_VERSION,
        "subject_id": payload.get("subject_id"),
        "as_of": as_of.isoformat() if as_of else None,
        "data_quality": vr.data_quality,
        "violations": [v.as_dict() for v in vr.violations],
        "presence": dict(vr.presence),
        "m1_bp_step": {"step": m1.get("step"),
                       "step_date": m1["step_date"].isoformat() if m1.get("step_date") else None},
        "guard": {"triggered": None, "pending_m1_field": "guard_flag"},   # §2 가드는 M1 플래그 정의 후 연결
        "target_bp": None,
        "states": _blank_states("data_rejected"),
        "implemented_states": list(T.IMPLEMENTED_STATES),
        "pending_m1_states": list(T.PENDING_M1_STATES),
        "display_priority": None,   # 결정 대기 D-20
    }
    if not vr.ok:
        log.info("m2 rejected subject=%s data_quality=%s n_violations=%d",
                 out["subject_id"], vr.data_quality, len(vr.violations))
        return out

    ctx = build_ctx(payload, vr.presence)
    results = R.evaluate_all(ctx)
    out["states"] = {code: r.as_dict() for code, r in results.items()}
    out["target_bp"] = R.target_bp(ctx)
    log.info("m2 done subject=%s step=%s positives=%s", out["subject_id"], ctx.step,
             [c for c, r in results.items() if r.status == T.STATUS_POSITIVE])
    return out

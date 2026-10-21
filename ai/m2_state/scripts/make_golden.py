"""scripts/make_golden.py — 골든 케이스 20건(상태별 2건) 초안 생성 (v0.2.0, M1 step 기반).

- 입력은 tests/builders.full_payload 로 만든다. step 과 복약 상태의 조합은 M1 정의(복약자 → htn)와 모순되지 않게 둔다.
- expected 는 현재 엔진 출력을 고정한 것(초안). 검토·확정 전까지 "draft": true.
- 실행:  python3 scripts/make_golden.py   → tests/golden/*.json, docs/golden_cases_draft.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import thresholds as T                                   # noqa: E402
from inference.judge_m2 import judge                     # noqa: E402
from tests.builders import full_payload                  # noqa: E402
from tests.cases import DRUGS4                           # noqa: E402

GOLDEN_DIR = ROOT / "tests" / "golden"
DOC = ROOT / "docs" / "golden_cases_draft.md"
NML, ELV, PRE, HTN = T.STEP_NORMAL, T.STEP_ELEVATED, T.STEP_PREHTN, T.STEP_HTN
P, N, NE, NA = T.STATUS_POSITIVE, T.STATUS_NEGATIVE, T.STATUS_NOT_EVALUABLE, T.STATUS_NOT_APPLICABLE
SYM2 = {"snoring": True, "daytime_sleepiness": True}


def cases() -> list[dict]:
    c: list[dict] = []

    def add(cid, state, desc, payload, intended):
        c.append({"id": cid, "state": state, "description": desc, "payload": payload, "intended": intended})

    add("G01_ELEVATED_a", "ELEVATED", "step=elevated, 진단 없음, 42세 남", full_payload(step=ELV, med_status=1, age=42, subject_id="G01"), {"ELEVATED": P, "PREHTN": N, "HTN_SUSPECT": N})
    add("G02_ELEVATED_b", "ELEVATED", "step=elevated, 진단·미치료, 60세 여, 위험인자 있어도 ELEVATED 는 step 만 봄", full_payload(step=ELV, med_status=2, age=60, sex="F", smoking="current", salty=True, subject_id="G02"), {"ELEVATED": P, "PREHTN": N})
    add("G03_PREHTN_a", "PREHTN", "step=prehtn, 진단 없음, 위험인자 3(현재흡연·짠식습관·가족력)", full_payload(step=PRE, med_status=1, age=38, smoking="current", salty=True, family_htn=True, subject_id="G03"), {"PREHTN": P, "ELEVATED": N})
    add("G04_PREHTN_b", "PREHTN", "step=prehtn, 진단·미치료, 위험인자 0", full_payload(step=PRE, med_status=2, age=55, sex="F", subject_id="G04"), {"PREHTN": P})
    add("G05_HTN_SUSPECT_a", "HTN_SUSPECT", "step=htn, 진단 없음(미치료) → positive", full_payload(step=HTN, med_status=1, age=58, subject_id="G05"), {"HTN_SUSPECT": P, "WHITE_COAT": NE, "MASKED": NE})
    add("G06_HTN_SUSPECT_b", "HTN_SUSPECT", "step=htn, 약 복용 중 → htn 이 복약 포함이라 bp_level_step 대기", full_payload(step=HTN, med_status=3, age=63, subject_id="G06"), {"HTN_SUSPECT": NE, "WHITE_COAT": NA, "MASKED": NA})
    add("G07_HTN_STAGE2_SCREEN_a", "HTN_STAGE2_SCREEN", "step=htn, 미치료, 증상 문항 있음 → stage2_flag 대기", full_payload(step=HTN, med_status=1, age=50, symptoms={"headache": True}, subject_id="G07"), {"HTN_STAGE2_SCREEN": NE, "HTN_SUSPECT": P})
    add("G08_HTN_STAGE2_SCREEN_b", "HTN_STAGE2_SCREEN", "step=prehtn, 진단·미치료 → stage2_flag 대기 (step 과 무관)", full_payload(step=PRE, med_status=2, age=45, sex="F", subject_id="G08"), {"HTN_STAGE2_SCREEN": NE, "PREHTN": P})
    add("G09_ISH_a", "ISH", "step=htn, 72세 여 미치료 → ish_flag 대기", full_payload(step=HTN, med_status=1, age=72, sex="F", subject_id="G09"), {"ISH": NE, "HTN_SUSPECT": P})
    add("G10_ISH_b", "ISH", "step=elevated, 68세 남 → ish_flag 대기", full_payload(step=ELV, med_status=1, age=68, subject_id="G10"), {"ISH": NE, "ELEVATED": P})
    add("G11_WHITE_COAT_a", "WHITE_COAT", "step=prehtn, 진단 없음 → office_step 대기", full_payload(step=PRE, med_status=1, age=44, subject_id="G11"), {"WHITE_COAT": NE, "MASKED": NE})
    add("G12_WHITE_COAT_b", "WHITE_COAT", "step=htn, 약 복용 중 → not_applicable", full_payload(step=HTN, med_status=3, age=60, sex="F", subject_id="G12"), {"WHITE_COAT": NA, "MASKED": NA})
    add("G13_MASKED_a", "MASKED", "step=normal, 진단·미치료 → office_step 대기", full_payload(step=NML, med_status=2, age=49, subject_id="G13"), {"MASKED": NE, "WHITE_COAT": NE, "ELEVATED": N})
    add("G14_MASKED_b", "MASKED", "step=htn, 약 복용 중 → not_applicable", full_payload(step=HTN, med_status=3, age=52, sex="F", subject_id="G14"), {"MASKED": NA})
    add("G15_MORNING_a", "MORNING", "step=htn, 미치료 → morning_step·evening_step 대기", full_payload(step=HTN, med_status=1, age=61, subject_id="G15"), {"MORNING": NE, "HTN_SUSPECT": P})
    add("G16_MORNING_b", "MORNING", "step=prehtn, 진단·미치료 → 대기", full_payload(step=PRE, med_status=2, age=39, subject_id="G16"), {"MORNING": NE})
    add("G17_NOCTURNAL_SCREEN_a", "NOCTURNAL_SCREEN", "step=normal, 코골이+주간졸림 → 증상 분기 positive", full_payload(step=NML, med_status=1, age=56, sleep=SYM2, subject_id="G17"), {"NOCTURNAL_SCREEN": P, "ELEVATED": N})
    add("G18_NOCTURNAL_SCREEN_b", "NOCTURNAL_SCREEN", "step=htn 미치료, 증상 1(야뇨) → 저녁 분기 대기, HTN_SUSPECT 는 positive", full_payload(step=HTN, med_status=1, age=48, sleep={"nocturia": True}, subject_id="G18"), {"NOCTURNAL_SCREEN": NE, "HTN_SUSPECT": P})
    add("G19_RESISTANT_SUSPECT_a", "RESISTANT_SUSPECT", "약 4제(이뇨제 포함), step=htn → 혈압 조건 bp_level_step 대기", full_payload(step=HTN, med_status=3, triple=True, drugs=DRUGS4, age=64, subject_id="G19"), {"RESISTANT_SUSPECT": NE, "HTN_SUSPECT": NE})
    add("G20_RESISTANT_SUSPECT_b", "RESISTANT_SUSPECT", "약 복용 중이나 3제 이뇨제 아님 → negative (혈압 무관)", full_payload(step=HTN, med_status=3, triple=False, age=70, sex="F", subject_id="G20"), {"RESISTANT_SUSPECT": N})
    return c


SHORT = {"positive": "+", "negative": "-", "not_evaluable": "NE", "not_applicable": "NA", "not_evaluated": "X"}
ABBR = {"ELEVATED": "ELEV", "PREHTN": "PRE", "HTN_SUSPECT": "SUSP", "HTN_STAGE2_SCREEN": "ST2", "ISH": "ISH",
        "WHITE_COAT": "WC", "MASKED": "MASK", "MORNING": "MORN", "NOCTURNAL_SCREEN": "NOCT", "RESISTANT_SUSPECT": "RES"}


def main() -> int:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for f in GOLDEN_DIR.glob("G*.json"):
        f.unlink()
    rows, mismatches = [], []
    for c in cases():
        out = judge(c["payload"])
        st = {k: v["status"] for k, v in out["states"].items()}
        missing = {k: v["missing_required"] for k, v in out["states"].items()}
        for code, want in c["intended"].items():
            if st[code] != want:
                mismatches.append((c["id"], code, want, st[code]))
        rec = {"id": c["id"], "state": c["state"], "draft": True, "description": c["description"],
               "intended": c["intended"], "input": c["payload"],
               "expected": {"data_quality": out["data_quality"], "step": out["m1_bp_step"]["step"],
                            "states": st, "missing_required": missing, "target_bp": out["target_bp"]}}
        (GOLDEN_DIR / f"{c['id']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        med = c["payload"]["medication"]["status"]
        noct = out["states"]["NOCTURNAL_SCREEN"]["evidence"].get("n_symptoms", "-")
        rows.append([c["id"], c["description"], c["payload"]["m1_bp_step"]["step"], str(med), str(noct),
                     *[SHORT[st[code]] for code in T.STATE_CODES]])

    hdr = ["ID", "설명", "step", "11", "수면증상"] + [ABBR[c] for c in T.STATE_CODES]
    lines = ["# 골든 케이스 20건 초안 (검토 전, v0.2.0 M1 step 기반)", "",
             "- 상태별 2건. `expected` 는 현재 엔진 출력을 고정한 것이며 검토·확정 전까지 draft.",
             "- 기호: `+` positive, `-` negative, `NE` not_evaluable(필수 결측 또는 M1 필드 대기), `NA` not_applicable, `X` not_evaluated.",
             "- 11 = medication.status (1 진단 없음 / 2 진단·미치료 / 3 약 복용 중). 수면증상 = 코골이·주간졸림·야뇨 개수.",
             "- M1 대기 상태(ST2·ISH·WC·MASK·MORN·RES)는 지금 결정 가능한 부분(복약자 NA, 미복약 RES −)만 내고 나머지는 NE.",
             "- 열 약어: ELEV=ELEVATED, PRE=PREHTN, SUSP=HTN_SUSPECT, ST2=HTN_STAGE2_SCREEN, WC=WHITE_COAT, MASK=MASKED, MORN=MORNING, NOCT=NOCTURNAL_SCREEN, RES=RESISTANT_SUSPECT",
             "", "| " + " | ".join(hdr) + " |", "|" + "---|" * len(hdr)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    lines += ["", "## 의도한 상태 ↔ 엔진 출력 대조", ""]
    if mismatches:
        lines += ["| ID | 상태 | 의도 | 엔진 |", "|---|---|---|---|"]
        lines += [f"| {cid} | {code} | {want} | {got} |" for cid, code, want, got in mismatches]
    else:
        lines.append("불일치 없음 (의도한 상태 전부 엔진 출력과 같음).")
    DOC.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""복약 상태별 테스트 (① 진단 없음 / ② 진단·미치료 / ③ 약 복용 중)."""
from __future__ import annotations

import pytest

import thresholds as T
from rules_m2 import M1
from tests.cases import CANON
from tests.conftest import state

P, N, NA, NE = T.STATUS_POSITIVE, T.STATUS_NEGATIVE, T.STATUS_NOT_APPLICABLE, T.STATUS_NOT_EVALUABLE
S1, S2, S3 = T.MED_NO_DIAGNOSIS, T.MED_DIAGNOSED_UNTREATED, T.MED_ON_TREATMENT

EXPECTED = {
    "ELEVATED":          {S1: P, S2: P, S3: P},
    "PREHTN":            {S1: P, S2: P, S3: P},
    "HTN_SUSPECT":       {S1: P, S2: P, S3: NE},    # 복약자는 bp_level_step 대기 (D-31)
    "HTN_STAGE2_SCREEN": {S1: NE, S2: NE, S3: NE},
    "ISH":               {S1: NE, S2: NE, S3: NE},
    "WHITE_COAT":        {S1: NE, S2: NE, S3: NA},
    "MASKED":            {S1: NE, S2: NE, S3: NA},
    "MORNING":           {S1: NE, S2: NE, S3: NE},
    "NOCTURNAL_SCREEN":  {S1: P, S2: P, S3: P},
    "RESISTANT_SUSPECT": {S1: N, S2: N, S3: NE},    # triple=True 고정. 복약자는 bp_level_step 대기
}
CASES = [(code, s) for code in T.STATE_CODES for s in (S1, S2, S3)]


@pytest.mark.parametrize("code,med_status", CASES, ids=[f"{c}-status{s}" for c, s in CASES])
def test_medication_status(code, med_status):
    r = state(CANON[code](med_status=med_status), code)
    assert r["status"] == EXPECTED[code][med_status]
    if r["status"] == NA:
        assert r["evidence"]["medication_status"] == S3 and r["missing_required"] == []


def test_medication_white_coat_masked_not_applicable_precedes_missing():
    for code in ("WHITE_COAT", "MASKED"):
        p = CANON[code](med_status=S3)
        p["smoking_alcohol"] = None
        assert state(p, code)["status"] == NA      # 해석 D-16


def test_medication_htn_suspect_treated_lists_bp_level_step():
    r = state(CANON["HTN_SUSPECT"](med_status=S3), "HTN_SUSPECT")
    assert r["missing_required"] == [f"{M1}.bp_level_step"] and r["evidence"]["medication_status"] == S3


def test_medication_resistant_untreated_is_negative_regardless_of_triple():
    for s in (S1, S2):
        r = state(CANON["RESISTANT_SUSPECT"](med_status=s, triple=True), "RESISTANT_SUSPECT")
        assert r["status"] == N and r["evidence"]["on_treatment"] is False

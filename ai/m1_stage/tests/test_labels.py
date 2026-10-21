"""
[파일] tests/test_labels.py
[용도] 명세 2-2 라벨 규칙(정상/주의/전단계/고혈압, 복약 → 고혈압), 2회 미만 측정 제외, 평균 컬럼 우선 규칙을 검사한다.
[왜 필요한가] 라벨이 틀리면 모든 지표가 틀린다. 경계값(120/130/140, 80/90)이 thresholds.py 와 함께 바뀌어도 규칙이 유지되는지 확인한다.
[쓰는 곳] pytest
"""

import numpy as np
import pandas as pd

import thresholds as T
from m1.contract import Contract
from m1.labels import make_labels, stage_index


def test_stage_rules():
    sbp = np.array([118, 125, 125, 135, 118, 142, 118, np.nan])
    dbp = np.array([78, 78, 82, 70, 92, 70, 78, 78])
    med = np.array([0, 0, 0, 0, 0, 0, 1, 0])
    out = stage_index(sbp, dbp, med)
    exp = [0, 1, 2, 2, 3, 3, 3, np.nan]
    assert np.allclose(out[:-1], exp[:-1]) and np.isnan(out[-1])


def test_make_labels_requires_two_measurements():
    c = Contract.load()
    df = pd.DataFrame({"sbp_1": [120, 150, 110], "sbp_2": [124, np.nan, 112], "dbp_1": [70, 90, 60], "dbp_2": [72, 92, 62], "htn_med": [0, 0, "예"]})
    y, info = make_labels(df, c)
    assert y.tolist()[0] == T.STAGE_INDEX["elevated"]
    assert np.isnan(y.iloc[1])          # 수축기 1회만 → 제외
    assert y.iloc[2] == T.STAGE_INDEX["htn"]   # 복약
    assert info["rows_labeled"] == 2


def test_make_labels_mean_columns_preferred():
    c = Contract.load()
    df = pd.DataFrame({"sbp_mean": [131.0], "dbp_mean": [79.0], "sbp_1": [100.0], "sbp_2": [100.0], "dbp_1": [60.0], "dbp_2": [60.0], "htn_med": [False]})
    y, _ = make_labels(df, c)
    assert y.iloc[0] == T.STAGE_INDEX["prehtn"]


def test_sbp_dbp_alias_and_assume_no_med():
    c = Contract.load()
    df = pd.DataFrame({"sbp": [118.0, 150.0], "dbp": [78.0, 70.0]})
    y, info = make_labels(df, c)                         # 복약 컬럼 없음 → 기본은 라벨 생성 안 함
    assert y.isna().all() and info["htn_med_source"] == "없음"
    y2, info2 = make_labels(df, c, med_policy="assume_false")
    assert y2.tolist() == [T.STAGE_INDEX["normal"], T.STAGE_INDEX["htn"]]
    assert info2["med_policy"] == "assume_false" and "sbp 컬럼" in info2["sbp_source"]

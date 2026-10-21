"""
[파일] label_data.py
[용도] 데이터 파일의 각 행에 혈압 단계(stage)를 계산해 hypertension 옆 새 열로 넣은 엑셀을 만든다(학습은 하지 않음).
      규칙은 train.py 가 라벨을 만들 때 쓰는 함수와 같다(m1/labels.py, thresholds.py 경계).
[왜 필요한가] 학습에 쓰인 라벨이 각 행에서 어떻게 정해졌는지 표로 확인하고, 테스트 정답을 같은 규칙으로 만들 수 있게 한다.
             hypertension 열이 있으면 stage=htn 과 일치하는지도 검사해 보고한다.
[쓰는 곳] 사용자가 직접 실행. tests/test_pipeline.py 가 main() 을 호출한다.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from m1.contract import Contract
from m1.data_io import load_table
from m1.labels import with_stage_column


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="각 행의 혈압 단계를 계산해 hypertension 옆 stage 열로 넣은 엑셀 생성")
    ap.add_argument("--data", required=True, help="엑셀/CSV 파일 또는 폴더")
    ap.add_argument("--out", default=None, help="출력 xlsx 경로 (기본 reports/<이름>_with_stage_<시각>.xlsx)")
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--assume-no-med", action="store_true", help="복약 컬럼이 없을 때 비복약 가정 (명세 2-2 복약 규칙 미적용)")
    a = ap.parse_args(argv)
    df, load_info = load_table(a.data, sheet=int(a.sheet) if str(a.sheet).isdigit() else a.sheet, max_rows=a.max_rows)
    if len(load_info["files"]) == 1:
        df = df.drop(columns=["__source_file"])
    out, info = with_stage_column(df, Contract.load(), assume_no_med=a.assume_no_med)
    path = Path(a.out) if a.out else Path("reports") / f"{Path(a.data).stem or 'data'}_with_stage_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_excel(path, index=False)
    print(f"행 {info['rows']} | 단계 계산 {info['rows_labeled']}행, 불가 {info['rows_unlabeled']}행 {info['unlabeled_reasons']}")
    print(f"수축기 {info['sbp_source']} / 이완기 {info['dbp_source']} / 복약 {info['htn_med_source']}")
    print(f"규칙: {info['stage_rule']}")
    print(f"단계 분포: {info['stage_counts']}")
    if info["hypertension_check"]:
        c = info["hypertension_check"]
        print(f"hypertension 일치 검사: 비교 {c['rows_compared']}행, 일치 {c['agree']}, 불일치 {c['disagree']} | 교차표 {c['crosstab']}")
    print(f"저장: {path}")
    return path


if __name__ == "__main__":
    main()

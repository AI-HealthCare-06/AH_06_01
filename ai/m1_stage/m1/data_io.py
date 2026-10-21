"""
[파일] m1/data_io.py
[용도] 지정한 경로(파일 또는 폴더)의 xlsx/xls/csv 를 읽어 하나의 표로 합친다. max_rows(앞 N행), sample_frac(무작위 비율)로 사용 행 수를 제한한다.
[왜 필요한가] 사용자가 train/ 에 엑셀을 넣고 데이터 양을 직접 조절하는 방식을 지원하기 위해서다. 파이프라인은 폴더를 자동으로 읽지 않고
             명령 실행 때 넘긴 경로만 읽는다. 읽은 파일·행 수를 info 로 돌려 보고서에 남긴다.
[쓰는 곳] train.py, profile_data.py, tests/test_pipeline.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

SUPPORTED = (".xlsx", ".xlsm", ".xls", ".csv")


def list_data_files(path: Path | str) -> list[Path]:
    p = Path(path)
    if p.is_file():
        return [p] if p.suffix.lower() in SUPPORTED else []
    if p.is_dir():
        return sorted(f for f in p.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED and not f.name.startswith("~$"))
    return []


def read_one(path: Path, sheet: int | str = 0) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet)


def load_table(
    path: Path | str,
    sheet: int | str = 0,
    max_rows: int | None = None,
    sample_frac: float | None = None,
    seed: int = 42,
) -> tuple[pd.DataFrame, dict]:
    files = list_data_files(path)
    if not files:
        raise FileNotFoundError(f"데이터 파일이 없음: {path} (지원 확장자 {SUPPORTED})")
    parts = []
    info_files = []
    for f in files:
        d = read_one(f, sheet)
        d["__source_file"] = f.name
        parts.append(d)
        info_files.append({"file": f.name, "rows": int(len(d)), "columns": int(d.shape[1] - 1)})
    df = pd.concat(parts, ignore_index=True)
    rows_loaded = int(len(df))
    if sample_frac is not None:
        if not (0 < sample_frac <= 1):
            raise ValueError("sample_frac 은 (0, 1] 범위")
        df = df.sample(frac=sample_frac, random_state=seed).sort_index().reset_index(drop=True)
    if max_rows is not None:
        if max_rows <= 0:
            raise ValueError("max_rows 는 양의 정수")
        df = df.head(max_rows).reset_index(drop=True)
    info = {
        "path": str(path),
        "files": info_files,
        "rows_loaded": rows_loaded,
        "sample_frac": sample_frac,
        "max_rows": max_rows,
        "rows_used": int(len(df)),
    }
    return df, info

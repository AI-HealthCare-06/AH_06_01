# M2 — 혈압 관련 상태 판정 모듈 (A군 10개 상태, v0.2.0)

> 위치: `ai/m2_state/`. 상위 `ai/` 의 모델(M1 B0, M2 예상 혈압, M3)과 `m1_stage/` 와는 별개의 독립 패키지이며 서로 import 하지 않는다. 이 폴더 안에서 실행한다.

M1-S(`ai/m1_stage/`)가 분류한 혈압 단계(step: normal / elevated / prehtn / htn)와 생활 데이터로 A군 10개 상태를 임계값 규칙으로 판정한다. 혈압 수치 계산은 M1 역할이라 하지 않는다. 학습 모델 없음.

## 구성

| 경로 | 내용 |
|---|---|
| `thresholds.py` | 모든 임계값·코드 단일 정의. `None` = 결정 대기 |
| `feature_contract.yaml` | 입력 변수 계약(원본): M1 step + 생활 데이터. 이름·타입·단위·범위·결측·존재 조건·필수/보조. `pending_m1` 필드는 M1 안정화 후 받을 자리 |
| `feature_contract.py` | 계약 로더·검증(`validate`)·평탄 표 변환(`from_table`)·컬럼 대조(`compare_columns`) |
| `rules_m2.py` | 10개 규칙(구현 4 + M1 대기 6), 위험인자 목록, 목표 혈압 필드 |
| `inference/judge_m2.py` | 판정기 `judge(payload, as_of=None) -> dict` |
| `tests/` | step 값별·결측·복약·계약·출력·골든 |
| `tests/golden/*.json` | 골든 케이스 20건(초안, `draft: true`) |
| `scripts/report_tests.py` | pytest 실행 + 규칙별 결과표 → `docs/test_results.md` |
| `scripts/make_golden.py` | 골든 케이스 재생성 → `docs/golden_cases_draft.md` |
| `scripts/apply_data.py` | 데이터 적용 보고(컬럼 대조 → 결측·범위 → 판정 분포 → 동시 발생표) |
| `docs/rules_spec.md` | 규칙 명세서(구현 기준) |
| `docs/m1_interface.md` | M1 에서 받는 것 / 받아야 하는 것 |
| `docs/decisions_needed.md` | 결정 필요 항목 목록 |
| `archive/v0.1_raw_bp/` | 가정혈압 원시값 기반 v0.1 스냅샷(보관용, 실행 대상 아님) |

## 실행 (이 폴더 안에서)

```bash
cd ai/m2_state && python3 -m pip install -r requirements.txt && python3 -m pytest
```

```bash
python3 scripts/report_tests.py
```

```bash
python3 scripts/apply_data.py <데이터 경로> [--aliases aliases.json]
```

## 사용 예

```python
from inference.judge_m2 import judge
out = judge(payload)            # payload 구조는 feature_contract.yaml
out["states"]["HTN_SUSPECT"]    # {"status": ..., "evidence": {...}, "missing_required": [...], ...}
```

데이터 파일은 커밋하지 않는다(`.gitignore`).

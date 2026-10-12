# ai/ — 고혈압 위험도 모델 (AI 팀)

인수인계 문서 「AI팀 인수인계 — 고혈압 위험도 모델 v0.1」(2026-10-12)을 구현하는 폴더.
생활·신체 변수 14개로 **고혈압 참고 위험지수(0~100)** 를 내는 설명 가능한 모델을 만든다.
판정(밴드·표현형·저혈압·응급)은 규칙 트리(개발팀) 담당이며, 이 모델은 대시보드
위험지수와 Quest Ranker 가중치에만 쓰인다.

## 원칙 (바꾸지 않는 것)

- 임계값은 `thresholds_kr_v1.py` 한 곳에서만 정의하고 import 한다. 130/80 등 숫자 하드코딩 금지.
- 피처 이름·단위·범위는 `feature_contract_v1.yaml` 이 원본. 바꾸면 `feature_version` 을 올린다.
- 혈압값(sbp/dbp, home/office 평균)은 어떤 버전에도 피처로 넣지 않는다 (라벨 누수).
- 범위 밖 값은 클리핑하지 않고 `data_quality = out_of_range` 로 거부한다.
- 출력·로그에 "진단", "발병 확률", "고혈압입니다" 를 쓰지 않는다. reason_codes 는 고정 어휘만.
- KNHANES·공단 원시자료는 커밋하지 않는다 (`data/raw/`, `data/processed/` 는 gitignore).

## 구조

```
ai/
├─ thresholds_kr_v1.py        임계값 상수 (KSH 2022)
├─ feature_contract_v1.yaml   피처 계약 v1 (학습·추론 공용)
├─ data/
│  ├─ schema_map.csv          KNHANES 연도별 변수명 → contract 피처 매핑  [10/13]
│  ├─ raw/                    원시자료 (gitignore)
│  └─ processed/              parquet 중간 산출물 (gitignore)
├─ features/contract_v1.py    14개 피처 변환 함수, 학습·추론 공용        [10/13]
├─ labels.py                  T1/T2/T3 라벨 규칙                        [10/13]
├─ train_baseline.py          B0 로지스틱, 시간 분할, AUROC·보정          [10/13]
├─ train_boost.py             B1 단조 제약 LightGBM                     [10/20]
├─ calibrate.py               Platt / isotonic 보정                     [10/20]
├─ eval_external.py           M-lite 공단 검진정보 외부 검증, 하위군 표     [10/20]
├─ inference/predict.py       predict_htn_risk(features) -> RiskResult  [10/20]
├─ tests/test_sanity.py       상식·안전 검증 10종 (CI)                   [10/27]
├─ tests/golden_cases.json    회귀 테스트 20건                           [10/27]
├─ artifacts/                 학습된 모델·보정기 (B0 ≤5MB, B1 ≤20MB)
├─ reports/                   보정 곡선 PNG, 하위군 표 CSV
├─ experiments.md             실험 기록 (날짜·데이터 버전·시드·지표 1줄씩)
└─ model_card.md              출시 모델 설명서                           [10/27]
```

## 데이터

| 역할 | 데이터 | 위치 | 비고 |
|---|---|---|---|
| 주 학습 | KNHANES 2013~2022 원시자료(.sas7bdat) + 연도별 코드북 | `data/raw/knhanes/<year>/` | 회원가입·이용서약 후 다운로드, 재배포 금지 |
| 외부 검증 (M-lite) | 공단 건강검진정보 2022 (100만 표본 CSV) | `data/raw/nhis/` | 라벨은 혈압값 기준만 가능 |
| 해외 보조 | NHANES 2017~2020 | `data/raw/nhanes/` | 아시아계 하위군 보고 |

분할은 **시간 분할** 고정: 학습 2013~2019 / 검증 2020 / 테스트 2021~2022.

## 실행

```bash
cd ai
python -m pip install -r requirements.txt
python train_baseline.py          # B0
python -m pytest tests -q         # 상식·안전 테스트 (아티팩트 없으면 스킵)
```

## 합격선 (B0 기준)

테스트 AUROC ≥ 0.80 · 보정 기울기 0.9~1.1 · 외부 검증 AUROC 하락 ≤ 0.05 · 성별 ECE 차 ≤ 0.05 ·
단건 추론 p95 ≤ 20 ms · 로드 후 메모리 ≤ 200 MB. B1 은 B0 대비 AUROC +0.02 이상일 때만 채택.

# ai/ — 혈압 관련 질환·혈압 증감 예측 모델 (AI 팀)

앱은 혈압 + 생활습관 데이터로 혈압 관련 질환을 추정하고 관리(퀘스트)를 돕는다. 이 폴더는 그중
**입력 건강 데이터로 질환과 혈압의 증감을 예측**하는 모델을 만든다 (범위·변경 이력: `HANDOFF_v0.2.md`, 원 인수인계 v0.1).

| 모델 | 입력 | 출력 | 상태 |
|---|---|---|---|
| M1 고혈압 선별 (B0) | 생활·신체 14개, 혈압 없음 | risk_index 0~100, reason_codes | 완료 |
| M2 예상 혈압·what-if | 생활·신체 14개 | expected_sbp/dbp ± RMSE, whatif, 실측 비교 | 완료 |
| M3 동반 질환 위험 | 혈압 포함 + 14개 + 복약 (계약 v2) | 당뇨·CKD·대사증후군·이상지질 위험지수 | 완료 |
| M4 혈압 추이 | 앱 가정혈압 로그 | 7일 추세 | 규칙 스펙 |
| M1-S 혈압 단계 (4단계 확률) | 생활·신체 16개(나트륨 제외), 혈압 없음 | stage_probs, stage_top, reason_codes | 검토 중 — `m1_stage/` 독립 패키지, 10/21 |

판정(밴드·표현형·저혈압·응급)은 규칙 트리(개발팀) 담당. 모델 결과는 대시보드 참고 카드와 Quest Ranker 에 쓰인다.

## 원칙 (바꾸지 않는 것)

- 임계값은 `thresholds_kr_v1.py` 한 곳에서만 정의하고 import 한다. 130/80 등 숫자 하드코딩 금지.
- 피처 이름·단위·범위는 `feature_contract_v1.yaml` 이 원본. 바꾸면 `feature_version` 을 올린다.
- 혈압값(sbp/dbp, home/office 평균)은 어떤 버전에도 피처로 넣지 않는다 (라벨 누수).
- 범위 밖 값은 클리핑하지 않고 `data_quality = out_of_range` 로 거부한다.
- 출력·로그에 "진단", "발병 확률", "고혈압입니다" 를 쓰지 않는다. reason_codes 는 고정 어휘만.
- KNHANES·공단 원시자료는 커밋하지 않는다 (`data/raw/`, `data/processed/` 는 gitignore).
- **생활습관 요인의 방향·효과 크기 기준은 문헌 근거표** `knowledge/lifestyle_evidence_v1.yaml` (팀 문헌표 17편) 이다.
  KNHANES 단면 계수는 역인과로 방향이 뒤집히므로 근거로 쓰지 않는다. 모델 부호 제약은 근거표와 일치해야 한다(`tests/test_evidence.py`).
  해석: `reports/lifestyle_evidence_vs_knhanes.md`.

## 구조

```
ai/
├─ thresholds_kr_v1.py        임계값 상수 (KSH 2022)
├─ feature_contract_v1.yaml   피처 계약 v1 (학습·추론 공용)
├─ data/
│  ├─ schema_map.csv          KNHANES 연도별 변수명 → contract 피처 매핑  [10/13]
│  ├─ raw/                    원시자료 (gitignore)
│  └─ processed/              parquet 중간 산출물 (gitignore)
├─ features/
│  ├─ contract_v1.py          14개 피처 변환 함수, 학습·추론 공용, 단조 제약 표
│  ├─ knhanes_v1.py           KNHANES 원시 → 계약 입력 (연도별 변수 차이 흡수)
│  └─ sk_transforms.py        age 제곱항 전처리, 부호 제약 로지스틱 (B0)
├─ knowledge/
│  ├─ lifestyle_evidence_papers.csv   팀 문헌표 17편 (원본)
│  ├─ lifestyle_evidence_v1.yaml      요인별 방향·SBP 효과·발생 위험·권고·출처 (기준)
│  └─ evidence.py             로더, EVIDENCE_DIRECTION, 사용자별 lifestyle_evidence()
├─ build_dataset.py           parquet + schema_map.csv + 데이터 감사 리포트
├─ evaluation.py              AUROC·AUPRC·Brier·ECE·보정 기울기·하위군 6셀·보정 곡선 PNG
├─ labels.py                  T1/T2/T3 라벨 규칙                        [10/13]
├─ train_baseline.py          M1 B0 부호 제약 로지스틱, 시간 분할, AUROC·보정
├─ train_boost.py             M1 B1 단조 제약 LightGBM (후보, 미채택)
├─ train_sbp.py               M2 예상 혈압 회귀 (SBP·DBP, 미복용자), what-if 근거
├─ train_comorbidity.py       M3 동반 질환 4개 (계약 v2: features/contract_v2.py, 라벨 labels_m3.py)
├─ m1_stage/                  M1-S 혈압 4단계 확률 모델 (독립 패키지: 계약·임계값·후보 3종·단건 고속 경로·테스트, README 참조)
├─ HANDOFF_v0.2.md            v0.1 대비 범위·계약·인터페이스 변경 기록
├─ eval_external.py           M-lite 공단 검진정보 외부 검증, 하위군 표     [10/20]
├─ inference/
│  ├─ bundle.py               아티팩트 1파일 형식(모델·보정기·대치값·열·버전)
│  ├─ predictor.py            계약 피처 → 위험지수·이유 코드 (순수 함수)
│  └─ predict.py              predict_htn_risk(features) -> dict, 아티팩트 1회 로드  [10/20]
├─ tests/
│  ├─ test_contract.py        계약 변환 규칙 (결측·범위·누수·미적용)         ← 모델 없이 실행
│  ├─ test_labels.py          라벨 규칙·포함 기준                          ← 모델 없이 실행
│  ├─ test_predictor_stub.py  합성 모델로 추론 경로 끝단 검증                ← 모델 없이 실행
│  ├─ test_sanity.py          상식·안전 검증 10종 (CI, 아티팩트 필요)        [10/27]
│  └─ golden_cases.json       회귀 테스트 20건                             [10/27]
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

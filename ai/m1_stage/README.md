# M1 — 생활습관·신체 변수 → 혈압 단계 확률 모델


## 최종 모델 M1-F (2026-10-26 확정: 현재 입력으로 가능한 최선)

- 구성: `m1/chain.py` ChainPreprocessor(입력 15열, 필수 age·sex·bmi·waist_cm, 대치 5개 이상 제외, 범위 밖 제외, 사용자 결측 규칙) → ChainFeatures(문헌 기준값 중심 표준화 + 나이×·성별× 추가 데이터, 42열) → LightGBM 다중분류 → 단계 = argmax. 코드 `m1/final_model.py`.
- 성능: 5겹 교차검증 정확도 0.518 ± 0.006, AUROC ≥140/90 0.731 ± 0.007 (전부 normal 기준선 0.51). 시간 분할 테스트 정확도 0.513, AUROC 0.716. 71개 학습기·설정 탐색에서 더 오르는 조합 없음(`reports/maxsearch_*`). 0.6 은 현재 혈압과 상관 ≥0.6 인 과거 혈압 입력이 있어야 도달(가상 실험).
- 지연: 단건 p95 3.1 ms(기여 요인 포함) / 0.2 ms(제외). 단건 경로 = 배치 경로 검증을 학습 때 수행(불일치면 중단).
- 학습: `python3 train_final.py --data train/ --test-data test/` → `artifacts/final_<run>/`, `reports/final_<run>/`(summary.md, test_predictions.xlsx).
- 추론: `python3 predict_final.py --json '{"age":52,"sex":"male","bmi":27.5,"waist_cm":95,...}'` 또는 `--data <파일/폴더>` → 단계, 4단계 확률, 기여 요인(top_factors), 제외 사유(note).
- 임계값·기준값·행 검증 상수는 `thresholds.py`(CHAIN_*, REFERENCE_*)에 있음. 명세 계약 기반 후보(ordinal/nested/lgbm)와 체인·M1-C 실험 코드는 비교용으로 남겨 둠.

혈압을 입력하지 않은 사용자에게 생활습관·신체 변수만으로 **혈압 4단계(normal / elevated / prehtn / htn)에 속할 확률**을 낸다.
mmHg 점 추정은 제품 출력이 아니다(명세 2-1). 혈압값은 라벨 생성에만 쓰고 피처로는 어떤 형태로도 넣지 않는다(코드가 이름 패턴으로 차단).

## 현재 데이터 조건 (2026-10-20 기준)

| 항목 | 상태 | 코드에서의 처리 |
|---|---|---|
| 혈압 | `sbp`, `dbp` 단일 컬럼 | `sbp_mean`/`dbp_mean` 별칭으로 인식. 2회 이상 평균으로 간주(측정 횟수 검증 불가, 보고서에 기록) |
| 복약(htn_med) | 없음. `hypertension`은 (sbp≥140 or dbp≥90)과 100% 일치하는 파생값 | `--assume-no-med` 를 명시한 실행에서만 비복약 가정으로 라벨 생성(명세 2-2 복약 규칙 미적용) |
| 흡연·스트레스 | 없음 | 해당 변형(smoking, stress, smoking_stress) 자동 생략 → 후보 3종 × base 변형 |
| 나트륨 | 단계와 상관 0.00, 모델 계수 0 | 피처·이유 코드 모두 제거(계약 1.2.0, 명세 2-3 과 다름) |
| 이유 코드 경계 | 문헌 없는 age·alcohol 은 학습 분할 스캔(`threshold_scan.py`) Youden 경계 | `thresholds.py` REASON_RULE=youden; `reason_rule_compare.py` 로 규칙 비교 |
| 결측 행 | 학습·검증은 대치 없는 완전한 행만 사용 | `train.py` 기본값(`--keep-imputed-rows` 로 되돌림). 테스트 분할·추론은 대치 포함 |
| 시간 순서 | `exam_year` 2013~2022 | `--time-col exam_year` 로 과거 학습 / 중간 검증 / 최근 테스트 |
| 합격선 | AUROC(≥140/90) ≥ 0.70 사용자 확정 | 기울기 0.9~1.1·성별 ECE 차 ≤0.05·p95 ≤20 ms 는 명세 예시값 그대로(미확정) |
| 검증 방식 | 테스트 파일의 혈압을 비우고 빈 `step` 열 | `predict_cli.py --data test/` 가 `person_id` + `step` 파일을 만들고 사용자가 정답률 확인 |

## 폴더 구성

| 경로 | 역할 |
|---|---|
| `thresholds.py` | 혈압 단계·이유 코드·위험 등급·데이터 품질 임계값의 **유일한 정의 위치**. 근거 없는 항목은 '근거 없음' 표기 |
| `feature_contract.yaml` | 피처 이름·타입·단위·범위·결측 처리·단조 방향의 **원본**(v1.1.0). 바꾸면 `version` 올림 |
| `train.py` | 학습 CLI: 후보 3종 × 변형 학습·평가·저장, 점검용 보조 혈압 회귀, 단건 경로 동등성 검증 |
| `predict_cli.py` | 추론 CLI: 단건(JSON) / 배치(라벨 없는 파일 → `step_filled.xlsx`, `predictions.xlsx`) |
| `evaluate_cli.py` | 학습된 모델을 혈압 컬럼이 있는 외부 파일로 평가만 |
| `label_data.py` | 각 행의 단계를 계산해 `hypertension` 옆 `stage` 열로 넣은 엑셀 생성 |
| `profile_data.py` | 데이터 프로파일(컬럼·결측·라벨 가능 여부, 학습 안 함) |
| `m1/contract.py` | 계약 로더, 모델 열 순서, 단조 벡터, 혈압 컬럼 차단 |
| `m1/features.py` | 원시 표 → 명세 변수 산출, 범위 검사, 대치·플래그, 표준화 (배치 경로, 학습·추론 공용) |
| `m1/fast_path.py` | 단건 전용 스칼라 변환 경로 + 배치 경로와의 동등성 검증 |
| `m1/labels.py` | 측정 혈압 + 복약 → 4단계 라벨, `stage` 열 생성 |
| `m1/pipeline.py` | CLI 공용 단계: 로드→라벨→행 검증, 단건 샘플, 지연 측정, run/조합 찾기 |
| `m1/data_io.py`, `m1/splits.py` | 지정 경로 읽기(`max_rows`·`sample_frac`), 분할(시간/층화) |
| `m1/models/` | `ordinal`(순서형 로지스틱), `nested`(중첩 이진+Platt), `lgbm`(단조 LightGBM+Platt), `bp_regression.py`(점검용 혈압 회귀 linear·lgbm) |
| `m1/evaluate.py` | AUROC·AUPRC·보정·ECE·정확도·혼동행렬·하위군 + 점검용 hypertension 이진·회귀 지표 |
| `m1/report.py` | `summary.md`·`test_results.xlsx` 작성 |
| `m1/batch.py` | 배치 추론 결과표(상세·분포·`person_id`+`step`·보조 회귀) |
| `m1/reasons.py`, `m1/predict.py`, `m1/plots.py` | 이유 코드 고정 어휘 8개(sodium_high 제거, bmi_high ≥23, age·alcohol 은 데이터 경계: 남 ≥39/여 ≥50세, 남 ≥1.25/여 ≥1.75잔/일 또는 폭음), 추론 API `M1Predictor`, 보정 곡선 |
| `docs/reference_table.md` | 참고 수치표(문헌 근거) |
| `train/`, `test/` | 사용자가 엑셀/CSV를 넣는 폴더. 커밋 제외, 자동 로딩 없음 |
| `reports/`, `artifacts/` | 실행 산출물(보고서·엑셀·그림 / 모델). `artifacts/LATEST` 가 최근 run_id. 커밋 제외 |
| `tests/` | 합성 데이터 기반 코드 테스트(성능 보고용 아님) |

## 실행 순서 (VSCode, 시스템 Python 3.14)

Run and Debug 패널에 아래 명령이 모두 실행 구성으로 들어 있다.

1. **데이터 확인** — `train/` 에 파일을 넣고
   ```bash
   python3 profile_data.py --data train/
   python3 label_data.py --data train/ --assume-no-med --out reports/train_with_stage.xlsx
   ```
   두 번째 명령은 각 행의 단계를 `hypertension` 옆 `stage` 열로 넣은 엑셀을 만들고 hypertension 과의 일치를 검사한다.

2. **학습**
   ```bash
   python3 train.py --data train/ --time-col exam_year --assume-no-med
   ```
   양 조절: `--max-rows 3000`, `--sample-frac 0.3`. 출력: `reports/<run_id>/summary.md`, `test_results.xlsx`, `calibration_*.png`; 모델 `artifacts/<run_id>/<후보>__base/`, 보조 회귀 `artifacts/<run_id>/bp_regression__<linear|lgbm>/`.

3. **테스트 — 정답률 확인 방식** — `test/` 에 혈압(`sbp`, `dbp`, `hypertension`)을 비우고 `step` 열을 둔 파일을 넣고
   ```bash
   python3 predict_cli.py --data test/ --latest --combo all
   ```
   `reports/predict_<run>_<시각>/step_filled.xlsx`: `person_id` + `step`(추정 단계 = stage_top) 두 열, 모델별 시트. 확률을 낼 수 없는 행은 step 에 사유(insufficient / out_of_range / not_applicable).
   `predictions.xlsx`: 행 단위 상세(확률·위험 등급·이유 코드·품질, 점검용 `pred_hypertension`·`pred_hypertension_youden`, `bp_<후보>` 시트의 `pred_sbp`/`pred_dbp`).

4. **테스트 — 혈압이 채워진 파일(지표 평가)**
   ```bash
   python3 evaluate_cli.py --data test/ --latest --assume-no-med                 # 학습된 모델 평가만
   python3 train.py --data train/ --test-data test/ --time-col exam_year --assume-no-med   # 재학습, 테스트는 외부 파일
   ```

5. **단건 추론**
   ```bash
   python3 predict_cli.py --latest --combo nested__base --input-file docs/sample_input.json
   ```

6. **코드 테스트**
   ```bash
   python3 -m pytest
   ```

## 데이터 컬럼 규약

컬럼명은 대소문자 구분 없이 읽는다. 명세 변수 컬럼이 있으면 그대로 쓰고, 없거나 비어 있으면 원시 컬럼에서 산출한다.

- **라벨용(피처 금지)**: `sbp`/`sbp_mean` 또는 `sbp_1, sbp_2, …`; `dbp` 계열 동일; `htn_med`(있을 때). 복약 컬럼이 없으면 `--assume-no-med` 필요.
- **필수 피처**: `age`(19~90), `sex`(male/female/남/여/1/2), `bmi`(14~50, 또는 `height_cm`+`weight_kg`). 결측 시 행 거부.
- **그 외 피처**: `waist_cm, alcohol_week, alcohol_per_day, binge, activity_minutes_week, activity_low_flag, family_htn, sodium_risk_score, sleep_short_flag, diabetes_flag, fasting_glucose, resting_hr, education_years` + 선택 `smoking, stress_score`. 결측은 계약의 방식으로 대치하고 플래그를 세운다.
- **산출용 원시 컬럼(선택)**: `alcohol_freq_per_week`×`alcohol_drinks_per_occasion`, `binge_freq_per_month`, `moderate/vigorous/walk_min_week`, `family_htn_father/mother/sibling`, `sodium_mg_day`, `sleep_hours`, `dm_dx`, `dm_med`, `hba1c`.
- 범위 밖 값은 클리핑하지 않고 `out_of_range` 로 거부한다. 대치 플래그 합이 `INSUFFICIENT_MISSING_COUNT`(5) 이상이면 `insufficient`.

## 출력 (명세 2-6)

```json
{
  "stage_probs": {"normal": 0.12, "elevated": 0.18, "prehtn": 0.33, "htn": 0.37},
  "stage_top": "htn",
  "risk_level": "htn",
  "reason_codes": ["bmi_high", "waist_high", "age"],
  "data_quality": "ok",
  "model_version": "M1-<run_id>-<후보>__base",
  "feature_version": "1.1.0"
}
```
`risk_level` 은 혈압 단계 4단계와 같은 값이며(사용자 결정), stage_top 과 함께 `m1/decision.py` 의 판정 규칙(현재 최대 확률)을 따른다. `data_quality`: ok | partial(대치 있음) | insufficient | out_of_range | not_applicable(혈압값 입력 또는 항고혈압제 복용). 확률이 없는 상태에서는 확률·단계·등급이 null 이고 거부 사유 코드 `problems` 가 붙는다. 모델은 코드·숫자만 내고 문구는 별도 템플릿이 만든다.

## 추론 경로와 보장

단건 `predict(dict)` 는 pandas 없는 스칼라 변환(`m1/fast_path.py`)과 LightGBM Booster 직접 호출로 p95 1~2 ms 다. 학습 때마다 테스트 집합 전체로 배치 경로와 입력 벡터·상태·확률·기여도가 같은지 검증하고 다르면 학습을 중단한다(`test_results.xlsx` 의 `fast_path_check` 시트, 보고서 9절).

## 점검용 출력 (제품 출력 아님)

- `pred_hypertension`(P(htn) ≥ 0.5), `pred_hypertension_youden`(검증 집합 Youden 임계값): hypertension 은 데이터에서 ≥140/90 과 동일하므로 P(htn) 이 대응된다. 유병률 13% 에서 전부 0 으로 판정해도 정확도 0.87 이 나오므로 정확도만으로 판정 성능을 읽을 수 없다(보고서 11절에 민감도·특이도 포함).
- 보조 혈압 회귀 `pred_sbp`/`pred_dbp`: RMSE 수축기 약 13.7 / 이완기 약 8.9 mmHg(내부 테스트). 예측값이 140/90 을 거의 넘지 않아 환산 hypertension 민감도는 0 에 가깝다(보고서 12절).

## 사용자 결정이 필요한 항목

`thresholds.py` 의 '근거 없음'·'명세 미정의' 임시값: insufficient 결측 수, 허리둘레 대치 BMI 구간(≥25 외), fasting_glucose·resting_hr·education_years 범위, smoking·stress 결측 처리. 그 외: 최종 모델 선택, 단계 판정 규칙(`m1/decision.py`, 최대 확률 규칙은 elevated 를 거의 고르지 않음), 범위 밖 행(활동 >2000분·음주 >60잔) 처리, 복약 데이터 확보 여부, 미확정 합격선 3개. 각 학습 보고서 10절에 같은 목록이 출력된다.

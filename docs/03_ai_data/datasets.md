# docs/datasets.md — 데이터셋 정의서 (통합본)

v0.1 · 2026-09-22 · 작성: AI 축 · 근거: 고혈압·당뇨·비만 데이터셋 조사보고서(팀원, 23개) + 나머지 질환 조사(AI 축) 통합
레포 위치: `docs/datasets.md` · 원시 데이터는 레포에 올리지 않는다(`data/`는 `.gitignore`)

> 이 문서는 기업 요구사항 "공개 데이터셋 기반 예측 모델링"의 근거 문서이자 평가 3-1(성능 검증 기록)의 출발점이다. 데이터셋을 바꾸거나 추가하면 이 문서 → `docs/experiments.md` → 요구사항 정의서 FR-PRED 순으로 같이 고친다.

---

## 1. 결론: 채택 데이터셋 4개

| # | 데이터셋 | 역할 | 대상 질환 | 접근 | 라이선스 |
|---|---|---|---|---|---|
| D1 | 국민건강영양조사 KNHANES (질병관리청) | **주 학습 데이터** | 고혈압·당뇨·비만·대사증후군·CKD·이상지질혈증·지방간(대리) | 회원가입 + 이용약관 동의 후 원시자료 다운로드 (무료) | 연구·비영리 이용, **재배포 금지** |
| D2 | 국민건강보험공단 건강검진정보 (공공데이터포털) | 규모 보강 · 나머지 질환 라벨 | 대사증후군·CKD·지방간(대리)·이상지질혈증 + 고혈압·당뇨 판정 밴드 | 가입 없이 CSV 다운로드 | 공공누리 유형 **[확인 필요]** |
| D3 | Diabetes Health Indicators — BRFSS 2015 (Kaggle, CDC 가공) | 베이스라인 · 외부 검증 | 당뇨(전당뇨)·고혈압(자기보고) | 공개 | CC0 (Kaggle 카드) **[확인 필요]** |
| D4 | NHANES (미국 CDC/NCHS) | 검사실 라벨 외부 검증 · 지방간 대리지수 타당성 확인 | 전 질환 | 공개(가입 없음) | 미국 정부 공개자료(퍼블릭 도메인) |

선정 논리(결과보고서에 그대로 쓸 수 있는 세 줄):
1. 한국인 데이터로 학습해야 한국 사용자 위험도로 설명이 된다 → D1·D2.
2. D1은 생활습관·가족력·진단 여부가 있어 우리 온보딩 피처와 1:1이지만 연 6천 명이라 D2(연 100만 명)로 규모를 보강한다.
3. 해외 공개 데이터(D3·D4)는 학습이 아니라 **외부 검증**에 써서 "다른 인구집단에서도 성능이 유지되는가"를 보인다(평가 3-1 가점 포인트).

---

## 2. 채택 데이터셋 상세

### D1. 국민건강영양조사 (KNHANES)

- 출처: https://knhanes.kdca.go.kr · 이용지침서: https://www.data.go.kr/data/15076556/fileData.do
- 다운로드 절차: 사이트 회원가입 → 원시자료 → 연도 선택 → 이용약관 동의 → SAS(.sas7bdat) 다운로드. 지침서·코드북(변수 설명서)을 같이 받는다.
- 사용 연도: 2019~2023 (5개년 병합, 성인 19세 이상) **[확인 필요: 2023·2024 공개 여부]**
- 변환: `pandas.read_sas()` → parquet 저장 (`data/knhanes/knhanes_2019_2023.parquet`, gitignore)
- 주요 변수(연도별 변수명이 조금씩 다르므로 코드북으로 재확인 **[확인 필요]**):
  - 인구·신체: `age`, `sex`, `HE_ht`, `HE_wt`, `HE_BMI`, `HE_wc`(허리둘레)
  - 측정·검사: `HE_sbp`, `HE_dbp`, `HE_glu`(공복혈당), `HE_HbA1c`, `HE_chol`, `HE_HDL_st2`, `HE_TG`, `HE_LDL_drct`, `HE_ast`, `HE_alt`, `HE_crea`, `HE_Upro`(요단백 스틱), 요알부민·요크레아티닌(ACR)
  - 진단·약물: `DI1_dg`/`DI1_pt`(고혈압 진단·치료), `DE1_dg`/`DE1_pt`(당뇨), `DI2_dg`(이상지질혈증), 신장질환·간질환 진단 항목
  - 가족력: `HE_HPfh1~3`(고혈압 부·모·형제), `HE_DMfh1~3`(당뇨)
  - 생활습관: 현재흡연(`sm_presnt` 또는 `BS3_1`), 음주 빈도(`BD1_11`), 걷기 일수(`BE3_31`), 중강도 신체활동, 수면시간(`Total_slp_wk`)
- 장점: 우리 온보딩 피처 전부 존재, 정확한 나이, 진단 여부 라벨 가능
- 주의: 재배포 금지 → 레포·발표자료에 원시 행을 노출하지 않음. 가중치 변수(`wt_*`)는 모델 학습에는 쓰지 않고, 유병률 통계를 낼 때만 사용.

### D2. 국민건강보험공단 건강검진정보

- 출처: https://www.data.go.kr/data/15007122/fileData.do (최신 등록명 "국민건강보험공단_건강검진정보_20241231")
- 다운로드: 로그인 없이 파일 다운로드(연도별 CSV, 각 약 100만 행) → `data/nhis/` (gitignore)
- 주요 컬럼(2018년 이후 형식 기준, 실제 파일로 재확인 **[확인 필요]**): 기준년도, 가입자일련번호, 시도코드, 성별코드, 연령대코드(5세 단위), 신장(5cm 단위), 체중(5kg 단위), 허리둘레, 시력·청력, 수축기혈압, 이완기혈압, 식전혈당, 총콜레스테롤, 트리글리세라이드, HDL, LDL, 혈색소, **요단백(1~6등급)**, **혈청크레아티닌**, **AST(지오티)·ALT(지피티)·감마지티피**, 흡연상태(1 비흡연/2 과거/3 현재), 음주여부, 구강검진 항목
- 장점: 규모, 가입 불필요, 소변 스틱 등급이 우리 입력과 같은 단위, 나머지 질환 라벨 전부 가능
- 한계: 운동·수면·가족력·진단 여부 없음 → 생활습관 피처 모델의 주 학습에는 부적합, **판정 밴드·규칙 기반 라벨(대사증후군·지질·CKD·지방간 지수)의 통계와 검증**에 사용. 키·몸무게가 5단위 구간이라 BMI가 거칠고 연령이 5세 구간. 지질 4항목은 검진 주기(4년) 때문에 결측이 많아 결측 아닌 행만 사용.

### D3. Diabetes Health Indicators — BRFSS 2015 (Kaggle)

- 출처: https://www.kaggle.com/datasets/alexteboul/diabetes-health-indicators-dataset (CDC BRFSS 2015를 정제한 3개 CSV)
- 사용 파일: `diabetes_012_health_indicators_BRFSS2015.csv` (253,680행, 라벨 0 정상/1 전당뇨/2 당뇨)
- 컬럼(21): `Diabetes_012`, `HighBP`, `HighChol`, `CholCheck`, `BMI`, `Smoker`, `Stroke`, `HeartDiseaseorAttack`, `PhysActivity`, `Fruits`, `Veggies`, `HvyAlcoholConsump`, `AnyHealthcare`, `NoDocbcCost`, `GenHlth`, `MentHlth`, `PhysHlth`, `DiffWalk`, `Sex`, `Age`(13구간), `Education`, `Income`
- 용도: (1) 파이프라인·베이스라인 코드를 첫 주에 돌려 보는 용도(다운로드 즉시 가능) (2) 당뇨 모델 외부 검증. 라벨이 **자기 보고 진단**이라 혈당 누수가 없고 피처 구성이 우리와 가장 비슷함
- 한계: 미국인 자기 보고 설문, 허리둘레·혈당·수면 없음, 나이가 구간값

### D4. NHANES (CDC)

- 출처: https://wwwn.cdc.gov/nchs/nhanes/ · 사이클별 XPT 파일, 가입 없음. 사용 사이클: 2017–2020(Pre-pandemic) + 2021–2023 **[확인 필요]**
- 파일 ↔ 용도: `DEMO`(나이·성별) · `BMX`(BMI·허리둘레) · `BPXO`(혈압) · `GLU`/`GHB`(공복혈당·HbA1c) · `TCHOL`/`HDL`/`TRIGLY`(지질) · `BIOPRO`(크레아티닌·AST·ALT·GGT) · `ALB_CR`(요알부민·크레아티닌 → ACR) · `LUX`(간 탄성도·CAP → 지방간 직접 라벨) · 설문 `BPQ`/`DIQ`/`MCQ`(진단·가족력) · `SMQ`/`ALQ`/`PAQ`/`SLQ`(흡연·음주·활동·수면)
- 용도: CKD·지질 모델 외부 검증, 지방간 대리지수(HSI/FLI)가 CAP 라벨과 얼마나 맞는지 1회 확인해 결과보고서에 근거로 첨부
- 한계: 미국인 → 학습에는 쓰지 않음

---

## 3. 질환별 라벨 규칙 (학회 기준 → 데이터 컬럼)

| 질환 | 라벨 = 1 조건 | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|
| 고혈압 | 의사진단 또는 혈압약 복용 **또는** SBP≥140 / DBP≥90 | 진단·약물·측정 모두 | 측정만 | 자기보고(HighBP) | 진단·약물·측정 |
| 당뇨 | 의사진단 또는 당뇨약 **또는** 공복혈당≥126 / HbA1c≥6.5 | 모두 | 공복혈당만 | 자기보고(Diabetes_012=2) | 모두 |
| 비만 | BMI≥25 (한국 기준) — 모델 없이 밴드만 | BMI | BMI(5단위) | BMI | BMI |
| 대사증후군 | 5개 중 3개↑: 허리둘레≥90(남)/85(여), 혈압≥130/85 또는 약, 공복혈당≥100 또는 약, TG≥150, HDL<40(남)/50(여) | 5개 전부 | 5개 전부(약물 제외) | 불가 | 5개 전부 |
| CKD | ACR≥30 mg/g 또는 eGFR<60(CKD-EPI 2021) 또는 요단백 스틱 1+↑(보조) | ACR·eGFR·스틱 | 스틱·크레아티닌(eGFR, 나이 구간 중앙값) | 불가 | ACR·eGFR |
| 지방간(대리) | HSI>36 또는 FLI≥60 (초음파 라벨 없음을 명시) | AST·ALT·TG·BMI·허리둘레 | 동일 | 불가 | 대리지수 + CAP 직접 라벨(검증) |
| 이상지질혈증 | 진단·약물 또는 LDL≥160 / 총콜≥240 / TG≥200 / HDL<40 | 모두 | 지질 4항목 | 자기보고(HighChol) | 모두 |

**라벨 누수 원칙**: 라벨을 만드는 데 쓴 측정값(혈압·혈당·HbA1c·지질·ACR·AST/ALT)은 해당 질환 위험도 모델의 **피처에 넣지 않는다.** 위험도 모델 피처는 §4의 공통 세트로 고정하고, 측정값은 대시보드 '현재 상태 밴드'로만 쓴다. (요구사항 정의서 FR-PRED-02·FR-USER-09)

---

## 4. 공통 피처 매핑표 (온보딩 입력 ↔ 데이터셋 변수)

| 온보딩 피처 (요구사항 정의서) | 코드 피처명 | D1 KNHANES | D2 건강검진정보 | D3 BRFSS | D4 NHANES |
|---|---|---|---|---|---|
| 나이 | `age` | `age` | 연령대코드 → 구간 중앙값 | `Age`(13구간 → 중앙값) | `RIDAGEYR` |
| 성별 | `sex` | `sex` | 성별코드 | `Sex` | `RIAGENDR` |
| BMI (키·몸무게) | `bmi` | `HE_BMI` | 신장·체중(5단위)로 계산 | `BMI` | `BMXBMI` |
| 허리둘레 | `waist_cm` | `HE_wc` | 허리둘레 | — | `BMXWAIST` |
| 흡연 (비/과거/현재) | `smoking` (0/1/2) | `BS3_1` 등 | 흡연상태(1/2/3) | `Smoker`(0/1) | `SMQ020`·`SMQ040` |
| 음주 빈도 (주 n회) | `alcohol_freq` | `BD1_11` | 음주여부(0/1) | `HvyAlcoholConsump`(0/1) | `ALQ121`·`ALQ130` |
| 운동 빈도 (주 n회 30분↑) | `exercise_freq` | `BE3_31`(걷기 일수)·중강도 | — | `PhysActivity`(0/1) | `PAQ` 계열 |
| 수면시간 | `sleep_hours` | `Total_slp_wk` | — | — | `SLD012` |
| 가족력 고혈압/당뇨 | `fh_htn`, `fh_dm` | `HE_HPfh1~3`, `HE_DMfh1~3` | — | — | `MCQ300C`(당뇨) |
| 최근 7일 생활습관 점수 | `ls_activity`, `ls_diet`, `ls_sleep`, `ls_record` | 걷기·식이·수면 항목을 0~1로 정규화해 대리값 생성 | — | `PhysActivity`·`Fruits`·`Veggies`로 대리값 | `PAQ`·`DR1TOT`·`SLQ` |

매핑 규칙: 데이터셋마다 코딩이 다르므로 `ai/features/mapping_<dataset>.py`에 변환 함수를 두고, 온보딩 API의 선택지(요구사항 FR-USER-08)는 D1 코딩을 기준으로 정한다. 결측은 학습·추론에서 같은 규칙(중앙값 대치 + 결측 플래그)으로 처리한다.

"생활습관 점수 → 위험도" 매핑의 의학적 타당성은 기획서 R1 리스크이므로 1차 멘토링 확인 항목으로 유지한다.

---

## 5. 데이터 관리 규칙

- `data/` 전체 `.gitignore`. 레포에는 다운로드 스크립트(`ai/data/download_public.py`: D3·D4 자동, D1·D2는 수동 절차 안내)와 이 문서만 둔다.
- 각 데이터셋은 `data/<dataset>/raw/` 원본 + `data/<dataset>/processed/*.parquet` 가공본. 가공 스크립트는 `--seed` 인자를 받고 분할(train/valid/test = 70/15/15, 층화)은 seed 고정.
- 실험 기록표 `docs/experiments.md`의 "데이터셋(버전)" 열에는 이 문서의 ID(D1~D4)와 사용 연도를 적는다.
- 라이선스 문구 원문은 §7에 옮겨 적고, 발표자료에는 출처 URL을 표기한다. D1 원시 행·D2 개인 단위 행은 화면에 띄우지 않는다(집계값만).
- 데모·시연은 가상 계정 데이터만 사용한다(요구사항 NFR, 기획서 R7).

---

## 6. 검토했으나 채택하지 않은 데이터 (부록)

팀원 조사보고서 23개 + AI 축 조사분을 접근성·피처 정합성 두 기준으로 분류. 결과보고서 "향후 확장 데이터"에 인용할 수 있다.

### 6-1. 접근 절차상 7주 내 불가 (신청·승인·유료) — 향후 검증 후보로만 언급
| 데이터 | 제공처 | 성격 | 비고 |
|---|---|---|---|
| SPRINT, ALLHAT, TOHP, PREMIER, ACCORD, ARIC | NHLBI BioLINCC | 임상시험·코호트 | 기관 IRB + DUA. TOHP·PREMIER는 생활습관 중재 효과 근거로 문헌 인용 가치 있음 |
| DPP, DPPOS, Look AHEAD | NIDDK Central Repository | 당뇨 예방·생활습관 중재 | 데이터 요청 심의. "생활습관 개선 → 당뇨 발생 감소" 근거 문헌으로 인용 |
| MIMIC-IV v3.1 | PhysioNet | 병원 EHR | CITI 교육 + DUA. 입원 환자라 예방 서비스와 목적 불일치 |
| All of Us | NIH | EHR+웨어러블 | Researcher Workbench 승인, 미국 기관 소속 필요 |
| UK Biobank | UK Biobank | 코호트 | 유료·승인 |
| 지역사회건강조사 CHS | 질병관리청 | 건강설문 | 원시자료 신청 가능하나 측정치 없음(자기보고), 승인 대기 |
| HIRA 환자표본자료 | 심평원 | 청구자료 | 신청·심의·폐쇄 분석환경. 진단코드만 있고 생활습관 없음 |
| AI Hub 만성질환 임상·생활습관 데이터(71335) | NIA | CKD·당뇨·고혈압 + 웨어러블 3개월 | 안심존 + IRB. **우리 서비스와 구조가 가장 닮아 향후 검증 1순위** |
| NHISS 표본코호트 | 건보공단 | 종단 | 연구 심의·비용 |

### 6-2. 접근은 되지만 모델 구조에 맞지 않음
| 데이터 | 사유 |
|---|---|
| Blood Pressure and BMI (Kaggle 7,133명) | 혈압·BMI·나이·성별뿐 → 생활습관 피처 없음, 혈압으로 고혈압 라벨 = 누수 |
| Diabetes 130-US Hospitals (UCI 101,766건) | 입원 환자 재입원 예측용. 일반인 위험도와 목적 불일치 |
| Comprehensive Diabetes 100K (Kaggle) | 출처(provenance) 불명 → 성능 보고에 사용 불가. 코드 테스트용만 |
| Estimation of Obesity Levels (Kaggle/UCI 2,111건) | 77% 합성 |
| BRFSS 2021 (Kaggle) / BRFSS 연간 원본 | D3와 중복. 필요 시 D3 대신 최신 연도로 교체 가능 |
| Kaggle Metabolic Syndrome (NHANES 추출 2,401행) | D4 원본으로 대체 가능. 혈압 컬럼 없음 |
| UCI CKD #336 (400행), #857 (200행, CC BY 4.0) | 파이프라인 시험용. #336은 요단백 스틱 등급(al)이 있어 소변 스틱 입력 구조 검증에 사용 가능 |
| Kaggle CKD (rabieelkharoua, 합성 1,659행) | 합성 → 피처 설계 참고만 |
| Kaggle NAFLD (nafld1 17,549행), NAFLD 602행, UCI ILPD 583행 | 검사치 없음 / 환자 내부 분류 / 지방간 특정 아님 |
| Iran Lifestyle Promotion Project (8,814행) | 이상지질혈증 피처 중요도 참고만 |

---

## 7. 라이선스·이용조건 원문 (다운로드 시 채워 넣기)

| 데이터 | 이용조건 요약 | 원문 링크 | 확인자 / 일자 |
|---|---|---|---|
| D1 KNHANES | 원시자료 이용약관: 연구·학술 목적, 제3자 제공·재배포 금지, 결과 공표 시 출처 표기 | knhanes.kdca.go.kr 이용약관 | [확정 필요] |
| D2 건강검진정보 | 공공누리 제_유형 [확인 필요] | data.go.kr 15007122 | [확정 필요] |
| D3 BRFSS 2015 (Kaggle) | CC0 1.0 [확인 필요] | Kaggle 데이터 카드 | [확정 필요] |
| D4 NHANES | 미국 연방정부 공개자료, 출처 표기 권장 | wwwn.cdc.gov/nchs/nhanes | [확정 필요] |

---

## 8. 다음 액션

| # | 할 일 | 담당 | 기한 |
|---|---|---|---|
| 1 | D3 다운로드 → 베이스라인 노트북(`notebooks/02_baseline_brfss.ipynb`)으로 파이프라인 검증 | AI 축 | 9/23 |
| 2 | D2 최신본 다운로드 → 컬럼·행 수·결측률 확인, §2 [확인 필요] 채우기 | AI 축 | 9/23 |
| 3 | D1 회원가입·2019~2023 다운로드·코드북으로 §4 변수명 확정 | AI 축 (+고혈압·당뇨 담당) | 추석 전 |
| 4 | §7 라이선스 원문 채우기, `.gitignore`에 `data/` 추가 | AI 축 · 인프라 | 9/30 레포 세팅 |
| 5 | §4 매핑표 기준으로 온보딩 선택지(FR-USER-08) 확정 → 프론트·백엔드 공유 | AI 축 → 백엔드 | 9/29 |
| 6 | 생활습관 점수 매핑 타당성 멘토 확인 | 팀장 | 1차 멘토링 |

## 출처
- 팀원 조사보고서 "고혈압·당뇨·비만 데이터셋 조사보고서"(2026-09-22, 23개)
- AI 축 조사 "datasets_candidates_나머지질환_v0.1.md"(2026-09-22)
- KNHANES https://knhanes.kdca.go.kr · 건강검진정보 https://www.data.go.kr/data/15007122/fileData.do · BRFSS 2015 https://www.kaggle.com/datasets/alexteboul/diabetes-health-indicators-dataset · NHANES https://wwwn.cdc.gov/nchs/nhanes/ · AI Hub https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71335

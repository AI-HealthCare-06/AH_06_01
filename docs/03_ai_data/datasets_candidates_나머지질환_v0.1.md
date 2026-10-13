# 데이터셋 후보 조사 — 대사증후군 · 만성콩팥병 · 지방간 · 이상지질혈증

v0.1 · 2026-09-22 · AI 축 · 고혈압·당뇨·비만 데이터는 별도 담당(제외)

판단 기준: ① 라벨을 만들 수 있는 검사 항목이 있는가 ② 우리 온보딩 피처(나이·성별·BMI·허리둘레·흡연·음주·운동·수면·가족력)와 겹치는가 ③ 라이선스·접근 절차가 7주 안에 가능한가 ④ 한국인 데이터인가.

표기: ◎ 1순위 / ○ 보조·검증용 / △ 베이스라인·교육용 / ✕ 일정상 불가

---

## 0. 결론 먼저

| 질환 | 1순위 | 보조 | 비고 |
|---|---|---|---|
| 대사증후군 | ◎ 국민건강보험공단 건강검진정보 (허리둘레·혈압·식전혈당·TG·HDL 5개 기준 전부) | ○ KNHANES / △ Kaggle Metabolic Syndrome(NHANES 추출, 2,401행) | 별도 모델 없이 판정 규칙이면 됨. 모델을 만들면 "5기준 중 3개 이상"이 라벨 |
| 만성콩팥병(CKD) | ◎ KNHANES (요단백 스틱 + 요알부민/크레아티닌비 ACR + 혈청 크레아티닌→eGFR) | ○ 건강검진정보(요단백 등급·혈청크레아티닌) / ○ NHANES(미국, ACR·크레아티닌) / △ UCI CKD 400행 | 소변 스틱 등급과 같은 단위(요단백 1~6등급)가 건강검진정보에 있음 |
| 지방간질환 | ○ 건강검진정보·KNHANES (AST·ALT·GGT·TG·BMI·허리둘레로 지방간 지수 계산) | ○ NHANES 2017~(간 탄성도 CAP로 지방간 직접 라벨) / △ Kaggle NAFLD(nafld1, 코호트) | 국내 데이터에는 초음파·CAP 라벨이 없어 **지수 기반 대리 라벨**(HSI·FLI)이 현실적 |
| 이상지질혈증 | ◎ 건강검진정보 (총콜·TG·HDL·LDL) / ◎ KNHANES | ○ NHANES / △ Iran LPP 8,814행 GitHub | 라벨 = 학회 기준(LDL≥160, TG≥200, HDL<40 또는 약물). 검진 입력형이라 추이 표시가 주목적 |

결론: **국민건강보험공단 건강검진정보 + KNHANES 두 개면 네 질환 라벨이 전부 나온다.** 고혈압·당뇨·비만 담당자가 같은 두 데이터셋을 쓸 가능성이 높으므로, 전처리 파이프라인을 하나로 합치는 것이 가장 효율적이다. Kaggle·UCI 소형 데이터는 베이스라인 코드 검증용으로만 쓴다.

---

## 1. 국내 공공 데이터

### 1-1. 국민건강보험공단 건강검진정보 (공공데이터포털) — ◎

- 위치: https://www.data.go.kr/data/15007122/fileData.do (최신 등록명 "국민건강보험공단_건강검진정보_20241231")
- 내용: 일반건강검진 수검자 표본(연도별 약 100만 명) CSV. 기준년도·성별·연령대(5세 단위)·시도, 신장·체중·허리둘레, 수축기/이완기 혈압, 식전혈당, 총콜레스테롤·트리글리세라이드·HDL·LDL, 혈색소, **요단백(1~6 등급)**, **혈청크레아티닌**, **AST·ALT·감마지티피**, 흡연상태, 음주여부, 구강검진 항목
- 우리 질환 커버: 대사증후군 5기준 전부 / CKD(요단백 등급 + 크레아티닌→eGFR, 단 나이가 5세 구간이라 eGFR 계산 시 구간 중앙값 사용) / 지방간 대리지수(HSI = 8×ALT/AST + BMI (+2 여성, +2 당뇨)) / 이상지질혈증 4개 지질 전부
- 장점: 회원가입 없이 바로 다운로드, CSV, 규모 큼, 한국인, 소변 스틱 등급 단위가 우리 입력과 같음
- 단점: 운동·수면·가족력 없음(흡연·음주만) → 생활습관 피처는 KNHANES로 보완 / 지질 4항목은 검진 주기(24세 이상 4년마다) 때문에 결측 많음 → 결측 아닌 행만 사용 / 연령이 5세 구간
- 라이선스: 공공데이터포털 이용허락범위(공공누리 유형) 페이지에서 확인 후 docs/datasets.md에 기록 **[확인 필요]**
- 확인 못 한 것: 2024년 등록본의 정확한 컬럼 목록과 행 수(페이지가 자동 조회로 열리지 않음). 담당자가 직접 내려받아 `df.columns`로 확정할 것

### 1-2. 국민건강영양조사 KNHANES (질병관리청) — ◎

- 위치: https://knhanes.kdca.go.kr (원시자료 → 회원가입 + 이용약관 동의 후 다운로드, SAS/SPSS 포맷). 이용지침서: https://www.data.go.kr/data/15076556/fileData.do
- 내용(검진조사 혈액·소변): 총콜레스테롤·HDL·TG·LDL(일부 연도 직접 측정), AST·ALT, 혈청 크레아티닌, 요산, HbA1c(2011~), 공복혈당, **요단백·요당 스틱, 요알부민·요크레아티닌(ACR, 2011~)**, 코티닌. 건강설문: 의사진단 여부(고혈압·당뇨·이상지질혈증·신부전·간질환 등), 약물 복용, 가족력, 흡연·음주, 걷기·중강도 운동, 수면시간, 식이(영양조사)
- 우리 질환 커버: CKD(ACR≥30 또는 eGFR<60 → 가장 정확한 국내 라벨) / 대사증후군 5기준 / 이상지질혈증(진단·약물 포함) / 지방간 대리지수
- 장점: 운동·수면·가족력·진단 여부까지 있어 **우리 온보딩 피처와 1:1**, 정확한 나이
- 단점: 연도별 표본 약 7~8천 명(성인 약 6천) → 여러 연도(예: 2019~2023) 합쳐야 함, 변수명이 연도별로 조금씩 달라 코드북 매핑 필요, **원시자료 재배포 금지(레포에 올리면 안 됨, .gitignore data/)**, SAS 파일 변환(pandas `read_sas` 가능)
- 확인 못 한 것: 2024년 원시자료 공개 여부(사이트가 동적 렌더링이라 목록을 못 읽음). 2023년 결과가 2024-12 발표됐으므로 2023년까지는 공개된 것으로 추정 **[확인 필요]**

### 1-3. AI Hub "만성질환 관련 임상 및 생활습관 데이터" — ✕ (참고만)

- 위치: https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71335
- 내용: 당뇨·고혈압·**CKD** 환자와 정상군 2,109명, 임상(요단백·HbA1c 등) + 3개월 생활습관·웨어러블 기록. 우리 서비스와 가장 닮은 구조
- 불가 사유: 안심존(오프라인/온라인 폐쇄망)에서만 접근, IRB 승인·연구계획서·기관 증빙 제출 필요 → 7주 내 불가. 결과보고서에 "향후 검증 데이터 후보"로만 언급

### 1-4. 국민건강보험공단 NHISS 표본코호트 — ✕

- https://nhiss.nhis.or.kr — 종단 데이터라 "미래 발병" 라벨이 가능하지만 연구 목적 심의·비용·기간 문제로 부트캠프 범위 밖

---

## 2. 해외 공개 데이터

### 2-1. NHANES (미국 CDC) — ○ 검증·보조

- 위치: https://wwwn.cdc.gov/nchs/nhanes/ (회원가입 없음, 사이클별 XPT 파일)
- 관련 파일: ALB_CR(요알부민·크레아티닌 → ACR), BIOPRO(혈청 크레아티닌·AST·ALT·GGT), TCHOL/HDL/TRIGLY(지질), LUX(2017~ 간 탄성도·CAP → 지방간 직접 라벨), BMX(체측정), BPX(혈압), GLU/GHB(혈당·HbA1c), DIQ/BPQ/MCQ/PAQ/SLQ/SMQ/ALQ(설문: 진단·활동·수면·흡연·음주)
- 용도: CKD·이상지질혈증 모델의 **외부 검증**, 지방간은 CAP 라벨로 "지수 기반 대리 라벨이 얼마나 맞는지" 확인
- 단점: 미국인 → 한국인 위험도로 설명 불가. 최종 모델 학습에는 안 씀

### 2-2. Kaggle Metabolic Syndrome (antimoni) — △

- https://www.kaggle.com/datasets/antimoni/metabolic-syndrome
- NHANES에서 추출(seqn 컬럼), 약 2,401행, 15열: Age·Sex·Marital·Income·Race·WaistCirc·BMI·Albuminuria·UrAlbCr·UricAcid·BloodGlucose·HDL·Triglycerides·MetabolicSyndrome(라벨). 재현 코드 예: https://github.com/calumatos/Metabolic-Syndrome
- 용도: 대사증후군 베이스라인 노트북 하루 만에 만들기. 혈압 컬럼이 없어 5기준 재구성은 불가

### 2-3. CKD 소형 데이터

| 데이터 | 규모 | 내용 | 용도 |
|---|---|---|---|
| UCI Chronic Kidney Disease (#336) https://archive.ics.uci.edu/dataset/336/chronic+kidney+disease | 400행·24피처 | 인도 병원, 혈압·비중·요단백(al)·요당(su)·혈당·요소·크레아티닌·Hb·고혈압·당뇨 등, 결측 많음 | △ 파이프라인 검증. **요단백 스틱 등급(al 0~5)이 피처로 있어 소변 스틱 입력과 구조가 같음** |
| UCI Risk Factor Prediction of CKD (#857) https://archive.ics.uci.edu/dataset/857/risk+factor+prediction+of+chronic+kidney+disease | 200행·28피처 | 방글라데시, CKD stage·eGFR(grf) 포함, **CC BY 4.0** | △ |
| Kaggle CKD (rabieelkharoua) https://www.kaggle.com/datasets/rabieelkharoua/chronic-kidney-disease-dataset-analysis | 약 1,659행 | **합성 데이터**. 생활습관(운동·식이·수면)·가족력·검사치 포함 | △ 피처 설계 참고만, 성능 보고에 쓰지 않음 |
| Kaggle Kidney Disease Dataset (amanik000) https://www.kaggle.com/datasets/amanik000/kidney-disease-dataset | 확인 필요 | 페이지 미확인 | 담당자가 열어서 출처 확인 |

### 2-4. 지방간 소형 데이터

| 데이터 | 규모 | 내용 | 용도 |
|---|---|---|---|
| Kaggle NAFLD (utkarshx27) https://www.kaggle.com/datasets/utkarshx27/non-alcohol-fatty-liver-disease | 약 17,549행 | R survival 패키지 `nafld1`(미국 Olmsted County 코호트): 나이·성별·체중·키·BMI·추적기간·사망. **NAFLD 여부·BMI만 있고 검사치 없음** | △ 생존분석 예제용, 우리 모델엔 부적합 |
| Kaggle/GitHub NAFLD 602행·62열 (Jitika-59) https://github.com/Jitika-59/NAFLD | 602행 | NAFL vs NASH·섬유화 단계, 간효소·지질·인슐린 | △ 진단받은 환자 내부 분류라 예방 서비스와 안 맞음 |
| UCI ILPD Indian Liver Patient (#225) https://archive.ics.uci.edu/dataset/225/ilpd+indian+liver+patient+dataset | 583행 | 간질환 환자 vs 비환자, 빌리루빈·효소·단백 | △ 지방간 특정 아님 |
| NHANES III 초음파 / NHANES 2017~ CAP | 수천 명 | 논문 https://www.wjgnet.com/1948-5182/full/v13/i10/1417.htm 에서 NHANES III 초음파로 3,235명 NAFLD 25% 라벨 | ○ 대리지수 검증용 |

### 2-5. 이상지질혈증

| 데이터 | 규모 | 내용 | 용도 |
|---|---|---|---|
| Iran Lifestyle Promotion Project (GitHub senonaderian/Dyslipidemia) https://github.com/senonaderian/Dyslipidemia | 8,814행·약 502피처 | 지질 5개 라벨, 허리둘레·혈압·활동·식이 등. 논문 https://bmcpublichealth.biomedcentral.com/articles/10.1186/s12889-024-19261-8 | △ 피처 중요도 참고 |
| Kaggle 심장질환 데이터(콜레스테롤 포함) | 다양 | 콜레스테롤은 피처이지 라벨이 아님 | ✕ |

---

## 3. 라벨 정의안 (학회 기준, 데이터셋 컬럼으로 만들 수 있는 것)

| 질환 | 라벨 규칙 | 필요 컬럼 | 비고 |
|---|---|---|---|
| 대사증후군 | 다음 5개 중 3개 이상: 허리둘레 ≥90(남)/85(여) cm, 혈압 ≥130/85 또는 약물, 공복혈당 ≥100 또는 약물, TG ≥150, HDL <40(남)/50(여) | 허리둘레·혈압·혈당·TG·HDL(+약물) | 한국인 허리둘레 기준 사용. 모델보다 판정 규칙이 우선 |
| CKD | ACR ≥30 mg/g 또는 eGFR <60 (CKD-EPI 2021) 또는 요단백 스틱 1+ 이상(보조) | 요알부민·요크레아티닌·혈청크레아티닌·나이·성별 | KNHANES가 ACR 있음. 건강검진정보는 요단백 등급+크레아티닌만 |
| 지방간(대리) | HSI >36 또는 FLI ≥60 (FLI = TG·BMI·GGT·허리둘레) | AST·ALT·GGT·TG·BMI·허리둘레·성별·당뇨 | 초음파 라벨 없음을 명시. NHANES CAP로 대리지수 타당성 1회 확인 |
| 이상지질혈증 | LDL ≥160 또는 총콜 ≥240 또는 TG ≥200 또는 HDL <40 또는 지질약 복용/의사진단 | 지질 4항목(+진단·약물) | 검진 입력형(C등급)이라 대시보드 판정 규칙이 주 용도 |

라벨 누수 주의: 라벨을 만든 검사값(예: ACR·AST/ALT·지질)은 위험도 모델 피처에 넣지 않는다. 피처는 고혈압·당뇨 모델과 동일한 생활습관·인구학 세트로 통일.

---

## 4. 다음 액션

1. 건강검진정보 최신본 다운로드 → 컬럼·행 수·결측률 확인, `docs/datasets.md`에 확정 기록 (담당: AI 축, 9/23)
2. KNHANES 회원가입·최근 5개년(2019~2023) 원시자료 다운로드, 변수명 매핑표 작성 (추석 전 착수)
3. 두 데이터셋의 공통 피처 스키마(나이·성별·BMI·허리둘레·흡연·음주·운동·수면·가족력) 정의 → 고혈압·당뇨 담당자와 공유해 전처리 파이프라인 통일
4. `.gitignore`에 `data/` 추가, 다운로드 절차만 README에 기록
5. 라이선스(공공누리 유형, KNHANES 이용약관) 문구를 `docs/datasets.md`에 그대로 옮기기

## 5. 이번 조사에서 확인하지 못한 것

- Kaggle 데이터셋 페이지는 자동 조회로 본문이 열리지 않아 행 수·라이선스를 기억과 검색 스니펫으로 적음 → 사용 전 담당자가 페이지에서 확인
- 건강검진정보 2024년 등록본의 정확한 컬럼 목록, KNHANES 최신 공개 연도

## 출처

- 공공데이터포털 건강검진정보: https://www.data.go.kr/data/15007122/fileData.do
- KNHANES 원시자료 이용지침서: https://www.data.go.kr/data/15076556/fileData.do · KNHANES: https://knhanes.kdca.go.kr/knhanes/main.do
- AI Hub 만성질환 데이터: https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=71335
- NHANES ACR 파일 예: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/ALB_CR_L.htm · 생화학: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2013/DataFiles/BIOPRO_H.htm
- UCI CKD #336: https://archive.ics.uci.edu/dataset/336/chronic+kidney+disease · #857: https://archive.ics.uci.edu/dataset/857/risk+factor+prediction+of+chronic+kidney+disease · ILPD #225: https://archive.ics.uci.edu/dataset/225/ilpd+indian+liver+patient+dataset
- Kaggle Metabolic Syndrome: https://www.kaggle.com/datasets/antimoni/metabolic-syndrome · 재현 코드: https://github.com/calumatos/Metabolic-Syndrome
- Kaggle CKD(합성): https://www.kaggle.com/datasets/rabieelkharoua/chronic-kidney-disease-dataset-analysis · Kaggle CKD(mansoordaku, UCI 사본): https://www.kaggle.com/datasets/mansoordaku/ckdisease
- Kaggle NAFLD: https://www.kaggle.com/datasets/utkarshx27/non-alcohol-fatty-liver-disease · NAFLD 602행: https://github.com/Jitika-59/NAFLD
- NHANES NAFLD 논문: https://www.wjgnet.com/1948-5182/full/v13/i10/1417.htm
- 이상지질혈증 LPP: https://bmcpublichealth.biomedcentral.com/articles/10.1186/s12889-024-19261-8

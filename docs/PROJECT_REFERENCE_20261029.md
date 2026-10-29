# REXRUN 프로젝트 정리와 사무직 A 30일 데모

기준일: 2026-10-29. 작업 브랜치: `feature/project-docs-persona-month`.

## 전달 파일

[project-reference/2026-10-29](project-reference/2026-10-29/)에 다음 자료를 보관한다.

| 자료 | 읽기용 | 편집·연동용 |
| --- | --- | --- |
| ERD와 데이터 사전 | `REXRUN_ERD.pdf` | `REXRUN_ERD.drawio`, `erd-schema.json` |
| 현재 화면·모달 와이어프레임 | `REXRUN_와이어프레임.pdf` | `REXRUN_와이어프레임.html` |
| 구현 API 계약 | `REXRUN_API_명세서.pdf` | `REXRUN_API.openapi.json` |
| 성능 개선 조사 | `개선방안_5가지.md` | 사용자가 후보를 선택한 뒤 구현 |
| 30일 합성 사용 기록 | `persona-a-30-days.csv` | `persona-a-30-days.json` |
| 문서 시나리오와 구현 차이 | `페르소나A_시나리오_매핑.md` | 원본 사실·추가 가정·미구현 요구 구분 |

전체 묶음: `project-reference/REXRUN_프로젝트자료_20261029.zip`.
원본 DOCX, 인증 정보, 사용자 계정 기록, 빌드 결과, 브라우저 테스트 파일은 묶음에 넣지 않는다.

SQL 문서는 체크인된 마이그레이션 기준이다. 연결 도구의 운영 DB 스키마 조회 권한이 없어 실행 중인 DB와의 일치를 보증하지 않는다. 일일 서베이와 전투 기록은 독립 테이블이 아니라 `game_saves.snapshot` JSON에 있으며 식단 기록은 계정별 기기 저장소에 있다.

## 새 데모

고정 ID는 `office-month-v1`이다. 42세 남성 사무직, 175cm, 78kg, 허리 92cm, 과거 검진 혈압 138/89, 고혈압 진단과 복용 약 없음이라는 사용자 문서의 사실을 사용한다. 혈당·맥박·가족력·수면 증상은 문서에 없어 null로 보존한다.

`frontend/src/design/demo-persona-office-month.json`에 실행일 기준 최근 30일을 구성했다. 내보낸 CSV·JSON의 고정 기간은 2026-09-30~2026-10-29이다. Day 29~30, 걸음 수와 일별 사용 패턴은 합성 가정이다. 기대 판정 단계나 치료 효과를 모델 결과로 만들어 넣지 않는다.

로그인 화면의 **사무직 A · 30일 데모 체험**에서 진입할 수 있다. 기존 **고혈압·당뇨 7일 데모**도 유지한다. 저장 키는 `rexrun-persona:office-month:*`로 분리한다. 최초 주간 기록 퀘스트와 수면 EXP는 현재 보상 함수를 사용하며 재진입 시 중복 지급하지 않는다. 약이 없는 사람의 복약 완료를 생성하지 않으므로 현재의 약 퀘스트가 포함된 모든 메인 완료 보상은 받지 않는다.

개발 중 별도 데모 화면 실행은 `frontend`에서 다음 환경 변수를 지정한다.

```powershell
$env:VITE_REXRUN_CLOUD = 'false'
$env:VITE_REXRUN_DEMO_PERSONA = 'true'
$env:VITE_REXRUN_DEMO_PERSONA_ID = 'office-month-v1'
$env:VITE_REXRUN_DEMO_MODEL_API_URL = 'http://127.0.0.1:8009'
npm ci
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5193 --strictPort
```

분석 서버는 별도 실행이 필요하다. 고정 합성 데모 요청은 `POST /predictions/bp-stage`에 `{"demo_persona":"office-month-v1"}`을 보낸다. 임의의 건강 입력은 계속 인증·동의가 필요하다. 새 고정 ID를 운영 서버에서 쓰려면 해당 서버도 별도 배포해야 한다.

## 검증의 범위

식단·모션 캡처 성능 개선, 모델 교체, 임계값 변경, 운영 배포는 수행하지 않았다. 원본 문서의 구형 Q1~Q5, 별도 혈압·음주 SQL 테이블, 2주 단계 하강 지연 규칙은 현재 구현과 다르며 이번 시드에 추가하지 않았다.

합성 페르소나를 기존 로컬 AI 런타임으로 분석한 원본 응답은 `persona-a-local-model-result.json`에 있다. M1은 실측 혈압 입력이 있어 `not_applicable`이며, M2의 각 상태는 필수 입력 존재 여부에 따라 평가 불가일 수 있다. 실행 환경과 최종 검사 결과는 `검증_기록.md`에 적는다.

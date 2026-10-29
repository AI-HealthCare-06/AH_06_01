# REXRUN 프로젝트 자료

기준일 2026-10-29. 브랜치 feature/project-docs-persona-month. 최신 develop에서 분기하고 이전 PR26의 점수 수정 의존성을 merge commit으로 보존했다. 운영 배포 없음.

- REXRUN_ERD.pdf: 물리 관계도·전체 컬럼 사전·JSON/로컬 저장 구분
- REXRUN_ERD.drawio: diagrams.net에서 편집 가능한 원본
- REXRUN_API_명세서.pdf: 읽기용 API 계약·인증·요청/응답·오류·운영 경계
- REXRUN_API.openapi.json: OpenAPI 3.1 기계 판독 원본
- REXRUN_와이어프레임.pdf: 현재 화면·모달 흐름과 28개 구조도
- REXRUN_와이어프레임.html: 화면 목록을 탐색할 수 있는 편집 가능한 HTML
- 개선방안_5가지.md: 식단·모션 개선 제안과 공식 출처. 아직 적용하지 않음.
- persona-a-30-days.json / .csv: 가상 QA 데이터 30일분
- 페르소나A_시나리오_매핑.md: 원본 사실·합성 가정·현재 구현과 차이

원본 DOCX는 변경하거나 이 묶음에 복제하지 않았다. 운영 DB 조회 권한이 없어 SQL 마이그레이션을 근거로 문서화했다. 생성 파일에 인증키·계정 토큰·실제 사용자 기록은 포함하지 않았다. 서버 명세의 새 데모 ID는 로컬 변경이며 현재 운영 배포 지원을 뜻하지 않는다.

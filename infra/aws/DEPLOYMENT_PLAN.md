# AWS 배포 현황

2026-10-20 / `feature/pixel-adventure-device-quests`.

현재 AWS 웹과 사용자 인증 수집 API는 배포되어 있다. 이전의 합성 이벤트 전용 DynamoDB 검토안은 적용하지 않았다.

최신 구성·ERD·API·기획서 반영·검증·제한은 [실제 데이터 구조·배포 상태](../../docs/architecture/SYSTEM_DATABASE_AND_AWS.md)를 따른다.

- 웹: https://d4vy5vn0lhbgi.cloudfront.net
- API: https://t7uhzwx69l.execute-api.ap-southeast-2.amazonaws.com
- AWS 계정 862330372849, `rexrun`, 시드니.
- 스택: rexrun-test-artifacts, rexrun-test-web, rexrun-test-collector.
- DB: 기존 Supabase Free 프로젝트의 PostgreSQL·RLS. 사용자별 JWT 인증.
- 월 추정 $4.05 / 월 $5 예산 모니터. [계산 가정·단가](pricing/deployed-rdb-estimate-2026-10-19.json).
- 예산은 자동 차단이 아니며 알림 수신자는 미설정이다.
- Ranker·모델 서버·RDS·DynamoDB·NAT·상시 서버 없음.
- Supabase 모바일 자동 업데이트 유지.

CDK는 BootstraplessSynthesizer와 S3의 버전 지정 수집기 아티팩트를 사용한다. Lambda 실행 역할은 지정 로그 그룹 쓰기만 허용한다. 모바일 앱에는 AWS 키나 서버 비밀 키를 넣지 않는다. 7일 로그 보존, API 초당 2/burst 4 제한을 적용한다. 계정 Lambda 동시 실행 한도가 10이므로 최소 100 unreserved 조건을 만족하지 못하는 reserved concurrency는 설정하지 않았다.

운영 재배포 시 실제 계정·리전 확인 후 변경 세트를 검토하고, DB 마이그레이션과 네이티브 호환성을 별도로 확인한다. 이전 `pricing/estimate-2026-10-19.json`, `collector/core.ts`의 합성 이벤트 실험은 배포 전 참고 자료이며 현재 API 계약이 아니다.

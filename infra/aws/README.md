# REXRUN AWS 연결 준비

작성일: 2026-10-19. 작업 브랜치: `feature/pixel-adventure-device-quests`.

사용자가 새로 준비한 AWS 계정으로 웹 데모 호스팅과 백엔드·Model/Ranker API를 준비한다. 기존 AWS 계정의 ID, IAM 사용자, 역할, 버킷, 배포 ID를 재사용하지 않는다. 현재 Supabase 모바일 자동 업데이트는 별도로 유지한다.

현재 단계는 **CLI 연결 완료·비용 산정·로컬 배포 코드 검증**이다. 리소스 생성·배포·IAM 변경·소스 업로드는 실행하지 않았다. 최신 범위와 비용은 [배포 준비안](DEPLOYMENT_PLAN.md), 현재 연결 상태는 [아키텍처](ARCHITECTURE.md)를 따른다. 사용자의 후속 지시에 따라 Ranker 연결은 제외하고 합성 데이터 수집 테스트를 우선한다.

2026-10-19 확인 상태: 새 Google 계정의 `KCJ-AWS-Team Identity Delegated Admin` 프로젝트로 **`rexrun` CLI 프로필 연결과 STS 검증을 완료**했다. 계정 ID는 Git에서 제외한 `connection.local.json`에 고정했다. 같은 계정의 `AccountFullAccessRole`을 사용하며, 기본 리전은 `us-east-1`, 출력 형식은 `json`이다. 기존 default 및 다른 계정의 프로필은 변경하지 않았다. 비밀번호 재설정·IAM/조직 정책 변경·리소스 생성·배포는 수행하지 않았다.

선택한 프로젝트의 전체 권한 콘솔 로그인은 사용자가 명시적으로 승인했다. 이 승인은 다른 조직/관리 계정으로의 로그인이나 정책 변경 승인이 아니다. 계정 연결 검증은 STS 및 선택한 계정의 Identity Center 인스턴스 조회까지 수행했다. 앱 인프라의 배포 권한·예산·리소스 설계 확정은 별도 단계다. 이전의 일회성 로그인 URL은 재사용하지 않는다.

### CLI 오류 진단 결과

문제는 인증 리전 불일치였다. `ap-northeast-2`와 `us-east-2`에서는 같은 계정을 선택한 뒤 `Something went wrong`이 발생했고 프로필이 생성되지 않았다. AWS Settings의 관리 계정 요약은 해당 Identity Center 관리 링크에 `region=us-east-1`을 지정하고 있었다. 같은 Settings 화면에서 기존에 조회를 차단한 SCP가 **리전 정책**임도 확인했다.

CLI 버전·사용자·선택 계정·역할을 유지한 채 `us-east-1`로 인증하자 `aws login`이 성공했고, `aws sts get-caller-identity --profile rexrun`의 계정 ID가 선택한 대상과 일치했다. 같은 리전의 `aws sso-admin list-instances`도 기존 조직 인스턴스를 `ACTIVE`로 반환했다. 오하이오에서의 SSO 조회 거절을 계정 전체의 IAM 권한 부족으로 취급하지 않는다. SCP를 열람·완화하지 않고 허용된 리전에서 해결했다.

공식 근거: [새 AWS 경험의 CLI 리전 오류](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in-troubleshoot.html), [프로젝트 리전 확인](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html). 콘솔 홈에 현재 표시되는 리전만으로 인증 리전을 정하지 않는다. IAM Identity Center 관리 리전과 향후 앱 리소스 배포 리전도 구분한다.

## 1. 새 계정만 선택하기

AWS CLI 2.36.16을 확인했다. 프로젝트는 전용 `rexrun` 프로필을 사용한다. Google 계정 생성, AWS 계정 가입, AWS CLI 접근 승인은 서로 다른 단계다. 인증은 AWS가 제공하는 브라우저 화면에서 진행하며 비밀번호·MFA·인증 캐시를 저장소에 넣지 않는다.

### 가입 방식에 맞는 로그인

Google 등의 소셜 로그인으로 가입한 **새 AWS 경험의 프로젝트**와, 이메일/비밀번호로 만든 **고급 AWS 계정의 루트 사용자**를 구분한다. Google 비밀번호를 루트 사용자 비밀번호 칸에 입력하지 않는다. 루트 인증 실패만으로 비밀번호 오류나 계정 부존재를 단정하지 않는다.

- 소셜 가입 프로젝트: [AWS Settings](https://settings.aws.com) → `Google에서 계속 진행` → 새 계정 → 해당 프로젝트로 들어간다. 프로젝트의 추가 정보에서 실제 리전을 확인한다.
- 고급 계정: 가입 당시 설정한 AWS 자격 증명으로 루트 또는 기존 IAM 경로를 사용한다. 이 프로젝트가 어느 방식인지 확인하기 전 비밀번호 초기화·새 계정 생성·IAM 권한 변경을 시작하지 않는다.
- 프로젝트의 `Create and manage cloud infrastructure` → `Use your AWS credentials with AI coding tools`에서 제공하는 연결 절차를 확인한다. 도구 접근 권한이 새로 확대되는 승인 화면은 권한과 기간을 검토한 뒤 처리한다.

공식 근거: [프로젝트 로그인](https://docs.aws.amazon.com/signin/latest/userguide/sign-in-project.html), [CLI 연결](https://docs.aws.amazon.com/signin/latest/userguide/command-line-sign-in.html), [프로젝트의 AI 도구 연결](https://docs.aws.amazon.com/accounts/latest/reference/connect-ai-coding-tool.html).

이 계정은 검증된 `us-east-1`을 사용하며, `connection.local.json`에도 같은 값을 넣는다. 인증 대기 시간이 만료된 URL을 다시 사용하지 않고 로그인 절차를 새로 시작한다. 이후 명령에는 `--profile rexrun`을 명시한다.

```powershell
aws login --profile rexrun
aws sts get-caller-identity --profile rexrun
```

STS가 반환하는 12자리 계정 ID를 새 계정의 콘솔 ID와 비교한 뒤 설정을 만든다. `connection.example.json`을 `connection.local.json`으로 복사하고 `expectedAccountId`를 입력한다. 예시에는 계정 ID를 비워 두어 인증 전 실행을 차단한다. `connection.local.json`과 검증 보고서는 Git에서 제외한다.

```powershell
# 저장소 루트에서 실행한다. 기존 로컬 파일을 덮어쓰지 않는다.
if (!(Test-Path -LiteralPath 'infra/aws/connection.local.json')) {
  Copy-Item -LiteralPath 'infra/aws/connection.example.json' -Destination 'infra/aws/connection.local.json'
}
# 새 계정의 ID를 채운 후:
node infra/aws/preflight.mjs
node --test infra/aws/preflight.test.mjs
```

`preflight.mjs`는 명시한 프로필의 STS 계정 ID가 예상값과 같을 때만 Free Tier 계정 플랜과 프로젝트 이름의 S3·CloudFront·ECR·ECS·CloudFormation 목록을 읽는다. 이전 셸의 자격 증명·기본 프로필·대체 엔드포인트가 선택을 덮어쓰지 못하게 한다. 권한 거절은 `unknown`으로 기록하며 빈 계정이나 무료 플랜으로 간주하지 않는다. IAM 권한을 추가하지 않는다. 결과는 `infra/aws/.cache/preflight.json`에 남는다.

CLI 인증 기본 리전은 `us-east-1`, **앱 배포 준비 리전은 `ap-southeast-2`(시드니)**다. 조직 SCP `AdvancedModeRegionRestrictionSecurityControlPolicy`를 읽어 지역별 제약을 확인했다. `us-east-1`은 인증·글로벌 서비스 등 일부만 예외로 허용하고, 일반 앱 서비스는 시드니에서 허용한다. 같은 계정으로 시드니의 ECR·ECS·CloudFormation·Lambda·HTTP API·DynamoDB 목록 조회가 성공했다. 로컬 연결 설정에는 배포 리전을 사용하고 Free Tier/공개 가격 조회는 명령별로 `us-east-1`을 명시한다. 조직 정책과 CLI 인증 기본값은 바꾸지 않았다.

## 2. 웹 호스팅 준비안

현재 앱은 React·Vite의 정적 SPA다. 웹 데모는 **비공개 S3 + CloudFront OAC**로 제공하는 안을 사용한다. 상시 웹 서버 없이 `frontend/dist`의 정적 파일을 제공할 수 있다. S3 website endpoint 대신 S3 REST origin을 사용하고, 버킷의 공개 접근 차단을 유지한다. [AWS 정적 웹사이트 지침](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/getting-started-secure-static-website-cloudformation-template.html).

- HTTPS를 사용하고 `/home`, `/character`, `/dashboard` 등 앱 경로를 `index.html`로 연결한다. 자산·API 경로의 실제 404를 HTML로 바꾸지 않는다.
- 해시가 있는 JS/CSS는 긴 캐시, `index.html`은 짧은 캐시로 구분한다. 새 HTML을 마지막에 교체해 이전 자산을 참조하는 중간 상태를 피한다.
- 카메라·MediaPipe WASM·Health Connect 관련 웹/네이티브 경계를 유지한다. MIME 유형, 이미지·폰트·WASM 로딩, 브라우저의 새로고침 경로를 검증한다.
- CSP·HSTS 등 응답 헤더와 제한된 접근 로그를 설정한다. WAF의 요청 제한과 관련 비용도 배포 검토에 포함한다.
- 첫 테스트는 CloudFront 기본 도메인을 사용한다. 유료 도메인을 임의로 구매하지 않는다.

웹 빌드는 `frontend`에서 `npm ci` 후 기존 lint·format·단위 테스트·build·E2E를 수행한다. 배포 대상은 검증한 `dist`만이며 `.env`, 소스 문서, 설문 기록, 인증 캐시, 개인 키, APK를 함께 업로드하지 않는다.

## 3. 백엔드·분석 API 준비안

기존 [앱 구상안](../../docs/REXRUN_모바일앱_뼈대_구상안.md)은 FastAPI → PostgreSQL, 긴 분석은 Redis Streams → AI Worker 구조다. 현재 HTTP 백엔드는 연결되지 않았다. **이번 테스트는 사용자의 후속 지시에 따라 Ranker 연결을 보류하고 데이터 전송·수집만 검증**한다. 이 범위에는 HTTP API → Lambda → DynamoDB를 준비했다. 기존 구상안의 전체 서비스 구조를 이 테스트 수집기로 대체하지 않는다. 향후 모델 추론의 시간·메모리·동시성 측정 결과에 따라 별도 실행 환경을 정한다.

이는 배포 확정이나 모델 실행 성능 판정이 아니다. 실제 백엔드 코드·모델 크기·최대 분석 시간·동시 요청량·GPU 필요 여부를 확인한 후 태스크 크기와 실행 방식을 확정한다. Fargate는 GPU를 지원하지 않으므로 GPU가 필요한 모델은 별도 실행 환경을 설계한다. 상시 ALB·태스크·DB·Redis·NAT의 비용을 무료라고 가정하지 않는다.

준비할 연결 경계:

| 대상        | 현재 상태        | 연결 시 확인할 계약                       |
| ----------- | ---------------- | ----------------------------------------- |
| 인증        | 앱의 데모 세션   | OIDC/JWT 발급자·대상·만료, 사용자별 권한  |
| 프로필·복약 | 로컬 입력과 저장 | 동의·필수 필드·소유자 확인·저장/삭제 정책 |
| 혈압 판정   | 실제 결과 대기   | `docs/toDev` 입력·출력·안전 게이트 계약   |
| Model       | 실제 결과 대기   | 서버가 반환하는 `risk_level`/`risk_index` |
| Ranker      | 실제 결과 대기   | 퀘스트 추천 순서·사유, Model 등급과 분리  |
| 분석 작업   | 미구현           | 접수 202·작업 ID·SSE/재조회·실패/만료     |
| 퀘스트·코인 | 데모 게임 상태   | 서버 날짜·멱등키·원자적 보상 원장         |

API 연결 지점은 `frontend/src/services/dashboard-service.ts`와 `health-profile-payload.ts`다. 후자는 입력 변환만 수행하며 전송하지 않는다. 경로·OpenAPI·인증 계약을 확정하기 전 임의의 의료 응답이나 사용자 정보 업로드를 추가하지 않는다. `docs/toDev`를 반환값 표시의 최우선 근거로 유지한다.

브라우저 origin과 Capacitor Android origin을 구분해 CORS 허용 목록을 설정한다. 건강정보 응답은 CDN에 캐시하지 않는다. DB/Redis는 비공개 네트워크와 인증을 사용하고, 실행 역할과 배포 역할은 분리한다. 장기 AWS 키를 웹 번들에 넣지 않는다. CI/CD 연결 시 GitHub OIDC 역할을 사용한다.

## 4. 실제 배포 전 확정할 것

1. 새 AWS 계정의 STS ID 및 플랜·서비스 권한 확인. root로 로그인한 경우 일상 배포용 권한 설계를 별도로 준비한다.
2. 웹의 첫 CloudFront 도메인, FastAPI/Worker 실행 코드와 이미지, 인증·API 명세 확정.
3. 새 계정의 무료 제공/크레딧과 필요한 서비스의 현재 단가를 확인하고 월 예상 비용·테스트 종료/정리 계획 제시. 예산 알림은 자동 과금 차단과 다르다.
4. S3/CloudFront와 API/데이터 스택을 구분한 IaC 변경안·권한·리소스 목록을 검토한 뒤 배포한다. 현재는 CDK 로컬 합성과 테스트까지 수행했고, bootstrap·변경 세트·deploy는 실행하지 않았다. 실행 역할은 별도 승인된 ARN을 요구해 자동 권한 생성을 피한다.
5. 외부 HTTPS 웹 접속·깊은 경로 새로고침·자산·API health·허용/차단 CORS·인증·갤럭시 API 연결·Supabase 업데이트 유지 여부 검증.

CLI 로그인 절차: [AWS 공식 문서](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html). 이 준비 작업은 AWS 연결과 배포를 분리하며 유료 리소스 생성 승인을 포함하지 않는다.

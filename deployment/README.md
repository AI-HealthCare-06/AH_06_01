# Main 기반 배포

`feature/* → develop → release/* → main` PR을 merge commit으로 병합한다. 배포는 `main` push 또는 `main`에서 실행한 **Deploy production** 수동 실행으로 시작한다. 기능 브랜치, PR, 로컬 변경 파일은 공개 배포할 수 없다. 로컬 검증 APK 빌드는 계속 가능하다.

## 실행 순서

1. 같은 커밋에서 lint, 포맷, 단위 테스트, 빌드, 전체 Playwright 검사를 실행한다.
2. GitHub `production` 환경에서 AWS OIDC 임시 자격을 발급받는다. 환경의 배포 브랜치는 `main`만 허용한다.
3. 현재 `origin/main`과 체크아웃 SHA가 일치하고 소스가 깨끗한지 확인한다. 네이티브 호환 지문과 기존 서명을 검사한다.
4. Node 22, Java 21, Android 36에서 기존 서명 계보를 유지한 APK를 만든다. 웹 버전은 `1.6.<workflow run number>`로 부여한다. 재실행은 같은 버전이며, 다른 파일로 활성화된 버전을 덮어쓸 수 없다.
5. Supabase에 내용 해시로 파일을 업로드하고 원격 SHA-256을 검증한다. 고유 이름의 APK를 S3에 올리고 공개 다운로드 해시를 검증한다. 기존 APK와 에셋은 삭제하지 않는다.
6. 배포 직전에 최신 main을 다시 확인한다. 호환 채널을 활성화한 후 웹, 설치 페이지, `release.json`을 게시하고 CloudFront 캐시를 갱신한다.
7. 공개 파일의 해시를 재검증한다. Actions 결과에는 APK와 공개 출처 자료만 보관한다.

## 환경 설정

- Repository: `AI-HealthCare-06/AH_06_01`, environment: `production`
- Environment variable: `AWS_DEPLOY_ROLE_ARN`
- Environment secret: `REXRUN_SIGNING_BUNDLE` (기존 APK JKS, 암호/별칭, 기존 debug keystore와 서명 계보, OTA RSA 개인 키의 JSON 묶음). `keystoreBase64`, `password`, `alias`, `legacyBase64`, `lineageBase64`, `otaPrivateKey` 필드를 사용한다. 원본과 JSON은 Git에 넣지 않는다.
- 서명 자료는 실행 중 임시 폴더에서만 사용하고 종료 시 제거한다. 암호는 명령 인자에 넣지 않는다. Actions artifact나 로그에 비밀키를 남기지 않는다.
- `iam/trust.json`은 GitHub의 immutable repository/owner ID와 production 환경만 신뢰한다. `iam/permissions.json`은 현재 공개 S3 버킷 업로드와 지정 CloudFront 배포의 캐시 갱신 권한만 부여한다. AWS 장기 액세스 키를 저장하지 않는다.

## 기존 앱과 네이티브 변경

현재 native `1.5.2 (12)`의 웹 번들을 새로 빌드한다. 기존 `1.5.0`, `1.5.1`, `1.5.2` 앱은 기존 Supabase 서명과 채널로 OTA를 받는다. 이전 채널은 보존한다. 웹 변경만으로 APK 재설치를 요구하지 않는다.

Java, Android 리소스, Capacitor 플러그인이나 네이티브 설정 변경 시 `production.json`의 호환 지문이 검사를 중단한다. 새 네이티브 버전, versionCode, 서버 허용 채널 및 실제 구버전 호환성 검증을 함께 반영해야 한다. 호환성이 확인되지 않은 구버전 채널에 새 네이티브 전용 코드를 배포하지 않는다. 현재 네이티브 지문은 텍스트 줄바꿈과 경로 구분자를 정규화하여 Windows와 Linux에서 동일하다.

## 운영 확인 및 복구

- 설치: https://d4vy5vn0lhbgi.cloudfront.net/install/index.html
- 출처: https://d4vy5vn0lhbgi.cloudfront.net/release.json
- GitHub Actions: https://github.com/AI-HealthCare-06/AH_06_01/actions/workflows/deploy.yml

배포는 동시 실행하지 않는다. 여러 서비스에 걸친 게시이므로 중간 실패 시 일부 채널만 활성화될 수 있다. 같은 실행을 재시도하면 이미 동일 파일로 활성화된 채널을 검증하여 이어간다. 파일이 달라진 경우 새 실행 번호로 게시한다. 배포된 버전을 되감지 않고, 수정/복구 커밋을 PR로 main에 반영해 더 높은 웹 버전으로 재배포한다. 이전 다운로드 파일과 서명 키는 보존한다.

이 파이프라인은 공개 웹, APK 및 Supabase OTA를 게시한다. 모델 재학습, 모델/식단 API 인프라 변경, DB 마이그레이션 및 Edge Function의 변경 배포는 별도 검증 절차를 유지한다. 기존 서비스 접속 주소는 앱 설정에서 이어 사용한다. 기존 수동 서버 배포 스크립트에도 clean main 출처 검사를 적용한다.

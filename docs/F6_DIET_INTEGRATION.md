# F6 식단 사진 분석 연동

2026-10-27, `feature/pixel-adventure-device-quests`에서 기존 REXRUN 앱에 통합했다. 원본 `팀원공유_F6_식단사진분석_최종.zip`은 보존했고 별도 데이터베이스 마이그레이션 없이 통합했다. 2026-10-27 AWS 식단 전용 서버에 배포했으며, 기존 native 1.5.0 앱에 서명 OTA 1.5.3으로 연결한다.

## 이용 경로

- Quest → 식단 분석·기록 보기 → `/meals`
- 식사 퀘스트 → 인증하기 → 카메라 촬영 → 사진 아래의 식단 분석
- 사진 선택만으로 전송하지 않는다. 외부 AI 전송 동의 후 `사진으로 분석`을 눌러야 한다.
- 음식명·실제 먹은 양을 수정하고 확인하면 기기에 계정별로 기록한다. 사진은 기록에 포함하지 않는다.
- `직접 입력`은 Vision API 없이 사용할 수 있다. `결과 예시 보기`는 공유본의 고정 예시로, 현재 사진 분석이 아니며 저장/보상에 사용하지 않는다.

## 가져온 자료와 변경 경계

`services/diet-f6/source-provenance.json`에 원본 ZIP SHA-256 및 가져온 파일의 해시를 기록했다. F6의 `diet_vision_v2.md`, OpenAI 공급자와 출력 스키마, 100g당 개발용 음식 DB 및 별칭을 재사용한다. 프롬프트 v2 원문은 유지했다. 불필요한 DB·Redis·임시 사용자 모델·마이그레이션은 기존 서비스에 적용하지 않고, 동의 후 미리보기 결과를 반환하는 별도 FastAPI 어댑터를 구성했다.

음식명은 Vision 응답으로 확인하고 영양값은 샘플 DB × 중량/100으로 계산한다. 유사 이름은 자동으로 다른 음식의 영양값을 배정하지 않고 선택 후보로만 제시한다. 알 수 없는 음식/중량/영양값은 `null`로 보존하고, 일부 항목만 알려진 합계는 누락 표시와 함께 보여 준다. 탄·단·지 비율은 모든 해당 값이 있을 때만 계산한다. 중량·음식명 확인 후 저장하며 식단 기록 저장 자체로 게임 보상을 지급하지 않는다.

현재 영양 DB는 공식 전체 DB가 아닌 공유본의 개발용 근사치다. 원본의 제한된 사진 40장 평가를 실제 사용자 정확도로 확대하지 않는다. 이번 변경은 모델 학습·튜닝이나 새로운 임상 평가가 아니다. 기존 식사 퀘스트 완료 조건과 복약·물 인증을 유지한다. F6의 Q3 2끼/미션 규칙이나 개인별 의료 목표는 현재 앱에 자동 적용하지 않는다.

## 서버 설정

서버 전용 파일: `services/diet-f6/.env` (`.gitignore` 적용). `VISION_API_KEY`를 사용자가 편집하고 저장한다. 빈 값을 명시하면 호스트의 다른 `OPENAI_API_KEY`로 자동 대체하지 않는다. 예시만 `.env.example`에 포함한다.

```dotenv
VISION_API_KEY=
VISION_MODEL=gpt-4o-mini
VISION_BASE_URL=
F6_APP_ENV=local
F6_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

키·헤더·원본 모델 오류 본문을 클라이언트나 로그로 출력하지 않는다. `VISION_BASE_URL`은 공식 OpenAI API를 사용할 때 비워 둔다. 환경파일 변경 후 서버를 재시작한다. 별도 파일을 쓰려면 서버의 `REXRUN_DIET_ENV_FILE`로 경로만 지정한다. 키를 `VITE_` 환경변수 또는 프런트엔드 설정에 넣지 않는다.

로컬 준비와 실행:

```powershell
python -m venv .cache/diet-f6/venv
.cache/diet-f6/venv/Scripts/python.exe -m pip install -r services/diet-f6/requirements-dev.txt
cd frontend
npm run diet:serve
```

다른 터미널에서 `frontend`의 `npm run dev`를 실행한다. 서버는 `127.0.0.1:8006`, Vite 프록시는 `/api/diet`를 사용한다. 프런트엔드 의존성은 변경하지 않았으며 새 환경에서는 기존 lockfile로 `npm ci`를 사용한다.

`GET /api/diet/status`: 설정 여부. 실제 모델 권한이 있다는 보장은 아니다.

`POST /api/diet/analyze`: 사진 파일과 `ai_consent=true`. JPEG/PNG/WEBP 10MB 이하, EXIF 제거 및 1024px 축소, JSON 스키마 검증, 비음식/시간 초과/잘못된 키/출력 오류 구분, 일일 요청 제한과 동시 처리 제한을 적용한다. 이미지 URL을 입력받지 않으며 서버에서 사진을 영구 저장하거나 결과를 공유 캐시하지 않는다. 프레임워크의 임시 업로드 파일은 읽은 뒤 닫는다. 외부 제공자의 데이터 정책은 별도다.

로컬 서버는 loopback과 허용 Origin·개발 헤더에 제한한다. 운영 모드는 Supabase `/auth/v1/user`로 Bearer 세션을 확인하며 로컬 헤더로 인증을 우회할 수 없다. 운영 주소는 `frontend/diet.config.json`에 설정했다. 개발 모드는 기존 Vite 프록시를 사용한다. 운영 서버는 실제 Supabase 계정으로 로그인해야 하며 데모에서는 직접 입력과 결과 예시를 이용한다. Android `https://localhost`, iOS localhost, 공개 웹 Origin을 허용한다. DynamoDB 조건부 갱신으로 계정당 하루 10회, 서버 전체 하루 200회를 제한하며 실패한 모델 호출도 횟수에 포함한다. 카운터는 사진·음식명 없이 해시된 계정 식별자와 날짜·횟수만 보관하고 3일 TTL을 적용한다.

## 기록·보존

식단 기록은 `rexrun-diet-records-v1:<account>`에 별도로 보관한다. 실제 계정과 데모/로컬 기록을 분리하고 로그아웃·계정 교체 시 화면과 진행 중 응답을 분리한다. 사진 변경/화면 종료/분석 중단 시 이전 응답을 폐기한다. 기록에는 음식·중량·영양 스냅샷·DB 버전·끼니·날짜·결과 출처만 저장한다. 다른 기기로 자동 동기화되지 않는다.

## 검증 상태

초기 호스트 키는 `401 invalid_api_key`로 거절됐으며 이 실패 기록을 보존했다. 사용자가 `.env` 키를 편집한 뒤 승인된 개발용 쌀밥 사진 1장으로 로컬 실제 분석이 성공했다. AWS 배포 후 같은 승인 사진으로 별도 1회 실제 분석을 확인해 HTTP 200, 쌀밥 210g, `gpt-4o-mini`, 약 4.36초를 기록했다. 로그인 누락·로컬 개발 헤더 우회·미허용 Origin·동의 누락은 모델 호출 전에 거절한다. 원본 평가셋은 추가 호출하거나 튜닝에 사용하지 않았다. 이는 단일 연결 확인이며 실제 사용자 정확도 검증은 아니다.

자동 검사는 외부 OpenAI 호출을 하지 않는 모의 공급자/응답을 사용한다. 계산, 누락 표시, 동의·인증·오류, 사진 교체와 취소, 저장·계정 분리, 기존 사진 인증, 샘플 기록 금지 및 320/390/430px 화면을 확인한다. 서버 모의 검사 14개와 앱 단위 검사 280개, 식단 브라우저 검사 9개를 통과했다. 모바일 사진은 동의 후 전송 전에 최대 1024px JPEG로 축소하며 깨진 이미지·큰 이미지·취소를 처리한다. 실제 기기의 촬영 정확도는 별도 검증 대상이다.

공식 구현 참고: [OpenAI 이미지 입력](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat), [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Supabase 세션 사용자 검증](https://supabase.com/docs/reference/python/auth-getuser).


## 배포 구성

- 별도 CloudFormation 스택 `rexrun-test-diet-f6`, Sydney 리전, Python 3.13 Lambda Function URL. 기존 수집·M1/M2 서버 스택은 수정하지 않는다.
- 사용자 승인 후 로컬 키를 메모리에서 Secrets Manager `rexrun/test/diet-openai`로 저장했다. CloudFormation 동적 참조로 서버 환경변수를 구성하며 키는 ZIP·프런트엔드·로그에 포함하지 않는다. 키 교체 후에는 서버 환경을 다시 배포해야 한다.
- Lambda payload 제한에 맞춰 앱은 전송 사진을 4MiB 이하로 준비한다. 서버는 기존 10MiB 입력 검증·메타데이터 제거·1024px 정규화도 유지한다.
- 배포 소스: `infra/aws/cdk/diet-stack.ts`, `diet-app.ts`, `infra/aws/diet/`. Linux 의존성은 `requirements-lambda-lock.txt`로 고정한다.
- AWS 계정의 미예약 동시 실행 최솟값 때문에 별도 예약 동시 실행은 설정하지 않는다. 일일 요청 제한은 인스턴스와 무관한 DynamoDB 조건부 갱신을 사용한다.

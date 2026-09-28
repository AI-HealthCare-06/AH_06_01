# REXRUN

건강 행동을 퀘스트로 기록하고 공룡을 성장시키는 모바일 웹 앱입니다. 기획서 v0.2의 기능 흐름을 바탕으로, 제공된 Figma의 디자인을 유지한 **프런트엔드 데모**를 구현했습니다.

## 실행

저장소를 처음 받는 경우 `git clone https://github.com/AI-HealthCare-06/AH_06_01.git` 후 저장소 폴더에서 `git switch develop`을 실행합니다. 새 작업은 `develop`에서 `feature/*`를 만들어 진행합니다. 브랜치·릴리스·핫픽스 규칙은 [Git Flow](docs/GIT_FLOW.md)를 참고하세요.

현재 개발 서버가 실행 중이면 [홈](http://127.0.0.1:5173/home)에서 확인할 수 있습니다. 서버가 꺼져 있으면 프로젝트 루트에서:

```powershell
cd frontend
npm ci
npm run dev
```

이미 의존성을 설치했다면 `npm run dev`만 실행합니다. 첫 진입은 디자인을 바로 확인할 수 있는 홈이며, [로그인·온보딩](http://127.0.0.1:5173/login)도 별도로 열 수 있습니다.

## 구현 범위

- React + TypeScript + Vite, React Router, Zustand, TanStack Query, Zod.
- 홈, 퀘스트, 대시보드, 상점과 로그인, 건강 프로필, 공룡 선택, 첫 결과, 퀘스트 상세, 보상, 버프, 위험도 상세, 시든 상태, 마이페이지: Figma의 14개 화면.
- 90개의 Figma 원본 이미지·SVG와 로컬 글꼴. 런타임에서 임시 Figma URL을 호출하지 않습니다.
- 프로필 입력 검증·BMI 계산, 공룡 선택, 화면 이동, 퀘스트 완료, 코인 적립, 무료 코인 하루 한 번, 새로고침 후 게임 상태 복원.
- 퀘스트 보상은 중복 지급하지 않으며 5개를 모두 완료하면 기본 일일 보상 합계의 50%를 추가 지급합니다. 서울 날짜가 바뀌면 당일 기록과 무료 코인 여부를 초기화하고 코인·공룡 선택은 유지합니다.
- 390 × 844 디자인을 기준으로 만들었으며 좁은 모바일 폭과 데스크톱에서도 화면과 메뉴를 사용할 수 있습니다. 페이지는 일반 문서 흐름으로, 게임 장면 내부만 디자인 좌표로 배치합니다.
- 시간·배터리·카메라 점과 하단 홈 표시기는 데스크톱/노트북 웹 미리보기에서만 표시합니다. 휴대폰·태블릿 브라우저/PWA에서는 OS 표시와 중복되지 않도록 숨기고 안전 영역 여백을 적용합니다. 화면 폭만으로 판정하지 않으므로 좁은 데스크톱 미리보기에서도 표시됩니다. 향후 Capacitor 네이티브 환경에서는 자동으로 제외되며, `VITE_DEVICE_PREVIEW=false`로 빌드 시 명시적으로 끌 수도 있습니다.

## 현재 데모와 서버 연동의 경계

이메일·비밀번호는 검증 후 화면 이동에만 쓰며 **저장·전송하지 않습니다**. 건강 입력값은 메모리에만 있고 새로고침하면 예시로 돌아갑니다. 로컬 저장소에는 공룡 선택, 완료한 퀘스트, 코인과 일일 플래그만 있습니다. 마이페이지의 로그아웃은 데모를 초기 상태로 되돌립니다.

건강 점수·위험도·예측 차트·공룡 능력치는 **Figma 예시 값**입니다. 프로필을 바꿔도 위험도가 실제로 계산되지 않습니다. 원본 화면의 계산 완료 문구·수치를 유지했고 입력 완료 시 데모 안내를 표시합니다. 의료 예측 모델이나 외부 건강 데이터는 연결하지 않았습니다.

실제 인증, 백엔드, AI 예측, Health Connect/웨어러블, 푸시 알림, 주간 보스전, 상품 교환, 기간별 기록, 꾸미기 카탈로그는 후속 구현 대상입니다. 미연결 메뉴에는 상태 안내를 표시하며 상품을 눌러도 코인을 차감하지 않습니다. 시든 상태 화면은 상태별 디자인 시연이며, 페널티 규칙과 실제 성장 수치 계산은 아직 구현하지 않았습니다. 일일 초기화 스위치는 UI 체험용입니다.

## 데스크톱에서 모바일 테스트

현재 UI 개발에는 Node.js와 Chrome 또는 Edge만 있으면 됩니다. 프로젝트 패키지는 설치되어 있습니다. Chrome에서 `F12` → `Ctrl+Shift+M` → Responsive → `390 × 844`로 설정하면 원본 크기로 비교하기 쉽습니다. 브라우저의 모바일 모드는 실제 기기의 센서·성능·운영체제를 모두 재현하지는 않습니다. [Chrome Device Mode 안내](https://developer.chrome.com/docs/devtools/device-mode)

Android 앱 패키지와 OS 기능을 붙일 단계에는 **Android Studio, Android SDK, Android Emulator/AVD**가 필요합니다. Windows에서도 에뮬레이터로 테스트할 수 있습니다. 현재 프로젝트에는 네이티브 패키지나 Capacitor를 추가하지 않았습니다. [Android Emulator 안내](https://developer.android.com/studio/run/emulator), [Capacitor 문서](https://capacitorjs.com/docs)

## 검증 명령

```powershell
cd frontend
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`playwright install`은 새 개발 환경에서 한 번만 필요합니다. 별도 설치된 브라우저를 사용할 때에는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 지정할 수 있습니다. 이 작업에서는 Codex에 이미 제공된 헤드리스 Chromium으로 검증했습니다. 브라우저 테스트는 퀘스트 보상·저장 복원·무료 코인·가입 검증·민감 정보 비저장·메뉴 이동·대화상자 키보드 동작을 확인합니다.

개발 서버가 실행 중일 때 `node scripts/capture.mjs`는 `frontend/test-results/screenshots/`에 14개 화면을 캡처합니다. 생성 결과는 Git에서 제외합니다.

## 구조와 다음 작업

| 경로 | 역할 |
| --- | --- |
| `frontend/src/pages` | Figma 화면 구현 |
| `frontend/src/components` | 공통 모바일 화면, 내비게이션, 장면 스케일링, 알림·대화상자 |
| `frontend/src/domain` | 퀘스트·보상·날짜 초기화·입력 검증 |
| `frontend/src/stores` | 게임 저장 상태와 건강 프로필 메모리 상태 |
| `frontend/src/services/dashboard-service.ts` | 대시보드 데이터 어댑터; FastAPI 연결 시 교체할 위치 |
| `frontend/src/design` | 원본 에셋 참조와 장식 데이터 |
| `frontend/public/assets/figma` | 원본 이미지·SVG |
| `frontend/tests` | Playwright 브라우저 테스트 |
| `docs/figma-reference` | Figma 디자인 참조·에셋 목록 |

다음 단계는 FastAPI의 인증·프로필·퀘스트 API 계약을 정하고 서버를 연결하는 것입니다. 실서비스에서 코인·중복 지급·초기화는 서버가 검증해야 합니다. PWA 설치·오프라인 지원과 Capacitor 패키징은 이후 단계입니다. 현재는 브라우저에서 실행되는 웹 앱입니다.

디자인 출처·화면 경로와 기획 충돌 사항은 [구현 기록](docs/figma-reference/IMPLEMENTATION.md)에 정리했습니다.

# Git Flow

원격 저장소: https://github.com/AI-HealthCare-06/AH_06_01

사용자가 제공한 Git Flow 그림의 **Master 역할은 이 저장소의 기본 브랜치인 `main`**이 담당합니다. 최초 업로드에서는 기존 프런트엔드 데모를 `main`과 `develop`의 공통 기준점으로 등록합니다. 이후 작업부터 아래 흐름을 사용합니다. 초기 업로드 자체는 운영 배포나 정식 릴리스가 아닙니다.

| 브랜치 | 시작점 | 병합 대상 | 용도 |
| --- | --- | --- | --- |
| `main` | 초기 기준점 | — | 검증된 기준 코드, 정식 릴리스 이력 |
| `develop` | `main` | `release/*`로 분기 | 다음 버전 개발 통합 |
| `feature/<작업명>` | 최신 `develop` | `develop` | 기능 추가, 일반 UI·버그 수정, 문서·개발 도구 변경 |
| `release/<버전>` | `develop` | `main`, `develop` | 릴리스 검증·수정·버전 및 변경 내역 정리 |
| `hotfix/<작업명>` | `main` | `main`, `develop` | 배포된 버전의 긴급 수정 |

작업명은 소문자 영문·숫자·하이픈을 사용합니다. 연결된 이슈가 있으면 `feature/12-quest-progress`처럼 실제 이슈 번호를 앞에 붙입니다. 이슈가 없으면 `feature/quest-progress`처럼 작성하며 번호를 임의로 만들지 않습니다.

## 기능 작업

작업 트리가 깨끗한 상태에서 시작합니다. 기존 변경이 있으면 먼저 해당 작업 브랜치에서 정리합니다.

```bash
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c feature/quest-progress

# 구현 및 필요한 검증 후
git add <변경한-파일>
git commit -m "feat: add quest progress indicators"
git push -u origin feature/quest-progress
```

GitHub에서 **base: develop / compare: feature/quest-progress** PR을 만듭니다. CI 통과와 리뷰 후 **Create a merge commit**으로 병합합니다. `main`/`develop`에 기능 코드를 직접 커밋하지 않고, 공유 브랜치에는 강제 푸시하지 않습니다. 커밋 접두사는 `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`를 사용합니다.

## 릴리스

1. 릴리스 요청 시 최신 `develop`에서 `release/0.2.0`처럼 분기합니다. 버전은 실제 릴리스 계획에 맞게 정합니다.
2. 릴리스 브랜치에서는 새 기능 대신 검증, 버그 수정, 버전·변경 내역 정리를 진행합니다.
3. 검증 후 `release/* → main` PR을 merge commit으로 병합합니다.
4. 같은 릴리스 브랜치를 `develop`에도 병합합니다. 양쪽 병합이 완료될 때까지 브랜치를 유지합니다.
5. 릴리스가 승인되면 `main`의 해당 커밋에 `v0.2.0` 같은 주석 태그를 생성하고 푸시합니다. 태그·GitHub Release·운영 배포는 구분하며 자동으로 배포하지 않습니다.

## 긴급 수정

최신 `main`에서 `hotfix/<작업명>`을 만듭니다. 검증 후 `main`과 `develop`으로 각각 PR을 보내 merge commit으로 병합합니다. 진행 중인 `release/*`가 있으면 필요한 수정도 반영해 다음 릴리스에서 문제가 재발하지 않게 합니다.

## 자동 검증과 로컬 설정

- `.github/workflows/ci.yml`: PR의 병합 방향, 프런트엔드 lint·format·단위 테스트·타입/빌드·브라우저 테스트를 검사합니다.
- PR 병합 방향: `main`은 `release/*`·`hotfix/*`, `develop`은 `feature/*`·`release/*`·`hotfix/*`·`main`을 받습니다. `main → develop`은 기준 코드 동기화에 사용합니다.
- `.github/PULL_REQUEST_TEMPLATE.md`: 변경 목적, 테스트, 릴리스/핫픽스 양방향 병합 확인을 기록합니다.
- `AGENTS.md`: 이후 Codex 작업에도 이 브랜치 규칙을 적용합니다.
- CI는 PR을 검사하지만 GitHub의 브랜치 보호 설정을 대신하지는 않습니다. 저장소 관리자는 보호 규칙에서 PR 필수, `Git Flow`·`Frontend` 체크 필수, force push 금지를 적용할 수 있습니다. 이 문서만으로 원격 보호 설정이 변경되지는 않습니다.

다른 개발자가 clone한 후 사용할 로컬 설정:

```bash
git config --local pull.ff only
git config --local fetch.prune true
git config --local push.default simple
git config --local gitflow.branch.master main
git config --local gitflow.branch.develop develop
git config --local gitflow.prefix.feature feature/
git config --local gitflow.prefix.release release/
git config --local gitflow.prefix.hotfix hotfix/
git config --local gitflow.prefix.versiontag v
git switch develop
```

Git Flow 확장 프로그램 설치 없이 기본 Git 명령만으로 동일한 흐름을 사용할 수 있습니다.

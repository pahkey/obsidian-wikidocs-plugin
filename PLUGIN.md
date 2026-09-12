# 옵시디언 위키독스 플러그인 배포 가이드

이 문서는 옵시디언 위키독스 플러그인을 수정한 후 배포하는 전체 과정을 설명합니다.
릴리스는 GitHub Actions로 자동화되어 있으며, **태그 푸시 + 릴리스 게시** 두 단계가 핵심입니다.

## 빠른 실행 (순서대로 복사해서 실행)

코드를 수정한 뒤에는 아래 7단계만 실행하면 됩니다. 각 단계의 배경 설명은 4~6장에 있습니다.

> **자동화 스크립트**: 아래 과정을 `release.sh`가 대신 실행합니다.
> ```bash
> ./release.sh patch -m "fix: 수정 내용"    # 커밋 + 릴리스 (푸시·게시 전 확인 프롬프트)
> ./release.sh patch --dry-run             # 실행될 명령만 미리 확인
> ./release.sh --help
> ```

```bash
# 1) 빌드 통과 확인 (CI가 실행하는 것과 같은 명령)
npm run build

# 2) 변경한 파일만 커밋 — npm version은 작업 트리가 clean일 때만 동작합니다
git add main.ts lib/ styles.css        # 실제로 변경한 파일을 지정
git commit -m "fix: 수정 내용"

# 3) 버전 범프 — 아래 3개 파일 갱신 + 커밋 + 태그까지 자동 처리
npm version patch        # 버그 수정 / minor: 기능 추가 / major: 호환성 깨짐

# 4) 커밋과 태그를 함께 푸시 → GitHub Actions가 빌드 후 draft 릴리스를 만듭니다
git push origin master --follow-tags

# 5) CI 완료까지 대기 (푸시 직후에는 워크플로우 등록에 몇 초 걸릴 수 있습니다)
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status

# 6) draft 릴리스에 자산 3개가 붙었는지 확인
VERSION=$(node -p "require('./package.json').version")
gh release view "$VERSION" --json isDraft,assets

# 7) 게시 (필수) — draft로 두면 사용자는 404를 받습니다
gh release edit "$VERSION" --draft=false
```

### 단계별 성공 확인

| 단계 | 확인 방법 |
|---|---|
| 1 | 오류 없이 종료되고 `main.js` 생성 |
| 3 | 새 버전이 출력되고 `git tag`에 그 버전이 보임 |
| 5 | 워크플로우 결론이 `success` |
| 6 | `assets`에 `main.js`, `manifest.json`, `styles.css` 3개 |
| 7 | 6번을 다시 실행했을 때 `"draft": false` |

> 옵시디언에서 실제 동작을 확인하려면 개발 볼트에서 `npm run dev`를 켜 두고 `main.js`가 자동 갱신되는 상태로 테스트합니다.

## 1. 개발 환경 설정

### 의존성 설치
```bash
npm install
```

### 개발 모드 실행
```bash
npm run dev
```
- 파일 변경 시 자동으로 빌드됨
- `main.js` 파일이 실시간으로 업데이트됨

## 2. 코드 수정 및 테스트

### 주요 파일 구조
- `main.ts`: 플러그인 메인 파일 (라이프사이클, 리본 아이콘, 명령어, 동기화 흐름)
- `lib/api.ts`: 위키독스 API 호출 로직
- `lib/config.ts`: 설정 관리
- `lib/md.ts`: 마크다운/Front Matter 처리
- `lib/utils.ts`: 유틸리티 함수
- `styles.css`: 플러그인 스타일

### 테스트
1. 옵시디언에서 플러그인을 활성화
2. 기능 동작 확인
3. 에러 로그 확인 (개발자 도구)

### 릴리스 전 확인 항목
- 책 내려받기 / 책 보내기 흐름
- 블로그 폴더 생성, 블로그 보내기 / 내려받기 흐름
- 새 Markdown 파일 생성 시 Front Matter 부여
- 폴더 / 파일 rename 이후 메타데이터 유지

## 3. 빌드 및 타입 체크

```bash
npm run build
```
- TypeScript 타입 체크(`tsc -noEmit -skipLibCheck`) 실행
- 프로덕션용 `main.js` 생성 (minify, 소스맵 없음)

CI도 동일한 명령을 실행하므로, **릴리스 전에 로컬에서 한 번 통과시켜야 합니다.**

## 4. 배포 원리 (먼저 알아둘 것)

Obsidian 커뮤니티 플러그인의 업데이트는 다음 순서로 동작합니다.

1. Obsidian이 저장소 **기본 브랜치의 `manifest.json`** 을 읽어 `version`과 `minAppVersion`을 확인
2. 설치된 버전보다 새 버전이고, `minAppVersion` ≤ 현재 앱 버전이면 업데이트를 제안
3. `releases/download/<version>/` 경로에서 `main.js`, `manifest.json`, `styles.css`를 내려받음

여기서 따라오는 규칙 4가지:

| 규칙 | 이유 |
|---|---|
| **태그 이름 = `manifest.json`의 `version`** (`v` 접두사 금지) | 3번의 다운로드 경로가 태그 이름으로 만들어짐 |
| **릴리스는 게시(publish)되어야 함** | draft 릴리스의 자산은 비공개라 404가 발생 |
| **`minAppVersion`이 정확해야 함** | 낮게 선언하면 구버전 앱이 실행 불가능한 업데이트를 받음 |
| **`main.js`는 커밋하지 않음** | `.gitignore` 대상. CI가 빌드해 릴리스 자산으로 첨부 |

## 5. 릴리스 절차

명령만 필요하면 위의 **빠른 실행**을 보세요. 아래는 각 단계의 배경과 주의사항입니다.

### 5.1 `minAppVersion` 점검

새로 사용한 Obsidian API가 요구하는 최소 앱 버전을 확인하고, `manifest.json`의 `minAppVersion`이 그보다 낮으면 올립니다.

- 예: `fileManager.trashFile`은 Obsidian **1.6.6** 이상 필요 (`lib/utils.ts`의 `deleteFolderContents`)
- 올릴 때 수정할 파일은 `manifest.json` 하나입니다. `versions.json`의 **새 버전 항목은 `npm version` 실행 시 자동으로** 이 값을 따릅니다
- 과거 릴리스의 요구 버전이 잘못 기재되어 있었다면 `versions.json`의 해당 항목도 함께 정정합니다

> `minAppVersion`을 올리면 그 미만 앱에는 업데이트가 제공되지 않습니다. 이는 의도된 동작입니다.

### 5.2 커밋 (작업 트리를 clean으로)

`npm version`은 작업 트리가 clean일 때만 동작합니다. dirty 상태면 `Git working directory not clean.` 오류로 중단됩니다.

```bash
git add <변경한 파일>        # git add . 보다 명시적으로
git commit -m "..."
```

### 5.3 버전 범프

```bash
npm version patch   # 1.1.7 → 1.1.8  (버그 수정)
npm version minor   # 1.1.7 → 1.2.0  (기능 추가)
npm version major   # 1.1.7 → 2.0.0  (호환성 깨짐)
```

이 명령 하나로 다음이 자동 처리됩니다.

- `package.json`의 `version` 갱신
- `version` 스크립트 실행 → `version-bump.mjs`가 `manifest.json`의 `version`을 갱신하고, `versions.json`에 `"<새 버전>": "<minAppVersion>"` 추가
- 변경 파일 커밋 + **태그 생성** (`.npmrc`의 `tag-version-prefix=""` 덕분에 `v` 접두사가 붙지 않음)

> **태그를 손으로 만들지 마세요.** `npm version`이 이미 만들며, 손으로 만들면 버전이 어긋납니다.

### 5.4 푸시

```bash
git push origin master --follow-tags
```

태그가 푸시되면 `.github/workflows/release.yml`이 실행되어 빌드 후 **draft 릴리스**를 만듭니다.

### 5.5 CI 확인

```bash
gh run list --limit 3
gh run watch <run-id> --exit-status
```

### 5.6 릴리스 검증 (게시 전)

```bash
gh release view <버전> --json isDraft,assets
```

- 자산 3개(`main.js`, `manifest.json`, `styles.css`)가 붙었는지 확인
- Obsidian과 동일한 조건(비인증)으로 내려받아 확인:

```bash
for f in main.js manifest.json styles.css; do
  curl -s -o /dev/null -w "$f %{http_code}\n" -L \
    "https://github.com/pahkey/obsidian-wikidocs-plugin/releases/download/<버전>/$f"
done
```

draft 상태에서는 셋 다 **404**가 나옵니다. 이게 정상이며, 다음 단계에서 200으로 바뀝니다.

### 5.7 릴리스 게시 (필수)

```bash
gh release edit <버전> --draft=false
```

또는 GitHub → Releases → 해당 draft → **Publish release**.

- **게시해야 자산이 공개되고 업데이트가 동작합니다.** draft로 두면 사용자는 404를 받습니다
- 게시 후 5.6의 `curl`이 200인지 다시 확인합니다
- 릴리스 노트(`body`)는 자동으로 채워지지 않습니다. 필요하면 게시 전에 작성합니다

## 6. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 다른 볼트에서 업데이트 시 `Request failed, status 404` | 릴리스가 draft 상태 | 5.7 게시 |
| 업데이트가 제안되지 않음 | `minAppVersion` > 현재 앱 버전 | 의도된 동작. `manifest.json` 확인 |
| 태그를 찾지 못하거나 업데이트가 반영되지 않음 | 태그에 `v` 접두사가 붙음 | 접두사 없는 태그로 다시 푸시 |
| CI 빌드 실패 | 타입/번들 오류 | 로컬에서 `npm run build`로 재현 |
| 업데이트 후 플러그인에서 런타임 오류 | `minAppVersion`이 실제 요구보다 낮음 | 5.1 점검 |

### 하지 말아야 할 것
- 태그를 손으로 생성 (`npm version`과 중복)
- 릴리스 draft 상태로 방치
- `main.js` 커밋 (`.gitignore` 대상이며 CI가 첨부)
- `manifest.json`의 `version`과 태그 이름을 다르게 유지

## 7. 옵시디언 커뮤니티 플러그인 등록 (최초 1회)

이미 등록된 플러그인이므로 이후 릴리스에는 필요하지 않습니다.

### 요구사항
- 플러그인이 공개 GitHub 저장소에 있어야 함
- `README.md`가 잘 작성되어 있어야 함
- 최소 하나의 릴리스가 있어야 함

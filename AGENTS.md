# AGENTS.md

이 문서는 이 저장소에서 작업하는 사람이나 에이전트를 위한 프로젝트 가이드입니다. 구현 변경 전에 전체 구조와 주의사항을 빠르게 파악할 수 있도록 정리했습니다.

## 프로젝트 개요

- 프로젝트명: `obsidian-wikidocs-plugin`
- 유형: Obsidian Community Plugin
- 목적: Obsidian 안에서 WikiDocs 책/블로그를 내려받고, 편집하고, 다시 업로드할 수 있게 돕는 플러그인
- 진입점: `main.ts`
- 빌드 산출물: `main.js`

## 현재 구조

- `main.ts`: 플러그인 라이프사이클, 리본 아이콘, 명령어, 컨텍스트 메뉴, 동기화 흐름
- `lib/api.ts`: WikiDocs API 호출과 업로드/다운로드 로직
- `lib/md.ts`: Front Matter 처리, 메타데이터 변환, 마크다운 저장 로직
- `lib/utils.ts`: 경로 처리, 폴더 판별, 이미지 추출, 확인 다이얼로그 등 공용 유틸
- `lib/config.ts`: 설정 타입과 기본값
- `manifest.json`: Obsidian 플러그인 메타데이터
- `styles.css`: 플러그인 UI 스타일
- `esbuild.config.mjs`: 번들 설정
- `PLUGIN.md`: 배포 절차 메모

## 개발 명령어

```bash
npm run dev
npm run build
```

- `npm run dev`: esbuild watch 모드
- `npm run build`: TypeScript 체크 후 production 번들 생성

## 작업 원칙

- 가능한 한 `main.ts`에는 이벤트 연결과 오케스트레이션만 두고, 데이터 처리 로직은 `lib/`로 분리합니다.
- 새 기능을 추가할 때는 책(book) 흐름과 블로그(blog) 흐름이 모두 영향받는지 먼저 확인합니다.
- Obsidian 파일 시스템 이벤트(`create`, `rename`, `file-open`)는 서로 연쇄적으로 호출될 수 있으므로 중복 실행과 무한 루프를 주의합니다.
- 동기화 관련 로직을 수정할 때는 `last_synced`, `id`, `parent_id` 처리 방식을 유지해야 합니다.
- 사용자에게 보이는 문자열은 현재 코드베이스와 맞춰 한국어를 우선 사용합니다.

## 주의할 점

- 이 코드베이스는 여러 유틸 함수에서 `this.app`에 의존합니다. 함수 추출이나 재사용 시 호출 컨텍스트가 깨지지 않는지 반드시 확인합니다.
- `metadata.md`, `blog_metadata.md`는 일반 문서와 다르게 취급됩니다. 업로드/삭제/자동 Front Matter 부여 대상에서 빠지는 경우가 많습니다.
- 파일명은 WikiDocs 제목과 매핑되므로 이름 변경 로직을 건드릴 때 `sanitizeFileName`, `extractTitleFromFilePath` 동작을 같이 확인합니다.
- 신규 페이지와 기존 페이지는 `id === -1` 여부로 구분합니다. 이미지 업로드 순서도 이 값에 따라 달라집니다.
- 책 동기화 후에는 서버 기준으로 다시 내려받는 흐름이 있으므로, 로컬 수정 보존 여부에 주의해야 합니다.

## 변경 후 확인 항목

1. `npm run build`가 성공하는지 확인합니다.
2. 책 내려받기와 책 보내기 흐름이 깨지지 않았는지 확인합니다.
3. 블로그 폴더 생성, 블로그 보내기/내려받기 흐름이 유지되는지 확인합니다.
4. 새 Markdown 파일 생성 시 Front Matter가 기대대로 붙는지 확인합니다.
5. 폴더/파일 rename 이후 메타데이터가 비정상적으로 바뀌지 않는지 확인합니다.

## 변경 범위 가이드

- API 스펙 변경: `lib/api.ts`, `lib/config.ts`, 필요 시 `README.md`
- Front Matter/파일 저장 규칙 변경: `lib/md.ts`, `lib/utils.ts`, `main.ts`
- UI 문구/설정 화면 변경: `main.ts`, `styles.css`, 필요 시 `manifest.json`
- 릴리스 준비: `manifest.json`, `versions.json`, `package.json`, 빌드 결과물 `main.js`

## 문서 업데이트가 필요한 경우

다음 중 하나를 변경했다면 관련 문서도 함께 갱신합니다.

- 설치 또는 설정 방법
- 사용자 명령어/메뉴 이름
- 배포 절차
- 지원하는 WikiDocs 동작 방식

대상 문서:

- `README.md`
- `PLUGIN.md`
- 필요 시 이 `AGENTS.md`

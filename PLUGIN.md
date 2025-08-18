# 옵시디언 위키독스 플러그인 배포 가이드

이 문서는 옵시디언 위키독스 플러그인을 수정한 후 배포하는 전체 과정을 설명합니다.

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
- `main.ts`: 플러그인 메인 파일
- `lib/api.ts`: 위키독스 API 호출 로직
- `lib/config.ts`: 설정 관리
- `lib/md.ts`: 마크다운 처리
- `lib/utils.ts`: 유틸리티 함수
- `styles.css`: 플러그인 스타일

### 테스트
1. 옵시디언에서 플러그인을 활성화
2. 기능 동작 확인
3. 에러 로그 확인 (개발자 도구)

## 3. 빌드 및 타입 체크

### 프로덕션 빌드
```bash
npm run build
```
- TypeScript 타입 체크 실행
- 프로덕션용 최적화된 `main.js` 생성

## 4. 버전 업데이트

### package.json 버전 업데이트
```bash
npm version patch  # 패치 버전 (1.1.4 → 1.1.5)
npm version minor  # 마이너 버전 (1.1.4 → 1.2.0)
npm version major  # 메이저 버전 (1.1.4 → 2.0.0)
```

### 자동 버전 동기화
`npm version` 명령어 실행 시 자동으로:
- `manifest.json`의 버전이 업데이트됨
- `versions.json`에 새 버전 정보가 추가됨
- Git에 변경사항이 스테이징됨

## 5. Git 커밋 및 태그

### 변경사항 커밋
```bash
git add .
git commit -m "feat: 새로운 기능 추가" # 또는 적절한 커밋 메시지
```

### 버전 태그 생성
```bash
git tag 1.1.5  # 새 버전에 맞는 태그
git push origin master
git push origin 1.1.5
```

## 6. 릴리스 준비

### 필수 파일들
배포 시 다음 파일들이 필요합니다:
- `main.js` (빌드된 플러그인 코드)
- `manifest.json` (플러그인 메타데이터)
- `styles.css` (플러그인 스타일)

### 릴리스 노트 작성
- 새로운 기능
- 버그 수정
- 중요한 변경사항
- 호환성 정보

## 7. GitHub 릴리스

### GitHub에서 릴리스 생성
1. GitHub 저장소의 "Releases" 탭으로 이동
2. "Create a new release" 클릭
3. 태그 버전 선택 (예: 1.1.5)
4. 릴리스 제목 및 설명 작성
5. 다음 파일들을 첨부:
   - `main.js`
   - `manifest.json`
   - `styles.css`

### 자동화된 릴리스 (선택사항)
GitHub Actions를 사용하여 태그 푸시 시 자동으로 릴리스를 생성할 수 있습니다.

## 8. 옵시디언 커뮤니티 플러그인 등록 (최초 배포 시)

### 요구사항
- 플러그인이 공개 GitHub 저장소에 있어야 함
- `README.md`가 잘 작성되어 있어야 함
- 최소 하나의 릴리스가 있어야 함

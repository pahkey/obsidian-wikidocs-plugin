#!/usr/bin/env bash
#
# 위키독스 옵시디언 플러그인 릴리스 스크립트
#
#   코드 수정 → 빌드 → 버전 범프 → 푸시 → CI 대기 → 릴리스 확인 → 게시
#
# 사용법:
#   ./release.sh patch                    # 이미 커밋한 상태에서 릴리스
#   ./release.sh patch -m "fix: ..."      # 변경사항을 커밋하고 릴리스
#   ./release.sh minor -y                 # 확인 없이 진행 (자동화용)
#   ./release.sh patch --dry-run          # 실행할 명령만 출력
#
# 자세한 배경은 PLUGIN.md 참고.
#
# 주의: macOS 기본 bash 3.2에서 동작하도록 작성되었습니다.

set -euo pipefail

BUMP=""
COMMIT_MESSAGE=""
ASSUME_YES="0"
DRY_RUN="0"

BRANCH="master"
WORKFLOW="release.yml"
REQUIRED_ASSETS="main.js manifest.json styles.css"

# ---------------------------------------------------------------- 출력 유틸

step()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '\033[1;33m!!  %s\033[0m\n' "$*" >&2; }
die()   { printf '\033[1;31m오류: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
	cat <<'EOF'
사용법: ./release.sh <patch|minor|major> [옵션]

옵션:
  -m <메시지>   변경사항을 커밋하고 진행 (미지정 시 작업 트리가 clean이어야 함)
  -y            푸시/게시 확인 프롬프트를 건너뜀
  --dry-run     실제로 실행하지 않고 명령만 출력
  -h, --help    이 도움말

예:
  ./release.sh patch -m "fix: 자물쇠 아이콘 표시 오류 수정"
  ./release.sh minor --dry-run
EOF
}

# ---------------------------------------------------------------- 인자 처리

parse_args() {
	while [ $# -gt 0 ]; do
		case "$1" in
			patch|minor|major)
				[ -z "$BUMP" ] || die "버전 종류는 하나만 지정할 수 있습니다."
				BUMP="$1"
				;;
			-m|--message)
				[ $# -ge 2 ] || die "-m 뒤에 커밋 메시지가 필요합니다."
				COMMIT_MESSAGE="$2"
				shift
				;;
			-y|--yes)     ASSUME_YES="1" ;;
			--dry-run)    DRY_RUN="1" ;;
			-h|--help)    usage; exit 0 ;;
			*)            usage; die "알 수 없는 인자: $1" ;;
		esac
		shift
	done

	[ -n "$BUMP" ] || { usage; exit 1; }
}

# ---------------------------------------------------------------- 실행 헬퍼

# 변경을 일으키는 명령은 전부 이 함수를 통해 실행 (dry-run이면 출력만)
run() {
	if [ "$DRY_RUN" = "1" ]; then
		printf '    [dry-run] %s\n' "$*"
		return 0
	fi
	"$@"
}

confirm() {
	if [ "$ASSUME_YES" = "1" ]; then
		info "$1 -> -y 옵션으로 자동 진행"
		return 0
	fi

	if [ ! -t 0 ]; then
		die "확인 프롬프트를 사용할 수 없습니다(표준 입력이 터미널이 아님). -y 옵션을 사용하세요."
	fi

	printf '\033[1;33m?  %s [y/N] \033[0m' "$1"
	read -r answer
	case "$answer" in
		[yY]|[yY][eE][sS]) return 0 ;;
		*) return 1 ;;
	esac
}

current_version() {
	node -p "require('./package.json').version"
}

# ---------------------------------------------------------------- 사전 점검

preflight() {
	step "사전 점검"

	local cmd
	for cmd in git node npm curl gh; do
		command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' 명령을 찾을 수 없습니다."
	done
	info "필수 명령 확인 완료 (git, node, npm, curl, gh)"

	gh auth status >/dev/null 2>&1 || die "gh 인증이 필요합니다. 'gh auth login'을 실행하세요."
	info "gh 인증 확인 완료"

	local branch
	branch=$(git rev-parse --abbrev-ref HEAD)
	[ "$branch" = "$BRANCH" ] || die "현재 브랜치가 '$branch'입니다. '$BRANCH'에서 실행하세요."
	info "브랜치 확인: $branch"

	# 작업 트리 상태: -m이 있으면 커밋할 변경이 있어야 하고, 없으면 clean이어야 함
	if [ -n "$COMMIT_MESSAGE" ]; then
		[ -n "$(git status --porcelain)" ] || die "커밋할 변경사항이 없습니다. -m 없이 실행하세요."
		info "커밋할 변경사항 있음 (-m 메시지로 커밋 예정)"
	else
		[ -z "$(git status --porcelain)" ] || die "작업 트리에 커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 -m 옵션을 사용하세요."
		info "작업 트리 clean"
	fi

	# 원격에 같은 태그가 이미 있는지
	local next_version
	next_version=$(next_version_for "$BUMP")
	if git rev-parse -q --verify "refs/tags/$next_version" >/dev/null 2>&1; then
		die "태그 '$next_version'이 이미 로컬에 있습니다. 버전을 확인하세요."
	fi
	info "다음 버전: $next_version"
}

# patch/minor/major 중 무엇을 올릴지 계산 (dry-run 계획 출력용)
next_version_for() {
	local current
	current=$(current_version)
	node -e '
		const bump = process.argv[1];
		const [major, minor, patch] = process.argv[2].split(".").map(Number);
		if (bump === "major") console.log(`${major + 1}.0.0`);
		else if (bump === "minor") console.log(`${major}.${minor + 1}.0`);
		else console.log(`${major}.${minor}.${patch + 1}`);
	' "$1" "$current"
}

# ---------------------------------------------------------------- 릴리스 단계

do_build() {
	step "1/7 빌드 검증 (CI와 동일한 명령)"
	run npm run build
	[ "$DRY_RUN" = "1" ] || info "빌드 성공"
}

do_commit() {
	step "2/7 변경사항 커밋"

	if [ -z "$COMMIT_MESSAGE" ]; then
		info "커밋할 변경사항 없음 (이미 커밋된 상태)"
		return 0
	fi

	run git add -A
	run git commit -m "$COMMIT_MESSAGE"
}

do_bump() {
	step "3/7 버전 범프 ($BUMP)"

	if [ "$DRY_RUN" = "1" ]; then
		run npm version "$BUMP"
		return 0
	fi

	npm version "$BUMP" >/dev/null

	VERSION=$(current_version)

	local tag_version
	tag_version=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
	[ "$tag_version" = "$VERSION" ] || die "태그($tag_version)와 package.json 버전($VERSION)이 다릅니다."

	info "버전: $VERSION (태그 생성됨)"
}

do_push() {
	step "4/7 푸시"

	confirm "커밋과 태그 $VERSION 을 origin/$BRANCH 로 푸시할까요?" || die "사용자가 중단했습니다."

	run git push origin "$BRANCH" --follow-tags
}

wait_for_run() {
	step "5/7 CI 대기"

	if [ "$DRY_RUN" = "1" ]; then
		info "[dry-run] gh run watch <run-id> --exit-status"
		return 0
	fi

	local attempt run_id
	run_id=""
	attempt=1
	while [ "$attempt" -le 12 ]; do
		run_id=$(gh run list --workflow="$WORKFLOW" --limit 20 \
			--json databaseId,headBranch \
			--jq ".[] | select(.headBranch==\"$VERSION\") | .databaseId" 2>/dev/null | head -1 || true)
		[ -n "$run_id" ] && break
		info "워크플로우 등록 대기 중... ($attempt/12)"
		sleep 5
		attempt=$((attempt + 1))
	done

	[ -n "$run_id" ] || die "워크플로우 실행을 찾지 못했습니다. 'gh run list'로 확인하세요."
	info "실행 ID: $run_id"

	if ! gh run watch "$run_id" --exit-status >/dev/null; then
		gh run view "$run_id" --log-failed 2>/dev/null | tail -30 || true
		die "CI가 실패했습니다. 위 로그를 확인하세요."
	fi
	info "CI 성공"
}

verify_release() {
	step "6/7 릴리스 자산 확인"

	if [ "$DRY_RUN" = "1" ]; then
		info "[dry-run] gh release view $VERSION --json isDraft,assets"
		return 0
	fi

	local assets
	assets=$(gh release view "$VERSION" --json assets --jq '.assets[].name')

	local asset
	for asset in $REQUIRED_ASSETS; do
		printf '%s\n' "$assets" | grep -qx "$asset" || die "릴리스에 '$asset' 자산이 없습니다."
		info "자산 확인: $asset"
	done
}

do_publish() {
	step "7/7 릴리스 게시"

	info "게시하지 않으면(draft 상태) 사용자는 업데이트 시 404를 받습니다."
	confirm "릴리스 $VERSION 을 게시할까요?" || {
		warn "게시를 건너뛰었습니다. 나중에 실행하세요: gh release edit $VERSION --draft=false"
		return 0
	}

	run gh release edit "$VERSION" --draft=false

	if [ "$DRY_RUN" != "1" ]; then
		info "게시 완료. 공개 다운로드 확인 중..."
		verify_public_urls
	fi
}

# 게시 후, Obsidian과 동일한 조건(비인증)으로 내려받아 확인
verify_public_urls() {
	local repo base asset code
	repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
	base="https://github.com/$repo/releases/download/$VERSION"

	for asset in $REQUIRED_ASSETS; do
		code=$(curl -s -o /dev/null -w '%{http_code}' -L "$base/$asset")
		[ "$code" = "200" ] || die "$asset 다운로드 실패 (HTTP $code)"
		info "$asset -> HTTP 200"
	done
	info "배포 완료: $base"
}

# ---------------------------------------------------------------- 진입점

main() {
	parse_args "$@"
	preflight

	if [ "$DRY_RUN" = "1" ]; then
		# 실제 상태는 바꾸지 않고, 실행될 명령을 같은 코드 경로에서 그대로 출력한다.
		# 확인 프롬프트는 자동 통과시킨다.
		ASSUME_YES="1"
		VERSION=$(next_version_for "$BUMP")
		info "예상 버전: $VERSION (실제 범프는 하지 않습니다)"
	fi

	do_build
	do_commit
	do_bump
	do_push
	wait_for_run
	verify_release
	do_publish

	step "완료"
	if [ "$DRY_RUN" = "1" ]; then
		info "위 명령들이 실행될 예정이었습니다 (--dry-run, 변경 없음)"
	else
		info "버전 $VERSION 배포 완료"
	fi
}

VERSION=""
main "$@"

#!/usr/bin/env bash
# 풀 기반 배포 (#15). 서버가 GitHub 에 **물어봐서** 배포한다 — 인바운드 SSH 가 전혀 필요 없다.
#
# ## 왜 이 방향인가
# GitHub Actions 러너가 서버에 SSH 로 들어오는 방식(PR #112, `.github/workflows/deploy.yml`)은 22 번
# 인그레스가 열려 있어야 한다. 이 서버는 `oci-ssh-allow.sh` 로 22 번을 운영자 IP 두 개로 좁혀 뒀고
# (근거: 0.0.0.0/0 이면 상시 스캔 대상 — 실측 24시간 209건, 그리고 sshd 의 pre-auth 취약점은 키 인증이
# 막아주지 못한다), Actions 러너 IP 를 허용 목록에 넣는 것은 불가능하다 — `api.github.com/meta` 의
# actions 범위가 IPv4 만 5,600개 이상이고 수시로 바뀐다.
#
# 셀프호스티드 러너도 쓰지 않는다: **이 레포는 public** 이라 포크 PR 의 워크플로가 러너에서 임의 코드를
# 실행할 수 있다(GitHub 이 공개 레포에 셀프호스티드 러너를 쓰지 말라고 명시한다). 배포 권한을 가진
# 서버에서는 대가가 너무 크다.
#
# 방향을 뒤집으면 이 제약이 전부 사라진다. 서버는 GitHub 에 **아웃바운드**로만 접근하고
# (확인: api.github.com 200, ghcr.io 도달 가능), 열어야 할 포트가 없다.
#
# ## 무엇을 하나
# 1. `origin/<브랜치>` 의 최신 커밋을 확인한다. 로컬 HEAD 와 같으면 **아무것도 하지 않는다**(대부분의 실행).
# 2. 다르면 그 커밋의 이미지가 GHCR 에 실제로 발행됐는지 먼저 확인한다. 없으면 아무것도 건드리지 않고
#    끝낸다 — 릴리스 워크플로가 아직 도는 중일 수 있고, 다음 주기에 다시 본다.
# 3. 체크아웃을 그 커밋으로 맞추고(`git reset --hard`) `.env` 의 이미지 태그를 `sha-<7자리>` 로 고정한 뒤
#    `bootstrap.sh` 를 부른다. 배포의 어려운 부분(오버레이 결정·다운그레이드 가드·헬스 대기)은 그쪽이 한다.
# 4. 헬스 확인이 실패하면 **직전 커밋·태그로 되돌리고 다시 올린다**(자동 롤백).
#
# `git reset --hard` 인 이유: compose*.yaml · monitoring/* (알림 룰) · Caddyfile.prod 는 이미지 안이 아니라
# **서버 체크아웃에서 bind-mount** 된다. 이미지만 갱신하면 알림 룰이나 리버스 프록시 변경이 반영되지 않는다.
# 서버의 로컬 수정은 버려진다(배포 대상은 항상 레포의 그 커밋이다). `.env` 는 gitignore 대상이라 남는다.
#
# ## 설정 (.env)
#   PULL_DEPLOY_ENABLED=true          필수. 이게 없으면 아무것도 하지 않는다(fail closed).
#                                     타이머를 지우지 않고 배포만 멈추는 킬 스위치이기도 하다.
#   PULL_DEPLOY_BRANCH=main           선택. 기본 main.
#   PULL_DEPLOY_HEALTH_URL=https://…  선택. 공개 경로까지 확인한다. 비우면 로컬 헬스만 본다.
#
# ## 사용
#   ./scripts/pull-deploy.sh              # 한 번 확인하고 필요하면 배포 (systemd 타이머가 이걸 부른다)
#   ./scripts/pull-deploy.sh --dry-run    # 무엇을 할지만 출력하고 아무것도 바꾸지 않는다
#   ./scripts/pull-deploy.sh --force      # HEAD 가 같아도 재배포 (설정 파일만 바뀐 경우 등)
#
# 설치: ./scripts/install-pull-deploy.sh (systemd 서비스 + 타이머). 로그는 journalctl 로 본다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DRY_RUN=false
FORCE=false
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=true ;;
		--force) FORCE=true ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$arg" >&2; exit 2 ;;
	esac
done

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"; }
die() { printf '%s error: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >&2; exit 1; }

# .env 에서 키 하나를 읽는다. source 하지 않는다 — .env 는 실행 대상이 아니다(값에 임의 셸이 들어올 수 있다).
env_value() { grep -E "^$1=" .env 2> /dev/null | head -1 | cut -d= -f2- || true; }

[ -f .env ] || die ".env 가 없다 — 배포 대상 디렉터리가 맞는지 확인한다 ($REPO_DIR)"

# fail closed: 명시적으로 켜지 않으면 아무것도 하지 않는다. 타이머만 설치돼 있어도 배포가 시작되지 않고,
# 반대로 이 값을 false 로 바꾸면 타이머를 건드리지 않고 배포를 멈출 수 있다.
if [ "$(env_value PULL_DEPLOY_ENABLED)" != "true" ]; then
	log "PULL_DEPLOY_ENABLED 가 true 가 아니다 — 아무것도 하지 않는다"
	exit 0
fi

BRANCH="$(env_value PULL_DEPLOY_BRANCH)"
BRANCH="${BRANCH:-main}"
HEALTH_URL="$(env_value PULL_DEPLOY_HEALTH_URL)"

# 겹쳐 도는 것을 막는다. 배포가 폴링 간격보다 오래 걸리면 두 번째 실행이 같은 체크아웃을 동시에 만지게 된다.
# flock 이 없는 환경은 없다고 가정하지 않고, 없으면 잠금 없이 진행하되 경고한다.
if command -v flock > /dev/null 2>&1; then
	exec 9> /tmp/reputation-pool-pull-deploy.lock
	flock -n 9 || { log "다른 배포가 진행 중이다 — 이번 주기는 건너뛴다"; exit 0; }
else
	log "warn: flock 이 없어 중복 실행을 막지 못한다"
fi

# docker 그룹이 이번 셸에 반영되지 않았으면 sudo 로 넘긴다 — bootstrap.sh 와 같은 판정이다.
if docker info > /dev/null 2>&1; then
	DOCKER=(docker)
elif sudo -n docker info > /dev/null 2>&1; then
	DOCKER=(sudo docker)
else
	die "docker 를 쓸 수 없다 (docker 그룹 또는 비밀번호 없는 sudo 가 필요하다)"
fi

# ---------------------------------------------------------------------------
# 1. 대상 커밋 결정
# ---------------------------------------------------------------------------
git fetch --quiet origin "$BRANCH" || die "git fetch 실패 — GitHub 아웃바운드 접근을 확인한다"
TARGET="$(git rev-parse "origin/$BRANCH")"
CURRENT="$(git rev-parse HEAD)"
SHORT="${TARGET:0:7}"

if [ "$TARGET" = "$CURRENT" ] && [ "$FORCE" != true ]; then
	log "최신이다 (${CURRENT:0:7}) — 배포할 것이 없다"
	exit 0
fi

log "배포 대상: ${CURRENT:0:7} -> $SHORT ($BRANCH)"

# ---------------------------------------------------------------------------
# 2. 이미지가 실제로 발행됐는지 먼저 확인
# ---------------------------------------------------------------------------
# 릴리스 워크플로가 아직 도는 중이면 태그가 없다. 여기서 멈추면 체크아웃을 건드리지 않은 채 다음 주기에
# 다시 시도한다. 이 확인이 없으면 `bootstrap.sh` 의 pull 이 실패하는데, 그 메시지는
# "GHCR 패키지가 public 인지 확인하라"로 나와 원인을 오도한다.
REGISTRY="ghcr.io/preagile/reputation-pool-cloud"
for image in app dashboard; do
	if ! "${DOCKER[@]}" manifest inspect "$REGISTRY/$image:sha-$SHORT" > /dev/null 2>&1; then
		log "이미지가 아직 없다: $REGISTRY/$image:sha-$SHORT — 다음 주기에 다시 본다"
		exit 0
	fi
done
log "이미지 확인 완료 (app · dashboard : sha-$SHORT)"

if [ "$DRY_RUN" = true ]; then
	log "--dry-run: 여기서 멈춘다. 실제로는 아래를 했을 것이다"
	printf '  git reset --hard %s\n' "$TARGET"
	printf '  .env: APP_IMAGE_TAG=sha-%s  DASHBOARD_IMAGE_TAG=sha-%s\n' "$SHORT" "$SHORT"
	printf '  ./scripts/bootstrap.sh\n'
	[ -n "$HEALTH_URL" ] && printf '  헬스 확인: %s\n' "$HEALTH_URL"
	exit 0
fi

# ---------------------------------------------------------------------------
# 3. 롤백 지점 기록 → 배포
# ---------------------------------------------------------------------------
PREV_SHA="$CURRENT"
PREV_APP_TAG="$(env_value APP_IMAGE_TAG)"
PREV_DASHBOARD_TAG="$(env_value DASHBOARD_IMAGE_TAG)"

# `.env` 키를 멱등하게 갱신한다(있으면 교체, 없으면 추가). 마지막 줄에 개행이 없는 파일도 다룬다 —
# 그러지 않으면 새 키가 앞 줄에 붙어버린다.
set_env_key() {
	local key="$1" val="$2"
	if grep -qE "^${key}=" .env; then
		sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
	else
		[ -s .env ] && [ "$(tail -c 1 .env)" != "" ] && printf '\n' >> .env
		printf '%s=%s\n' "$key" "$val" >> .env
	fi
}

# 환경변수가 아니라 `.env` 에 쓰는 이유: bootstrap.sh 가 `sudo docker compose` 로 갈 수 있고 sudo 는
# 기본 env_reset 이라 export 한 변수를 버린다. 그러면 compose 가 `${APP_IMAGE_TAG:-latest}` 의 기본값으로
# 떨어져 "체크아웃은 대상 커밋인데 이미지는 latest" 인 조합이 조용히 만들어진다. compose 는 프로젝트
# 디렉터리의 `.env` 를 sudo 와 무관하게 직접 읽는다.
apply() {
	local sha="$1" app_tag="$2" dashboard_tag="$3"
	git reset --hard --quiet "$sha"
	set_env_key APP_IMAGE_TAG "$app_tag"
	set_env_key DASHBOARD_IMAGE_TAG "$dashboard_tag"
	./scripts/bootstrap.sh
}

# 공개 경로 확인. bootstrap.sh 가 이미 로컬 헬스(app:8083)를 기다리므로 여기서는 Caddy·DNS·인증서까지
# 포함한 바깥 경로만 본다. 설정이 없으면 이 단계를 건너뛴다(로컬 헬스는 이미 통과한 상태다).
public_health_ok() {
	[ -n "$HEALTH_URL" ] || return 0
	local attempt
	for attempt in $(seq 1 12); do
		[ "$attempt" -gt 1 ] && log "공개 경로 헬스 재시도 $attempt/12"
		if curl -fsS --max-time 10 "$HEALTH_URL" > /dev/null 2>&1; then
			log "공개 경로 헬스 OK ($HEALTH_URL)"
			return 0
		fi
		sleep 5
	done
	log "공개 경로 헬스 실패 ($HEALTH_URL)"
	return 1
}

rollback() {
	log "롤백 시작 -> ${PREV_SHA:0:7} (app=${PREV_APP_TAG:-latest} dashboard=${PREV_DASHBOARD_TAG:-latest})"
	# 이전에 태그가 없었다면(예: latest 로 돌던 서버) 그 상태로 되돌린다.
	if apply "$PREV_SHA" "${PREV_APP_TAG:-latest}" "${PREV_DASHBOARD_TAG:-latest}"; then
		log "롤백 완료 — 배포는 실패로 끝났다. journalctl 로 원인을 확인한다"
	else
		log "롤백도 실패했다 — 수동 개입이 필요하다"
	fi
	exit 1
}

log "배포 시작"
if ! apply "$TARGET" "sha-$SHORT" "sha-$SHORT"; then
	log "bootstrap.sh 실패"
	rollback
fi
if ! public_health_ok; then
	rollback
fi

log "배포 완료: $SHORT"

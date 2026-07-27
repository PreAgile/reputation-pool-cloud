#!/usr/bin/env bash
# 서버 부트스트랩 (#15 / D8) — 빈 리눅스 호스트를 "스택이 도는 상태"로 만든다.
#
# #15 §5 의 리스크 대응이 "30분 내 재구축 가능 상태 유지"를 요구한다. 무료 티어는 한도가 예고 없이
# 바뀌거나(2026-06 Ampere A1 반토막) 인스턴스가 회수될 수 있으므로, 재구축이 문서를 따라가는 수작업이
# 아니라 스크립트 한 번이어야 한다. 이 스크립트는 멱등하다 — 재실행이 곧 재배포다.
#
# 전제: 이 레포가 클론되어 있고 레포 루트에서 실행한다. 대상은 Oracle Cloud A1(arm64) 위의
# Ubuntu 24.04 또는 Oracle Linux 9 이며, 다른 systemd 리눅스에서도 동작한다.
#
#   git clone https://github.com/PreAgile/reputation-pool-cloud.git && cd reputation-pool-cloud
#   cp .env.example .env && $EDITOR .env      # 시크릿 채우기
#   ./scripts/bootstrap.sh                    # 평문 :80 (도메인 없이도 뜬다)
#
# 인자로 넘긴 compose 파일은 오버레이로 뒤에 덧붙는다:
#
#   ./scripts/bootstrap.sh compose.prod.tls.yaml    # 도메인 + 자동 HTTPS (DOMAIN/ACME_EMAIL 필요)
#   ./scripts/bootstrap.sh compose.prod.6gb.yaml    # 1 OCPU/6GB 인스턴스
#
# 재배포마다 인자를 기억하지 않으려면 .env 에 남긴다 — 모드는 호스트의 성질이다:
#
#   DEPLOY_OVERLAYS=compose.prod.tls.yaml
#
# 인자 없이 재실행해 TLS 가 빠지는 사고는 다운그레이드 가드가 막는다(§2-1).
#
# 이 스크립트가 하지 못하는 것: OCI 콘솔의 VCN Security List(또는 NSG) 인그레스 규칙. 호스트 방화벽만
# 열려 있고 VCN 이 막혀 있으면 증상이 "인증서 발급 실패"로 나타나 원인을 찾기 어렵다 — 종료 시 안내한다.
#
# bash 를 쓴다(컨테이너 안에서 도는 backup.sh/restore.sh 의 /bin/sh 와 달리): 호스트 스크립트이고
# pipefail 과 함수가 필요하다.
set -euo pipefail

COMPOSE_FILES=(-f compose.yaml -f compose.prod.yaml)
# .env 에 반드시 값이 있어야 하는 키. compose 도 `:?` 로 검사하지만, 컨테이너를 띄우기 시작한 뒤에
# 실패하는 것보다 먼저 한 번에 알려주는 편이 낫다. DOMAIN/ACME_EMAIL 은 여기 없다 — 평문 모드로도
# 뜨게 하려는 것이고, TLS 오버레이를 쓸 때는 그 파일의 `:?` 가 즉시 실패시킨다.
REQUIRED_ENV=(
	REPUTATION_POOL_API_KEY
	GRAFANA_ADMIN_PASSWORD
)
# 값은 비어 있어도 되지만 **정의는 있어야** 하는 키. compose 의 `secrets: environment:` 소스는 컨테이너
# 생성 시점에 해석되고 정의되지 않은 변수에서 하드 실패하는데, `compose config` 는 통과한다 — 즉 이걸
# 확인하지 않으면 pull 까지 다 끝난 `up` 단계에서야 알 수 없는 에러로 터진다.
REQUIRED_DEFINED_ENV=(
	REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL
)

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

# root 가 아니면 sudo 를 앞에 붙인다(패키지 설치·방화벽은 특권이 필요하다).
if [ "$(id -u)" -eq 0 ]; then
	SUDO=""
elif command -v sudo > /dev/null 2>&1; then
	SUDO="sudo"
else
	die "root 가 아니고 sudo 도 없다 — 특권 없이는 도커 설치와 방화벽 설정을 할 수 없다"
fi

# ---------------------------------------------------------------------------
# 1. 사전 검사 — 여기서 실패해야 나중에 반쯤 뜬 스택을 디버깅하지 않는다.
# ---------------------------------------------------------------------------
log "사전 검사"
[ -f compose.yaml ] || die "레포 루트에서 실행해야 한다 (compose.yaml 이 없다)"
[ -f compose.prod.yaml ] || die "compose.prod.yaml 이 없다 — 레포 루트에서 실행한다"
[ -f .env ] || die ".env 가 없다 — 'cp .env.example .env' 후 시크릿과 DOMAIN/ACME_EMAIL 을 채운다"

# 추가 오버레이 해석. 우선순위: CLI 인자 > .env 의 DEPLOY_OVERLAYS > 없음.
#
# .env 를 경유하는 이유: 이 스크립트는 재배포·롤백 경로이기도 한데, TLS 로 띄운 호스트에서 인자 없이
# 재실행하면 TLS 오버레이가 빠져 **HTTPS 가 평문으로 내려앉는다.** 모드는 호스트의 성질이므로 명령줄이
# 아니라 호스트 설정(.env)에 남아야 한다. 아래 다운그레이드 가드가 최후 방어선이다.
overlays=("$@")
if [ ${#overlays[@]} -eq 0 ] && [ -f .env ]; then
	# `|| true` 가 필수다: grep 이 못 찾으면 1 을 반환하고, pipefail 이 그것을 파이프라인 상태로 올려
	# `set -e` 가 스크립트를 여기서 끝낸다 — DEPLOY_OVERLAYS 가 없는 것이 기본 경로이므로 항상 죽는다.
	env_overlays="$(grep -E '^DEPLOY_OVERLAYS=' .env | head -1 | cut -d= -f2- || true)"
	if [ -n "$env_overlays" ]; then
		# 공백 구분 목록. 단어 분리가 의도된 곳이다.
		read -ra overlays <<< "$env_overlays"
		echo "ok: .env 의 DEPLOY_OVERLAYS 사용 — ${overlays[*]}"
	fi
fi

# TLS 모드 여부. 방화벽 개방 범위와 종료 안내가 이 값으로 갈린다.
tls_mode=no

# 빈 배열을 순회하기 전에 개수를 확인한다: macOS 기본 bash 3.2 는 `set -u` 에서 `"${arr[@]}"` 가
# 빈 배열이면 "unbound variable" 로 죽는다(bash 4.4+ 는 괜찮다). 이 스크립트는 리눅스 호스트용이지만
# 맥에서 검증할 수 있어야 한다 — 검증 경로가 막히면 버그가 서버에서야 드러난다.
if [ ${#overlays[@]} -gt 0 ]; then
	# 없는 파일을 조용히 무시하면 상한이나 TLS 가 적용되지 않은 채 뜨므로 즉시 실패시킨다.
	for overlay in "${overlays[@]}"; do
		[ -f "$overlay" ] || die "오버레이 파일이 없다: $overlay"
		COMPOSE_FILES+=(-f "$overlay")
		echo "ok: 오버레이 추가 — $overlay"
		case "$overlay" in *compose.prod.tls.yaml) tls_mode=yes ;; esac
	done
fi

missing=()
for key in "${REQUIRED_ENV[@]}"; do
	# 주석이 아니고 값이 비어 있지 않은 줄만 인정한다. source 하지 않는다(.env 는 실행 대상이 아니다).
	grep -Eq "^${key}=.+" .env || missing+=("$key")
done
[ ${#missing[@]} -eq 0 ] || die ".env 에 값이 없다: ${missing[*]-}"

undefined=()
for key in "${REQUIRED_DEFINED_ENV[@]}"; do
	# 값은 비어 있어도 되므로 `=` 까지만 있으면 통과. 줄 자체가 없으면 실패.
	grep -Eq "^${key}=" .env || undefined+=("$key")
done
[ ${#undefined[@]} -eq 0 ] \
	|| die ".env 에 정의 자체가 없다(값은 비어도 된다): ${undefined[*]-} — .env.example 참고"

# 로컬 개발용 placeholder 가 공개 서버로 넘어오는 사고를 막는다(.env.example 의 값들).
if grep -Eq '^REPUTATION_POOL_API_KEY=local-dev-key$|^GRAFANA_ADMIN_PASSWORD=local-dev-admin$' .env; then
	die ".env 에 .env.example 의 로컬 placeholder 가 그대로 있다 — 공개 서버에서는 강한 난수로 바꾼다"
fi
echo "ok: .env 필수 키 확인"

# 사전 검사까지만 확인하고 끝낸다. 이 스크립트는 도커 설치·방화벽·기동을 하므로 CI 에서 통째로 돌릴 수
# 없는데, 그 결과 사전 검사 구간의 버그가 서버에서야 드러났다(grep 미매치가 set -e 로 스크립트를 죽인
# 사고). DRY_RUN 은 그 구간만 실제로 실행해 CI 가 검증할 수 있게 하는 장치다.
if [ "${DRY_RUN:-0}" = 1 ]; then
	log "사전 검사 통과 (DRY_RUN=1 — 도커·방화벽·기동은 건너뛴다)"
	echo "compose 파일: ${COMPOSE_FILES[*]}"
	echo "tls_mode: $tls_mode"
	exit 0
fi

# ---------------------------------------------------------------------------
# 2. 도커 — 없으면 설치. get.docker.com 은 도커가 공식 문서에서 안내하는 설치 경로이고
#    compose 플러그인(v2)까지 함께 넣는다. 이미 있으면 건너뛴다.
# ---------------------------------------------------------------------------
if docker compose version > /dev/null 2>&1; then
	log "도커 확인 — 이미 설치돼 있다 ($(docker --version))"
else
	log "도커 설치"
	tmp="$(mktemp)"
	curl -fsSL https://get.docker.com -o "$tmp"
	$SUDO sh "$tmp"
	rm -f "$tmp"
	$SUDO systemctl enable --now docker
	# 재로그인 없이도 docker 를 쓰려면 그룹 반영이 필요하다 — 여기서는 남은 단계를 sudo 로 넘긴다.
	if [ -n "$SUDO" ]; then
		$SUDO usermod -aG docker "$(id -un)" || true
		echo "note: docker 그룹에 추가했다 — 다음 로그인부터 sudo 없이 docker 를 쓸 수 있다"
	fi
fi

# 이번 실행에서 그룹이 아직 반영되지 않았을 수 있으므로 도커 접근 가능 여부로 실행 방식을 결정한다.
if docker info > /dev/null 2>&1; then
	DOCKER=(docker)
elif [ -n "$SUDO" ]; then
	DOCKER=(sudo docker)
else
	die "도커 데몬에 접근할 수 없다 (docker info 실패)"
fi

# `!override`/`!reset`(compose.prod.yaml)은 Compose v2.24.0+ 에서만 동작한다. 그 이전 버전은 리스트를
# 병합해버려 db 의 5435 공개와 base Caddyfile 마운트가 남는다 — 조용히 잘못 뜨는 것을 막는다.
compose_version="$("${DOCKER[@]}" compose version --short 2>/dev/null || echo "0")"
if [ "$(printf '%s\n2.24.0\n' "$compose_version" | sort -V | head -1)" != "2.24.0" ]; then
	die "Docker Compose ${compose_version} 은 너무 낮다 — compose.prod.yaml 의 !override 에는 2.24.0+ 가 필요하다"
fi
echo "ok: compose ${compose_version}"

# ---------------------------------------------------------------------------
# 2-1. TLS → 평문 다운그레이드 가드
#
# 이미 TLS 로 돌고 있는 호스트에서 평문 모드로 재실행하면 Caddy 가 교체되어 **HTTPS 가 조용히 내려앉는다**
# (443 이 닫히고 :80 평문만 남는다). 재배포·롤백이 같은 스크립트라 실수하기 쉬운 경로다. 실행 중인
# caddy 컨테이너가 Caddyfile.prod 를 마운트하고 있으면 TLS 운영 중으로 보고 거부한다.
# 의도적으로 내리려면 ALLOW_PLAINTEXT_DOWNGRADE=1 을 명시한다.
# ---------------------------------------------------------------------------
if [ "$tls_mode" = no ]; then
	caddy_cid="$("${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" ps -q caddy 2> /dev/null | head -1 || true)"
	if [ -n "$caddy_cid" ] \
		&& "${DOCKER[@]}" inspect "$caddy_cid" --format '{{range .Mounts}}{{.Source}} {{end}}' 2> /dev/null \
		| grep -q 'Caddyfile\.prod'; then
		if [ "${ALLOW_PLAINTEXT_DOWNGRADE:-0}" = 1 ]; then
			log "경고: TLS 로 돌던 스택을 평문으로 내린다 (ALLOW_PLAINTEXT_DOWNGRADE=1)"
		else
			die "이 호스트는 TLS(HTTPS)로 돌고 있는데 평문 모드로 재실행하려 한다 — HTTPS 가 내려앉는다.
  TLS 를 유지하려면:  ./scripts/bootstrap.sh compose.prod.tls.yaml
  또는 .env 에      DEPLOY_OVERLAYS=compose.prod.tls.yaml  을 넣어 재실행마다 자동 적용한다.
  의도적으로 평문으로 내리려면:  ALLOW_PLAINTEXT_DOWNGRADE=1 ./scripts/bootstrap.sh"
		fi
	fi
fi

# ---------------------------------------------------------------------------
# 3. 호스트 방화벽 — 80/443 인그레스. Oracle 이미지는 기본이 차단이다: Oracle Linux 는 firewalld,
#    Ubuntu 는 INPUT 마지막의 REJECT 룰. 열지 않으면 ACME HTTP-01 챌린지부터 실패한다.
# ---------------------------------------------------------------------------
# 열 포트를 모드에 맞춘다. 평문 모드에서는 443 에 아무것도 리스닝하지 않으므로 열어둘 이유가 없다 —
# 방화벽 규칙은 영구 저장되니 한 번 열면 남는다. TLS 로 전환할 때 이 스크립트를 다시 돌리면 열린다.
if [ "$tls_mode" = yes ]; then
	log "호스트 방화벽 (80/443 인그레스 — TLS 모드)"
else
	log "호스트 방화벽 (80 인그레스 — 평문 모드, 443 은 열지 않는다)"
fi
if command -v firewall-cmd > /dev/null 2>&1 && $SUDO firewall-cmd --state > /dev/null 2>&1; then
	$SUDO firewall-cmd --permanent --add-service=http > /dev/null
	if [ "$tls_mode" = yes ]; then
		$SUDO firewall-cmd --permanent --add-service=https > /dev/null
		# HTTP/3 (Caddy 의 443/udp).
		$SUDO firewall-cmd --permanent --add-port=443/udp > /dev/null
	fi
	$SUDO firewall-cmd --reload > /dev/null
	echo "ok: firewalld — 허용 완료"
elif command -v iptables > /dev/null 2>&1; then
	# INPUT 1 번에 삽입한다: Oracle Ubuntu 이미지의 REJECT 룰 위치에 의존하지 않기 위한 것이다.
	# 허용 대상이 80/443 뿐이라 맨 앞에 두어도 다른 정책을 넓히지 않는다. -C 로 멱등하게.
	specs=("tcp 80")
	[ "$tls_mode" = yes ] && specs+=("tcp 443" "udp 443")
	for spec in "${specs[@]}"; do
		read -r proto port <<< "$spec"
		for cmd in iptables ip6tables; do
			command -v "$cmd" > /dev/null 2>&1 || continue
			$SUDO "$cmd" -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2> /dev/null \
				|| $SUDO "$cmd" -I INPUT 1 -p "$proto" --dport "$port" -j ACCEPT
		done
	done
	# 재부팅 후에도 남도록 저장. netfilter-persistent 가 없으면 경고만 하고 넘어간다(룰은 이미 적용됨).
	if command -v netfilter-persistent > /dev/null 2>&1; then
		$SUDO netfilter-persistent save > /dev/null
		echo "ok: iptables — 허용 + 영구 저장"
	else
		echo "warn: netfilter-persistent 가 없다 — 룰은 적용됐지만 재부팅 시 사라진다"
	fi
else
	echo "warn: firewalld·iptables 를 찾지 못했다 — 인그레스를 직접 확인할 것"
fi

# ---------------------------------------------------------------------------
# 4. 이미지 pull + 기동. 서버는 빌드하지 않는다(release.yml 이 GHCR 에 arm64 로 발행).
# ---------------------------------------------------------------------------
log "이미지 pull (GHCR)"
# GHCR 패키지는 기본이 private 다 — public 으로 바꾸지 않았다면 익명 pull 이 denied 로 실패한다.
# 실패 원인이 네트워크로 오해되기 쉬워 힌트를 붙인다.
"${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" pull || die "이미지 pull 실패 — GHCR 패키지가 public 인지 확인한다
  (GitHub → 레포 → Packages → 각 패키지 → Package settings → Change visibility → Public).
  private 로 두려면 read:packages 권한 PAT 로 'docker login ghcr.io' 를 먼저 실행한다.
  자세한 내용: docs/engineering/deployment.md"

log "스택 기동"
# --remove-orphans: 이전 배포에서 사라진 서비스의 컨테이너를 남기지 않는다.
"${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" up -d --remove-orphans

# ---------------------------------------------------------------------------
# 5. 기동 확인 — app 의 loopback 포트로 확인한다. DNS·인증서와 무관하게 백엔드 자체를 판정할 수 있다.
# ---------------------------------------------------------------------------
log "헬스 대기 (app:8083, 최대 3분)"
for i in $(seq 1 90); do
	if curl -fsS http://127.0.0.1:8083/actuator/health > /dev/null 2>&1; then
		echo "ok: app 이 healthy 하다"
		break
	fi
	if [ "$i" -eq 90 ]; then
		"${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" ps
		"${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" logs --no-color --tail 100 app
		die "app 이 3분 안에 뜨지 않았다 (위 로그 확인)"
	fi
	sleep 2
done

"${DOCKER[@]}" compose "${COMPOSE_FILES[@]}" ps

# 안내는 tls_mode 로 갈라 준다 — 평문 모드에서 인증서 얘기를 하면 혼란만 준다.
printf '\n==> 완료. 남은 확인 (이 스크립트 밖)\n'
printf '  1. OCI 콘솔 → Networking → VCN → Security List(또는 NSG) 인그레스 허용:\n'
if [ "$tls_mode" = yes ]; then
	printf '     80/443 (TCP) + 443 (UDP). 호스트 방화벽만 열고 여기를 빼먹으면 "인증서 발급 실패"로 나타난다.\n'
else
	printf '     80 (TCP). 호스트 방화벽만 열고 여기를 빼먹으면 브라우저에서 그냥 안 열린다.\n'
fi

if [ "$tls_mode" = yes ]; then
	# 위와 같은 이유로 `|| true`. TLS 모드면 값이 있어야 하지만, 없더라도 안내 문구가 깨질 뿐이지
	# 스크립트가 죽어서는 안 된다(이미 기동은 끝난 시점이다).
	domain="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2- || true)"
	cat <<EOF
  2. DNS: ${domain:-<DOMAIN>} A/AAAA 레코드를 이 인스턴스로. Cloudflare 를 쓰면 인증서가 발급될
     때까지 DNS-only(회색 구름)로 두고, 발급 확인 후 proxied(주황 구름)로 전환한다.
  3. https://${domain:-<도메인>}/actuator/health 가 200 이면 공개 경로까지 성공이다.
     인증서 진행 상황: docker compose ${COMPOSE_FILES[*]} logs caddy
EOF
else
	cat <<EOF
  2. 평문 모드다(도메인·TLS 없음). http://<이 서버 공인 IP>/ 로 대시보드가 열리고
     http://<공인 IP>/actuator/health 가 200 이면 성공이다.
  3. ⚠️ HTTP 이므로 관리 콘솔 로그인 자격이 평문으로 전송된다. 도메인·TLS 를 붙이기 전에는
     관리자 자격을 설정하지 않거나(미설정 시 /api/** 가 fail closed) throwaway 값만 쓴다.
     도메인이 준비되면: ./scripts/bootstrap.sh compose.prod.tls.yaml
EOF
fi

cat <<EOF

  롤백: .env 에 APP_IMAGE_TAG=sha-<커밋> 을 넣고 이 스크립트를 다시 실행한다.
EOF

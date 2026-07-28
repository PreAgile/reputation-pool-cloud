#!/usr/bin/env bash
# 풀 기반 배포용 systemd 서비스 + 타이머 설치 (#15). **서버에서** 한 번 실행한다.
#
# 유닛 파일을 레포에 커밋해 두지 않고 여기서 생성하는 이유: `User=` 와 `WorkingDirectory=` 가 호스트마다
# 다르고, 커밋된 파일에 경로를 박아 두면 다른 호스트에서 조용히 틀린 디렉터리를 배포하게 된다. 지금 실행
# 중인 사용자와 이 스크립트의 위치에서 값을 얻으므로 어긋날 수 없다.
#
# 사용:
#   ./scripts/install-pull-deploy.sh              # 설치 + 즉시 시작
#   ./scripts/install-pull-deploy.sh --interval 10m
#   ./scripts/install-pull-deploy.sh --uninstall
#
# 설치 후 확인:
#   systemctl list-timers reputation-pool-deploy.timer
#   journalctl -u reputation-pool-deploy.service -n 50 --no-pager
#
# 배포를 멈추려면 타이머를 지울 필요 없이 `.env` 의 PULL_DEPLOY_ENABLED 를 true 가 아닌 값으로 바꾼다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
INTERVAL="5m"
UNINSTALL=false

while [ $# -gt 0 ]; do
	case "$1" in
		--interval) INTERVAL="${2:?--interval 에 값이 필요하다}"; shift 2 ;;
		--uninstall) UNINSTALL=true; shift ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
	esac
done

SERVICE=/etc/systemd/system/reputation-pool-deploy.service
TIMER=/etc/systemd/system/reputation-pool-deploy.timer

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

[ "$RUN_USER" != "root" ] || die "root 로 실행하지 않는다 — 배포를 수행할 일반 사용자로 실행한다(그 사용자가 유닛의 User= 가 된다)"
sudo -n true 2> /dev/null || die "비밀번호 없는 sudo 가 필요하다(유닛 파일을 /etc/systemd/system 에 쓴다)"

if [ "$UNINSTALL" = true ]; then
	log "제거"
	sudo systemctl disable --now reputation-pool-deploy.timer 2> /dev/null || true
	sudo rm -f "$SERVICE" "$TIMER"
	sudo systemctl daemon-reload
	echo "제거 완료. .env 의 PULL_DEPLOY_* 키는 그대로 남아 있다."
	exit 0
fi

[ -x "$REPO_DIR/scripts/pull-deploy.sh" ] || die "pull-deploy.sh 가 실행 가능하지 않다: $REPO_DIR/scripts/pull-deploy.sh"
[ -f "$REPO_DIR/.env" ] || die ".env 가 없다: $REPO_DIR/.env"

if ! grep -qE '^PULL_DEPLOY_ENABLED=true' "$REPO_DIR/.env"; then
	printf '\n주의: .env 에 PULL_DEPLOY_ENABLED=true 가 없다. 타이머는 설치되지만 배포는 시작되지 않는다\n'
	printf '      (fail closed). 준비되면 그 줄을 넣으면 다음 주기부터 동작한다.\n'
fi

log "유닛 생성 (user=$RUN_USER, dir=$REPO_DIR, interval=$INTERVAL)"

sudo tee "$SERVICE" > /dev/null <<UNIT
[Unit]
Description=reputation-pool-cloud 풀 기반 배포 (한 번 실행)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md
# 도커와 네트워크가 준비된 뒤에만 의미가 있다. 아니면 첫 실행이 fetch 나 manifest 확인에서 헛돈다.
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/scripts/pull-deploy.sh
# 배포는 이미지 pull 을 포함하므로 넉넉히 준다. 넘으면 실패로 남고 다음 주기가 다시 시도한다.
TimeoutStartSec=25min
UNIT

sudo tee "$TIMER" > /dev/null <<UNIT
[Unit]
Description=reputation-pool-cloud 배포 확인 타이머
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md

[Timer]
# 부팅 직후 한 번(재부팅 중 놓친 배포를 따라잡는다), 그 뒤 주기적으로.
OnBootSec=2min
OnUnitActiveSec=$INTERVAL
# 여러 타이머가 같은 초에 몰리지 않게 systemd 가 분산할 여유. 배포 지연에 영향은 없다.
AccuracySec=30s
RandomizedDelaySec=20s
# 서버가 꺼져 있던 동안 지나간 주기를 부팅 후 한 번으로 합쳐 실행한다.
Persistent=true

[Install]
WantedBy=timers.target
UNIT

log "활성화"
sudo systemctl daemon-reload
sudo systemctl enable --now reputation-pool-deploy.timer

log "상태"
systemctl list-timers reputation-pool-deploy.timer --no-pager || true

cat <<'DONE'

==> 완료

  다음 확인:
    systemctl list-timers reputation-pool-deploy.timer
    journalctl -u reputation-pool-deploy.service -n 50 --no-pager

  즉시 한 번 돌려보기:
    ./scripts/pull-deploy.sh --dry-run     # 무엇을 할지만 출력
    sudo systemctl start reputation-pool-deploy.service

  배포 멈추기(타이머 유지):
    .env 의 PULL_DEPLOY_ENABLED 를 false 로 바꾼다
DONE

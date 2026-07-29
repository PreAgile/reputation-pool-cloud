#!/usr/bin/env bash
# A1 사냥 루프를 서버 상주 서비스로 설치한다 (#15). **서버에서** 한 번 실행한다.
#
# ## 왜 서버인가
# 개발 머신에서 돌리면 맥이 잠들 때마다 루프가 멈춘다 — 실측 30시간 중 실제 시도는 11시간분이었다
# (가동률 37%). 용량이 열리는 순간은 예측할 수 없으므로 **가동률이 곧 확률**이고, 24/7 도는 서버로
# 옮기면 100% 가 된다.
#
# ## 왜 API 키를 복사하지 않는가
# 이 서버는 공개 인터넷에 열려 있다. `~/.oci/oci_api_key.pem` 은 테넌시 전체를 조작할 수 있고 파일이라
# 유출되면 어디서든 쓸 수 있다. 대신 **인스턴스 프린시펄**을 쓴다 — 인스턴스가 자기 신원으로 인증하므로
# 키 파일이 없고, 권한은 IAM 정책으로 좁히며, 문제가 생기면 정책을 지워 즉시 차단된다.
#
# 사전 준비(테넌시에 한 번, 관리자 자격으로 — 이미 되어 있다면 건너뛴다):
#   oci iam dynamic-group create --name a1-hunter \
#     --matching-rule "ALL {instance.id = '<이 인스턴스 OCID>'}" ...
#   oci iam policy create --name a1-hunter-policy --statements '[
#     "Allow dynamic-group a1-hunter to manage instance-family in tenancy where any {
#        request.operation='"'"'LaunchInstance'"'"', request.operation='"'"'GetInstance'"'"',
#        request.operation='"'"'ListInstances'"'"', request.operation='"'"'ListVnicAttachments'"'"'}",
#     "Allow dynamic-group a1-hunter to use volume-family in tenancy",
#     "Allow dynamic-group a1-hunter to use virtual-network-family in tenancy"]'
#
# TerminateInstance 를 정책에서 뺀 것이 중요하다: 이 루프는 프로덕션 서버에서 돌고, 그 서버가 자기
# 자신을 죽일 수 있으면 안 된다.
#
# 사용:
#   ./scripts/install-a1-hunter.sh              # 설치 + 즉시 시작
#   ./scripts/install-a1-hunter.sh --uninstall
#
# 설정은 `~/.a1-hunter.env` 에 둔다(이 스크립트가 없으면 만들어 준다). 메일 알림은 `~/.rp-mail.env`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
UNINSTALL=false
ENV_FILE="$HOME/.a1-hunter.env"

while [ $# -gt 0 ]; do
	case "$1" in
		--uninstall) UNINSTALL=true; shift ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
	esac
done

SERVICE=/etc/systemd/system/a1-hunter.service

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

[ "$RUN_USER" != root ] || die "root 로 실행하지 않는다 — 루프를 돌릴 일반 사용자로 실행한다(그 사용자가 유닛의 User= 가 된다)"
sudo -n true 2> /dev/null || die "비밀번호 없는 sudo 가 필요하다(유닛 파일을 /etc/systemd/system 에 쓴다)"

if [ "$UNINSTALL" = true ]; then
	log "제거"
	sudo systemctl disable --now a1-hunter.service 2> /dev/null || true
	sudo rm -f "$SERVICE"
	sudo systemctl daemon-reload
	echo "제거 완료. $ENV_FILE 는 그대로 남아 있다."
	exit 0
fi

command -v oci > /dev/null 2>&1 || [ -x "$HOME/bin/oci" ] \
	|| die "oci CLI 가 없다 — bash -c \"\$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)\" --accept-all-defaults"
[ -x "$REPO_DIR/scripts/oci-launch-retry.sh" ] || die "oci-launch-retry.sh 가 실행 가능하지 않다"

# 인스턴스 프린시펄이 실제로 되는지 먼저 본다. 여기서 걸러야 "서비스는 떴는데 매 재시작마다 인증
# 실패로 죽는" 상태를 피한다 — systemd 는 Restart=always 로 조용히 재시작만 반복한다.
log "인스턴스 프린시펄 확인"
INSTANCE_ID="$(curl -sS -H 'Authorization: Bearer Oracle' --max-time 5 \
	http://169.254.169.254/opc/v2/instance/id || true)"
[ -n "$INSTANCE_ID" ] || die "인스턴스 메타데이터에 닿지 못했다 — OCI 인스턴스가 아니거나 메타데이터가 막혀 있다"
echo "  instance $INSTANCE_ID"

if [ ! -f "$ENV_FILE" ]; then
	log "설정 파일 생성: $ENV_FILE"
	umask 077
	cat > "$ENV_FILE" <<'ENVFILE'
# A1 사냥 루프 설정. systemd EnvironmentFile 로 읽힌다(따옴표 없이, KEY=VALUE).
#
# TENANCY/AD/SUBNET/IMAGE 를 박아 두는 이유: 값을 조회하면 시도마다 API 호출이 늘고(레이트 리밋에
# 불리) 조회 권한까지 정책에 넣어야 한다. 박아 두면 필요한 권한이 LaunchInstance 계열만 남는다.
TENANCY=
AD=
SUBNET=
IMAGE=
SSH_KEY_FILE=/home/ubuntu/.ssh/oci_rp_work.pub
SHAPE_LADDER=2:12 1:6
INTERVAL=60
BOOT_GB=50
DISPLAY_NAME=reputation-pool-prod
ENVFILE
	die "$ENV_FILE 을 채운 뒤 다시 실행한다 (TENANCY/AD/SUBNET/IMAGE 는 개발 머신의 oci CLI 로 조회한다)"
fi

for key in TENANCY AD SUBNET IMAGE SSH_KEY_FILE; do
	grep -qE "^${key}=." "$ENV_FILE" || die "$ENV_FILE 에 $key 가 비어 있다"
done
keyfile="$(grep -E '^SSH_KEY_FILE=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -f "$keyfile" ] || die "SSH 공개키가 없다: $keyfile (개발 머신에서 복사한다 — 공개키라 비밀이 아니다)"

log "유닛 생성 (user=$RUN_USER, dir=$REPO_DIR)"

# Type=simple + Restart=always: 이 스크립트는 성공할 때까지 도는 장기 루프다. 네트워크 장애나 OOM 으로
# 죽어도 스스로 돌아와야 한다. 단 **성공하면 exit 0 으로 끝나므로** RemainAfterExit 없이 두고,
# Restart=on-failure 가 아니라 always 를 쓰되 성공 종료는 재시작하지 않도록 RestartPreventExitStatus 로
# 0 을 지정한다 — 그러지 않으면 인스턴스를 잡은 뒤에도 계속 다시 떠서 두 번째 인스턴스를 만들려 든다.
sudo tee "$SERVICE" > /dev/null <<UNIT
[Unit]
Description=A1 용량 사냥 루프 (#15) — 확보 즉시 종료하고 메일로 알린다
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
Environment=OCI_CLI_AUTH=instance_principal
Environment=PATH=$HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$REPO_DIR/scripts/oci-launch-retry.sh
Restart=always
RestartSec=60
RestartPreventExitStatus=0
# 루프가 60초 간격으로 도는 동안 CPU 를 거의 쓰지 않지만, 프로덕션 서비스와 자원을 다투지 않도록
# 우선순위를 낮춘다.
Nice=10
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
UNIT

log "활성화"
sudo systemctl daemon-reload
sudo systemctl enable --now a1-hunter.service

sleep 3
log "상태"
systemctl status a1-hunter.service --no-pager -n 15 || true

cat <<'DONE'

==> 완료

  로그:       journalctl -u a1-hunter.service -f
  멈추기:     sudo systemctl stop a1-hunter.service
  제거:       ./scripts/install-a1-hunter.sh --uninstall

  확보에 성공하면 서비스는 exit 0 으로 끝나고(재시작하지 않는다) 메일이 갑니다.
DONE

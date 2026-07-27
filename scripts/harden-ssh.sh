#!/usr/bin/env bash
# SSH 하드닝 — 공개키 전용 접속을 확정하고 브루트포스 표면을 닫는다.
#
# bootstrap.sh 는 80/443 인그레스만 다룬다. 22 번은 Oracle 이미지가 처음부터 열어두는 유일한 포트이고,
# 인터넷에 노출된 sshd 는 계정 추측 시도를 상시로 받는다 — security.md 가 로그인 API 에 대해 세운
# "IP 단위로 세고 차단한다"는 원칙을 호스트 레벨에서도 같은 모양으로 적용한다(fail2ban).
#
# **비밀번호 인증은 켜는 옵션조차 두지 않는다.** 비밀번호는 추측 가능한 자격이라 22 번이 열려 있는
# 동안 사전 공격의 유효 표면이 되는데, ed25519 키에는 그 표면이 없다. OCI 이미지는 기본이 이미 키
# 전용인데 여기서 명시적으로 못박는 이유는 (1) 이미지·배포판이 바뀌어도 전제가 유지되고
# (2) 누가 나중에 손으로 켜둔 설정을 되돌리기 때문이다. 멱등하다.
#
# 어느 경우에도 root 직접 로그인은 열지 않는다. sudo 를 거치게 하면 누가 무엇을 했는지가 로그에 남는다.
#
# 전제: 이 스크립트를 돌리는 계정으로 이미 **키 접속이 되고 있어야** 한다. 그 확인을 통과하지 못하면
# 아무것도 바꾸지 않고 멈춘다 — 스스로를 잠그는 것이 이 스크립트의 유일한 치명적 실패 모드다.
#
#   ssh -i ~/.ssh/oci_rp_work ubuntu@<IP>
#   cd reputation-pool-cloud && ./scripts/harden-ssh.sh
#
# 22 번의 **인그레스 소스**는 이 스크립트가 다루지 않는다 — 그건 `oci-ssh-allow.sh`(노트북에서 실행)다.
# 호스트에서 인그레스를 좁히면 잘못됐을 때 스스로 되돌릴 수 없기 때문에 일부러 분리했다.
#
# 환경변수 (전부 선택):
#   SSH_ALLOW_USERS="ubuntu"   AllowUsers 화이트리스트. 기본은 현재 계정.
#   SKIP_FAIL2BAN=1            fail2ban 설치를 건너뛴다.
set -euo pipefail

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
	SUDO=""
elif command -v sudo > /dev/null 2>&1; then
	SUDO="sudo"
else
	die "root 가 아니고 sudo 도 없다 — sshd 설정과 패키지 설치에는 특권이 필요하다"
fi

TARGET_USER="${SUDO_USER:-$(id -un)}"
ALLOW_USERS="${SSH_ALLOW_USERS:-$TARGET_USER}"

# ---------------------------------------------------------------------------
# 0. 잠금 방지 — 여기를 통과하지 못하면 절대 진행하지 않는다.
#
# 비밀번호 인증을 끄는 순간 유일한 입구는 authorized_keys 다. 그 파일이 비어 있는데 설정을 적용하면
# 재접속이 불가능해지고, 복구는 OCI 콘솔의 Bastion·시리얼 콘솔 같은 별도 경로가 된다.
# ---------------------------------------------------------------------------
log "잠금 방지 사전 검사"
home="$(eval echo "~$TARGET_USER")"
keys="$home/.ssh/authorized_keys"
[ -f "$keys" ] || die "$keys 가 없다 — 키 접속이 성립하지 않은 상태에서 비밀번호를 끄면 잠긴다"
key_count="$(grep -cE '^(ssh-|ecdsa-|sk-)' "$keys" || true)"
[ "${key_count:-0}" -ge 1 ] || die "$keys 에 유효한 공개키가 없다 — 중단한다"
echo "ok: $TARGET_USER 에 공개키 ${key_count}개 — 키 접속 성립"

# OCI Bastion 이 주입한 키는 `#ocid1.bastionsession...` 주석 블록 안에 들어가고 **세션이 만료되면
# 플러그인이 지운다**. 그 키에만 의존하는 상태로 하드닝하면 세션 만료와 함께 잠긴다.
if grep -q '^#ocid1\.bastionsession' "$keys" 2> /dev/null; then
	permanent="$(grep -vE '^#|^$' "$keys" | grep -cE '^(ssh-|ecdsa-|sk-)' || true)"
	echo "note: Bastion 세션이 주입한 임시 키가 있다(세션 만료 시 사라진다)."
	echo "      블록 밖 영구 키가 ${permanent}개 있는지 확인할 것 — 없으면 먼저 등록하고 다시 실행한다."
fi

# ---------------------------------------------------------------------------
# 1. sshd 설정 — drop-in 으로 넣는다.
#
# /etc/ssh/sshd_config 를 직접 수정하지 않는 이유: 배포판 패키지 업그레이드가 그 파일을 덮거나
# 3-way merge 프롬프트를 띄운다. Ubuntu 24.04 와 Oracle Linux 9 모두 sshd_config.d/*.conf 를
# Include 하고, sshd 는 **먼저 나온 값이 이긴다** — Include 가 파일 앞에 있으므로 drop-in 이 우선한다.
# 파일명의 99- 는 클라우드 이미지가 넣어둔 50-cloud-init.conf 류와 이름으로 충돌하지 않게 하려는 것이다.
# ---------------------------------------------------------------------------
log "sshd 하드닝 설정"

# Include 가 없는 배포판이면 drop-in 이 조용히 무시된다 — 즉시 알려야 한다.
if ! $SUDO grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config; then
	die "/etc/ssh/sshd_config 에 sshd_config.d Include 가 없다 — drop-in 이 무시된다. 직접 수정할 것"
fi

dropin=/etc/ssh/sshd_config.d/99-hardening.conf
$SUDO mkdir -p /etc/ssh/sshd_config.d
$SUDO tee "$dropin" > /dev/null <<EOF
# harden-ssh.sh 가 생성 — 직접 고치지 말고 스크립트를 고칠 것.

# 공개키만. KbdInteractive 를 같이 끄지 않으면 PAM 경로로 비밀번호가 되살아난다 —
# PasswordAuthentication no 만 걸고 안심하는 것이 가장 흔한 실수다.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitEmptyPasswords no

# root 직접 로그인 금지. sudo 를 거치게 하면 "누가 무엇을 했는지"가 로그에 남는다.
PermitRootLogin no

# 접속 가능한 계정을 명시한다. 나중에 서비스 계정이 늘어도 자동으로 열리지 않는다.
AllowUsers $ALLOW_USERS

# 연결당 시도 횟수·시간을 좁힌다. fail2ban 이 IP 를 차단하기까지의 창을 줄인다.
MaxAuthTries 3
LoginGraceTime 20
MaxSessions 5

# 쓰지 않는 기능은 끈다 — 공격 표면이지 편의가 아니다.
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding yes
PermitTunnel no

# 유휴 세션 정리(2분 x 3 = 6분).
ClientAliveInterval 120
ClientAliveCountMax 3
EOF
$SUDO chmod 644 "$dropin"

# 문법 검증 후에만 반영한다. sshd -t 를 건너뛰고 restart 하면 오타 하나로 sshd 가 죽고,
# 그 순간 유일한 입구가 사라진다.
if ! $SUDO sshd -t; then
	$SUDO rm -f "$dropin"
	die "sshd 설정 문법 오류 — drop-in 을 되돌렸다. sshd 는 그대로 살아 있다"
fi
echo "ok: sshd -t 통과"

# 서비스 이름은 배포판마다 다르다(Ubuntu: ssh, OL9: sshd). reload 를 쓴다 — restart 와 달리
# 기존 세션을 끊지 않으므로, 설정이 잘못돼도 지금 붙어 있는 창은 살아남아 복구할 수 있다.
#
# 존재 판정에 `is-enabled` 를 쓰면 안 된다. Ubuntu 24.04 는 socket activation 이 기본이라
# `ssh.socket` 이 enabled 이고 `ssh.service` 는 **disabled 이면서 active** 다 — enabled 여부로
# 거르면 유닛이 있는데도 "없다"고 판정해 reload 를 건너뛴다. `systemctl cat` 으로 존재만 보고,
# 실행 여부는 `is-active` 로 따로 본다.
svc=""
for candidate in ssh sshd; do
	if $SUDO systemctl cat "$candidate.service" > /dev/null 2>&1; then
		svc="$candidate"
		break
	fi
done
[ -n "$svc" ] || die "ssh/sshd systemd 유닛을 찾지 못했다 — 수동으로 reload 할 것"
if $SUDO systemctl is-active "$svc" > /dev/null 2>&1; then
	$SUDO systemctl reload "$svc"
	echo "ok: $svc reload — 기존 세션은 유지된다"
else
	# socket activation 만 도는 구성. 연결마다 sshd 가 새로 뜨면서 설정을 다시 읽으므로
	# reload 할 대상이 없고, 다음 연결부터 자동으로 적용된다.
	echo "ok: $svc 는 실행 중이 아니다(socket activation) — 새 연결부터 적용된다"
fi

# ---------------------------------------------------------------------------
# 2. fail2ban — 실패 반복 IP 차단.
#
# 키 전용으로 바꾸면 비밀번호 추측은 애초에 성공할 수 없다. 그래도 켜는 이유는 남는 비용이다:
# 시도 자체가 로그와 CPU 를 먹고, 무료 티어의 좁은 인스턴스에서는 그게 관측 노이즈가 된다.
# security.md 의 로그인 스로틀과 같은 모양 — 계정을 잠그지 않고 IP 를 잠근다.
# ---------------------------------------------------------------------------
if [ "${SKIP_FAIL2BAN:-}" = 1 ]; then
	log "fail2ban 건너뜀 (SKIP_FAIL2BAN=1)"
else
	log "fail2ban"
	if ! command -v fail2ban-server > /dev/null 2>&1; then
		if command -v apt-get > /dev/null 2>&1; then
			$SUDO DEBIAN_FRONTEND=noninteractive apt-get update -qq
			$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban > /dev/null
		elif command -v dnf > /dev/null 2>&1; then
			# OL9 는 fail2ban 이 EPEL 에 있다.
			$SUDO dnf install -y -q oracle-epel-release-el9 > /dev/null 2>&1 \
				|| $SUDO dnf install -y -q epel-release > /dev/null 2>&1 || true
			$SUDO dnf install -y -q fail2ban > /dev/null
		else
			die "apt-get·dnf 를 찾지 못했다 — fail2ban 을 수동 설치하거나 SKIP_FAIL2BAN=1"
		fi
	fi

	# jail.local 에 쓴다(jail.conf 는 패키지 소유라 업그레이드 때 덮인다).
	# backend=systemd: Ubuntu 24.04 는 /var/log/auth.log 를 만들지 않는다 — journal 을 읽어야 한다.
	$SUDO tee /etc/fail2ban/jail.local > /dev/null <<EOF
# harden-ssh.sh 가 생성 — 직접 고치지 말고 스크립트를 고칠 것.
[DEFAULT]
backend = systemd
# 차단은 넉넉히, 창은 짧게. 정상 사용자가 걸릴 일은 키 인증에서는 사실상 없다.
bantime = 1h
findtime = 10m
maxretry = 5
# 스스로를 차단하지 않도록 사설 대역을 제외한다(OCI VCN 내부 통신 = Bastion 경로 포함).
ignoreip = 127.0.0.1/8 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16

[sshd]
enabled = true
mode = aggressive
# journalmatch 를 명시하는 이유: fail2ban 의 sshd 기본값은 \`_SYSTEMD_UNIT=sshd.service\` 인데
# Debian·Ubuntu 의 유닛명은 \`ssh.service\` 다. 그대로 두면 매치가 0건이 되어 fail2ban 이
# "돌고는 있지만 아무것도 못 보는" 상태가 된다 — 차단이 안 되는데 status 는 정상으로 보이므로
# 가장 위험한 실패 모드다. 위에서 탐지한 실제 유닛명을 그대로 쓴다.
journalmatch = _SYSTEMD_UNIT=$svc.service + _COMM=sshd
EOF
	$SUDO systemctl enable --now fail2ban > /dev/null
	$SUDO systemctl restart fail2ban
	echo "ok: fail2ban — bantime 1h / maxretry 5 / unit=$svc.service"
fi

# ---------------------------------------------------------------------------
# 3. 무인 보안 업데이트 — sshd·커널 CVE 를 사람 손에 의존하지 않게 한다.
#
# 키 전용 인증은 **인증 단계**만 막는다. sshd 의 pre-auth 취약점(CVE-2024-6387 등)은 인증 전에
# 터지므로 키가 보호해주지 않는다 — 패치와 인그레스 제한이 그 부류의 대책이다.
# ---------------------------------------------------------------------------
log "무인 보안 업데이트"
if command -v apt-get > /dev/null 2>&1; then
	$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades > /dev/null
	# 재부팅은 자동으로 하지 않는다 — 스택이 도는 호스트를 예고 없이 내리면 안 된다.
	$SUDO tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
	echo "ok: unattended-upgrades (자동 재부팅은 끔 — 커널 갱신 시 직접 재부팅할 것)"
elif command -v dnf > /dev/null 2>&1; then
	$SUDO dnf install -y -q dnf-automatic > /dev/null
	$SUDO systemctl enable --now dnf-automatic.timer > /dev/null
	echo "ok: dnf-automatic.timer"
else
	echo "warn: 패키지 관리자를 찾지 못했다 — 보안 업데이트를 수동으로 관리할 것"
fi

# ---------------------------------------------------------------------------
# 검증 — 파일 내용이 아니라 sshd 가 해석한 유효 설정으로 확인한다.
# ---------------------------------------------------------------------------
log "적용 결과 (sshd 가 해석한 값)"
$SUDO sshd -T 2> /dev/null | grep -iE '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|maxauthtries|allowusers) ' \
	|| echo "warn: sshd -T 출력을 읽지 못했다"

cat <<EOF

==> 완료

  이 세션은 끊지 않았다(reload). **지금 붙어 있는 창을 닫기 전에** 새 터미널에서 재접속을 확인할 것:

    ssh -i ~/.ssh/oci_rp_work $TARGET_USER@<IP>

  막히면 이 창에서 되돌릴 수 있다:

    sudo rm $dropin && sudo systemctl reload $svc

  남은 것 — 이 스크립트가 다루지 않는 것:
  * 22 번의 인그레스 소스는 \`oci-ssh-allow.sh\`(노트북에서 실행)가 관리한다. 좁히지 않으면
    포트가 전 세계에 보이는 상태가 유지된다 — pre-auth 취약점은 키로 막지 못한다.
  * fail2ban 상태:  sudo fail2ban-client status sshd
EOF

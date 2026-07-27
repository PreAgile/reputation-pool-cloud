#!/usr/bin/env bash
# SSH 접속 정책 설정 — 인증 방식을 확정하고 브루트포스 표면을 좁힌다.
#
# bootstrap.sh 는 80/443 인그레스만 다룬다. 22 번은 OCI 이미지가 처음부터 열어두는 유일한 포트이고,
# 인터넷에 노출된 sshd 는 계정 추측 시도를 상시로 받는다 — security.md 가 로그인 API 에 대해 세운
# "IP 단위로 세고 차단한다"는 원칙을 호스트 레벨에서도 같은 모양으로 적용한다(fail2ban).
#
# 두 가지 모드가 있다.
#
#   기본(키 전용):     ./scripts/harden-ssh.sh
#   비밀번호 허용:     SSH_PASSWORD_AUTH=1 ./scripts/harden-ssh.sh
#
# 기본이 키 전용인 이유는 비밀번호가 **추측 가능한 자격**이라는 점이다. 22 번이 0.0.0.0/0 에 열린 채
# 비밀번호를 켜면 사전 공격의 유효 표면이 생긴다 — ed25519 키에는 그 표면이 없다. 그래서 비밀번호
# 모드에서는 fail2ban 을 선택이 아닌 필수로 강제하고(SKIP_FAIL2BAN 을 무시한다), 차단 임계값을 더
# 조이고, 비밀번호가 실제로 강한지 검사한다. 그것들이 없으면 비밀번호 모드는 성립하지 않는다.
#
# 어느 모드든 root 직접 로그인은 열지 않는다. sudo 를 거치게 하면 누가 무엇을 했는지가 로그에 남는다.
#
# 멱등하다 — 재실행이 곧 재적용이고, 모드를 바꿔 다시 돌리면 전환된다.
#
# 전제: 이 스크립트를 돌리는 계정으로 이미 서버에 들어와 있어야 한다. 원격에서 sshd 설정을 바꾸는
# 작업의 유일한 치명적 실패는 스스로를 잠그는 것이므로, 그 확인을 통과하지 못하면 아무것도 바꾸지 않는다.
#
#   ssh -i ~/.ssh/oci_rp_work ubuntu@<IP>
#   cd reputation-pool-cloud && ./scripts/harden-ssh.sh
#
# 환경변수 (전부 선택):
#   SSH_PASSWORD_AUTH=1       비밀번호 인증을 켠다(기본은 끈다).
#   SSH_SET_PASSWORD=1        비밀번호 모드에서 강한 비밀번호를 생성해 설정한다.
#   SSH_ALLOW_USERS="ubuntu"  AllowUsers 화이트리스트. 기본은 현재 계정.
#   SKIP_FAIL2BAN=1           fail2ban 을 건너뛴다. **비밀번호 모드에서는 무시된다.**
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
PW_MODE="${SSH_PASSWORD_AUTH:-0}"

if [ "$PW_MODE" = 1 ]; then
	log "모드: 비밀번호 + 공개키 허용"
	# 비밀번호를 켜는 순간 fail2ban 은 보험이 아니라 유일한 브루트포스 방어선이 된다.
	if [ "${SKIP_FAIL2BAN:-}" = 1 ]; then
		echo "warn: 비밀번호 모드에서는 SKIP_FAIL2BAN 을 무시한다 — fail2ban 없이는 켤 수 없다"
	fi
	SKIP_FAIL2BAN=0
else
	log "모드: 공개키 전용"
fi

# ---------------------------------------------------------------------------
# 0. 잠금 방지 — 여기를 통과하지 못하면 진행하지 않는다.
#
# 적용 후 재접속에 쓸 자격이 최소 하나는 성립해 있어야 한다. 키 전용 모드에서는 authorized_keys,
# 비밀번호 모드에서는 "키 또는 설정된 비밀번호" 다. 둘 다 없는 상태로 적용하면 복구가 콘솔 시리얼
# 접속이나 부트 볼륨 분리 같은 수작업이 된다.
# ---------------------------------------------------------------------------
log "잠금 방지 사전 검사"
home="$(eval echo "~$TARGET_USER")"
keys="$home/.ssh/authorized_keys"
key_count=0
if [ -f "$keys" ]; then
	key_count="$(grep -cE '^(ssh-|ecdsa-|sk-)' "$keys" || true)"
fi
echo "공개키: ${key_count}개 ($keys)"

# 비밀번호가 실제로 설정돼 있는지는 shadow 의 2번째 필드로 판단한다. `!` 또는 `*` 로 시작하면
# 잠긴 것이고(클라우드 이미지의 기본), 빈 값이면 비밀번호 없음이다 — 둘 다 로그인에 쓸 수 없다.
pw_hash="$($SUDO getent shadow "$TARGET_USER" 2> /dev/null | cut -d: -f2 || true)"
case "$pw_hash" in
	'' | '!'* | '*'*) pw_set=no ;;
	*) pw_set=yes ;;
esac
echo "비밀번호: $pw_set"

if [ "$PW_MODE" = 1 ]; then
	if [ "$pw_set" = no ] && [ "${SSH_SET_PASSWORD:-}" != 1 ]; then
		die "비밀번호 모드인데 $TARGET_USER 에 비밀번호가 없다 — SSH_SET_PASSWORD=1 로 생성하게 하거나 먼저 'sudo passwd $TARGET_USER' 로 설정할 것"
	fi
else
	[ "${key_count:-0}" -ge 1 ] \
		|| die "키 전용 모드인데 $keys 에 유효한 공개키가 없다 — 적용하면 잠긴다. 중단한다"
fi

# ---------------------------------------------------------------------------
# 0-1. 비밀번호 생성 — 요청받았고 아직 없을 때만.
#
# 사람이 고른 비밀번호는 22 번이 열린 환경에서 사전 공격의 대상이 된다. 그래서 직접 입력받지 않고
# 충분한 엔트로피를 기계가 만든다(영숫자 24자 ≈ 143비트). 화면에 한 번만 보여주고 저장하지 않는다.
# ---------------------------------------------------------------------------
if [ "$PW_MODE" = 1 ] && [ "$pw_set" = no ] && [ "${SSH_SET_PASSWORD:-}" = 1 ]; then
	log "비밀번호 생성"
	command -v openssl > /dev/null 2>&1 || die "openssl 이 없다 — 비밀번호를 안전하게 생성할 수 없다"
	# base64 에서 헷갈리는 문자(+/=)를 걸러 24자를 취한다.
	NEWPW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24)"
	[ "${#NEWPW}" -eq 24 ] || die "비밀번호 생성 실패 — 길이가 ${#NEWPW}"
	printf '%s:%s\n' "$TARGET_USER" "$NEWPW" | $SUDO chpasswd
	pw_set=yes
	cat <<EOF

  ┌─ $TARGET_USER 의 비밀번호 — 지금 옮겨 적을 것. 다시 보여주지 않는다.
  │
  │    $NEWPW
  │
  └─ 스크립트는 이 값을 어디에도 저장하지 않는다.

EOF
fi

# ---------------------------------------------------------------------------
# 1. sshd 설정 — drop-in 으로 넣는다.
#
# /etc/ssh/sshd_config 를 직접 수정하지 않는 이유: 배포판 패키지 업그레이드가 그 파일을 덮거나
# 3-way merge 프롬프트를 띄운다. Ubuntu 24.04 와 Oracle Linux 9 모두 sshd_config.d/*.conf 를
# Include 하고, sshd 는 **먼저 나온 값이 이긴다** — Include 가 파일 앞에 있으므로 drop-in 이 우선한다.
# 파일명의 99- 는 클라우드 이미지가 넣어둔 50-cloud-init.conf 류와 이름으로 충돌하지 않게 하려는 것이다.
# ---------------------------------------------------------------------------
log "sshd 설정"

# Include 가 없는 배포판이면 drop-in 이 조용히 무시된다 — 즉시 알려야 한다.
if ! $SUDO grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config; then
	die "/etc/ssh/sshd_config 에 sshd_config.d Include 가 없다 — drop-in 이 무시된다. 직접 수정할 것"
fi

# 클라우드 이미지는 50-cloud-init.conf 에 PasswordAuthentication no 를 넣어둔다. sshd 는 먼저 읽은
# 값이 이기므로, 그 파일이 우리 drop-in 보다 앞서면 비밀번호 모드가 조용히 무효가 된다. 정렬은
# 파일명 순이라 99- 가 뒤에 읽힌다 — 그래서 비밀번호 모드에서는 그 줄을 무력화해야 한다.
cloudinit=/etc/ssh/sshd_config.d/50-cloud-init.conf
if [ "$PW_MODE" = 1 ] && [ -f "$cloudinit" ] \
	&& $SUDO grep -qiE '^\s*PasswordAuthentication\s+no' "$cloudinit"; then
	$SUDO cp -n "$cloudinit" "$cloudinit.bak-harden"
	$SUDO sed -i.tmp 's/^\([[:space:]]*PasswordAuthentication[[:space:]]\+no\)/#\1  # harden-ssh.sh/I' "$cloudinit"
	$SUDO rm -f "$cloudinit.tmp"
	echo "note: $cloudinit 의 PasswordAuthentication no 를 주석 처리했다(원본은 .bak-harden)"
fi

dropin=/etc/ssh/sshd_config.d/99-hardening.conf
$SUDO mkdir -p /etc/ssh/sshd_config.d

{
	echo "# harden-ssh.sh 가 생성 — 직접 고치지 말고 스크립트를 고칠 것."
	echo "PubkeyAuthentication yes"
	echo "PermitEmptyPasswords no"
	echo
	if [ "$PW_MODE" = 1 ]; then
		echo "# 비밀번호 인증 허용(SSH_PASSWORD_AUTH=1). PAM 경로를 같이 열어야 실제로 동작한다 —"
		echo "# PasswordAuthentication yes 만 켜고 KbdInteractive 를 끄면 배포판에 따라 거부된다."
		echo "PasswordAuthentication yes"
		echo "KbdInteractiveAuthentication yes"
		echo "UsePAM yes"
	else
		echo "# 공개키만. KbdInteractive 를 같이 끄지 않으면 PAM 경로로 비밀번호가 되살아난다 —"
		echo "# PasswordAuthentication no 만 걸고 안심하는 것이 가장 흔한 실수다."
		echo "PasswordAuthentication no"
		echo "KbdInteractiveAuthentication no"
		echo "UsePAM yes"
	fi
	echo
	echo "# root 직접 로그인 금지 — 어느 모드에서도 열지 않는다."
	echo "PermitRootLogin no"
	echo
	echo "# 접속 가능한 계정을 명시한다. 서비스 계정이 늘어도 자동으로 열리지 않는다."
	echo "AllowUsers $ALLOW_USERS"
	echo
	echo "# 연결당 시도 횟수·시간. fail2ban 이 IP 를 차단하기까지의 창을 줄인다."
	if [ "$PW_MODE" = 1 ]; then
		# 비밀번호가 열려 있으면 한 연결에서 여러 번 찔러보는 것이 곧 공격이다 — 더 좁힌다.
		echo "MaxAuthTries 2"
		echo "LoginGraceTime 15"
	else
		echo "MaxAuthTries 3"
		echo "LoginGraceTime 20"
	fi
	echo "MaxSessions 5"
	echo
	echo "# 쓰지 않는 기능은 끈다 — 공격 표면이지 편의가 아니다."
	echo "X11Forwarding no"
	echo "AllowAgentForwarding no"
	echo "AllowTcpForwarding yes"
	echo "PermitTunnel no"
	echo
	echo "# 유휴 세션 정리(2분 x 3 = 6분)."
	echo "ClientAliveInterval 120"
	echo "ClientAliveCountMax 3"
} | $SUDO tee "$dropin" > /dev/null
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
# security.md 의 로그인 스로틀과 같은 모양 — 계정을 잠그지 않고 IP 를 잠근다. 키 전용 모드에서는
# 보험이지만(추측이 애초에 성공할 수 없다), 비밀번호 모드에서는 유일한 브루트포스 방어선이다.
# 그래서 모드에 따라 임계값을 다르게 준다.
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
			die "apt-get·dnf 를 찾지 못했다 — fail2ban 을 수동 설치할 것"
		fi
	fi

	if [ "$PW_MODE" = 1 ]; then
		# 비밀번호가 열려 있으면 시도 1건의 기대값이 0 이 아니다 — 짧게 세고 길게 막는다.
		f2b_maxretry=3
		f2b_findtime=10m
		f2b_bantime=24h
	else
		f2b_maxretry=5
		f2b_findtime=10m
		f2b_bantime=1h
	fi

	# jail.local 에 쓴다(jail.conf 는 패키지 소유라 업그레이드 때 덮인다).
	# backend=systemd: Ubuntu 24.04 는 /var/log/auth.log 를 만들지 않는다 — journal 을 읽어야 한다.
	$SUDO tee /etc/fail2ban/jail.local > /dev/null <<EOF
# harden-ssh.sh 가 생성 — 직접 고치지 말고 스크립트를 고칠 것.
[DEFAULT]
backend = systemd
bantime = $f2b_bantime
findtime = $f2b_findtime
maxretry = $f2b_maxretry
# 스스로를 차단하지 않도록 사설 대역을 제외한다(OCI VCN 내부 통신 포함).
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
	echo "ok: fail2ban — bantime $f2b_bantime / maxretry $f2b_maxretry"
fi

# ---------------------------------------------------------------------------
# 3. 무인 보안 업데이트 — sshd·커널 CVE 를 사람 손에 의존하지 않게 한다.
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

    ssh $TARGET_USER@<IP>            # 비밀번호 모드
    ssh -i ~/.ssh/oci_rp_work $TARGET_USER@<IP>

  막히면 이 창에서 되돌릴 수 있다:

    sudo rm /etc/ssh/sshd_config.d/99-hardening.conf && sudo systemctl reload $svc

  남은 것 — 이 스크립트가 할 수 없는 것:
  * OCI 콘솔 VCN Security List 의 22 번 소스. 지금은 0.0.0.0/0 이라 전 세계가 노크할 수 있다.
    비밀번호 모드에서는 이걸 좁히는 것이 fail2ban 보다 효과가 크다 — 포트가 안 보이면 시도 자체가 없다.
  * fail2ban 상태:  sudo fail2ban-client status sshd
EOF

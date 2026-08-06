#!/usr/bin/env bash
# 다가오는 데드라인 알림 (#15) — 정해진 날짜가 가까워지면 메일로 알린다.
#
# ## 왜 필요한가
# 이 프로젝트의 인프라 대비(오프사이트 백업 #129, `.env` 암호화 #170, 호스트 이전 스크립트 #167)는 전부
# **인스턴스가 사라지는 시나리오**를 위해 만들었다. 그런데 그 시나리오가 시작되는 날짜는 이미 정해져 있고
# (체험 크레딧 만료 → 유예 → 삭제), **그날이 다가온다는 것을 알려 주는 장치가 없었다.** 준비는 다 해 두고
# 실행 시점을 놓치는 것이 가장 아까운 실패다.
#
# ## `#174`(dead man's switch)와 무엇이 다른가
# 성질이 반대다. #174 는 "서버가 **이미** 죽었다" 를 잡고, 그건 신호가 오지 않는 것을 감지해야 하므로
# **외부**에 있어야 한다. 이 스크립트는 "죽을 **날짜**가 다가온다" 를 알리고, 그건 달력만 있으면 되므로
# 죽기 전에 서버 안에서 보내면 충분하다. 그래서 외부 의존이 없고 새 컴포넌트도 없다 — `notify-mail.py`
# (OCI Email Delivery, 하루 100통 영구 무료)를 그대로 쓴다.
#
# ## 알림 시점: D-14 / D-7 / D-3 / D-1 / D-0
# 매일 보내면 사람이 그 메일을 읽지 않게 되고(#172 에서 같은 이유로 손 실행 실패 메일을 껐다), 한 번만
# 보내면 그 한 통을 놓쳤을 때 끝이다. 점점 조이는 다섯 번이 그 사이의 타협이다. 지난 날짜는 조용하다 —
# 이미 지난 것을 매일 알리는 것은 알림이 아니라 소음이다.
#
# ## 사용
#   ./scripts/deadline-notify.sh                   # 오늘 기준으로 판단해 필요하면 발송
#   ./scripts/deadline-notify.sh --dry-run         # 무엇을 보낼지만 출력
#   ./scripts/deadline-notify.sh --list            # 설정된 데드라인과 남은 일수
#   ./scripts/deadline-notify.sh --install         # systemd 타이머 설치(매일 09:00 UTC)
#   ./scripts/deadline-notify.sh --uninstall
#
# ## 설정 (`~/.rp-deadline.env`, `RP_DEADLINE_ENV` 로 변경)
#   DEADLINE_TRIAL_END=2026-08-26       # 체험 종료 → 30일 유예 시작
#   DEADLINE_GRACE_END=2026-09-25       # 유예 종료 → 인스턴스·데이터 영구 삭제
#
# 이름은 `DEADLINE_` 로 시작하는 아무 것이나 되고 값은 `YYYY-MM-DD` 다. **날짜를 코드에 박지 않는다** —
# 위 두 날짜는 지금 이 인스턴스의 사정이고, A1 을 확보해 이전하면(#15) 무의미해진다. 그때는 설정에서 줄을
# 지우면 끝이고, 다른 데드라인이 생기면 한 줄 더한다.
#
# ## 테스트 가능성
# `RP_DEADLINE_TODAY=YYYY-MM-DD` 로 "오늘" 을 주입할 수 있다. 이것이 없으면 알림 시점 로직은 **실제로 그
# 날짜가 되어야만** 검증되고, 그러면 영원히 검증되지 않은 채로 그날을 맞는다 — 알림 코드가 정확히 그렇게
# 조용히 썩는다. CI 가 이 변수로 다섯 시점을 매번 실행한다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

CONF="${RP_DEADLINE_ENV:-$HOME/.rp-deadline.env}"
SERVICE=/etc/systemd/system/rp-deadline-notify.service
TIMER=/etc/systemd/system/rp-deadline-notify.timer

# 알릴 시점(남은 일수). 정확히 이 값일 때만 보낸다 — "이하" 로 하면 D-14 부터 매일 온다.
NOTIFY_AT=(14 7 3 1 0)

DRY_RUN=false
ACTION=run

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=true ;;
		--list) ACTION=list ;;
		--install) ACTION=install ;;
		--uninstall) ACTION=uninstall ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$arg" >&2; exit 2 ;;
	esac
done

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"; }

# ---------------------------------------------------------------------------
# 설치 / 제거
# ---------------------------------------------------------------------------
if [ "$ACTION" = uninstall ]; then
	sudo systemctl disable --now rp-deadline-notify.timer 2> /dev/null || true
	sudo rm -f "$SERVICE" "$TIMER"
	sudo systemctl daemon-reload
	echo "제거 완료. $CONF 은 그대로 남아 있다."
	exit 0
fi

if [ "$ACTION" = install ]; then
	[ "$(id -un)" != root ] || { printf 'error: root 로 실행하지 않는다\n' >&2; exit 1; }
	sudo -n true 2> /dev/null || { printf 'error: 비밀번호 없는 sudo 가 필요하다\n' >&2; exit 1; }

	sudo tee "$SERVICE" > /dev/null <<UNIT
[Unit]
Description=다가오는 데드라인을 메일로 알린다 (#15)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/scripts/deadline-notify.sh
TimeoutStartSec=5min
UNIT

	# 09:00 UTC — 오프사이트 백업(08:00)이 끝난 뒤다. 두 메일이 같은 시각에 몰리면 어느 것이 무엇인지
	# 구분하기 전에 둘 다 넘기게 된다.
	sudo tee "$TIMER" > /dev/null <<'UNIT'
[Unit]
Description=데드라인 알림 타이머 (매일 09:00 UTC)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md

[Timer]
OnCalendar=*-*-* 09:00:00 UTC
# 서버가 꺼져 있어 놓친 주기를 부팅 후 한 번 실행한다. D-1 을 놓치면 그 알림은 영영 오지 않는다.
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
UNIT

	sudo systemctl daemon-reload
	sudo systemctl enable --now rp-deadline-notify.timer
	systemctl list-timers rp-deadline-notify.timer --no-pager || true
	echo
	echo "설치 완료. 설정: $CONF (DEADLINE_<이름>=YYYY-MM-DD)"
	echo "확인: ./scripts/deadline-notify.sh --list"
	exit 0
fi

# ---------------------------------------------------------------------------
# 설정 읽기
# ---------------------------------------------------------------------------
command -v python3 > /dev/null 2>&1 || { log "error: python3 가 없다"; exit 1; }

# source 하지 않는다(값에 셸 메타문자가 들어올 수 있다) — notify-mail.py·backup-offsite.sh 와 같은 이유.
DEADLINE_NAMES=()
DEADLINE_DATES=()
if [ -f "$CONF" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in ''|'#'*) continue ;; esac
		key="${line%%=*}"
		val="${line#*=}"
		case "$key" in
			DEADLINE_*)
				DEADLINE_NAMES+=("${key#DEADLINE_}")
				DEADLINE_DATES+=("$val")
				;;
		esac
	done < "$CONF"
fi

if [ "${#DEADLINE_NAMES[@]}" -eq 0 ]; then
	# 조용히 끝내지 않는다 — 설정이 없어서 아무것도 안 한 것과 데드라인이 멀어서 안 한 것은 다르다.
	log "설정된 데드라인이 없다 ($CONF) — 아무것도 하지 않는다"
	exit 0
fi

TODAY="${RP_DEADLINE_TODAY:-}"

# 남은 일수를 계산한다. `date -d` 를 쓰지 않는 이유: GNU 전용이라 노트북(BSD date)에서 손으로 돌릴 때
# 조용히 다른 값을 내거나 죽는다. python3 는 notify-mail.py 가 이미 요구하므로 새 의존성이 아니다.
days_until() {
	python3 - "$1" "$TODAY" <<'PY'
import datetime, sys
target = datetime.date.fromisoformat(sys.argv[1].strip())
today = datetime.date.fromisoformat(sys.argv[2].strip()) if len(sys.argv) > 2 and sys.argv[2].strip() else datetime.date.today()
print((target - today).days)
PY
}

# ---------------------------------------------------------------------------
# 목록
# ---------------------------------------------------------------------------
if [ "$ACTION" = list ]; then
	printf '기준일: %s\n\n' "${TODAY:-$(date -u +%Y-%m-%d) (오늘)}"
	# 헤더를 ASCII 로 둔다 — printf 의 폭 지정은 바이트 기준이라 한글 헤더를 쓰면 값과 열이 어긋난다.
	printf '%-16s %-12s %s\n' "NAME" "DATE" "DAYS-LEFT"
	for i in "${!DEADLINE_NAMES[@]}"; do
		if ! left="$(days_until "${DEADLINE_DATES[$i]}" 2> /dev/null)"; then
			printf '%-16s %-12s %s\n' "${DEADLINE_NAMES[$i]}" "${DEADLINE_DATES[$i]}" "날짜 형식 오류"
			continue
		fi
		printf '%-16s %-12s %s\n' "${DEADLINE_NAMES[$i]}" "${DEADLINE_DATES[$i]}" "$left"
	done
	exit 0
fi

# ---------------------------------------------------------------------------
# 발송
# ---------------------------------------------------------------------------
notify() {
	local subject="$1" body="$2" rc=0
	if [ "$DRY_RUN" = true ]; then
		log "[dry-run] 보냈을 것: $subject"
		return 0
	fi
	printf '%s\n' "$body" | python3 "$REPO_DIR/scripts/notify-mail.py" "$subject" > /dev/null 2>&1 || rc=$?
	case "$rc" in
		0) log "발송: $subject" ;;
		2) log "warn: 메일 설정이 없어 알리지 못했다 (~/.rp-mail.env) — $subject" ;;
		*) log "warn: 발송 실패 (rc=$rc) — $subject" ;;
	esac
}

sent=0
for i in "${!DEADLINE_NAMES[@]}"; do
	name="${DEADLINE_NAMES[$i]}"
	date_str="${DEADLINE_DATES[$i]}"

	# 날짜 오타는 조용히 넘기지 않는다. 이 스크립트의 실패 모드는 "안 알리는 것" 이고, 형식 오류를 무시하면
	# 그 데드라인이 영원히 알림 없이 지나간다.
	if ! left="$(days_until "$date_str" 2> /dev/null)"; then
		log "warn: DEADLINE_$name 의 날짜를 읽을 수 없다 (받은 값: '$date_str') — YYYY-MM-DD 여야 한다"
		continue
	fi

	match=false
	for at in "${NOTIFY_AT[@]}"; do
		[ "$left" = "$at" ] && match=true && break
	done
	if [ "$match" = false ]; then
		continue
	fi

	if [ "$left" = 0 ]; then
		when="오늘"
	else
		when="${left}일 뒤"
	fi

	# 본문의 진단 명령은 **실측한 유닛 이름**을 쓴다. A1 사냥꾼은 `rp-` 접두어가 없고 타이머가 아니라
	# 서비스다(`a1-hunter.service` — 무한 루프로 돌며 확보 시 종료한다). 처음 `list-timers
	# rp-a1-hunter.timer` 로 적었다가 서버에서 확인해 고쳤다 — 메일을 받은 사람이 가장 급한 순간에
	# 존재하지 않는 유닛을 조회하게 만드는 것이 최악이다(#172 에서 같은 종류의 실수를 겪었다).
	notify "[reputation-pool] 데드라인 D-${left}: $name ($date_str)" \
		"$(printf '데드라인이 %s입니다.\n\n  이름: %s\n  날짜: %s\n  남은 일수: %s\n  호스트: %s\n\n지금 확인할 것:\n  ./scripts/deadline-notify.sh --list\n  journalctl -u a1-hunter.service -n 5 --no-pager     # A1 확보 진행 상황\n  journalctl -u rp-backup-offsite.service -n 20 --no-pager\n\nA1 을 확보했다면 ./scripts/migrate-host.sh --to <신규IP> 로 옮기고, 이 데드라인은\n~/.rp-deadline.env 에서 지웁니다. 배경은 deployment.md 와 이슈 #15 에 있습니다.\n' \
			"$when" "$name" "$date_str" "$left" "$(hostname)")"
	sent=$((sent + 1))
done

log "알림 대상 $sent 건 (설정된 데드라인 ${#DEADLINE_NAMES[@]} 개)"

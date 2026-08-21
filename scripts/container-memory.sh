#!/usr/bin/env bash
# 컨테이너 메모리 수집 (#131 의 textfile 경로 재사용) — cgroup 이 실제로 보는 값을 노출한다.
#
# ## 왜 필요한가
# 대시보드의 'JVM 심층' 섹션은 **JVM 이 자기 입으로 보고하는 값**만 더한다. 그런데 컨테이너를 죽이는
# 주체는 JVM 이 아니라 cgroup 이고, cgroup 은 힙이 아니라 자기가 센 메모리를 본다. 그 둘은 크게 다르다 —
# 이 호스트에서 JVM 보고 합계는 약 160MB 인데 실제 RSS 는 약 348MB 다. **2배가 계측 밖에 있고,
# OOM-kill 은 바로 그 영역에서 일어난다.**
#
# 그래서 필요한 것은 "JVM 이 얼마를 쓴다고 말하는가" 가 아니라 "cgroup 이 얼마를 셌는가" 이고,
# 그 둘의 차이가 곧 native·GC 구조체·스레드 스택처럼 아무도 보고하지 않는 소비자의 크기다.
#
# ## 왜 node-exporter 의 기본 collector 를 켜지 않는가
# 켜려면 `/proc`·`/sys` 마운트와 host PID·network 공유가 필요하고, 그것은 compose.yaml 의
# node-exporter 주석이 명시적으로 거절한 보안 표면 확대다. 게다가 그 collector 들은 **호스트 단위**
# 지표라 컨테이너별로 쪼개주지 않는다 — 어느 컨테이너가 한도에 붙었는지가 알고 싶은 것이므로 애초에
# 답이 아니다.
#
# cAdvisor 도 쓰지 않는다. 컨테이너 하나가 늘고, docker 소켓이나 `/sys/fs/cgroup` 마운트를 요구하며,
# 무엇보다 시계열을 2천 개 단위로 늘린다 — 현재 전체가 3,070 개다. 여기서 필요한 것은 5종 × 9컨테이너 =
# 45개뿐이다.
#
# 이 스크립트는 **호스트에서 cgroup 파일을 직접 읽는다.** 새 마운트도, 새 컨테이너도, 특권도 필요 없다
# (cgroup v2 의 `memory.*` 는 0444 라 ubuntu 로 읽힌다). 쓰기만 `docker run -v … alpine` 으로 하는데,
# 그 볼륨이 named volume 이고 backup-offsite.sh 가 이미 같은 방식으로 쓰기 때문이다.
#
# ## 왜 60초 주기로 충분한가
# `memory.peak` 은 **고수위 표시이고 리셋되지 않는다.** 스파이크가 표본 사이에 일어나도 다음 표본의
# peak 에 남는다. 즉 표본 간격을 늘려도 **최대치 정보는 잃지 않는다** — 잃는 것은 곡선의 해상도뿐이고,
# 빠른 상승은 15초로 긁히는 JVM 쪽 지표가 이미 보여준다. 그래서 `docker run` 왕복을 분당 한 번으로
# 묶었다(2 OCPU 에서 15초마다 컨테이너를 만들고 버리는 것은 공짜가 아니다).
#
# ## 사용
#   ./scripts/container-memory.sh              # 한 번 수집해 .prom 을 쓴다
#   ./scripts/container-memory.sh --stdout     # 파일을 쓰지 않고 화면에 출력(검증용)
#   ./scripts/container-memory.sh --install    # systemd 타이머 설치(60초 주기)
#   ./scripts/container-memory.sh --uninstall
#
# ## 설정
#   CM_METRICS_VOLUME=    # textfile 볼륨. 비우면 자동 탐색(backup-offsite.sh 와 같은 규칙)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ACTION=collect
case "${1:-}" in
	--install) ACTION=install ;;
	--uninstall) ACTION=uninstall ;;
	--stdout) ACTION=stdout ;;
	"") ;;
	*) die "알 수 없는 인자: $1 (--install|--uninstall|--stdout)" ;;
esac

SERVICE=/etc/systemd/system/rp-container-memory.service
TIMER=/etc/systemd/system/rp-container-memory.timer

if [ "$ACTION" = uninstall ]; then
	sudo systemctl disable --now rp-container-memory.timer 2> /dev/null || true
	sudo rm -f "$SERVICE" "$TIMER"
	sudo systemctl daemon-reload
	# .prom 을 남겨두면 게이지가 영원히 낡은 값을 보고한다 — 수집을 끈 것과 수집이 고장난 것을
	# 구분할 수 없게 되므로 지운다. 그러면 absent() 가 부재를 잡는다.
	VOL=$(docker volume ls -q --filter name=reputation-pool-metrics | head -1 || true)
	[ -n "$VOL" ] && docker run --rm -v "$VOL":/m alpine:3 rm -f /m/rp-container-memory.prom || true
	echo "제거 완료."
	exit 0
fi

if [ "$ACTION" = install ]; then
	[ "$(id -un)" != root ] || die "root 로 실행하지 않는다"
	sudo -n true 2> /dev/null || die "비밀번호 없는 sudo 가 필요하다"

	sudo tee "$SERVICE" > /dev/null <<UNIT
[Unit]
Description=컨테이너 cgroup 메모리를 textfile 로 노출한다 (#131 경로 재사용)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/scripts/container-memory.sh
# 표본 하나를 놓치는 것은 사고가 아니다 — 다음 주기가 60초 뒤에 온다. 여기서 오래 붙잡고 있으면
# 오히려 타이머가 겹친다.
TimeoutStartSec=45s
UNIT

	sudo tee "$TIMER" > /dev/null <<'UNIT'
[Unit]
Description=컨테이너 메모리 수집 타이머 (60초 주기)
Documentation=https://github.com/PreAgile/reputation-pool-cloud/blob/main/docs/engineering/deployment.md

[Timer]
OnBootSec=90s
OnUnitActiveSec=60s
# 기본 AccuracySec 은 1분이라 주기가 들쭉날쭉해진다 — 표본 간격이 일정해야 곡선을 읽을 수 있다.
AccuracySec=1s
# Persistent 를 쓰지 않는다. 이것은 표본이지 백업이 아니므로, 꺼져 있던 동안의 표본을 부팅 후에
# 몰아서 찍는 것은 의미가 없다(오히려 잘못된 시각의 값이 들어간다).

[Install]
WantedBy=timers.target
UNIT

	sudo systemctl daemon-reload
	sudo systemctl enable --now rp-container-memory.timer
	systemctl list-timers rp-container-memory.timer --no-pager || true
	echo
	echo "설치 완료. 즉시 한 번: sudo systemctl start rp-container-memory.service"
	exit 0
fi

# ---------------------------------------------------------------------------
# 수집
# ---------------------------------------------------------------------------
command -v docker > /dev/null || die "docker 가 없다"
[ "$(stat -fc %T /sys/fs/cgroup 2> /dev/null)" = cgroup2fs ] \
	|| die "cgroup v2 가 아니다 — 이 스크립트는 memory.current/peak/events 를 읽는다"

emit() {
	printf '# HELP rp_container_memory_current_bytes cgroup memory.current — cgroup 이 실제로 센 값(anon + page cache + kernel).\n'
	printf '# TYPE rp_container_memory_current_bytes gauge\n'
	printf '# HELP rp_container_memory_anon_bytes cgroup memory.stat anon — 회수 불가능한 익명 메모리. OOM 위험의 실체.\n'
	printf '# TYPE rp_container_memory_anon_bytes gauge\n'
	printf '# HELP rp_container_memory_peak_bytes cgroup memory.peak — 고수위. 리셋되지 않으므로 표본 사이의 스파이크도 남는다.\n'
	printf '# TYPE rp_container_memory_peak_bytes gauge\n'
	printf '# HELP rp_container_memory_max_bytes cgroup memory.max — 한도. 무제한이면 계열을 내보내지 않는다.\n'
	printf '# TYPE rp_container_memory_max_bytes gauge\n'
	printf '# HELP rp_container_oom_kill_total cgroup memory.events oom_kill — 이 cgroup 에서 일어난 OOM-kill 누적 횟수.\n'
	printf '# TYPE rp_container_oom_kill_total counter\n'
	printf '# HELP rp_container_memory_limit_hits_total cgroup memory.events max — 한도에 부딪혀 직접 회수가 돈 누적 횟수.\n'
	printf '# TYPE rp_container_memory_limit_hits_total counter\n'

	local id name pid cg base
	# 컨테이너 이름이 아니라 compose 서비스 라벨을 쓴다 — 프로젝트 이름이 바뀌어도 라벨은 그대로다.
	while read -r id; do
		[ -n "$id" ] || continue
		name=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2> /dev/null || true)
		[ -n "$name" ] || name=$(docker inspect -f '{{.Name}}' "$id" 2> /dev/null | sed 's#^/##')
		[ -n "$name" ] || continue

		# cgroup 경로를 이름으로 조립하지 않고 프로세스에게 물어본다. `system.slice/docker-<id>.scope`
		# 형태는 systemd 드라이버일 때만이고 cgroupfs 드라이버면 `/docker/<id>` 다 — 드라이버를 가정하면
		# 호스트를 옮겼을 때 조용히 빈 값이 된다(#15 의 호스트 이전이 실제로 있었다).
		pid=$(docker inspect -f '{{.State.Pid}}' "$id" 2> /dev/null || echo 0)
		[ "$pid" -gt 0 ] 2> /dev/null || continue
		cg=$(sed -n 's#^0::##p' "/proc/$pid/cgroup" 2> /dev/null || true)
		[ -n "$cg" ] || continue
		base="/sys/fs/cgroup${cg}"
		[ -d "$base" ] || continue

		[ -r "$base/memory.current" ] \
			&& printf 'rp_container_memory_current_bytes{container="%s"} %s\n' "$name" "$(cat "$base/memory.current")"
		# memory.peak 은 커널 5.19+ 다. 없으면 계열을 빼고, 대시보드가 그것을 드러낸다.
		[ -r "$base/memory.peak" ] \
			&& printf 'rp_container_memory_peak_bytes{container="%s"} %s\n' "$name" "$(cat "$base/memory.peak")"
		# "max" 는 무제한이라는 뜻이므로 숫자가 아니다 — 계열을 내보내지 않는다. +Inf 로 쓰면 비율
		# 패널이 전부 0 으로 눌려 "한도에 여유가 많다" 로 잘못 읽힌다.
		if [ -r "$base/memory.max" ]; then
			local mx; mx=$(cat "$base/memory.max")
			[ "$mx" != max ] && printf 'rp_container_memory_max_bytes{container="%s"} %s\n' "$name" "$mx"
		fi
		[ -r "$base/memory.stat" ] \
			&& printf 'rp_container_memory_anon_bytes{container="%s"} %s\n' "$name" \
				"$(awk '$1=="anon"{print $2; exit}' "$base/memory.stat")"
		if [ -r "$base/memory.events" ]; then
			printf 'rp_container_oom_kill_total{container="%s"} %s\n' "$name" \
				"$(awk '$1=="oom_kill"{print $2; exit}' "$base/memory.events")"
			# `max` 는 한도에 부딪혀 **직접 회수**가 돈 횟수다. OOM-kill 과 전혀 다른 사건이고, 이 둘을
			# 섞으면 진단이 뒤집힌다: db 는 이 값이 25,841 인데 oom_kill 은 0 이다(회수 가능한 page cache
			# 라서 죽지 않는다). 반대로 anon 이 한도를 채우는 컨테이너는 이 값이 오른 직후 oom_kill 이
			# 따라온다. 즉 이 계열은 OOM 의 **선행 지표**다.
			printf 'rp_container_memory_limit_hits_total{container="%s"} %s\n' "$name" \
				"$(awk '$1=="max"{print $2; exit}' "$base/memory.events")"
		fi
	done < <(docker ps -q)

	# 수집기 자신의 신선도. #131 이 백업에서 배운 것과 같다 — 게이지가 낡은 것과 게이지가 아예 없는
	# 것은 다른 사고이고, 이 값이 없으면 전자를 알 수 없다.
	printf '# HELP rp_container_memory_last_success_timestamp_seconds 이 수집기가 마지막으로 성공한 시각.\n'
	printf '# TYPE rp_container_memory_last_success_timestamp_seconds gauge\n'
	printf 'rp_container_memory_last_success_timestamp_seconds %s\n' "$(date +%s)"
}

if [ "$ACTION" = stdout ]; then
	emit
	exit 0
fi

VOL="${CM_METRICS_VOLUME:-}"
if [ -z "$VOL" ]; then
	VOL=$(docker volume ls -q --filter name=reputation-pool-metrics | head -1 || true)
fi
[ -n "$VOL" ] || die "textfile 볼륨을 찾지 못했다 — CM_METRICS_VOLUME 으로 지정한다"

# 원자적 쓰기: node-exporter 는 `*.prom` 만 읽으므로 `.tmp` 에 쓴 뒤 rename 한다. 쓰는 중간을
# 스크레이프하면 잘린 파일을 파싱하게 된다(textfile collector 의 알려진 함정 — backup.sh 와 같은 이유).
emit | docker run --rm -i -v "$VOL":/m alpine:3 \
	sh -c 'cat > /m/rp-container-memory.prom.tmp && mv /m/rp-container-memory.prom.tmp /m/rp-container-memory.prom'

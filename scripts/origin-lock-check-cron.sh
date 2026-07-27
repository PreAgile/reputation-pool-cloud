#!/usr/bin/env bash
# `oci-origin-lock.sh --check` 를 주기 실행하기 위한 래퍼 — 드리프트가 생겼을 때만 알린다.
#
# 왜 필요한가: 오리진을 잠근 뒤 Cloudflare 가 IP 대역을 추가하면, 그 대역을 쓰는 엣지에서 오는
# 요청이 인그레스에 막혀 **일부 지역 유저만 502** 가 된다. 전체 장애가 아니라 부분 장애이므로
# 모니터링에도 잘 안 잡히고, 원인이 몇 달 전 우리가 넣은 방화벽 규칙이라는 걸 떠올리기 어렵다.
# 대역 변경은 드물지만(연 단위) 바로 그래서 사람이 기억하지 못한다.
#
# **왜 자동 적용이 아니라 알림인가**: 자동 적용은 "외부 URL 의 응답으로 방화벽을 다시 쓴다"는
# 뜻이다. 그 엔드포인트가 오염되거나 부분 응답을 주면 자동화가 스스로 구멍을 만들거나 정상 대역을
# 빼버릴 수 있다. `oci-origin-lock.sh` 에 CIDR 형식·개수 하한 검증이 있지만, 그래도 네트워크 경계를
# 바꾸는 결정은 사람이 트리거하는 편이 낫다 — 감지는 자동, 적용은 한 줄.
#
# **왜 서버가 아니라 노트북에서 도는가**: 서버에서 돌리려면 인스턴스에 Security List 를 수정할 IAM
# 권한(인스턴스 프린시펄)을 줘야 한다. 공개된 호스트가 자기 방화벽을 고칠 수 있게 만드는 것은
# 침해 시 피해를 키운다. 노트북에는 이미 API 키가 있고 새 권한이 필요 없다.
#
# 설치(macOS launchd, 주 1회):
#   cp scripts/com.poolroost.origin-lock-check.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.poolroost.origin-lock-check.plist
#
# 로그: ~/Library/Logs/poolroost-origin-lock-check.log
set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG="${LOG:-$HOME/Library/Logs/poolroost-origin-lock-check.log}"
mkdir -p "$(dirname "$LOG")" 2> /dev/null || true

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

notify() {
	# macOS 알림. 없으면(리눅스 등) stderr 로만 남긴다 — cron 이 메일로 보낸다.
	if command -v osascript > /dev/null 2>&1; then
		osascript -e "display notification \"$2\" with title \"$1\"" > /dev/null 2>&1 || true
	fi
	printf '%s\n%s\n' "$1" "$2" >&2
}

out="$(cd "$REPO" && ./scripts/oci-origin-lock.sh --check 2>&1)"
rc=$?

{
	printf '\n===== %s (exit %d) =====\n' "$(stamp)" "$rc"
	printf '%s\n' "$out"
} >> "$LOG"

case "$rc" in
	0)
		# 정상은 조용히 넘어간다 — 매주 알림이 오면 사람이 무시하기 시작한다.
		exit 0
		;;
	3)
		notify "poolroost: Cloudflare 대역 드리프트" \
			"오리진 인그레스와 Cloudflare 목록이 어긋났습니다. 일부 지역 유저가 502 일 수 있습니다. ./scripts/oci-origin-lock.sh 를 실행하세요."
		exit 3
		;;
	*)
		# 네트워크 실패·인증 만료 등. 조용히 실패하면 감지 자체가 죽은 걸 모르게 되므로 알린다.
		notify "poolroost: 드리프트 점검 실패 (exit $rc)" \
			"확인이 필요합니다: $LOG"
		exit "$rc"
		;;
esac

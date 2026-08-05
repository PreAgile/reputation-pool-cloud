#!/usr/bin/env bash
# Cloudflare DNS 전환 (#167 / deployment.md §11) — 오리진을 가리키는 A 레코드를 조회·전환·복원한다.
#
# 호스트를 옮길 때 사용자에게 보이는 유일한 순간이 이 전환이다. 대시보드에서 손으로 하면 세 가지가
# 재현되지 않는다: **무엇을 바꿨는지의 기록**, **되돌릴 근거**, 그리고 **잘못된 레코드를 고르지 않는다는 보장**.
#
# ## 대상을 이름이 아니라 IP 로 고른다 (가장 중요한 규칙)
# 이 zone 에는 오리진을 가리키는 레코드(`app`, `grpc`)와 Cloudflare Pages 를 가리키는 레코드
# (apex·`www`·`docs`·`status`)가 섞여 있고, Pages 쪽은 **오리진이 죽어도 살아 있어야 하는** 것들이다
# (deployment.md §구성: "랜딩·문서·status 는 백엔드와 분리 — Oracle 이 죽어도 살아있다").
# 이름 목록으로 고르면 목록 갱신을 잊는 순간 랜딩까지 옮겨 죽인다. 그래서 대상은 언제나
# **"content 가 구 오리진 IP 인 A 레코드"** 다 — 데이터로 고르면 실수로 옮길 수가 없고, 오리진 레코드가
# 늘어나도 저절로 반영된다.
#
# ## proxied(주황 구름)를 유지한다
# 오리진 IP 는 엣지 내부 설정이라 클라이언트가 보는 IP(엣지 주소)는 바뀌지 않는다. 그래서 content 만
# 바꾸면 **클라이언트 DNS 캐시와 무관하게 수 초 내** 전환된다(회색 구름이면 TTL 300 초 동안 두 호스트가
# 동시에 트래픽을 받는 구간을 감당해야 한다). 전환 중에 proxied 를 끄면 그 이점이 사라지는 것은 물론
# 오리진 IP 가 노출되고, 잠근 인그레스(`oci-origin-lock.sh`)에 유저가 직접 부딪혀 전면 차단된다.
# 그래서 PATCH 는 content 와 **원래의 proxied 값**을 함께 보낸다.
#
# ## 토큰은 노트북에만 둔다
# `oci-origin-lock.sh`·`oci-ssh-allow.sh` 와 같은 이유다 — 서버가 침해돼도 DNS 는 건드릴 수 없어야 한다
# (DNS 를 빼앗기면 도메인 전체가 공격자에게 향하고, 인증서까지 새로 받을 수 있다). 권한은 `poolroost.com`
# zone 한정 `Zone:DNS:Edit` 하나로 좁힌다. 토큰은 argv 가 아니라 curl 설정 파일로 넘긴다 — argv 는 같은
# 호스트의 다른 사용자에게 `ps` 로 보인다.
#
# ## 파이썬 3.9 호환으로 쓴다
# 이 스크립트는 **노트북에서** 돌고(서버는 3.12), macOS 의 python3 는 3.9 인 경우가 흔하다. f-string 안에
# 중첩 인용/백슬래시는 3.12(PEP 701) 이전에 SyntaxError 이므로 `%` 포매팅만 쓴다.
#
# 사용:
#   export CF_API_TOKEN=…                          # 또는 ~/.config/poolroost/cf.env 에 CF_API_TOKEN=…
#   ./scripts/cf-dns.sh --list                     # zone 의 A 레코드 전부(변경 없음)
#   ./scripts/cf-dns.sh --check 161.33.220.229     # 그 IP 를 가리키는 A 레코드 = 전환 대상. 0건이면 exit 3
#   ./scripts/cf-dns.sh --switch <구IP> <신IP>     # 대상 전환 + 변경 전 스냅샷 저장
#   ./scripts/cf-dns.sh --restore dns-before.json  # 스냅샷대로 되돌린다(롤백)
#
# 옵션: --dry-run(무엇을 할지만), --snapshot <경로>(--switch 의 스냅샷 위치)
# 환경변수: CF_ZONE(기본 poolroost.com), CF_MAX_TARGETS(기본 6), CF_TOKEN_FILE
set -euo pipefail

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 인자 — 토큰·네트워크보다 **먼저** 검증한다
# ---------------------------------------------------------------------------
# 이 스크립트는 실제로 이전할 때 딱 한 번 도는데, 그때 인자 처리에서 죽으면 가장 곤란하다. 인자 검증을
# 앞에 두면 CI 가 토큰도 네트워크도 없이 그 부분을 실제로 실행해 볼 수 있다(ci.yml 의 인자 검증 스텝).
MODE=""
OLD_IP=""
NEW_IP=""
SNAPSHOT=""
DRY_RUN=false

usage() {
	printf 'usage: %s (--list | --check <IP> | --switch <구IP> <신IP> | --restore <스냅샷>) [--dry-run] [--snapshot <경로>]\n' \
		"$(basename "$0")" >&2
	exit 2
}

set_mode() {
	if [ -n "$MODE" ]; then
		printf 'error: 모드를 두 개 줄 수 없다 (%s, %s)\n' "$MODE" "$1" >&2
		exit 2
	fi
	MODE="$1"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--list) set_mode list ;;
		--check)
			set_mode check
			OLD_IP="${2:-}"
			[ -n "$OLD_IP" ] || { printf 'error: --check 에 IP 가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--switch)
			set_mode switch
			OLD_IP="${2:-}"
			NEW_IP="${3:-}"
			if [ -z "$OLD_IP" ] || [ -z "$NEW_IP" ]; then
				printf 'error: --switch <구IP> <신IP> 두 개가 필요하다\n' >&2
				exit 2
			fi
			shift 2
			;;
		--restore)
			set_mode restore
			SNAPSHOT="${2:-}"
			[ -n "$SNAPSHOT" ] || { printf 'error: --restore 에 스냅샷 경로가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--snapshot)
			SNAPSHOT="${2:-}"
			[ -n "$SNAPSHOT" ] || { printf 'error: --snapshot 에 경로가 필요하다\n' >&2; exit 2; }
			shift
			;;
		--dry-run) DRY_RUN=true ;;
		-h | --help) usage ;;
		*) printf 'error: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
	esac
	shift
done

[ -n "$MODE" ] || usage

# IPv4 형식 검증. 오타로 zone 을 이상한 값으로 밀어 넣는 사고를 여기서 끊는다 — Cloudflare 는 형식만
# 맞으면 어떤 주소든 받아 주므로 API 가 잡아 주지 않는다.
valid_ipv4() {
	local ip="$1" a b c d o
	[[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
	IFS=. read -r a b c d <<< "$ip"
	for o in "$a" "$b" "$c" "$d"; do
		[ "$o" -le 255 ] || return 1
	done
	return 0
}

for ip in "$OLD_IP" "$NEW_IP"; do
	[ -n "$ip" ] || continue
	valid_ipv4 "$ip" || die "IPv4 주소로 보이지 않는다: $ip"
done

# 같은 IP 로 "전환" 하는 것은 항상 실수다(대개 인자 순서를 헷갈린 경우). 스냅샷만 남고 아무것도 바뀌지
# 않는데 로그는 성공으로 보이므로, 조용히 통과시키면 이전이 끝난 줄 알고 다음 단계로 넘어간다.
if [ "$MODE" = switch ] && [ "$OLD_IP" = "$NEW_IP" ]; then
	die "구 IP 와 신 IP 가 같다 ($OLD_IP) — 인자 순서를 확인한다"
fi

if [ "$MODE" = restore ] && [ ! -f "$SNAPSHOT" ]; then
	die "스냅샷 파일이 없다: $SNAPSHOT"
fi

command -v curl > /dev/null 2>&1 || die "curl 이 없다"
command -v python3 > /dev/null 2>&1 || die "python3 이 없다"

ZONE="${CF_ZONE:-poolroost.com}"
MAX_TARGETS="${CF_MAX_TARGETS:-6}"
case "$MAX_TARGETS" in
	'' | *[!0-9]*) die "CF_MAX_TARGETS 는 정수여야 한다 (받은 값: '$MAX_TARGETS')" ;;
esac

# ---------------------------------------------------------------------------
# 파이썬 조각 — 셸 인용 지옥을 피해 heredoc 으로 한 번만 정의한다
# ---------------------------------------------------------------------------
PY_ASSERT_SUCCESS="$(
	cat <<'PY'
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    sys.stderr.write("Cloudflare 응답이 JSON 이 아니다\n")
    sys.exit(1)
if not d.get("success"):
    errs = "; ".join(
        "%s: %s" % (e.get("code"), e.get("message")) for e in (d.get("errors") or [])
    ) or "알 수 없는 오류"
    sys.stderr.write(errs + "\n")
    sys.exit(1)
sys.stdout.write(raw)
PY
)"

PY_ZONE_ID="$(
	cat <<'PY'
import json, sys
res = json.load(sys.stdin).get("result") or []
# 정확히 하나가 아니면 멈춘다 — 0건이면 토큰이 다른 계정의 것이고, 2건 이상이면 우리가 어느 zone 을
# 만지는지 모르는 상태다. 둘 다 "일단 첫 번째" 로 진행할 상황이 아니다.
if len(res) != 1:
    sys.stderr.write("zone 조회 결과가 %d건이다\n" % len(res))
    sys.exit(1)
print(res[0]["id"])
PY
)"

PY_LIST="$(
	cat <<'PY'
import json, sys
res = sorted(json.load(sys.stdin).get("result") or [], key=lambda r: r["name"])
print("")
if not res:
    print("  (A 레코드가 없다)")
for r in res:
    cloud = "proxied" if r.get("proxied") else "dns-only"
    print("  %-28s %-16s %-9s ttl=%s" % (r["name"], r["content"], cloud, r.get("ttl")))
print("")
print("  총 %d건. 오리진 이전 대상은 --check <구 오리진 IP> 로 확인한다." % len(res))
PY
)"

PY_TARGETS="$(
	cat <<'PY'
import json, os, sys
old = os.environ["OLD_IP"]
res = json.load(sys.stdin).get("result") or []
# type 은 쿼리에서 이미 A 로 좁혔지만 다시 확인한다 — "이름이 아니라 값으로 고른다"의 나머지 절반이다.
json.dump([r for r in res if r.get("type") == "A" and r.get("content") == old], sys.stdout)
PY
)"

PY_TARGETS_SHOW="$(
	cat <<'PY'
import json, sys
rows = sorted(json.load(sys.stdin), key=lambda r: r["name"])
for r in rows:
    print("  %-28s proxied=%-5s id=%s%s" % (
        r["name"],
        str(bool(r.get("proxied"))).lower(),
        r["id"],
        "  (locked)" if r.get("locked") else "",
    ))
PY
)"

PY_TARGETS_FIELDS="$(
	cat <<'PY'
import json, sys
for r in sorted(json.load(sys.stdin), key=lambda r: r["name"]):
    print(r["id"], r["name"], str(bool(r.get("proxied"))).lower())
PY
)"

PY_COUNT_CONTENT="$(
	cat <<'PY'
import json, os, sys
want = os.environ["WANT_IP"]
res = json.load(sys.stdin).get("result") or []
print(len([r for r in res if r.get("content") == want]))
PY
)"

# ---------------------------------------------------------------------------
# 토큰 로드
# ---------------------------------------------------------------------------
TOKEN_FILE="${CF_TOKEN_FILE:-$HOME/.config/poolroost/cf.env}"
if [ -z "${CF_API_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
	# source 하지 않는다 — 설정 파일은 실행 대상이 아니다(pull-deploy.sh 의 env_value 와 같은 판단).
	CF_API_TOKEN="$(grep -E '^CF_API_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- || true)"
	CF_API_TOKEN="${CF_API_TOKEN%\"}"
	CF_API_TOKEN="${CF_API_TOKEN#\"}"
fi
[ -n "${CF_API_TOKEN:-}" ] \
	|| die "CF_API_TOKEN 이 없다 — 환경변수나 $TOKEN_FILE 에 둔다 ($ZONE 한정 Zone:DNS:Edit)"

CURL_CFG="$(mktemp)"
TMP_JSON="$(mktemp)"
trap 'rm -f "$CURL_CFG" "$TMP_JSON"' EXIT
chmod 600 "$CURL_CFG"
{
	printf 'header = "Authorization: Bearer %s"\n' "$CF_API_TOKEN"
	printf 'header = "Content-Type: application/json"\n'
	printf 'max-time = 20\nsilent\nshow-error\n'
} > "$CURL_CFG"

API="https://api.cloudflare.com/client/v4"

# 성공 판정을 HTTP 코드가 아니라 응답의 `success` 로 한다 — Cloudflare 는 권한 부족 등을
# 200 + success:false 로 주는 경우가 있어 `curl -f` 만으로는 조용히 통과한다.
#
# API_SOFT=true 면 die 하지 않고 non-zero 를 돌려준다. 전환 루프에서 **부분 전환을 되돌리기 위해** 필요하다
# — 첫 레코드는 바뀌고 두 번째가 실패했는데 그대로 죽으면 zone 이 반쯤 옮겨진 채 남는다.
API_SOFT=false
api() {
	local method="$1" path="$2" body="${3:-}" out
	if [ -n "$body" ]; then
		if ! out="$(curl --config "$CURL_CFG" -X "$method" --data "$body" "$API$path")"; then
			if [ "$API_SOFT" = true ]; then return 1; fi
			die "API 호출 실패: $method $path"
		fi
	else
		if ! out="$(curl --config "$CURL_CFG" -X "$method" "$API$path")"; then
			if [ "$API_SOFT" = true ]; then return 1; fi
			die "API 호출 실패: $method $path"
		fi
	fi
	if ! printf '%s' "$out" | python3 -c "$PY_ASSERT_SUCCESS"; then
		if [ "$API_SOFT" = true ]; then return 1; fi
		die "Cloudflare 가 실패를 반환했다: $method $path"
	fi
}

# ---------------------------------------------------------------------------
# 토큰·zone 확인
# ---------------------------------------------------------------------------
api GET /user/tokens/verify > /dev/null
ZONE_ID="$(api GET "/zones?name=$ZONE" | python3 -c "$PY_ZONE_ID")" \
	|| die "zone '$ZONE' 을 특정하지 못했다 — 토큰 권한과 CF_ZONE 을 확인한다"

log "zone $ZONE ($ZONE_ID)"

RECORDS="$(api GET "/zones/$ZONE_ID/dns_records?type=A&per_page=100")"

# ---------------------------------------------------------------------------
# --list
# ---------------------------------------------------------------------------
if [ "$MODE" = list ]; then
	log "A 레코드"
	printf '%s' "$RECORDS" | python3 -c "$PY_LIST"
	exit 0
fi

# ---------------------------------------------------------------------------
# 대상 산출 (check / switch 공용)
# ---------------------------------------------------------------------------
TARGETS="$(printf '%s' "$RECORDS" | OLD_IP="$OLD_IP" python3 -c "$PY_TARGETS")"
COUNT="$(printf '%s' "$TARGETS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"

log "대상 — content == $OLD_IP 인 A 레코드"
printf '%s' "$TARGETS" | python3 -c "$PY_TARGETS_SHOW"
printf '  총 %s건\n' "$COUNT"

if [ "$COUNT" -eq 0 ]; then
	printf '\n  그 IP 를 가리키는 A 레코드가 없다 — 구 오리진 IP 가 맞는지 확인한다 (--list).\n'
	exit 3
fi

# 상한. 부분 응답이나 IP 오타로 **zone 의 레코드를 무더기로 옮기는** 사고를 막는다. 오리진 레코드는
# 지금 두 개(app·grpc)이고, 늘어난다면 그것을 인지한 상태에서 CF_MAX_TARGETS 를 올리는 편이 낫다.
if [ "$COUNT" -gt "$MAX_TARGETS" ]; then
	die "대상이 ${COUNT}건으로 상한(${MAX_TARGETS})을 넘는다 — IP 를 확인하고, 맞다면 CF_MAX_TARGETS 를 올린다"
fi

if [ "$MODE" = check ]; then
	exit 0
fi

# ---------------------------------------------------------------------------
# --switch
# ---------------------------------------------------------------------------
if [ "$MODE" = switch ]; then
	# 신 IP 를 이미 가리키는 레코드가 있으면 알린다(재실행이거나 반쯤 전환된 상태다).
	ALREADY="$(printf '%s' "$RECORDS" | WANT_IP="$NEW_IP" python3 -c "$PY_COUNT_CONTENT")"
	if [ "$ALREADY" -ne 0 ]; then
		log "참고: 이미 $NEW_IP 를 가리키는 A 레코드가 ${ALREADY}건 있다 (부분 전환 상태일 수 있다)"
	fi

	SNAPSHOT="${SNAPSHOT:-dns-before-$(date -u '+%Y%m%dT%H%M%SZ').json}"

	if [ "$DRY_RUN" = true ]; then
		log "--dry-run: 아무것도 바꾸지 않는다. 실제로는 아래를 했을 것이다"
		while read -r rid rname rproxied; do
			[ -n "$rid" ] || continue
			printf '  PATCH %-28s %s -> %s (proxied=%s 유지, id=%s)\n' \
				"$rname" "$OLD_IP" "$NEW_IP" "$rproxied" "$rid"
		done <<< "$(printf '%s' "$TARGETS" | python3 -c "$PY_TARGETS_FIELDS")"
		printf '  스냅샷: %s\n' "$SNAPSHOT"
		exit 0
	fi

	# 스냅샷을 **바꾸기 전에** 남긴다. 이것이 롤백의 유일한 근거다 — 전환 후에 조회해서 만들면 이미 새 값이다.
	#
	# ⛔ 이미 있으면 **덮어쓰지 않는다.** 부분 전환(app 은 PATCH 성공, grpc 는 실패) 뒤 같은 스냅샷 경로로
	# 재실행하면 TARGETS 에는 아직 구 IP 인 레코드만 들어오는데, 그것으로 덮어쓰면 **먼저 옮겨진 레코드를
	# 되돌릴 근거가 사라진다** — 그 상태에서 --restore 는 app 을 복원하지 못하고 app 과 grpc 가 서로 다른
	# 호스트를 가리킨 채 남는다. Cloudflare API 의 일시적 실패 한 번으로 롤백 근거가 손상되면 안 된다.
	if [ -s "$SNAPSHOT" ]; then
		log "기존 스냅샷 보존: $SNAPSHOT (부분 전환 재개로 본다 — 덮어쓰지 않는다)"
	else
		printf '%s' "$TARGETS" \
			| python3 -c 'import json,sys; json.dump(json.load(sys.stdin), sys.stdout, indent=2, ensure_ascii=False)' \
				> "$TMP_JSON"
		cp "$TMP_JSON" "$SNAPSHOT"
		log "스냅샷 저장: $SNAPSHOT (롤백 근거 — 지우지 않는다)"
	fi

	log "전환 $OLD_IP -> $NEW_IP"
	# 도중에 실패하면 **즉시 최초 스냅샷으로 되돌린 뒤** 실패로 끝낸다. 반쯤 옮겨진 zone 을 남기지 않는다.
	# 복원은 검증된 경로를 그대로 재사용한다(자기 자신을 --restore 로 부른다).
	API_SOFT=true
	SWITCH_FAILED=""
	while read -r rid rname rproxied; do
		[ -n "$rid" ] || continue
		if api PATCH "/zones/$ZONE_ID/dns_records/$rid" \
			"$(printf '{"content":"%s","proxied":%s}' "$NEW_IP" "$rproxied")" > /dev/null; then
			printf '  %-28s -> %s (proxied=%s)\n' "$rname" "$NEW_IP" "$rproxied"
		else
			SWITCH_FAILED="$rname"
			break
		fi
	done <<< "$(printf '%s' "$TARGETS" | python3 -c "$PY_TARGETS_FIELDS")"
	API_SOFT=false

	if [ -n "$SWITCH_FAILED" ]; then
		log "PATCH 실패($SWITCH_FAILED) — 최초 스냅샷으로 되돌린다"
		"$0" --restore "$SNAPSHOT" \
			|| die "되돌리기까지 실패했다 — zone 이 부분 전환 상태다. 즉시 확인: $SNAPSHOT"
		die "전환에 실패해 원상 복구했다 ($SWITCH_FAILED)"
	fi

	# 적용 후 실물을 다시 읽어 확인한다. PATCH 가 200 이라는 말과 레코드가 실제로 그 값이라는 말은 다르다.
	LEFT="$(api GET "/zones/$ZONE_ID/dns_records?type=A&per_page=100" \
		| WANT_IP="$OLD_IP" python3 -c "$PY_COUNT_CONTENT")"
	if [ "$LEFT" -ne 0 ]; then
		die "전환 후에도 $OLD_IP 를 가리키는 레코드가 ${LEFT}건 남았다 — 수동 확인이 필요하다"
	fi

	cat <<EOF

==> 전환 완료

  proxied 를 유지했으므로 클라이언트 DNS 캐시와 무관하게 엣지에서 수 초 내 반영된다.

  검증:
    curl -fsS https://app.$ZONE/actuator/health
    ./scripts/cf-dns.sh --check $NEW_IP

  되돌리기:
    ./scripts/cf-dns.sh --restore $SNAPSHOT
EOF
	exit 0
fi

# ---------------------------------------------------------------------------
# --restore
# ---------------------------------------------------------------------------
# 스냅샷의 id 로 되돌린다. 이름이 아니라 id 로 찾는 이유: 사이에 레코드를 지우고 다시 만들었다면 id 가
# 달라지고, 그때는 되돌리는 대신 **실패해야** 한다(다른 레코드를 옛 값으로 덮어쓰는 것이 최악이다).
log "복원 근거: $SNAPSHOT"
printf '%s' "$RECORDS" > "$TMP_JSON"
PLAN="$(
	python3 - "$SNAPSHOT" "$TMP_JSON" <<'PY'
import json, sys

snap = json.load(open(sys.argv[1]))
live = {r["id"]: r for r in (json.load(open(sys.argv[2])).get("result") or [])}

if not snap:
    sys.stderr.write("스냅샷이 비어 있다\n")
    sys.exit(1)

rows = []
for r in snap:
    rid = r.get("id")
    if rid not in live:
        sys.stderr.write("스냅샷의 레코드가 현재 zone 에 없다: %s (%s)\n" % (r.get("name"), rid))
        sys.exit(1)
    rows.append((rid, r["name"], r["content"], str(bool(r.get("proxied"))).lower(), live[rid]["content"]))

for row in rows:
    print(" ".join(row))
PY
)" || die "복원 계획을 만들 수 없다 — 스냅샷과 현재 zone 이 어긋난다"

while read -r rid rname rcontent rproxied rnow; do
	[ -n "$rid" ] || continue
	if [ "$rcontent" = "$rnow" ]; then
		printf '  %-28s 이미 %s — 건너뜀\n' "$rname" "$rcontent"
		continue
	fi
	if [ "$DRY_RUN" = true ]; then
		printf '  [dry-run] %-28s %s -> %s\n' "$rname" "$rnow" "$rcontent"
		continue
	fi
	api PATCH "/zones/$ZONE_ID/dns_records/$rid" \
		"$(printf '{"content":"%s","proxied":%s}' "$rcontent" "$rproxied")" > /dev/null
	printf '  %-28s %s -> %s (proxied=%s)\n' "$rname" "$rnow" "$rcontent" "$rproxied"
done <<< "$PLAN"

if [ "$DRY_RUN" = true ]; then
	exit 0
fi

log "복원 완료 — 엣지 경유로 확인한다: curl -fsS https://app.$ZONE/actuator/health"

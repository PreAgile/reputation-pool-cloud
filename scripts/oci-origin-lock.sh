#!/usr/bin/env bash
# 오리진 잠그기 (deployment.md §6) — 80/443 인그레스를 Cloudflare 공개 IP 대역으로만 제한한다.
#
# Cloudflare proxied 로 전환해도 **오리진 IP 를 알면 엣지를 우회해 직접 접속**할 수 있다. 그러면
# 엣지의 WAF·레이트리밋·DDoS 방어를 전부 건너뛰고, `CF-Connecting-IP` 를 위조할 수 있다. 후자가
# 더 위험하다 — 앱은 로그인 스로틀(#28)을 IP 단위로 키잉하므로, 위조가 가능하면 스로틀 우회와
# 무관한 IP 락아웃이 둘 다 성립한다.
#
# 오리진 IP 는 숨겨서 해결할 수 없다. DNS 이력(SecurityTrails 등), 인증서 투명성 로그, Censys·Shodan
# 전수 스캔으로 새기 때문이다. 그래서 비밀 유지가 아니라 **네트워크 레벨 거부**가 유일한 실효 대책이다.
#
# 이 스크립트는 **노트북에서** 돌린다(OCI API 만 사용). 멱등하다 — Cloudflare 가 대역을 추가하면
# 다시 실행하면 된다. 그 갱신을 잊으면 증상이 "일부 지역 유저만 502" 로 나타나 원인 찾기가 까다롭다.
#
# 22 번과 ICMP 규칙은 건드리지 않는다. SSH 허용 IP 관리는 `oci-ssh-allow.sh` 가 담당한다.
#
# 사용:
#   ./scripts/oci-origin-lock.sh            # 80/443 을 Cloudflare 대역으로 제한
#   ./scripts/oci-origin-lock.sh --list     # 현재 80/443 소스 출력(변경 없음)
#   ./scripts/oci-origin-lock.sh --unlock   # 0.0.0.0/0 으로 되돌린다
#
# `--unlock` 이 필요한 이유: 잠근 뒤에는 Cloudflare 를 회색 구름으로 되돌리는 것이 롤백이 되지
# 않는다. 유저가 오리진에 직접 오려 하는데 인그레스가 막고 있어 전부 차단되기 때문이다.
# 회색으로 돌릴 일이 생기면 **먼저 이걸로 풀어야** 한다.
set -euo pipefail

export SUPPRESS_LABEL_WARNING=True

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v oci > /dev/null 2>&1 || die "oci CLI 가 없다 — brew install oci-cli"
command -v python3 > /dev/null 2>&1 || die "python3 가 없다"

MODE=lock
case "${1:-}" in
	--list) MODE=list ;;
	--check) MODE=check ;;
	--unlock) MODE=unlock ;;
	"") MODE=lock ;;
	*) die "알 수 없는 인자: $1" ;;
esac

# ---------------------------------------------------------------------------
# 대상 탐색 — 인스턴스 → VNIC → 서브넷 → Security List / VCN
# ---------------------------------------------------------------------------
tenancy="${TENANCY:-$(python3 - <<'PY'
import configparser, os, sys
c = configparser.ConfigParser(); c.read(os.path.expanduser("~/.oci/config"))
sys.stdout.write(c.get(os.environ.get("OCI_CLI_PROFILE", "DEFAULT"), "tenancy", fallback=""))
PY
)}"
[ -n "$tenancy" ] || die "테넌시를 알 수 없다 — TENANCY 로 지정할 것"

inst="${INSTANCE:-$(oci compute instance list --compartment-id "$tenancy" --all \
	--lifecycle-state RUNNING --query 'data[0].id' --raw-output 2> /dev/null || true)}"
[ -n "$inst" ] || die "RUNNING 인스턴스를 찾지 못했다 — INSTANCE 로 지정할 것"

subnet="$(oci compute instance list-vnics --instance-id "$inst" \
	--query 'data[0]."subnet-id"' --raw-output 2> /dev/null)"
SL="${SECURITY_LIST:-$(oci network subnet get --subnet-id "$subnet" \
	--query 'data."security-list-ids"[0]' --raw-output 2> /dev/null)}"
[ -n "$SL" ] || die "Security List 를 찾지 못했다"

# VCN 에 IPv6 가 없으면 IPv6 대역을 넣을 이유가 없다 — 그런 트래픽은 도달 자체가 불가능하고,
# 규칙만 늘어나 목록을 읽기 어려워진다.
vcn="$(oci network subnet get --subnet-id "$subnet" --query 'data."vcn-id"' --raw-output 2> /dev/null)"
v6_enabled="$(oci network vcn get --vcn-id "$vcn" \
	--query 'data."ipv6-cidr-blocks"' --raw-output 2> /dev/null || true)"

log "대상"
echo "  security-list  $SL"
echo "  VCN IPv6       $([ -n "$v6_enabled" ] && [ "$v6_enabled" != "null" ] && echo 있음 || echo '없음 — IPv4 대역만 적용')"

BEFORE="$(mktemp)"; AFTER="$(mktemp)"; SRC="$(mktemp)"
trap 'rm -f "$BEFORE" "$AFTER" "$SRC"' EXIT
oci network security-list get --security-list-id "$SL" \
	--query 'data."ingress-security-rules"' > "$BEFORE" 2> /dev/null || die "현재 규칙을 읽지 못했다"

# ---------------------------------------------------------------------------
# 허용 소스 결정
# ---------------------------------------------------------------------------
if [ "$MODE" = unlock ]; then
	printf '0.0.0.0/0\n' > "$SRC"
else
	# Cloudflare 가 공개하는 목록을 매번 새로 받는다 — 하드코딩하면 갱신을 잊는다.
	curl -fsS -m 15 https://www.cloudflare.com/ips-v4 > "$SRC" \
		|| die "Cloudflare IPv4 목록을 받지 못했다"
	if [ -n "$v6_enabled" ] && [ "$v6_enabled" != "null" ]; then
		curl -fsS -m 15 https://www.cloudflare.com/ips-v6 >> "$SRC" \
			|| die "Cloudflare IPv6 목록을 받지 못했다"
	fi
	# 받은 값이 CIDR 로 보이는지 최소 검증한다. 장애 페이지 HTML 을 그대로 규칙에 넣으면
	# 적용이 실패하거나(다행) 이상한 규칙이 들어간다.
	grep -qE '^[0-9a-fA-F:.]+/[0-9]+$' "$SRC" || die "받은 목록이 CIDR 형식이 아니다 — 중단한다"
	# 개수 하한. 부분 응답(엣지 장애 등)을 그대로 적용하면 **정상 대역이 규칙에서 빠져** 일부 지역
	# 유저만 502 가 되는데, 원인이 우리 쪽 자동화라는 걸 떠올리기 어렵다. IPv4 는 오랫동안 15개다.
	got="$(grep -cE '^[0-9.]+/[0-9]+$' "$SRC" || true)"
	[ "${got:-0}" -ge 10 ] \
		|| die "IPv4 대역이 ${got}개뿐이다(하한 10) — 부분 응답으로 보인다. 적용하지 않는다"
fi

MODE="$MODE" python3 - "$BEFORE" "$AFTER" "$SRC" <<'PY'
import json, os, re, sys

before_path, after_path, src_path = sys.argv[1:4]
mode = os.environ["MODE"]

rules = json.load(open(before_path))
if isinstance(rules, dict):
    rules = rules["data"]

def camel(o):
    if isinstance(o, dict):
        return {re.sub(r"-(\w)", lambda m: m.group(1).upper(), k): camel(v)
                for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [camel(x) for x in o]
    return o

rules = [camel(r) for r in rules]
sources = [l.strip() for l in open(src_path) if l.strip()]

WEB = {80, 443}

def ports(r):
    """이 규칙이 다루는 목적지 포트 집합(대략). 포트 지정이 없으면 전 포트."""
    opts = r.get("tcpOptions") or r.get("udpOptions") or {}
    rng = opts.get("destinationPortRange")
    if not rng:
        return None
    return set(range(int(rng["min"]), int(rng["max"]) + 1))

def is_web(r):
    if str(r.get("protocol")) not in ("6", "17"):
        return False
    p = ports(r)
    if p is None:
        return False          # 전 포트 규칙은 건드리지 않는다(의도를 모른다)
    return bool(p & WEB)

web_rules = [r for r in rules if is_web(r)]
keep = [r for r in rules if not is_web(r)]

if mode == "list":
    print("\n==> 현재 80/443 허용 소스")
    seen = []
    for r in web_rules:
        proto = {"6": "TCP", "17": "UDP"}[str(r["protocol"])]
        opts = r.get("tcpOptions") or r.get("udpOptions")
        port = opts["destinationPortRange"]["min"]
        seen.append(f"  {proto}:{port}  {r['source']}")
    for s in sorted(set(seen)) or ["  (없음)"]:
        print(s + ("   ⚠️ 전체 개방" if s.strip().endswith("0.0.0.0/0") else ""))
    print(f"\n  규칙 {len(web_rules)}개 / 그 외 보존 대상 {len(keep)}개")
    sys.exit(0)

if mode == "check":
    # 드리프트 판정 = "Cloudflare 가 지금 공개하는 대역"과 "인그레스에 실제로 들어 있는 소스"의 차집합.
    # 스냅샷 파일이 아니라 **양쪽 실물**을 비교한다 — 스냅샷은 실제 적용 상태와 어긋날 수 있다.
    have = {r["source"] for r in web_rules}
    want = set(sources)
    missing = sorted(want - have)   # CF 가 추가한 대역 → 그 지역 유저가 502
    extra = sorted(have - want)     # CF 가 뺀 대역 → 불필요하게 열려 있음
    if not missing and not extra:
        print(f"\n==> 동기화됨 — Cloudflare 대역 {len(want)}개가 모두 인그레스에 있다")
        sys.exit(0)
    print("\n==> 드리프트 발견")
    for s in missing:
        print(f"  + {s}   인그레스에 없음 → 이 대역을 쓰는 유저가 502")
    for s in extra:
        print(f"  - {s}   Cloudflare 목록에 없음 → 불필요하게 열려 있음")
    print("\n  해결:  ./scripts/oci-origin-lock.sh")
    sys.exit(3)

# 80/TCP, 443/TCP, 443/UDP(HTTP/3) 를 소스마다 만든다.
spec = [("6", "tcpOptions", 80), ("6", "tcpOptions", 443), ("17", "udpOptions", 443)]
new = []
for src in sources:
    for proto, key, port in spec:
        new.append({
            "protocol": proto,
            "source": src,
            "sourceType": "CIDR_BLOCK",
            "isStateless": False,
            key: {"destinationPortRange": {"min": port, "max": port}},
        })

json.dump(keep + new, open(after_path, "w"), indent=2)

print(f"\n==> 적용 계획")
print(f"  허용 소스 {len(sources)}개 x 3규칙(80/tcp, 443/tcp, 443/udp) = {len(new)}개")
print(f"  교체 대상(기존 80/443) {len(web_rules)}개 → {len(new)}개")
print(f"  보존(22·ICMP 등) {len(keep)}개")
for s in sources[:4]:
    print(f"    {s}")
if len(sources) > 4:
    print(f"    … 외 {len(sources) - 4}개")
PY

# 읽기 전용 모드는 여기서 끝난다. `--check` 를 빼먹으면 동기화된 경우에 그대로 적용 단계로
# 넘어가므로(드리프트일 때는 python 이 exit 3 으로 죽어서 안 넘어간다) 조용히 쓰기가 일어난다.
[ "$MODE" = list ] && exit 0
[ "$MODE" = check ] && exit 0

log "적용"
oci network security-list update --security-list-id "$SL" \
	--ingress-security-rules "file://$AFTER" --force \
	--query 'data."lifecycle-state"' --raw-output || die "적용 실패"

log "적용 후 요약"
oci network security-list get --security-list-id "$SL" \
	--query 'data."ingress-security-rules"' 2> /dev/null | python3 -c '
import json, sys, collections
d = json.load(sys.stdin)
d = d["data"] if isinstance(d, dict) else d
c = collections.Counter()
for r in d:
    p = {"6": "TCP", "17": "UDP", "1": "ICMP"}.get(str(r["protocol"]), r["protocol"])
    o = r.get("tcp-options") or r.get("udp-options") or {}
    rng = o.get("destination-port-range")
    c[f"{p}:{rng['\''min'\'']}" if rng else p] += 1
for k, v in sorted(c.items()):
    print(f"  {k:10} 규칙 {v}개")
print(f"  총 {len(d)}개")
'

cat <<'EOF'

==> 완료

  검증:
    curl -I https://app.poolroost.com/actuator/health                      # 엣지 경유 — 200 이어야 한다
    curl -I --resolve app.poolroost.com:443:<오리진IP> https://app.poolroost.com/  # 직접 — 실패해야 한다

  되돌리기:  ./scripts/oci-origin-lock.sh --unlock
  주의: 잠근 뒤에는 Cloudflare 회색 구름 전환이 롤백이 되지 않는다 — 먼저 --unlock 할 것.
EOF

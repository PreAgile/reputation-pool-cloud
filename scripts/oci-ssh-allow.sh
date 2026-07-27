#!/usr/bin/env bash
# SSH(22) 인그레스 허용 IP 관리 — 카페·집·회사를 옮겨다니면서 한 줄로 갱신한다.
#
# 22 번을 `0.0.0.0/0` 으로 열어두면 상시 스캔 대상이 된다(실측: 24시간 209건). 키 전용 인증이
# 인증 단계를 막아주지만, sshd 의 **pre-auth** 취약점(CVE-2024-6387 regreSSHion, xz 백도어 등)은
# 인증 전에 터지므로 키가 보호해주지 못한다. 소스 IP 를 좁히면 그 부류가 구조적으로 사라진다.
#
# 그런데 한국 가정용·카페 IP 는 유동이라 "좁히면 내가 잠긴다"가 실질적 장벽이다. 이 스크립트는
# 그 장벽만 없애는 것이 목적이다 — 이동할 때마다 이걸 한 번 돌리면 된다.
#
# **서버가 아니라 노트북에서 돌린다.** SSH 가 막힌 상태에서도 복구할 수 있어야 하므로 OCI API 로만
# 동작한다(`~/.oci/config` 의 API 키 인증). Security List 를 통째로 교체하는 API 라, 22 번 규칙만
# 바꾸고 그 외 규칙(80/443/ICMP 등)은 읽어서 그대로 되돌려 넣는다.
#
# 사용:
#   ./scripts/oci-ssh-allow.sh                     # 지금 내 공인 IP 를 22 번 허용 목록에 추가
#   ./scripts/oci-ssh-allow.sh --list              # 현재 허용 목록만 출력(변경 없음)
#   ./scripts/oci-ssh-allow.sh --only A/32 B/32    # 목록을 이 값들로 교체
#   ./scripts/oci-ssh-allow.sh --remove A/32       # 한 항목 제거
#   ./scripts/oci-ssh-allow.sh --add 1.2.3.4/32    # 특정 CIDR 추가(현재 IP 대신)
#
# 자동 탐색: 인스턴스 → VNIC → 서브넷 → Security List 를 따라간다. 여러 개면 INSTANCE 로 지정한다.
#   INSTANCE=ocid1.instance... SECURITY_LIST=ocid1.securitylist... 로 건너뛸 수 있다.
set -euo pipefail

export SUPPRESS_LABEL_WARNING=True

log() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v oci > /dev/null 2>&1 || die "oci CLI 가 없다 — brew install oci-cli"
command -v python3 > /dev/null 2>&1 || die "python3 가 없다 (JSON 편집에 필요)"

DISPLAY_NAME="${DISPLAY_NAME:-reputation-pool}"

# ---------------------------------------------------------------------------
# 대상 Security List 탐색
# ---------------------------------------------------------------------------
resolve_security_list() {
	[ -n "${SECURITY_LIST:-}" ] && { echo "$SECURITY_LIST"; return; }

	local tenancy inst subnet
	tenancy="${TENANCY:-$(python3 - <<'PY'
import configparser, os, sys
c = configparser.ConfigParser()
c.read(os.path.expanduser("~/.oci/config"))
p = os.environ.get("OCI_CLI_PROFILE", "DEFAULT")
sys.stdout.write(c.get(p, "tenancy", fallback=""))
PY
)}"
	[ -n "$tenancy" ] || die "테넌시를 알 수 없다 — TENANCY 로 지정할 것"

	inst="${INSTANCE:-$(oci compute instance list --compartment-id "$tenancy" --all \
		--lifecycle-state RUNNING --query 'data[0].id' --raw-output 2> /dev/null || true)}"
	[ -n "$inst" ] || die "RUNNING 인스턴스를 찾지 못했다 — INSTANCE 로 지정할 것"

	subnet="$(oci compute instance list-vnics --instance-id "$inst" \
		--query 'data[0]."subnet-id"' --raw-output 2> /dev/null || true)"
	[ -n "$subnet" ] || die "인스턴스의 서브넷을 찾지 못했다"

	oci network subnet get --subnet-id "$subnet" \
		--query 'data."security-list-ids"[0]' --raw-output 2> /dev/null
}

my_ip() {
	local ip
	for url in https://checkip.amazonaws.com https://api.ipify.org https://ifconfig.me/ip; do
		ip="$(curl -fsS -m 8 "$url" 2> /dev/null | tr -d '[:space:]')" || continue
		# IPv4 형태만 받는다(OCI 규칙에 IPv6 를 넣으려면 --add 로 명시).
		case "$ip" in
			[0-9]*.[0-9]*.[0-9]*.[0-9]*) echo "$ip"; return 0 ;;
		esac
	done
	return 1
}

MODE=add
ARGS=()
case "${1:-}" in
	--list) MODE=list ;;
	--only) MODE=only; shift; ARGS=("$@") ;;
	--remove) MODE=remove; shift; ARGS=("$@") ;;
	--add) MODE=add; shift; ARGS=("$@") ;;
	"") MODE=add ;;
	*) die "알 수 없는 인자: $1 (사용법은 파일 상단 주석 참고)" ;;
esac

SL="$(resolve_security_list)"
[ -n "$SL" ] || die "Security List 를 찾지 못했다 — SECURITY_LIST 로 지정할 것"
log "대상 Security List"
echo "  $SL"

BEFORE="$(mktemp)"; AFTER="$(mktemp)"
trap 'rm -f "$BEFORE" "$AFTER"' EXIT
oci network security-list get --security-list-id "$SL" \
	--query 'data."ingress-security-rules"' > "$BEFORE" 2> /dev/null \
	|| die "현재 규칙을 읽지 못했다"

# 현재 IP 는 --add 기본값이자, 결과에서 스스로가 빠지지 않았는지 검사하는 기준이다.
CURRENT_IP="$(my_ip || true)"
[ -n "$CURRENT_IP" ] && echo "  내 공인 IP: $CURRENT_IP"

if [ "$MODE" = add ] && [ ${#ARGS[@]} -eq 0 ]; then
	[ -n "$CURRENT_IP" ] || die "공인 IP 를 알아내지 못했다 — --add <CIDR> 로 직접 지정할 것"
	ARGS=("$CURRENT_IP/32")
fi

MODE="$MODE" CURRENT_IP="${CURRENT_IP:-}" FORCE="${FORCE:-}" \
	python3 - "$BEFORE" "$AFTER" "${ARGS[@]+"${ARGS[@]}"}" <<'PY'
import json, os, re, sys

before_path, after_path, *args = sys.argv[1:]
mode = os.environ["MODE"]
current_ip = os.environ.get("CURRENT_IP") or ""
force = os.environ.get("FORCE") == "1"

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

def is_ssh(r):
    """22 번을 포함하는 TCP 규칙인지. 포트 범위로 준 규칙도 잡아야 한다."""
    if str(r.get("protocol")) != "6":
        return False
    opts = r.get("tcpOptions") or {}
    rng = opts.get("destinationPortRange")
    if not rng:
        # 포트 지정이 없으면 전 포트 허용 = 22 포함.
        return not opts
    return int(rng.get("min", 0)) <= 22 <= int(rng.get("max", 0))

ssh_rules = [r for r in rules if is_ssh(r)]
others = [r for r in rules if not is_ssh(r)]
existing = [r.get("source") for r in ssh_rules]

if mode == "list":
    print("\n==> 현재 22번 허용 소스")
    for s in existing or ["(없음)"]:
        mark = ""
        if current_ip and s == f"{current_ip}/32":
            mark = "   ← 지금 내 IP"
        elif s == "0.0.0.0/0":
            mark = "   ⚠️ 전체 개방"
        print(f"  {s}{mark}")
    sys.exit(0)

wanted = list(existing)
if mode == "only":
    wanted = list(args)
elif mode == "add":
    for a in args:
        if a not in wanted:
            wanted.append(a)
elif mode == "remove":
    wanted = [w for w in wanted if w not in args]

# 전체 개방이 남아 있으면 좁히는 의미가 없다 — 명시적으로 알린다.
if "0.0.0.0/0" in wanted and len(wanted) > 1:
    print("  note: 0.0.0.0/0 이 남아 있어 다른 항목은 무의미하다 — --only 로 교체할 것")

if not wanted:
    print("error: 22번 허용 목록이 비게 된다 — 잠긴다. 중단한다", file=sys.stderr)
    sys.exit(1)

# 스스로를 잠그는 것이 이 스크립트의 유일한 치명적 실패다.
covered = "0.0.0.0/0" in wanted or (current_ip and f"{current_ip}/32" in wanted)
if not covered and not force:
    print(f"error: 결과 목록에 현재 IP({current_ip or '알 수 없음'})가 없다 — 적용하면 잠긴다.\n"
          f"       의도한 것이면 FORCE=1 로 다시 실행할 것", file=sys.stderr)
    sys.exit(1)

# 22번 규칙을 새로 만든다. 기존 규칙의 다른 속성(stateless 등)은 첫 규칙을 본떠 유지한다.
template = dict(ssh_rules[0]) if ssh_rules else {"protocol": "6", "isStateless": False}
new_ssh = []
for src in wanted:
    r = dict(template)
    r["protocol"] = "6"
    r["source"] = src
    r["sourceType"] = "CIDR_BLOCK"
    r.setdefault("isStateless", False)
    r["tcpOptions"] = {"destinationPortRange": {"min": 22, "max": 22}}
    r.pop("udpOptions", None)
    r.pop("icmpOptions", None)
    new_ssh.append(r)

json.dump(others + new_ssh, open(after_path, "w"), indent=2)

print("\n==> 적용할 22번 허용 소스")
for s in wanted:
    print(f"  {s}")
print(f"\n  (그 외 규칙 {len(others)}개는 그대로 유지)")
PY

[ "$MODE" = list ] && exit 0

log "적용"
oci network security-list update --security-list-id "$SL" \
	--ingress-security-rules "file://$AFTER" --force \
	--query 'data."lifecycle-state"' --raw-output || die "적용 실패"

log "적용 후 상태"
oci network security-list get --security-list-id "$SL" \
	--query 'data."ingress-security-rules"[*].{proto:protocol,src:source,tcp:"tcp-options"."destination-port-range".min,udp:"udp-options"."destination-port-range".min}' \
	--output table

cat <<EOF

==> 완료

  **지금 붙어 있는 SSH 창을 닫기 전에** 새 터미널에서 재접속을 확인할 것:

    ssh reputation-pool

  잠겼다면 OCI Bastion 으로 복구한다(rp-recovery):

    oci bastion session create-managed-ssh --bastion-id <bastion> \\
      --target-resource-id <instance> --target-os-username ubuntu \\
      --ssh-public-key-file ~/.ssh/oci_rp_work.pub --session-ttl 10800

  이동했을 때(카페 등):  ./scripts/oci-ssh-allow.sh
  현재 목록 확인:        ./scripts/oci-ssh-allow.sh --list
EOF

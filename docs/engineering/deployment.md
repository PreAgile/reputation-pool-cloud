# 배포 (#15 / D8)

Oracle Cloud Always Free A1(arm64) 단일 호스트 + Docker Compose 배포 절차. 결정 근거는
[ADR 0002](../decisions/0002-deploy-target-oracle-a1-arm64.md)와 이슈 #15에 있고, 이 문서는 **실행 절차**만 다룬다.

## 구성

| 계층 | 어디 | 비고 |
|---|---|---|
| DNS·CDN·TLS 엣지 | Cloudflare | 오리진 IP 은닉, DDoS 흡수 |
| 랜딩(`www`)·문서(`docs`)·`status` | Cloudflare Pages | 백엔드와 **분리** — Oracle이 죽어도 살아있다 |
| 대시보드 + REST(`/api`) + DB + 모니터링 | Oracle A1 (2 OCPU / 12GB, arm64) | `compose.yaml` + `compose.prod.yaml` |
| 이미지 발행 | GitHub Actions → GHCR | `linux/arm64`, 서버는 pull만 |

관련 파일:

- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — app·dashboard 이미지를 GHCR에 멀티아치 발행
- [`scripts/pull-deploy.sh`](../../scripts/pull-deploy.sh) — 서버의 systemd 타이머가 새 커밋을 발견해 스스로 배포(§7-1). GitHub 이 SSH 로 들어오지 않는다
- [`scripts/install-pull-deploy.sh`](../../scripts/install-pull-deploy.sh) — 그 systemd 서비스·타이머 설치
- [`compose.prod.yaml`](../../compose.prod.yaml) — 프로덕션 오버레이(발행 이미지·메모리 상한·80/443·db 비공개)
- [`Caddyfile.prod`](../../Caddyfile.prod) — 도메인 + 자동 HTTPS + XFF 덮어쓰기
- [`scripts/bootstrap.sh`](../../scripts/bootstrap.sh) — 빈 호스트 → 스택 기동 (멱등, 재실행이 곧 재배포)

## 왜 서버에서 빌드하지 않나

2 OCPU에서 Gradle `bootJar` + `next build`를 돌리면 코어를 수 분간 점유하고 빌드 메모리가 서비스와 경쟁한다.
CI(무료 arm64 호스티드 러너)에서 굽고 서버는 `pull`만 하면 재배포가 수십 초로 끝나고, 롤백이 태그 변경 한 줄이 된다.

## 1. Oracle 인스턴스 준비

1. **홈 리전은 가입 시 영구 고정된다.** A1 용량 여유가 있는(=한산한) 리전을 고른다. 나중에 바꿀 수 없다.
2. Compute → Instances → Create:
   - Shape: **VM.Standard.A1.Flex**, 2 OCPU / 12GB (Always Free 한도)
   - Image: Ubuntu 24.04 (arm64) — 아래 방화벽 절차는 Oracle Linux 9도 지원한다
   - 부트 볼륨 50GB 이상(200GB까지 무료), SSH 공개키 등록
3. `Out of host capacity`가 나오면 — 무료 티어에서 흔하다:
   - **[`scripts/oci-launch-retry.sh`](../../scripts/oci-launch-retry.sh)로 자동 재시도한다** (권장).
     용량이 풀리는 순간을 잡고, 성공하면 멈추고 공인 IP를 출력한다. 아래 "용량 재시도" 참고
   - 콘솔에서 손으로 누를 때 **재시도 간격은 3분 이상** — 짧게 연달아 누르면 용량 에러가 아니라
     `Too many requests for the user`(API 레이트 리밋)가 뜨고, 그 상태에서 더 누르면 리밋 창이 계속 갱신된다
   - 급하면 1 OCPU / 6GB로 줄여 신청한다. 스택은 그것으로도 돈다 — §9의 6GB 오버레이를 쓴다
   - **다른 리전으로 우회할 수 없다**(홈 리전 고정). 이것이 1번을 가입 전에 확정해야 하는 이유다
   - 도쿄·오사카는 **가용성 도메인이 1개**라 "다른 AD로 재시도"가 불가능하다(에러 메시지가 그렇게 안내하지만
     해당 없음)

### 용량 재시도 (`oci-launch-retry.sh`)

사전 준비 — OCI CLI와 **API 키 인증**(세션 토큰은 1시간에 만료돼 장시간 루프가 죽는다):

```bash
brew install oci-cli
oci setup config      # user OCID / tenancy OCID / region=ap-tokyo-1 → API 키 생성
# ~/.oci/oci_api_key_public.pem 를 콘솔에 등록:
#   Profile → User settings → API keys → Add API key → Paste public key
```

실행:

```bash
./scripts/oci-launch-retry.sh
```

가용성 도메인·퍼블릭 서브넷·Ubuntu 24.04(arm64) 이미지 OCID를 **자동 탐색**하므로 콘솔에서 OCID를 복사해
붙일 필요가 없다. 90초 간격으로 한 번씩만 시도하고(분당 1회 미만이라 레이트 리밋에 걸리지 않는다), 리밋에
걸리면 5분→10분→…30분으로 물러난다. 성공하면 멈추고 알림·공인 IP·SSH 명령을 출력한다.

조정은 환경변수로 한다: `OCPUS`, `MEMORY_GB`, `BOOT_GB`, `INTERVAL`, `MAX_ATTEMPTS`, `SSH_KEY_FILE`,
`DISPLAY_NAME`. 자동 탐색이 실패하면 `TENANCY`, `AD`, `SUBNET`, `IMAGE`를 직접 지정한다.

인스턴스가 유휴 회수(§10)됐을 때의 재구축 경로이기도 하다 — 컴퓨트는 이 스크립트, OS 위쪽은
`bootstrap.sh`다.
4. 실제 한도 확인: 콘솔 → Governance → Limits, Quotas and Usage → `Cores for Ampere A1 based VM instances`
   (2026-06에 4 OCPU/24GB → 2 OCPU/12GB로 무공지 축소된 전례가 있다)

## 2. VCN 인그레스 (놓치기 쉬운 단계)

방화벽이 **2중**이다. `bootstrap.sh`는 호스트 방화벽(firewalld / iptables)만 열 수 있다.

콘솔 → Networking → Virtual Cloud Networks → 해당 VCN → Security Lists(또는 인스턴스의 NSG)에서 인그레스 추가:

| 소스 | 프로토콜 | 포트 | 언제 |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 80 | 항상 |
| `0.0.0.0/0` | TCP | 443 | TLS 모드 |
| `0.0.0.0/0` | UDP | 443 (HTTP/3) | TLS 모드 |

> `bootstrap.sh` 가 여는 **호스트** 방화벽도 모드에 맞춰 갈린다 — 평문 모드에서는 443 에 아무것도
> 리스닝하지 않으므로 열지 않는다(방화벽 규칙은 영구 저장되니 한 번 열면 남는다). TLS 로 전환할 때
> 다시 실행하면 열린다. VCN 쪽은 콘솔 작업이라 미리 열어둬도 무해하다.

> 호스트 방화벽만 열고 VCN을 빼먹으면 증상이 **"인증서 발급 실패"**로 나타난다 — ACME HTTP-01 챌린지가
> 오리진에 닿지 못하기 때문이다. 원인을 엉뚱한 곳에서 찾게 되는 대표적인 함정이다.

Postgres(5432)·gRPC(9093)·Grafana(3000)는 **열지 않는다**. `compose.prod.yaml`이 db 호스트 포트를 닫고
app을 loopback에 묶으므로 애초에 열 대상이 아니다.

22 번은 Oracle 이미지가 기본으로 열어두는 유일한 포트이고, `0.0.0.0/0` 으로 두면 상시 스캔 대상이 된다
(실측: 24시간 인증 실패 209건, 단일 IP 90회). 키 전용 인증은 인증 단계를 막지만 sshd 의 **pre-auth**
취약점(CVE-2024-6387 등)은 인증 전에 터지므로 키가 보호해주지 않는다 — 소스를 좁히면 그 부류가
구조적으로 사라진다. 이동이 잦아 유동 IP 가 걸림돌이면 `scripts/oci-ssh-allow.sh` 로 갱신한다:

```bash
./scripts/oci-ssh-allow.sh                   # 지금 내 공인 IP 추가
./scripts/oci-ssh-allow.sh --list            # 현재 허용 목록
./scripts/oci-ssh-allow.sh --only A/32 B/32  # 목록 교체
```

sshd 쪽 정책(키 전용·root 로그인 금지·fail2ban)은 서버에서 `scripts/harden-ssh.sh` 가 담당한다.

> 22 번을 좁히기 전에 **복구 경로를 확보**해 둘 것. OCI 는 인스턴스 생성 후 메타데이터로 키를 추가할
> 수 없다(cloud-init 이 첫 부팅만 읽는다). OCI Bastion 의 Managed SSH 는 원본 키 없이도 접속할 수 있고
> **public 서브넷 대상에도 동작한다.** 단 Bastion 이 주입한 키는 `#ocid1.bastionsession...` 주석 블록에
> 들어가고 세션 만료 시 플러그인이 지우므로, 들어간 즉시 블록 밖에 `>>` 로 영구 등록해야 한다.

## 3. .env 구성

```bash
git clone https://github.com/PreAgile/reputation-pool-cloud.git
cd reputation-pool-cloud
cp .env.example .env
$EDITOR .env
```

프로덕션에서 반드시 채울 값:

| 키 | 값 |
|---|---|
| `REPUTATION_POOL_API_KEY` | 강한 난수 (gRPC `x-api-key`) |
| `GRAFANA_ADMIN_PASSWORD` | 강한 난수 |
| `REPUTATION_POOL_DB_PASSWORD` | 강한 난수 (미설정 시 로컬용 throwaway로 폴백된다) |
| `DOMAIN` | Caddy가 서빙할 호스트네임 (예: `app.example.com`) |
| `ACME_EMAIL` | 인증서 만료·실패 알림 수신 주소 |
| `REPUTATION_POOL_ADMIN_USERNAME` / `_PASSWORD` / `_JWT_SECRET` | 관리자 콘솔을 쓸 때만. 미설정 시 `/api/**`는 fail closed로 전부 거부(gRPC는 계속 동작) |
| `REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL` | **값은 비어도 되지만 키는 반드시 있어야 한다.** 빈 값 = SLO 알림이 Alertmanager 까지만 가고 밖으로 나가지 않음(무통합 no-op). 실제 통지를 붙일 때만 URL 을 넣고 `monitoring/alertmanager.yml` 의 `webhook_configs` 주석을 해제한다(#76) |

`bootstrap.sh`는 필수 키 누락, **정의 자체가 없는 키**(스크립트의 `REQUIRED_DEFINED_ENV` 목록 — 값은 비어도
되지만 줄이 있어야 하는 부류), `.env.example`의 로컬 placeholder 잔존을 기동 전에 거부한다.

> **왜 빈 값이라도 키가 있어야 하나** — `alertmanager` 서비스는 이 값을 compose 의
> `secrets: <name>: environment:` 소스로 파일(`/run/secrets/…`)로 받는다. 이 소스는 컨테이너 **생성**
> 시점에 변수 정의를 요구하므로, 값이 비어 있으면 빈 파일이 마운트되지만 **정의가 아예 없으면**
> `environment variable ... required by file ... is not set` 으로 실패한다. `docker compose config` 는
> 통과하기 때문에 설정 검증만으로는 드러나지 않아, `bootstrap.sh` 가 기동 전에 따로 검사한다.

> `.env` 파일은 현재 시크릿의 유일한 보관 위치다. 시크릿 스토어 도입은 #6.

## 4. 기동

### 두 가지 모드

| 모드 | 명령 | 도메인 | 언제 |
|---|---|---|---|
| **평문** | `./scripts/bootstrap.sh` | 불필요 | 도메인이 아직 없을 때, 임시 검증 호스트 |
| **TLS** | `./scripts/bootstrap.sh compose.prod.tls.yaml` | **필요** (`DOMAIN`·`ACME_EMAIL`) | 공개 데모 |

`compose.prod.yaml` 은 도메인을 요구하지 않는다 — 발행 이미지·메모리 상한·로그 회전·db 비공개는
두 모드가 공유하고, 도메인·자동 HTTPS·443 은 `compose.prod.tls.yaml` 이 얹는다. 변수 보간은 파일을 읽는
시점에 일어나므로 `${DOMAIN:?}` 를 나중 오버레이로 무력화할 수 없다 — TLS 요구를 별 파일로 뺀 이유다.

### ⚠️ 평문 모드의 제약

HTTP 이므로 **관리 콘솔 로그인(#11) 자격이 평문으로 전송된다.** 공개 IP 에 평문으로 띄울 때는:

- 관리자 자격(`REPUTATION_POOL_ADMIN_*`)을 **설정하지 않는다.** 미설정이면 `/api/**` 가 fail closed 라
  대시보드 화면과 public health 는 보이고 로그인만 불가하다 — 배포 경로 검증에는 충분하다
- 굳이 켜야 하면 **재사용하지 않는 throwaway 값**만 쓴다
- Grafana 는 두 모드 모두 loopback 바인딩이므로 SSH 터널로만 접근한다(§8)

XFF 위조는 두 모드 모두 막혀 있다 — base `Caddyfile` 도 `header_up X-Forwarded-For {remote_host}` 로
헤더를 덮어쓴다(§6, [`security.md`](security.md) 참고).



> **선행 1회: GHCR 패키지를 public 으로 바꾼다.** `release.yml` 이 처음 발행한 직후 패키지는 **private**이
> 기본이라 서버의 익명 `pull` 이 `denied` 로 실패한다. GitHub → 레포 → Packages → `app`·`dashboard` 각각 →
> Package settings → Change visibility → **Public**. private 로 유지하려면 서버에서 `read:packages` 권한
> PAT 로 `docker login ghcr.io` 를 먼저 해야 한다.

```bash
./scripts/bootstrap.sh                        # 평문
./scripts/bootstrap.sh compose.prod.tls.yaml  # 도메인 + 자동 HTTPS
```

하는 일: 사전 검사 → 도커·compose 설치(없으면) → 호스트 방화벽 80/443 → `compose pull` → `up -d` →
app 헬스 대기. 멱등하므로 **재실행이 곧 재배포**다. 인자로 넘긴 오버레이는 뒤에 덧붙는다(§9 의 6GB
프로파일도 같은 방식이며, 함께 쓸 수 있다).

수동으로 할 때:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d                            # 평문
docker compose -f compose.yaml -f compose.prod.yaml -f compose.prod.tls.yaml up -d   # TLS
```

**평문 → TLS 전환**은 도메인이 준비된 뒤 오버레이를 하나 더 얹어 재실행하면 된다. 컨테이너와 볼륨은
그대로 재사용되고 Caddy 만 교체된다.

### 모드를 `.env` 에 고정한다 (TLS 호스트에서 필수)

`bootstrap.sh` 는 **재배포·롤백 경로이기도 하다**(§7). TLS 로 띄운 호스트에서 인자 없이 재실행하면
TLS 오버레이가 빠져 **HTTPS 가 평문으로 내려앉는다.** 모드는 호스트의 성질이므로 `.env` 에 남긴다:

```bash
DEPLOY_OVERLAYS=compose.prod.tls.yaml
```

인자 없이 실행하면 이 값이 쓰이고, CLI 인자가 있으면 그것이 우선한다. 그래도 실수로 평문 재실행을 하면
**다운그레이드 가드**가 막는다 — 실행 중인 caddy 가 `Caddyfile.prod` 를 마운트하고 있으면 거부하고,
의도적으로 내릴 때만 `ALLOW_PLAINTEXT_DOWNGRADE=1` 로 통과시킨다.

## 5. DNS와 Cloudflare — 순서가 중요하다

인증서 발급과 Cloudflare 프록시에는 순서 의존이 있다.

1. `DOMAIN`의 A(그리고 IPv6를 쓰면 AAAA) 레코드를 인스턴스 공인 IP로 만든다. **처음에는 DNS only(회색 구름)**.
2. Caddy가 Let's Encrypt 인증서를 받는지 확인한다:
   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml logs -f caddy
   curl -I https://<DOMAIN>/actuator/health
   ```
3. 발급을 확인한 뒤 **proxied(주황 구름)**로 전환하고, Cloudflare SSL/TLS 모드를 **Full (strict)**로 둔다.
   Caddy의 인증서가 유효하므로 strict가 맞다. 갱신은 proxied 상태에서도 동작한다(챌린지가 Cloudflare를 경유해 도착).
4. Flexible 모드를 쓰지 않는다 — 엣지-오리진 구간이 평문이 되고 리다이렉트 루프의 원인이 된다.

## 6. 오리진 잠그기 (공개 전 권장)

Cloudflare proxied로 전환한 뒤에도 **오리진 IP를 알면 Cloudflare를 우회해 직접 접속**할 수 있다. 그러면:

- 엣지의 WAF·레이트리밋·DDoS 방어를 건너뛴다
- `CF-Connecting-IP` 같은 헤더를 위조할 수 있다

그래서 VCN 인그레스의 소스를
[Cloudflare 공개 IP 범위](https://www.cloudflare.com/ips/)(IPv4 + IPv6)로 제한한다. `0.0.0.0/0` 규칙을
지우고 범위별 규칙으로 교체한다. ACME 갱신은 proxied 상태에서 Cloudflare를 경유해 도착하므로 계속 동작한다.

이 제한을 끝낸 **뒤에야** `Caddyfile.prod`의 XFF 처리를 실제 클라이언트 IP로 되돌릴 수 있다:

```caddyfile
# 오리진이 Cloudflare 범위로 제한된 뒤에만 — 그 전에는 위조 가능하다.
header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}
```

제한 전 기본값은 `{remote_host}`(직접 peer IP 덮어쓰기)다. 배경은
[`security.md`](security.md)의 로그인 스로틀 항목과 [ADR 0001](../decisions/0001-reverse-proxy-caddy.md) 참고.

인그레스 교체는 콘솔에서 손으로 하지 않아도 된다 — `scripts/oci-origin-lock.sh` 가 Cloudflare 목록을
받아 80/443 규칙을 교체하고 22·ICMP 는 보존한다(멱등, 노트북에서 실행):

```bash
./scripts/oci-origin-lock.sh          # 잠그기
./scripts/oci-origin-lock.sh --list   # 현재 80/443 소스
./scripts/oci-origin-lock.sh --unlock # 되돌리기
```

> ⚠️ **잠근 뒤에는 Cloudflare 를 회색 구름으로 되돌리는 것이 롤백이 아니다.** 유저가 오리진에 직접
> 오려 하는데 인그레스가 막고 있어 전부 차단된다. 회색으로 돌릴 일이 생기면 `--unlock` 을 먼저 한다.
> 그리고 Cloudflare 가 대역을 추가하면 갱신이 필요하다 — 증상이 "일부 지역 유저만 502" 로 나타나
> 원인을 찾기 어렵다.

## 7. 재배포 · 롤백

`main` 에 머지하면 **자동으로 배포된다**(아래 §7-1). 아래 수동 절차는 자동 배포가 꺼져 있거나
서버에서 직접 손볼 때 쓴다.

```bash
# 수동 재배포 (main 머지 후 release.yml이 latest 를 갱신한 뒤)
./scripts/bootstrap.sh
```

롤백은 자동 배포가 켜져 있는지에 따라 절차가 다르다 — **켜져 있으면 태그만 되돌려도 다음 폴링 주기가
`origin/main` 으로 다시 올린다.** [§7-1 롤백하기](#롤백하기)를 따른다. 자동 배포가 꺼진 호스트라면
`.env` 의 `APP_IMAGE_TAG` 와 `DASHBOARD_IMAGE_TAG` 를 `sha-<7자리>`(release.yml 이 커밋마다 남긴다)로
바꾸고 `bootstrap.sh` 를 다시 실행하면 된다. 둘 다 바꾼다 — app 만 되돌리면 대시보드는 새 이미지로 남는다.

### 7-1. 자동 배포 (서버가 GitHub 에 물어본다 — 풀 방식)

`main` 머지 → `Release Images` 가 GHCR 에 이미지 발행 → **서버의 systemd 타이머가 새 커밋을 발견해 스스로
배포**한다. GitHub 이 서버로 들어오지 않는다.

#### 왜 풀 방식인가 (Actions → SSH 를 쓰지 않는 이유)

처음에는 GitHub Actions 가 SSH 로 붙는 방식으로 만들었다(PR #112). 그 방식은 **22 번 인그레스가 열려
있어야** 하는데, 이 서버는 `oci-ssh-allow.sh` 로 22 번을 운영자 IP 두 개로 좁혀 뒀다(근거: §6 SSH 하드닝 —
`0.0.0.0/0` 이면 상시 스캔 대상이고, sshd 의 pre-auth 취약점은 키 인증이 막아주지 못한다).

세 가지를 검토했다:

| 방법 | 판정 |
|---|---|
| Actions 러너 IP 를 22 번 허용 목록에 추가 | **불가능.** `api.github.com/meta` 의 `actions` 범위가 IPv4 만 5,600개 이상이고 수시로 바뀐다. Security List 에 넣을 수 없다 |
| 셀프호스티드 러너 | **쓰지 않는다.** 이 레포는 **public** 이라 포크 PR 의 워크플로가 러너에서 임의 코드를 실행할 수 있다(GitHub 이 공개 레포에 셀프호스티드 러너를 쓰지 말라고 명시한다). 배포 권한을 가진 서버에서는 대가가 너무 크다 |
| Tailscale / Cloudflare Tunnel | 가능하다. Actions 화면의 배포 기록과 `production` environment 승인 게이트를 유지하고 싶으면 이쪽이다. 대가는 상주 에이전트 하나 |

방향을 뒤집으면 이 제약이 전부 사라진다. 서버는 GitHub 에 **아웃바운드**로만 접근하고(확인: `api.github.com`
200), 열어야 할 포트가 없다. 부품이 가장 적어 이 방식을 골랐다 — 단일 서버·단일 운영자에 배포 빈도가 낮은
지금 단계에서는 "새로 관리할 에이전트가 없는 것"이 Actions 화면 기록보다 가치가 크다.

**Actions 방식의 구현은 지우되 이력에 남겨 뒀다** — 나중에 Tailscale 로 갈 때 PR #112 (`883bc4c`) 의
`.github/workflows/deploy.yml` 을 되살리고 `DEPLOY_HOST` 만 tailnet IP 로 바꾸면 된다. 지운 이유: 시크릿이
없으면 그 잡은 **매 머지마다 "건너뜀"으로 초록 체크**가 되어 "배포됐다"는 오해를 만든다.

#### 배포가 하는 일

`scripts/pull-deploy.sh` (systemd 타이머가 기본 5분마다 호출):

1. `origin/main` 의 최신 커밋을 확인한다. **마지막으로 배포에 성공한 커밋**(`.pull-deploy-state`)과 같으면
   아무것도 하지 않는다(대부분의 실행).

   HEAD 로 비교하지 않는 이유: `git reset --hard` 가 `bootstrap.sh` 보다 먼저 일어나므로 그 사이에
   프로세스가 죽으면(TimeoutStartSec 초과·OOM·재부팅) **HEAD 는 새 커밋인데 컨테이너는 옛 이미지**로 남는다.
   HEAD 기준이면 그 상태가 "최신" 으로 보여 다음 주기가 아무것도 하지 않고, 스택은 영원히 뒤처진 채 로그는
   "배포할 것이 없다" 라고 말한다. 표식은 **끝까지 성공한 뒤에만** 갱신하므로 그 창이 없다. 롤백하면 표식도
   되돌려 다음 주기가 재시도한다. (`.gitignore` 대상 — 호스트마다 다르고, `git reset --hard` 는 untracked
   파일을 지우지 않아 배포를 거쳐도 남는다.)
2. **그 커밋의 CI 가 통과했는지** GitHub check-runs API 로 확인한다.

   필요한 이유: `release.yml` 은 `push: branches: [main]` 로 돌고 **`ci.yml` 의 결과에 의존하지 않는다.**
   게다가 이 레포의 `main` 에는 **브랜치 보호가 없다**(확인: `/branches/main/protection` → 404). 즉 테스트가
   실패한 커밋도 이미지가 발행되고, 이미지 존재만 보면 그대로 프로덕션에 올라간다.

   판정을 "필수 체크 이름 목록" 으로 하지 않는다 — 이름이 바뀌거나 추가되면 조건이 영원히 충족되지 않아
   **배포가 조용히 멈춘다**(반대 방향의 같은 실패). 대신 *실패가 하나라도 있으면 중단 / 진행 중이 있으면
   다음 주기 / 전부 끝났고 실패 없으면 배포*. public 레포라 토큰이 필요 없고, 새 커밋이 있을 때만 호출하므로
   익명 한도(시간당 60회)와 무관하다. **API 에 닿지 못하면 배포하지 않는다**(fail closed).
3. 그 커밋의 이미지가 GHCR 에 실제로 발행됐는지 확인한다. 없으면 체크아웃을 건드리지 않고 끝내고 다음 주기에
   다시 본다. 이 확인이 없으면 `bootstrap.sh` 의 pull 이 실패하는데 그 메시지는 "GHCR 패키지가 public 인지
   확인하라"로 나와 원인을 오도한다.
4. **서버 체크아웃을 그 커밋으로 맞춘다** (`git reset --hard`). 이미지 pull 만으로는 부족하다 —
   `compose*.yaml`·`monitoring/*`(알림 룰)·`Caddyfile.prod` 는 이미지 안이 아니라 **서버 체크아웃에서
   bind-mount** 되므로, 이미지만 갱신하면 알림 룰이나 리버스 프록시 변경이 반영되지 않는다.
   서버의 로컬 수정은 버려진다. `.env` 는 gitignore 대상이라 남는다.
5. **이미지 태그를 그 커밋으로 고정한다** — `.env` 의 `APP_IMAGE_TAG`·`DASHBOARD_IMAGE_TAG` 를
   `sha-<7자리>` 로 갱신한 뒤 `bootstrap.sh` 를 부른다.

   - **7자리다.** `release.yml` 의 merge 잡이 매니페스트 리스트를 `sha-${SHA:0:7}` 로 발행한다. 40자리
     `sha-<full>-<arch>` 는 아치별 단일 이미지 태그이고 compose 가 쓸 대상이 아니다.
   - **환경변수가 아니라 `.env` 다.** `bootstrap.sh` 는 도커 그룹이 이번 세션에 아직 반영되지 않았으면
     `sudo docker compose` 로 실행하는데, sudo 는 기본 `env_reset` 이라 export 한 변수를 버린다. 그러면
     compose 가 `${APP_IMAGE_TAG:-latest}` 의 기본값으로 떨어져 **"체크아웃은 대상 커밋인데 이미지는
     latest"** 인 조합이 조용히 만들어진다. compose 는 프로젝트 디렉터리의 `.env` 를 sudo 와 무관하게 직접
     읽는다. 부수 효과로 나중에 `bootstrap.sh` 를 수동 재실행해도 같은 이미지가 뜬다.
6. **공개 URL 들이 전부 200 인지 확인하고, 하나라도 실패하면 직전 커밋·태그로 되돌려 다시 올린다**
   (자동 롤백). 성공하면 그때 표식을 갱신한다.

   **URL 을 목록으로 받는 이유**: `app` 과 `dashboard` 는 별개 컨테이너다. `/actuator/health` 는 app 이
   응답하므로, 대시보드 컨테이너가 뜨지 못해 Caddy 가 502 를 내고 있어도 그 확인은 통과하고 배포가 "성공"
   으로 끝나며 롤백도 일어나지 않는다 — 사람이 화면을 열어볼 때까지 아무도 모른다. 두 경로를 모두 넣는다.

오버레이(TLS·6GB)는 스크립트가 결정하지 않는다. 모드는 호스트의 성질이므로 `.env` 의 `DEPLOY_OVERLAYS` 가
정하고, 빠지면 `bootstrap.sh` 의 다운그레이드 가드가 막는다.

#### 설치

**서버에서** 한 번 실행한다. 유닛 파일을 레포에 커밋하지 않고 생성하는 이유는 `User=`·`WorkingDirectory=` 가
호스트마다 다르기 때문이다 — 박아 두면 다른 호스트에서 조용히 틀린 디렉터리를 배포한다.

```bash
cd ~/reputation-pool-cloud

# 1. .env 에 키 추가 (ENABLED 가 true 가 아니면 스크립트는 아무것도 하지 않는다 — fail closed)
cat >> .env <<'EOF'
PULL_DEPLOY_ENABLED=true
PULL_DEPLOY_HEALTH_URLS="https://app.poolroost.com/actuator/health https://app.poolroost.com/login"
EOF

# 2. systemd 서비스 + 타이머 설치
./scripts/install-pull-deploy.sh            # 기본 5분 주기
./scripts/install-pull-deploy.sh --interval 10m
```

| `.env` 키 | 기본값 | 의미 |
|---|---|---|
| `PULL_DEPLOY_ENABLED` | 없음(=끔) | `true` 여야 배포한다. **타이머를 지우지 않고 배포만 멈추는 킬 스위치** |
| `PULL_DEPLOY_BRANCH` | `main` | 따라갈 브랜치 |
| `PULL_DEPLOY_HEALTH_URLS` | 없음 | 배포 후 확인할 공개 URL **목록**(공백 구분). **전부** 200 이어야 성공. 비우면 로컬 헬스(`bootstrap.sh` 가 이미 확인)만 본다. app·dashboard 경로를 모두 넣는다 |

#### 확인 · 운영

```bash
systemctl list-timers reputation-pool-deploy.timer
journalctl -u reputation-pool-deploy.service -n 50 --no-pager

./scripts/pull-deploy.sh --dry-run          # 무엇을 할지만 출력, 아무것도 바꾸지 않는다
./scripts/pull-deploy.sh --force            # HEAD 가 같아도 재배포
sudo systemctl start reputation-pool-deploy.service   # 주기를 기다리지 않고 즉시 한 번

./scripts/install-pull-deploy.sh --uninstall
```

배포가 폴링 간격보다 오래 걸려도 겹치지 않는다 — 스크립트가 `flock` 으로 잠근다. 서버가 꺼져 있던 동안
지나간 주기는 타이머의 `Persistent=true` 로 부팅 후 한 번에 합쳐 실행된다.

#### 롤백하기

```bash
# 서버에서: 먼저 자동 배포를 멈춘다 — 이걸 빼면 다음 주기가 롤백을 되돌린다
cd ~/reputation-pool-cloud
sed -i 's|^PULL_DEPLOY_ENABLED=.*|PULL_DEPLOY_ENABLED=false|' .env

# 되돌릴 커밋으로 고정한 뒤 재실행
git reset --hard <되돌릴-sha>
sed -i 's|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=sha-<7자리>|' .env
sed -i 's|^DASHBOARD_IMAGE_TAG=.*|DASHBOARD_IMAGE_TAG=sha-<7자리>|' .env
./scripts/bootstrap.sh
```

`PULL_DEPLOY_ENABLED=false` 를 먼저 하는 이유: 타이머는 5분마다 `origin/main` 을 보므로, 멈추지 않으면
**최대 5분 뒤 롤백이 조용히 되돌아간다.** 타이머 자체는 그대로 두고 배포만 멈추는 킬 스위치다.

원인을 고친 뒤 `PULL_DEPLOY_ENABLED` 를 `true` 로 되돌리는 것을 잊지 않는다 — 잊으면 이후 머지가 전부
배포되지 않고, 로그에는 "아무것도 하지 않는다" 만 남아 알아채기 어렵다. 되돌릴 것이 **코드 자체라면
`main` 에 revert 를 머지하는 것이 정석이다** — 다음 주기가 그걸 배포하고, 킬 스위치를 건드릴 일이 없다.
`bootstrap.sh` 도 완료 안내에서 이 호스트의 자동 배포 상태를 확인해 맞는 절차를 출력한다.

> `docker compose down -v` 를 프로덕션에서 쓰지 않는다. `caddy-data` 볼륨의 인증서가 사라져 재발급이 일어나고
> Let's Encrypt 레이트리밋을 소모한다. DB 볼륨도 함께 지워진다.

### 새 `.env` 키가 생긴 릴리스로 재배포할 때

호스트의 `.env` 는 한 번 만든 뒤 그대로 남으므로, 그 후 추가된 키는 자동으로 채워지지 않는다.
`bootstrap.sh` 가 기동 전에 잡아주지만(위 §3), 어떤 줄을 넣어야 하는지는 `.env.example` 을 봐야 한다.

```
error: .env 에 정의 자체가 없다(값은 비어도 된다): REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL — .env.example 참고
```

이 메시지가 나오면 해당 키를 `.env` 에 추가하고 다시 실행한다. 값을 비워 두면 그 기능이 no-op 로
꺼진 상태로 뜬다(위 예시의 경우 SLO 알림이 밖으로 나가지 않음).

```bash
echo 'REPUTATION_POOL_ALERTMANAGER_WEBHOOK_URL=' >> .env
./scripts/bootstrap.sh
```

업그레이드 전에 미리 확인하려면 `.env.example` 과 `.env` 의 키 이름만 비교한다(값은 보지 않는다):

```bash
diff <(grep -oE '^[A-Z_]+=' .env.example | sort) <(grep -oE '^[A-Z_]+=' .env | sort)
```

## 8. 운영 확인

```bash
# 상태 · 로그
docker compose -f compose.yaml -f compose.prod.yaml ps
docker compose -f compose.yaml -f compose.prod.yaml logs --tail 100 app

# Grafana — 공개 도메인에 노출하지 않는다. SSH 터널로 본다.
ssh -L 3001:127.0.0.1:3001 <user>@<서버>   # → http://localhost:3001

# 백업 (일일 자동). 즉시 한 번 + 목록
docker compose -f compose.yaml -f compose.prod.yaml exec backup /usr/local/bin/backup.sh
```

백업·복원·복원 리허설 상세는 [`scripts/README.md`](../../scripts/README.md).

## 9. 메모리 배분

12GB 호스트 기준 컨테이너 상한 합계 약 8.6GB, 나머지는 OS와 페이지 캐시 몫이다.

| 서비스 | 상한 | 비고 |
|---|---|---|
| app | 4GB | JVM 힙은 이 값의 70%(≈2.8GB) — `Dockerfile`의 `-XX:MaxRAMPercentage` |
| db | 2GB | |
| prometheus | 1GB | |
| dashboard / grafana | 512MB 각 | |
| alertmanager / backup | 256MB 각 | |
| caddy | 128MB | |

> base `compose.yaml`에 서비스를 추가하면 `compose.prod.yaml`에도 상한과 `logging`을 추가해야 한다.
> 빠뜨리면 그 컨테이너만 상한 없이 뜨고 로그가 무한히 쌓인다.

### 1 OCPU / 6GB 호스트인 경우

`Out of host capacity`로 2 OCPU 배치가 안 되어 1 OCPU/6GB로 받았다면, 위 합계(8.4GB)가 호스트를 넘으므로
[`compose.prod.6gb.yaml`](../../compose.prod.6gb.yaml) 오버레이를 한 겹 더 얹는다:

```bash
./scripts/bootstrap.sh compose.prod.6gb.yaml
```

| 서비스 | 12GB | 6GB |
|---|---|---|
| app | 4GB | **2GB** (힙 ≈1.4GB) |
| db | 2GB | **1GB** |
| prometheus | 1GB | **512MB** |
| grafana | 512MB | **384MB** |
| alertmanager | 256MB | **128MB** |
| dashboard / backup / caddy | 512MB / 256MB / 128MB | 동일 |
| 합계 | 약 8.6GB | **약 4.9GB** |

**힙은 어느 쪽에서도 건드리지 않는다.** `Dockerfile`의 `-XX:MaxRAMPercentage=70`이 cgroup 상한을 읽으므로
app의 상한을 내리면 힙이 자동으로 따라 내려간다 — 힙을 고정 `-Xmx`로 박지 않은 이유가 이것이다.

나중에 12GB 인스턴스를 확보하면 이 오버레이를 빼고 `bootstrap.sh`를 다시 실행하면 된다.

## 10. 유휴 회수 주의

Always Free 인스턴스는 7일간 CPU 95백분위 < 20%, 네트워크 < 20%, 메모리 < 20%면 회수 대상이다.
**"필요할 때만 켜기"를 하지 않는다** — 스택 전체를 상시 가동(Prometheus 스크레이프 포함)하는 편이
임계치 유지에 유리하다.

## 남은 것 (#15 Phase C)

- 시크릿 스토어 (#6) — 현재는 서버의 `.env` 파일
- 복원 리허설을 **실 서버에서** 한 번 통과시키기 (`RestoreRehearsalIT`는 CI에서 경로만 검증한다)
- 데모 전용 읽기 계정 + 시드 데이터 주기 리셋 (공개 회원가입은 열지 않는다)
- 자동 배포의 **첫 실 배포 확인** — 워크플로는 들어갔지만(§7-1) 시크릿 4개를 넣고 한 번 돌려봐야
  SSH·경로·권한이 실제로 맞는지 알 수 있다. 그때까지 배포 잡은 "건너뜀"으로 끝난다.
- **스테이징/프로덕션 분리는 `container_name` 이 먼저 걸린다.** `compose.yaml` 이 서비스마다 고정
  `container_name`(`reputation-pool-db` 등)을 지정하므로, compose 프로젝트를 분리(`-p`)해도 같은 호스트에서
  두 스택을 동시에 띄울 수 없다(`Conflict. The container name ... is already in use`). 분리를 실제로 하려면
  `container_name` 을 제거해 compose 가 프로젝트명으로 이름을 짓게 해야 한다 — 고정 이름에 의존하는
  `docker logs reputation-pool-app` 류 습관이 깨지므로 별도 변경으로 다룬다.

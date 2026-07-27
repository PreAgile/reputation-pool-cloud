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

- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — app·dashboard arm64 이미지를 GHCR에 발행
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

## 7. 재배포 · 롤백

```bash
# 재배포 (main 머지 후 release.yml이 latest 를 갱신한 뒤)
./scripts/bootstrap.sh

# 롤백 — release.yml이 커밋마다 sha-<커밋> 태그를 남긴다
echo 'APP_IMAGE_TAG=sha-<커밋>' >> .env
./scripts/bootstrap.sh
```

> `docker compose down -v`를 프로덕션에서 쓰지 않는다. `caddy-data` 볼륨의 인증서가 사라져 재발급이 일어나고
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
- 자동 배포(CI → 서버)
- **스테이징/프로덕션 분리는 `container_name` 이 먼저 걸린다.** `compose.yaml` 이 서비스마다 고정
  `container_name`(`reputation-pool-db` 등)을 지정하므로, compose 프로젝트를 분리(`-p`)해도 같은 호스트에서
  두 스택을 동시에 띄울 수 없다(`Conflict. The container name ... is already in use`). 분리를 실제로 하려면
  `container_name` 을 제거해 compose 가 프로젝트명으로 이름을 짓게 해야 한다 — 고정 이름에 의존하는
  `docker logs reputation-pool-app` 류 습관이 깨지므로 별도 변경으로 다룬다.

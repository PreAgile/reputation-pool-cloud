import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import {
  A,
  B,
  Bullet,
  Bullets,
  C,
  Callout,
  CodeBlock,
  DocsLink,
  P,
  PageHeader,
  Section,
} from "@/components/docs/prose";
import { CLOUD_REPO_URL, CONTACT_EMAIL, GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";
import { TYPESCRIPT_WORKER_EXAMPLE } from "@/app/docs/quickstart/typescript-example";

const SLUG = "quickstart";
const LOCALE = "ko";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 한국어 퀵스타트 (#143). 영어판(`app/docs/quickstart/page.tsx`)과 같은 절차·같은 명령이고 산문만 한국어다.
 *
 * TypeScript 예제는 **영어판과 같은 모듈**(`@/app/docs/quickstart/typescript-example`)에서 가져온다.
 * 그 문자열은 계약 테스트가 실제 `tsc --noEmit` 에 걸어 컴파일되는지 확인하는 진짜 코드이고, 코드는
 * 번역 대상이 아니다 — 여기에 복제하면 검증이 한쪽에만 걸린 채로 두 벌이 서서히 갈린다.
 */
export default function DocsQuickstartPageKo() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Callout tone="warn" title="아직 호스티드 gRPC 엔드포인트는 없습니다 — 이 문서는 직접 띄운 스택을 기준으로 합니다">
        <P>
          평판 루프는 gRPC 이고, 호스티드 배포는 그 포트를 공개하지 않습니다. 이 프로젝트의 모든 compose
          파일에서 데이터플레인은 <C>127.0.0.1:9093</C> 에 바인딩돼 있고, 공개 리버스 프록시는 대시보드와{" "}
          <C>/api</C> 만 라우팅합니다 — TLS 유무와 무관하게, 호스트 밖의 클라이언트가 붙을 주소 자체가
          없습니다.
        </P>
        <P>
          이건 배포가 덜 된 것이 아니라 경계입니다. 컨트롤플레인이 IP 별 로그인 제한에{" "}
          <C>X-Forwarded-For</C> 를 신뢰하는 근거가 &quot;프록시 말고는 들어올 길이 없다&quot; 이므로,
          데이터플레인을
          공개하는 것은 그 신뢰를 먼저 다시 설계하는 일입니다. 그때까지 호스티드로 제공되는 것은 대시보드와
          REST 컨트롤플레인입니다.
        </P>
        <P>
          그래서 아래 내용은 전부 <B>여러분이</B> 띄운 스택 — 호스티드 배포와 같은 레포, 같은 이미지 — 을
          대상으로 합니다. 처음부터 끝까지 복붙해서 실행됩니다. 데이터플레인이 열리면 주소와 채널
          자격증명만 바뀌므로,{" "}
          <a href="#hosted" className="font-medium text-accent hover:underline">
            호스티드 데이터플레인에서 달라지는 것
          </a>
          만 따로 적어 두었습니다.
        </P>
      </Callout>

      <Section id="step-1" title="1. 스택 띄우기">
        <P>
          서비스는 <C>docker compose</C> 파일 하나입니다. 앱(REST <C>8083</C>, gRPC <C>9093</C>),
          PostgreSQL, 대시보드, 그리고 둘을 <C>:8080</C> 한 오리진으로 묶어 주는 Caddy 리버스 프록시로
          구성됩니다. 첫 부팅에 Flyway 가 스키마를 마이그레이션하므로 별도 준비 단계는 없습니다.
        </P>
        <CodeBlock language="bash" title="clone, configure, run">
          {`git clone ${CLOUD_REPO_URL}
cd reputation-pool-cloud
cp .env.example .env      # REPUTATION_POOL_API_KEY has no default — compose refuses to start without it
docker compose up --build -d`}
        </CodeBlock>
        <P>
          <C>http://localhost:8080</C> 을 열면 대시보드가 있습니다. REST 컨트롤플레인은 한 단계가 더
          필요합니다 — <C>.env</C> 의 <C>REPUTATION_POOL_ADMIN_*</C> 세 줄의 주석을 해제하세요. 이 값을
          비워 두는 것은 <B>의도된 기본 차단(fail closed)</B> 입니다. 관리자 콘솔이 비활성으로 남고 모든{" "}
          <C>/api/**</C> 호출이 거절되며, gRPC 데이터플레인은 그대로 동작합니다.
        </P>
        <CodeBlock language="bash" title=".env — enabling the control plane">
          {`REPUTATION_POOL_ADMIN_USERNAME=admin
REPUTATION_POOL_ADMIN_PASSWORD=change-me-local-dev
# HS256 needs a 256-bit key: anything shorter than 32 bytes fails fast at startup.
REPUTATION_POOL_ADMIN_JWT_SECRET=0123456789abcdef0123456789abcdef

# Then re-create the container. Not \`docker compose restart\` — that reuses the container
# with the environment it was created with, so the new variables would appear to do nothing.
docker compose up -d`}
        </CodeBlock>
        <P>이 페이지의 나머지가 쓰는 값들입니다.</P>
        <CodeBlock language="bash" title="the addresses and credentials used throughout">
          {`export RP_ORIGIN=http://localhost:8080     # control plane + dashboard, one origin (Caddy)
export RP_GRPC=localhost:9093              # data plane — loopback only, by design
export RP_TENANT=default                   # the tenant compose seeds on startup
export RP_API_KEY=local-dev-key            # REPUTATION_POOL_API_KEY from your .env`}
        </CodeBlock>
        <Callout title="두 평면은 서로 다른 자격증명을 씁니다">
          <P>
            REST 컨트롤플레인은 로그인해서 받은 <C>Authorization: Bearer &lt;jwt&gt;</C> 를, gRPC
            데이터플레인은 <C>x-api-key</C> 메타데이터 헤더의 API 키를 받습니다. JWT 로 gRPC 호출을 인증할 수
            없고 API 키로 REST 호출을 인증할 수 없습니다 —{" "}
            <DocsLink slug="authentication" locale={LOCALE}>
              인증
            </DocsLink>
            을 보세요.
          </P>
        </Callout>
      </Section>

      <Section id="step-2" title="2. API 키 받기">
        <P>
          이미 하나 있습니다. 앱은 시작할 때 <C>REPUTATION_POOL_API_KEY</C> 를 <C>default</C> 테넌트의 활성
          키로 심어 두므로, <C>$RP_API_KEY</C> 로 gRPC 호출이 바로 인증됩니다. 이 변수를 바꾸고 재시작하면
          같은 단계에서 기존 키가 폐기됩니다 — 이 부트스트랩 키 하나에 대해서는 환경변수가 단일 출처입니다.
        </P>
        <P>
          첫 실행을 넘어가면 워커마다 키를 따로 두고 싶어지고, 그 키는 컨트롤플레인에서 나옵니다. 먼저
          로그인해 토큰을 받으세요. 토큰은 <C>expiresInSeconds</C> 뒤에 만료됩니다(기본 한 시간).
        </P>
        <CodeBlock language="bash" title="POST /api/auth/login">
          {`curl -sS -X POST "$RP_ORIGIN/api/auth/login" \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"admin","password":"change-me-local-dev"}'

# {"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}
export RP_JWT=eyJhbGciOiJIUzI1NiJ9…`}
        </CodeBlock>
        <P>
          이제 키를 발급합니다. 응답의 <C>rawToken</C> 은 키 원문을 볼 수 있는 <B>유일한</B> 순간입니다 —
          암호화가 아니라 해시로 저장되므로 나중에 다시 읽어낼 수 없습니다. 곧바로 비밀 저장소에 넣으세요.
        </P>
        <CodeBlock language="bash" title="POST /api/tenants/{tenantId}/api-keys">
          {`curl -sS -X POST "$RP_ORIGIN/api/tenants/$RP_TENANT/api-keys" \\
  -H "Authorization: Bearer $RP_JWT" \\
  -H 'Content-Type: application/json' \\
  -d '{"label":"worker-01"}'

# 201 Created
# {
#   "id": "5f1c…-…",
#   "rawToken": "rp_9Q3xK7bT…",       <-- shown once, never again
#   "label": "worker-01",
#   "prefix": "rp_9Q3xK7bT",          <-- what listings show
#   "createdAt": "2026-07-29T09:12:44Z"
# }
export RP_API_KEY=rp_9Q3xK7bT…`}
        </CodeBlock>
        <P>
          대시보드의 API 키 화면도 버튼 하나로 같은 일을 합니다. 어느 쪽이든 경로의 <C>tenantId</C> 는 토큰이
          묶여 있는 테넌트여야 합니다 — 다른 테넌트를 향한 키 발급 요청은 그 테넌트가 존재하든 아니든{" "}
          <C>403</C> 으로 거절됩니다.
        </P>
      </Section>

      <Section id="step-3" title="3. 리소스 등록하기">
        <P>
          리소스는 <C>kind</C>(<C>PROXY</C>, <C>ACCOUNT</C>, <C>SESSION</C>)와 여러분이 정하는 불투명한{" "}
          <C>value</C> 의 조합입니다 — 프록시 엔드포인트, 계정 id, 세션 핸들 같은 것. 등록은 멱등이므로 워커가
          부팅할 때마다 다시 등록하는 것이 정상적인 패턴입니다.
        </P>
        <P>
          데이터플레인은 gRPC 라서 아래 요청은 curl 이 아니라{" "}
          <A href="https://github.com/fullstorydev/grpcurl">grpcurl</A> 을 씁니다. 서버 리플렉션이 켜져 있어
          grpcurl 이 서비스를 스스로 찾아냅니다 — 받아 올 <C>.proto</C> 파일이 없습니다. 인터셉터가 리플렉션도
          함께 지키므로 목록을 보는 데도 키가 필요합니다.
        </P>
        <CodeBlock language="bash" title="check you can reach the data plane">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" "$RP_GRPC" list

# io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor   <-- plus health and reflection`}
        </CodeBlock>
        <P>
          여기서 <C>-plaintext</C> 는 편법이 아니라 맞는 선택입니다. 포트가 loopback 에 있고 앞에 TLS 가
          없습니다. 실제로 TLS 종단을 붙였을 때만 이 플래그를 빼세요.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Register">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{"resource":{"kind":"PROXY","value":"proxy-1.example.net:8080"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Register

# {}   <-- RegisterResponse is empty; the call succeeding is the result`}
        </CodeBlock>
      </Section>

      <Section id="step-4" title="4. 컨텍스트에 맞는 리소스 획득하기">
        <P>
          <B>컨텍스트</B>는 지금 하려는 일에 이름을 붙인 문자열입니다 — <C>checkout-us</C>, <C>search-eu</C>{" "}
          처럼, 리소스를 독립적으로 태울 수 있는 목적지나 워크로드마다 하나씩. 이 값을 <C>Acquire</C> 에
          넘기면 풀이 <B>그 컨텍스트에서</B> 가장 건강한 리소스를 골라, 여러분에게만 배타적으로 리스해 줍니다.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Acquire">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{"context":{"value":"checkout-us"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Acquire

# {
#   "granted": true,
#   "lease": {
#     "resource": {"kind":"PROXY","value":"proxy-1.example.net:8080"},
#     "context":  {"value":"checkout-us"},
#     "token":    "1",                      <-- int64 is a string in proto3 JSON
#     "leasedAt":  "2026-07-29T09:13:02Z",
#     "expiresAt": "2026-07-29T09:13:32Z"   <-- 30s lease TTL by default
#   }
# }`}
        </CodeBlock>
        <Callout tone="warn" title="granted 가 false 인 것은 에러가 아니라 정상적인 답입니다">
          <P>
            등록된 리소스가 모두 쿨다운 중이거나 차단 목록에 올랐거나 이미 리스돼 있으면, 호출은 성공하면서{" "}
            <C>granted: false</C> 와 빈 리스를 돌려줍니다. 백오프하고 재시도하세요. 전송 실패로 취급하면 안
            됩니다. 풀은 이때 <C>AcquisitionRejected</C> 이벤트도 함께 내보내므로 대시보드에서 거절 사실이
            보입니다.
          </P>
        </Callout>
      </Section>

      <Section id="step-5" title="5. 리소스를 쓰고, 결과를 보고하기">
        <P>
          <C>lease.resource</C> 로 할 일을 하고, 무슨 일이 있었는지 풀에 알려 주세요. 평판을 움직이는 것은 이
          호출입니다. 성공은 점수를 조금 올리고, 실패는 실패 유형에 따라 정해진 만큼 점수를 내리며, 임계치를
          넘으면 그 리소스를 쿨다운 동안 빼 둡니다.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Report — success">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{
        "resource": {"kind":"PROXY","value":"proxy-1.example.net:8080"},
        "context":  {"value":"checkout-us"},
        "outcome":  {"success":{"latency":"0.412s"}}
      }' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Report`}
        </CodeBlock>
        <CodeBlock language="bash" title="ReputationAdvisor/Report — failure">
          {`# type: CONNECTION_RESET | TLS_HANDSHAKE | TIMEOUT | BLOCKED | SLOW
grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{
        "resource": {"kind":"PROXY","value":"proxy-1.example.net:8080"},
        "context":  {"value":"checkout-us"},
        "outcome":  {"failure":{"type":"BLOCKED","latency":"1.2s"}}
      }' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Report`}
        </CodeBlock>
        <P>
          실패 유형은 정직하게 고르세요 — 장식이 아닙니다. <C>BLOCKED</C> 는 점수 30 점과 한 시간 쿨다운을,{" "}
          <C>SLOW</C> 는 2 점과 30 초를 뜻합니다. 전부 <C>BLOCKED</C> 로 보고하면 풀이 비어 버립니다. 정확한
          수치는{" "}
          <DocsLink slug="concepts" locale={LOCALE}>
            핵심 개념
          </DocsLink>
          에 있습니다.
        </P>
        <P>
          마지막으로 <C>Release</C> 로 리소스를 돌려주면 다른 워커가 가져갈 수 있습니다. 반납은 정확성을 위해
          필수는 아닙니다 — 리스는 TTL 이 지나면 스스로 만료됩니다 — 하지만 제때 반납하는 것이 풀을 TTL 만료를
          기다리는 상태가 아니라 일하는 상태로 유지합니다. 작업이 TTL 보다 길어지면 <C>Renew</C> 를 부르세요.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Release">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{"lease":{"resource":{"kind":"PROXY","value":"proxy-1.example.net:8080"},
                "context":{"value":"checkout-us"},"token":"1",
                "leasedAt":"2026-07-29T09:13:02Z","expiresAt":"2026-07-29T09:13:32Z"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Release

# {"released": true}`}
        </CodeBlock>
        <Callout title="리스를 통째로 되돌려 주세요">
          <P>
            <C>Renew</C> 와 <C>Release</C> 는 <C>token</C> 을 포함해 받은 <C>LeaseHandle</C> 을 그대로
            받습니다. 이 토큰은 펜싱 토큰입니다 — 풀이 현재 보유자를 위해서만 동작하게 해 주므로, 이미 리스가
            만료돼 다른 워커가 다시 가져간 리소스를 뒤늦게 반납해 남의 리스를 끊어 버리는 일이 생기지 않습니다.
          </P>
        </Callout>
      </Section>

      <Section id="java" title="같은 루프, Java 로">
        <P>
          생성된 스텁은 퍼블리시된 <C>io.github.preagile:reputation-pool-grpc</C> 아티팩트에서 오므로 여러분
          쪽에 codegen 단계가 없습니다. 와이어 타입이 한 겉 클래스(<C>AdvisorProto</C>) 아래에 중첩된 것은
          의도적입니다 — 단순 이름이 엔진의 도메인 타입과 충돌하기 때문입니다.
        </P>
        <CodeBlock language="java" title="Worker.java">
          {`import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.AcquireResponse;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Context;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.FailureType;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.LeaseHandle;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.Outcome;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.RegisterRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReleaseRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ReportRequest;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceId;
import io.github.preagile.reputationpool.grpc.v1.AdvisorProto.ResourceKind;
import io.github.preagile.reputationpool.grpc.v1.ReputationAdvisorGrpc;
import io.grpc.ChannelCredentials;
import io.grpc.Grpc;
import io.grpc.InsecureChannelCredentials;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;

final class Worker {

    private final ReputationAdvisorGrpc.ReputationAdvisorBlockingStub advisor;

    /**
     * Loopback data plane: InsecureChannelCredentials. Behind a TLS terminator this becomes
     * TlsChannelCredentials.create() and nothing else in this class changes.
     */
    Worker(String target, String apiKey) {
        var headers = new Metadata();
        headers.put(Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER), apiKey);
        ChannelCredentials credentials = InsecureChannelCredentials.create();
        ManagedChannel channel = Grpc.newChannelBuilder(target, credentials).build();
        this.advisor = ReputationAdvisorGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }

    void runOnce() {
        var proxy = ResourceId.newBuilder()
                .setKind(ResourceKind.PROXY)
                .setValue("proxy-1.example.net:8080")
                .build();
        var context = Context.newBuilder().setValue("checkout-us").build();

        advisor.register(RegisterRequest.newBuilder().setResource(proxy).build()); // idempotent

        AcquireResponse acquired = advisor.acquire(AcquireRequest.newBuilder().setContext(context).build());
        if (!acquired.getGranted()) {
            return; // nothing eligible right now — back off and retry
        }
        LeaseHandle lease = acquired.getLease();

        long startedAt = System.nanoTime();
        try {
            useProxy(lease.getResource().getValue()); // your work
            report(lease, Outcome.newBuilder()
                    .setSuccess(Outcome.Success.newBuilder().setLatency(elapsed(startedAt)))
                    .build());
        } catch (java.io.IOException failed) {
            report(lease, Outcome.newBuilder()
                    .setFailure(Outcome.Failure.newBuilder()
                            .setType(FailureType.CONNECTION_RESET)
                            .setLatency(elapsed(startedAt)))
                    .build());
        } finally {
            advisor.release(ReleaseRequest.newBuilder().setLease(lease).build());
        }
    }

    private void report(LeaseHandle lease, Outcome outcome) {
        advisor.report(ReportRequest.newBuilder()
                .setResource(lease.getResource())
                .setContext(lease.getContext())
                .setOutcome(outcome)
                .build());
    }

    /** google.protobuf.Duration from a nanosecond stopwatch reading. */
    private static com.google.protobuf.Duration elapsed(long startedAtNanos) {
        long nanos = System.nanoTime() - startedAtNanos;
        return com.google.protobuf.Duration.newBuilder()
                .setSeconds(nanos / 1_000_000_000L)
                .setNanos((int) (nanos % 1_000_000_000L))
                .build();
    }
}`}
        </CodeBlock>
      </Section>

      <Section id="typescript" title="같은 루프, TypeScript 로">
        <P>
          퍼블리시된 JS 클라이언트는 아직 없으므로 <C>@grpc/proto-loader</C> 로 런타임에{" "}
          <C>advisor.proto</C> 를 읽어 씁니다. <C>keepCase: false</C> 로 두면 위 JSON 예제와 같은
          lowerCamelCase 필드 이름을 쓸 수 있습니다. proto 파일은 퍼블리시된{" "}
          <C>reputation-pool-grpc</C> 아티팩트 안에 들어 있고 원본은{" "}
          <A href={GITHUB_REPO_URL}>엔진 레포</A>에 있습니다.
        </P>
        <CodeBlock language="typescript" title="worker.ts">
          {TYPESCRIPT_WORKER_EXAMPLE}
        </CodeBlock>
        <Callout title="이 스니펫은 CI 가 컴파일합니다">
          <P>
            계약 테스트가 위 코드를 그대로 임시 파일에 쓰고 <C>strict</C> 아래에서 <C>tsc --noEmit</C> 을
            돌립니다. 문서 예제는 그러지 않으면 조용히 썩습니다 — 이 페이지의 초기 원고는 로드한 패키지를{" "}
            <C>never</C> 로 캐스팅했는데, 바로 다음 줄에서 컴파일이 깨지는 코드였고 읽어서는 알 수 없었습니다.
          </P>
        </Callout>
      </Section>

      <Section id="verify" title="6. 반영됐는지 확인하기">
        <P>
          컨트롤플레인으로 풀을 되읽어 보세요. 등록한 리소스가 보이고, 보고한 컨텍스트마다 셀이 하나씩 있고,
          이벤트 피드에 리스와 쿨다운이 찍혀 있어야 합니다.
        </P>
        <CodeBlock language="bash" title="GET /api/pools/resources and GET /api/events">
          {`curl -sS "$RP_ORIGIN/api/pools/resources" -H "Authorization: Bearer $RP_JWT"
curl -sS "$RP_ORIGIN/api/events?limit=10" -H "Authorization: Bearer $RP_JWT"`}
        </CodeBlock>
        <Bullets>
          <Bullet>
            <C>resources</C> 가 비어 있나요? <C>Register</C> 호출이 지금 읽고 있는 테넌트에 닿지 않았습니다 —
            API 키와 JWT 가 같은 테넌트에 속하는지 확인하세요.
          </Bullet>
          <Bullet>
            행에 <C>contexts: 0</C> 이 보이나요? 등록은 했지만 보고를 한 번도 하지 않은 것입니다. 셀은{" "}
            <C>Acquire</C> 가 아니라 <C>Report</C> 가 만듭니다.
          </Bullet>
          <Bullet>
            모든 REST 호출이 <C>401</C> 인가요? 토큰이 만료됐거나(다시 로그인하세요) 관리자 환경변수 세 개가
            설정되지 않아 콘솔이 통째로 비활성입니다. 전체 에러 표는{" "}
            <DocsLink slug="api" locale={LOCALE}>
              REST API 레퍼런스
            </DocsLink>
            에 있습니다.
          </Bullet>
          <Bullet>
            grpcurl 이 <C>UNAVAILABLE</C> 을 주나요? <C>9093</C> 에서 아무것도 듣고 있지 않습니다.{" "}
            <C>docker compose ps</C> 를 확인하세요. 앱은 그 포트를 <C>127.0.0.1</C> 에만 공개하므로 다른
            머신에서는 의도적으로 닿지 않습니다.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="hosted" title="호스티드 데이터플레인에서 달라지는 것">
        <P>
          루프에서는 아무것도 달라지지 않습니다. RPC, 메시지 모양, API 키 헤더, 평판 모델은 모두 엔진의 것이고
          이 서비스는 엔진을 fork 하지 않고 퍼블리시된 의존성으로 소비합니다 — 두 곳에서 같은 코드가 돕니다.
          워커를 여러분의 스택에서 호스티드로 옮기는 일은 두 군데를 고치는 것입니다.
        </P>
        <Bullets>
          <Bullet>
            대상 주소 — <C>localhost:9093</C> 이 호스티드 엔드포인트로 바뀝니다.
          </Bullet>
          <Bullet>
            채널 자격증명 — <C>-plaintext</C> / <C>InsecureChannelCredentials</C> /{" "}
            <C>credentials.createInsecure()</C> 가 각각의 TLS 짝으로 바뀝니다.
          </Bullet>
        </Bullets>
        <P>
          <B>없는</B> 것은 그 엔드포인트 자체입니다. 호스티드 데이터플레인의 호스트명·포트·TLS 계약이 아직
          공개된 바 없고, 이 페이지는 그것을 지어내지 않습니다. 그게 도입을 막는 부분이라면{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          로 알려 주세요 — 알려진 공백이고, 누가 필요한지가 언제 만들지를 정합니다. 평판 상태도 아직 배포
          사이를 옮겨가지 않습니다. 풀은 실제 트래픽으로 다시 예열됩니다.
        </P>
        <P>
          이 페이지의 모든 내용은{" "}
          <A href={CLOUD_REPO_URL}>PreAgile/reputation-pool-cloud</A> 의 배포 파일 — <C>compose.yaml</C>,{" "}
          <C>compose.prod.yaml</C>, <C>Caddyfile.prod</C> — 에서 나왔습니다. 포트 바인딩에 대한 설명을 그냥
          믿는 대신 직접 확인하고 싶다면 그곳을 보세요.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}

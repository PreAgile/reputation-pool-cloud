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
import { TYPESCRIPT_WORKER_EXAMPLE } from "./typescript-example";

const SLUG = "quickstart";
const LOCALE = "en";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

/**
 * 퀵스타트 (#121). **자체 호스팅 스택 기준**으로 쓴다.
 *
 * 이 페이지는 원래 `your-grpc.example.com:9093` 이라는 공개 gRPC 주소를 전제로 쓰여 있었는데 그런
 * 엔드포인트는 존재하지 않는다(PR #130 리뷰 P1). `compose.yaml` 은 9093 을 `127.0.0.1` 에만 바인딩하고,
 * `compose.prod.yaml` 은 그 바인딩을 그대로 두며, `Caddyfile.prod` 는 `/api` 와 대시보드만 프록시한다 —
 * gRPC 경로도 TLS 종단도 없다. 게다가 이건 배포 누락이 아니라 이슈 #15 가 못 박은 경계다: 로그인 스로틀이
 * X-Forwarded-For 를 신뢰하는 근거(#28)가 "앱에 직접 닿을 수 없다" 이므로, 데이터플레인을 여는 것은
 * 설정 변경이 아니라 방어 재설계다.
 *
 * 그래서 따라 하면 실제로 되는 유일한 경로 — 로컬 `docker compose` — 를 정본으로 삼는다. 없는 것을 있는
 * 것처럼 쓴 문서는 없느니만 못하다. 호스티드 데이터플레인이 열리면 주소와 채널 자격증명만 바뀌고
 * 나머지는 그대로이므로, 마지막 절에서 그 차이만 따로 적는다.
 *
 * TypeScript 예제는 `./typescript-example` 의 문자열 하나에서 온다 — 같은 문자열을 계약 테스트가 진짜
 * `tsc` 에 걸어 컴파일되는지 확인한다(같은 리뷰의 P2). 여기 인라인으로 다시 적으면 그 검증이 무의미해진다.
 */
export default function DocsQuickstartPage() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Callout tone="warn" title="There is no hosted gRPC endpoint yet — this page runs against your own stack">
        <P>
          The reputation loop is gRPC, and the hosted deployment does not publish that port. In every compose file in
          this project the data plane is bound to <C>127.0.0.1:9093</C>, and the public reverse proxy routes only the
          dashboard and <C>/api</C> — there is no address for a client outside the host to dial, with or without TLS.
        </P>
        <P>
          That is a boundary rather than a gap in the rollout. The control plane trusts <C>X-Forwarded-For</C> for its
          per-IP login throttle precisely because the proxy is the only way in, so publishing the data plane means
          redesigning that trust first. Until then, hosted access means the dashboard and the REST control plane.
        </P>
        <P>
          So everything below runs against a stack <B>you</B> start, from the same repository and the same images the
          hosted deployment runs. It is copy-paste runnable end to end. When the data plane does open, only the address
          and the channel credentials change — see{" "}
          <a href="#hosted" className="font-medium text-accent hover:underline">
            what changes on a hosted data plane
          </a>
          .
        </P>
      </Callout>

      <Section id="step-1" title="1. Start the stack">
        <P>
          The service is one <C>docker compose</C> file: the app (REST on <C>8083</C>, gRPC on <C>9093</C>),
          PostgreSQL, the dashboard, and a Caddy reverse proxy that serves both on a single origin at{" "}
          <C>:8080</C>. Flyway migrates the schema on first boot, so there is no separate setup step.
        </P>
        <CodeBlock language="bash" title="clone, configure, run">
          {`git clone ${CLOUD_REPO_URL}
cd reputation-pool-cloud
cp .env.example .env      # REPUTATION_POOL_API_KEY has no default — compose refuses to start without it
docker compose up --build -d`}
        </CodeBlock>
        <P>
          Open <C>http://localhost:8080</C> and the dashboard is there. The REST control plane needs one more step:
          uncomment the three <C>REPUTATION_POOL_ADMIN_*</C> lines in <C>.env</C>. Leaving them unset is{" "}
          <B>fail-closed on purpose</B> — the admin console stays disabled and every <C>/api/**</C> call is rejected,
          while the gRPC data plane keeps working.
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
        <P>These are the values the rest of the page uses:</P>
        <CodeBlock language="bash" title="the addresses and credentials used throughout">
          {`export RP_ORIGIN=http://localhost:8080     # control plane + dashboard, one origin (Caddy)
export RP_GRPC=localhost:9093              # data plane — loopback only, by design
export RP_TENANT=default                   # the tenant compose seeds on startup
export RP_API_KEY=local-dev-key            # REPUTATION_POOL_API_KEY from your .env`}
        </CodeBlock>
        <Callout title="The two planes use different credentials">
          <P>
            The REST control plane takes an <C>Authorization: Bearer &lt;jwt&gt;</C> obtained by logging in. The gRPC
            data plane takes an API key in the <C>x-api-key</C> metadata header. A JWT will not authenticate a gRPC call
            and an API key will not authenticate a REST call — see{" "}
            <DocsLink slug="authentication" locale={LOCALE}>Authentication</DocsLink>.
          </P>
        </Callout>
      </Section>

      <Section id="step-2" title="2. Get an API key">
        <P>
          You already have one. On startup the app seeds <C>REPUTATION_POOL_API_KEY</C> as an active key for the{" "}
          <C>default</C> tenant, so <C>$RP_API_KEY</C> authenticates gRPC calls immediately. Change the variable and
          restart and the old key is revoked in the same step — the env var is the single source of truth for that one
          bootstrap key.
        </P>
        <P>
          For anything beyond a first run you want a key per worker, and those come from the control plane. Log in for a
          token first; it expires after <C>expiresInSeconds</C> (one hour by default).
        </P>
        <CodeBlock language="bash" title="POST /api/auth/login">
          {`curl -sS -X POST "$RP_ORIGIN/api/auth/login" \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"admin","password":"change-me-local-dev"}'

# {"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}
export RP_JWT=eyJhbGciOiJIUzI1NiJ9…`}
        </CodeBlock>
        <P>
          Now mint a key. The <C>rawToken</C> in the response is the <B>only</B> time the key material is ever
          available — it is stored as a hash, not encrypted, so it cannot be read back later. Put it straight into your
          secret store.
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
          The dashboard&apos;s API keys screen does the same thing with a button. Either way, the{" "}
          <C>tenantId</C> in the path must be the tenant your token is bound to — a key request aimed at another tenant
          is rejected with <C>403</C> regardless of whether that tenant exists.
        </P>
      </Section>

      <Section id="step-3" title="3. Register your resources">
        <P>
          A resource is a <C>kind</C> (<C>PROXY</C>, <C>ACCOUNT</C>, or <C>SESSION</C>) plus an opaque{" "}
          <C>value</C> you choose — a proxy endpoint, an account id, a session handle. Registration is idempotent, so
          re-registering on every worker boot is fine and is the usual pattern.
        </P>
        <P>
          The data plane is gRPC, so the requests below use <A href="https://github.com/fullstorydev/grpcurl">grpcurl</A>{" "}
          rather than curl. Server reflection is on, so grpcurl can discover the service by itself — no{" "}
          <C>.proto</C> file to fetch. The interceptor guards reflection too, so the key is required even to list:
        </P>
        <CodeBlock language="bash" title="check you can reach the data plane">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" "$RP_GRPC" list

# io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor   <-- plus health and reflection`}
        </CodeBlock>
        <P>
          <C>-plaintext</C> is correct here and not a shortcut: the port is on loopback with no TLS in front of it. Drop
          the flag only when you have actually put a TLS terminator there.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Register">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{"resource":{"kind":"PROXY","value":"proxy-1.example.net:8080"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Register

# {}   <-- RegisterResponse is empty; the call succeeding is the result`}
        </CodeBlock>
      </Section>

      <Section id="step-4" title="4. Acquire for a context">
        <P>
          A <B>context</B> is a string naming what you are about to do — <C>checkout-us</C>, <C>search-eu</C>, one per
          destination or workload that can burn a resource independently. You pass it to <C>Acquire</C> and the pool
          returns the healthiest resource <B>for that context</B>, leased exclusively to you.
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
        <Callout tone="warn" title="granted can be false — that is a normal answer, not an error">
          <P>
            If every registered resource is cooling, blocklisted, or already leased, the call succeeds with{" "}
            <C>granted: false</C> and no lease. Back off and retry; do not treat it as a transport failure. The pool also
            emits an <C>AcquisitionRejected</C> event so the rejection is visible in the dashboard.
          </P>
        </Callout>
      </Section>

      <Section id="step-5" title="5. Use the resource, then report the outcome">
        <P>
          Do your work with <C>lease.resource</C>, then tell the pool what happened. This is the call that moves
          reputation: a success nudges the score up, a failure pushes it down by an amount that depends on the failure
          type and, past the threshold, benches the resource for a cooldown.
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
          Pick the failure type honestly — it is not cosmetic. <C>BLOCKED</C> costs 30 score points and starts an hour
          of cooldown; <C>SLOW</C> costs 2 and starts thirty seconds. Reporting everything as <C>BLOCKED</C> will empty
          your pool. The exact numbers are in <DocsLink slug="concepts" locale={LOCALE}>Concepts</DocsLink>.
        </P>
        <P>
          Finally, hand the resource back with <C>Release</C> so another worker can take it. Releasing is not required
          for correctness — a lease expires on its own after its TTL — but releasing promptly is what keeps the pool
          busy instead of waiting out TTLs. If your work outlives the TTL, call <C>Renew</C>.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Release">
          {`grpcurl -plaintext -H "x-api-key: $RP_API_KEY" \\
  -d '{"lease":{"resource":{"kind":"PROXY","value":"proxy-1.example.net:8080"},
                "context":{"value":"checkout-us"},"token":"1",
                "leasedAt":"2026-07-29T09:13:02Z","expiresAt":"2026-07-29T09:13:32Z"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Release

# {"released": true}`}
        </CodeBlock>
        <Callout title="Echo the whole lease back">
          <P>
            <C>Renew</C> and <C>Release</C> take the <C>LeaseHandle</C> you were given, including its <C>token</C>. That
            token is a fencing token: it lets the pool act only for the current holder, so a worker whose lease already
            expired and was re-acquired by someone else cannot release the new holder&apos;s lease out from under it.
          </P>
        </Callout>
      </Section>

      <Section id="java" title="The same loop in Java">
        <P>
          The generated stubs come from the published <C>io.github.preagile:reputation-pool-grpc</C> artifact, so there
          is no codegen step on your side. Wire types are nested under one outer class (<C>AdvisorProto</C>) on purpose —
          their simple names collide with the engine&apos;s domain types.
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

      <Section id="typescript" title="The same loop in TypeScript">
        <P>
          There is no published JS client yet, so load <C>advisor.proto</C> at runtime with{" "}
          <C>@grpc/proto-loader</C>. <C>keepCase: false</C> gives you the same lowerCamelCase field names the JSON
          examples above use. The proto file ships inside the published <C>reputation-pool-grpc</C> artifact and lives
          in <A href={GITHUB_REPO_URL}>the engine repository</A>.
        </P>
        <CodeBlock language="typescript" title="worker.ts">
          {TYPESCRIPT_WORKER_EXAMPLE}
        </CodeBlock>
        <Callout title="This snippet is compiled by CI">
          <P>
            A contract test writes exactly the code above to a temporary file and runs <C>tsc --noEmit</C> on it under{" "}
            <C>strict</C>. Documentation examples rot silently otherwise: an earlier draft of this page cast the loaded
            package to <C>never</C>, which fails to compile on the very next line, and reading it did not reveal that.
          </P>
        </Callout>
      </Section>

      <Section id="verify" title="6. Verify it landed">
        <P>
          Read the pool back over the control plane. Your resource should be there with one cell per context you have
          reported on, and the events feed should show the lease and any cooldown.
        </P>
        <CodeBlock language="bash" title="GET /api/pools/resources and GET /api/events">
          {`curl -sS "$RP_ORIGIN/api/pools/resources" -H "Authorization: Bearer $RP_JWT"
curl -sS "$RP_ORIGIN/api/events?limit=10" -H "Authorization: Bearer $RP_JWT"`}
        </CodeBlock>
        <Bullets>
          <Bullet>
            Nothing in <C>resources</C>? The <C>Register</C> call did not reach the tenant you are reading — check that
            the API key and the JWT belong to the same tenant.
          </Bullet>
          <Bullet>
            <C>contexts: 0</C> on the row? You registered but never reported. A cell is created by <C>Report</C>, not by{" "}
            <C>Acquire</C>.
          </Bullet>
          <Bullet>
            <C>401</C> on every REST call? Either the token expired — log in again — or the three admin variables are
            not set, which disables the console entirely. See{" "}
            <DocsLink slug="api" locale={LOCALE}>REST API reference</DocsLink> for the full error table.
          </Bullet>
          <Bullet>
            <C>UNAVAILABLE</C> from grpcurl? Nothing is listening on <C>9093</C>. Check <C>docker compose ps</C>; the
            app publishes that port on <C>127.0.0.1</C> only, so it is unreachable from another machine by design.
          </Bullet>
        </Bullets>
      </Section>

      <Section id="hosted" title="What changes on a hosted data plane">
        <P>
          Nothing in the loop. The RPCs, the message shapes, the API key header, and the reputation model are the
          engine&apos;s, and this service consumes the engine as a published dependency rather than a fork — the same
          code runs in both places. Moving a worker from your stack to a hosted one is two edits:
        </P>
        <Bullets>
          <Bullet>
            the target address — <C>localhost:9093</C> becomes whatever the hosted endpoint is;
          </Bullet>
          <Bullet>
            the channel credentials — <C>-plaintext</C> / <C>InsecureChannelCredentials</C> /{" "}
            <C>credentials.createInsecure()</C> become their TLS counterparts.
          </Bullet>
        </Bullets>
        <P>
          What does <B>not</B> exist yet is the endpoint itself. There is no published hostname, port, or TLS contract
          for a hosted data plane, and this page will not invent one. If that is what stands between you and using this,
          say so at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          — it is a known gap, and knowing who needs it is what decides when it gets built. Reputation state does not
          transfer between deployments today either; pools warm up again from live traffic.
        </P>
        <P>
          Everything on this page came from the deployment files in{" "}
          <A href={CLOUD_REPO_URL}>PreAgile/reputation-pool-cloud</A> — <C>compose.yaml</C>, <C>compose.prod.yaml</C>,{" "}
          and <C>Caddyfile.prod</C>. If you want to check the claim about the port binding rather than take it on
          trust, that is where to look.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}

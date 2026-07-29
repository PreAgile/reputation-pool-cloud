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
import { GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "quickstart";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG);

export default function DocsQuickstartPage() {
  return (
    <>
      <PageHeader title={PAGE.title} summary={PAGE.summary} />

      <Section id="before-you-start" title="Before you start">
        <P>
          You need two things from onboarding: the <B>control-plane origin</B> (HTTPS, same host as your dashboard) and
          the <B>data-plane address</B> (gRPC, port <C>9093</C> in the default deployment), plus admin credentials for
          the dashboard. Access is set up by hand today — there is no self-serve signup.
        </P>
        <CodeBlock language="bash" title="the two addresses used throughout this page">
          {`export RP_HOST=your-console.example.com   # control plane: https://$RP_HOST/api/...
export RP_GRPC=your-grpc.example.com:9093 # data plane: ReputationAdvisor
export RP_TENANT=your-tenant-id`}
        </CodeBlock>
        <Callout title="The two planes use different credentials">
          <P>
            The REST control plane takes an <C>Authorization: Bearer &lt;jwt&gt;</C> obtained by logging in. The gRPC
            data plane takes an API key in the <C>x-api-key</C> metadata header. A JWT will not authenticate a gRPC call
            and an API key will not authenticate a REST call — see{" "}
            <DocsLink href="/docs/authentication">Authentication</DocsLink>.
          </P>
        </Callout>
      </Section>

      <Section id="step-1" title="1. Get an API key">
        <P>
          Log in to obtain a control-plane token. The response is show-once for the token value; it expires after{" "}
          <C>expiresInSeconds</C> (one hour by default).
        </P>
        <CodeBlock language="bash" title="POST /api/auth/login">
          {`curl -sS -X POST "https://$RP_HOST/api/auth/login" \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"admin","password":"…"}'

# {"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}
export RP_JWT=eyJhbGciOiJIUzI1NiJ9…`}
        </CodeBlock>
        <P>
          Now mint an API key for your tenant. The <C>rawToken</C> in the response is the <B>only</B> time the key
          material is ever available — it is stored as a hash, not encrypted, so it cannot be read back later. Put it
          straight into your secret store.
        </P>
        <CodeBlock language="bash" title="POST /api/tenants/{tenantId}/api-keys">
          {`curl -sS -X POST "https://$RP_HOST/api/tenants/$RP_TENANT/api-keys" \\
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

      <Section id="step-2" title="2. Register your resources">
        <P>
          A resource is a <C>kind</C> (<C>PROXY</C>, <C>ACCOUNT</C>, or <C>SESSION</C>) plus an opaque{" "}
          <C>value</C> you choose — a proxy endpoint, an account id, a session handle. Registration is idempotent, so
          re-registering on every worker boot is fine and is the usual pattern.
        </P>
        <P>
          The data plane is gRPC, so the requests below use <A href="https://github.com/fullstorydev/grpcurl">grpcurl</A>{" "}
          rather than curl. Server reflection is not enabled, so point grpcurl at <C>advisor.proto</C> — it ships inside
          the published <C>reputation-pool-grpc</C> artifact and lives in{" "}
          <A href={GITHUB_REPO_URL}>the engine repository</A>.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Register">
          {`grpcurl -proto advisor.proto \\
  -H "x-api-key: $RP_API_KEY" \\
  -d '{"resource":{"kind":"PROXY","value":"proxy-1.example.net:8080"}}' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Register

# {}   <-- RegisterResponse is empty; the call succeeding is the result`}
        </CodeBlock>
      </Section>

      <Section id="step-3" title="3. Acquire for a context">
        <P>
          A <B>context</B> is a string naming what you are about to do — <C>checkout-us</C>, <C>search-eu</C>, one per
          destination or workload that can burn a resource independently. You pass it to <C>Acquire</C> and the pool
          returns the healthiest resource <B>for that context</B>, leased exclusively to you.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Acquire">
          {`grpcurl -proto advisor.proto \\
  -H "x-api-key: $RP_API_KEY" \\
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

      <Section id="step-4" title="4. Use the resource, then report the outcome">
        <P>
          Do your work with <C>lease.resource</C>, then tell the pool what happened. This is the call that moves
          reputation: a success nudges the score up, a failure pushes it down by an amount that depends on the failure
          type and, past the threshold, benches the resource for a cooldown.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Report — success">
          {`grpcurl -proto advisor.proto \\
  -H "x-api-key: $RP_API_KEY" \\
  -d '{
        "resource": {"kind":"PROXY","value":"proxy-1.example.net:8080"},
        "context":  {"value":"checkout-us"},
        "outcome":  {"success":{"latency":"0.412s"}}
      }' \\
  "$RP_GRPC" io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor/Report`}
        </CodeBlock>
        <CodeBlock language="bash" title="ReputationAdvisor/Report — failure">
          {`# type: CONNECTION_RESET | TLS_HANDSHAKE | TIMEOUT | BLOCKED | SLOW
grpcurl -proto advisor.proto \\
  -H "x-api-key: $RP_API_KEY" \\
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
          your pool. The exact numbers are in <DocsLink href="/docs/concepts">Concepts</DocsLink>.
        </P>
        <P>
          Finally, hand the resource back with <C>Release</C> so another worker can take it. Releasing is not required
          for correctness — a lease expires on its own after its TTL — but releasing promptly is what keeps the pool
          busy instead of waiting out TTLs. If your work outlives the TTL, call <C>Renew</C>.
        </P>
        <CodeBlock language="bash" title="ReputationAdvisor/Release">
          {`grpcurl -proto advisor.proto \\
  -H "x-api-key: $RP_API_KEY" \\
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
import io.grpc.Grpc;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.TlsChannelCredentials;
import io.grpc.stub.MetadataUtils;

final class Worker {

    private final ReputationAdvisorGrpc.ReputationAdvisorBlockingStub advisor;

    Worker(String target, String apiKey) {
        var headers = new Metadata();
        headers.put(Metadata.Key.of("x-api-key", Metadata.ASCII_STRING_MARSHALLER), apiKey);
        ManagedChannel channel = Grpc.newChannelBuilder(target, TlsChannelCredentials.create()).build();
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
          examples above use.
        </P>
        <CodeBlock language="typescript" title="worker.ts">
          {`import { credentials, loadPackageDefinition, Metadata } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

const definition = loadSync("advisor.proto", { keepCase: false, defaults: true, longs: String });
const proto = loadPackageDefinition(definition) as never;
// package io.github.preagile.reputationpool.grpc.v1
const { ReputationAdvisor } = (proto as Record<string, never>)
  .io.github.preagile.reputationpool.grpc.v1;

const advisor = new ReputationAdvisor(process.env.RP_GRPC!, credentials.createSsl());

const auth = new Metadata();
auth.set("x-api-key", process.env.RP_API_KEY!);

const call = <T>(method: string, request: unknown): Promise<T> =>
  new Promise((resolve, reject) =>
    advisor[method](request, auth, (err: Error | null, res: T) => (err ? reject(err) : resolve(res))),
  );

// google.protobuf.Duration accepts the "12.345s" JSON form.
const seconds = (ms: number) => \`\${(ms / 1000).toFixed(3)}s\`;

export async function runOnce(): Promise<void> {
  const resource = { kind: "PROXY", value: "proxy-1.example.net:8080" };
  const context = { value: "checkout-us" };

  await call("Register", { resource }); // idempotent

  const acquired = await call<{ granted: boolean; lease?: { token: string } }>("Acquire", { context });
  if (!acquired.granted || acquired.lease === undefined) {
    return; // nothing eligible right now — back off and retry
  }
  const lease = acquired.lease;

  const startedAt = Date.now();
  try {
    await useProxy(resource.value); // your work
    await call("Report", {
      resource,
      context,
      outcome: { success: { latency: seconds(Date.now() - startedAt) } },
    });
  } catch {
    await call("Report", {
      resource,
      context,
      outcome: { failure: { type: "TIMEOUT", latency: seconds(Date.now() - startedAt) } },
    });
  } finally {
    await call("Release", { lease: { resource, context, ...lease } });
  }
}`}
        </CodeBlock>
      </Section>

      <Section id="verify" title="5. Verify it landed">
        <P>
          Read the pool back over the control plane. Your resource should be there with one cell per context you have
          reported on, and the events feed should show the lease and any cooldown.
        </P>
        <CodeBlock language="bash" title="GET /api/pools/resources and GET /api/events">
          {`curl -sS "https://$RP_HOST/api/pools/resources" -H "Authorization: Bearer $RP_JWT"
curl -sS "https://$RP_HOST/api/events?limit=10" -H "Authorization: Bearer $RP_JWT"`}
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
            <C>401</C> on every REST call? The token expired — log in again. See{" "}
            <DocsLink href="/docs/api">REST API reference</DocsLink> for the full error table.
          </Bullet>
        </Bullets>
      </Section>

      <DocsPager slug={SLUG} />
    </>
  );
}

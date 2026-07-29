import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import {
  A,
  B,
  Bullet,
  Bullets,
  C,
  Callout,
  Cell,
  DocsLink,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { CONTACT_EMAIL, GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "faq";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG);

export default function DocsFaqPage() {
  return (
    <>
      <PageHeader title={PAGE.title} summary={PAGE.summary} />

      <Section id="limits" title="Limits">
        <SubHeading>How many resources and cells can I have?</SubHeading>
        <P>
          Every tenant&apos;s pool is resident in one shared process, so the ceiling is a{" "}
          <B>service-wide budget, not a per-tenant quota</B>: 100,000 registered resources and 500,000 reputation cells
          summed across all tenants by default. That is deliberate — a single active tenant may use the entire budget
          alone, and several tenants share it dynamically as they show up. A fixed per-tenant cap would throttle a lone
          tenant while nothing else was competing.
        </P>
        <P>
          The budget is only checked by calls that would <B>grow</B> durable state: a <C>Register</C> for a resource the
          pool has not seen, or a <C>Report</C> for a <C>(resource, context)</C> pair that has no cell yet. Those are
          refused with <C>RESOURCE_EXHAUSTED</C>. Everything else — acquiring, reporting on existing cells, reading —
          keeps working. It is a fail-safe ceiling, not a fail-closed gate.
        </P>
        <Callout tone="warn" title="These numbers are an untested hypothesis, not a measured capacity">
          <P>
            No production load test backs 100,000 / 500,000 yet; they exist so the budget is on rather than unset, and
            they are meant to be tuned once real per-resource memory footprint is observed. If you are planning
            something near that scale, talk to us first rather than discovering the ceiling in production.
          </P>
        </Callout>

        <SubHeading>Are there request rate limits?</SubHeading>
        <P>
          Not on the data plane today — no per-tenant RPC quota. The one limiter that exists is on{" "}
          <C>POST /api/auth/login</C>, keyed by source IP: five failed attempts in fifteen minutes block that IP for
          fifteen minutes (<C>429</C> with <C>Retry-After</C>), plus a global per-second backstop. Read endpoints instead
          clamp their own inputs: <C>score-history?hours=</C> to <C>[1, 720]</C> and <C>events?limit=</C> to{" "}
          <C>[1, 500]</C>, so no single call can trigger an unbounded scan.
        </P>

        <SubHeading>How many contexts should one resource have?</SubHeading>
        <P>
          As many as you have things that can burn it independently — typically one per destination. Each distinct{" "}
          <C>(resource, context)</C> pair is one cell against the budget above, so a context derived per-request (a
          request id, a timestamp) will both exhaust the budget and produce cells with no useful history. See{" "}
          <DocsLink href="/docs/concepts">Concepts</DocsLink>.
        </P>
      </Section>

      <Section id="retention" title="Retention">
        <Table head={["Data", "Kept for", "Notes"]}>
          <Row>
            <Cell>Reputation state (cells, blocklist, registrations)</Cell>
            <Cell>Indefinitely</Cell>
            <Cell>Live state, checkpointed to PostgreSQL and restored on restart. Not a time series.</Cell>
          </Row>
          <Row>
            <Cell>
              Score samples (<C>score-history</C>)
            </Cell>
            <Cell>7 days</Cell>
            <Cell>Sampled once a minute per live cell; older samples are purged hourly.</Cell>
          </Row>
          <Row>
            <Cell>
              Audit events (<C>GET /api/events</C>)
            </Cell>
            <Cell>Indefinitely by default</Cell>
            <Cell>
              Age-based purging is opt-in and off unless configured, so the trail is complete unless you asked for a
              window.
            </Cell>
          </Row>
          <Row>
            <Cell>Usage meters</Cell>
            <Cell>Not purged</Cell>
            <Cell>
              Daily rows. <C>GET /api/usage</C> returns the last 30 days plus the current month&apos;s total.
            </Cell>
          </Row>
          <Row>
            <Cell>Leases</Cell>
            <Cell>Until TTL or release</Cell>
            <Cell>Runtime coordination only — not part of the durable snapshot, so nothing is held after a restart.</Cell>
          </Row>
        </Table>
        <P>
          If you need a specific audit-retention window for a compliance reason, that is a deployment setting rather than
          an API one — ask and we will configure it for your tenant.
        </P>
      </Section>

      <Section id="self-host" title="Self-host or hosted?">
        <Callout tone="warn" title="Today this is not fully a choice — the data plane is self-hosted either way">
          <P>
            The gRPC port is bound to loopback in every deployment and the public reverse proxy fronts only the
            dashboard and <C>/api</C>, so there is no hosted address to send <C>Acquire</C> and <C>Report</C> to. What
            hosting covers right now is the control plane and everything built on it. The comparison below is what the
            two options are meant to be; <DocsLink href="/docs/quickstart">Quickstart</DocsLink> is what runs today.
          </P>
        </Callout>
        <P>
          The engine is open source under Apache-2.0 at <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A>: scoring,
          the four states and their transitions, the cooldown curve, lease fencing, the selection strategy, the gRPC
          contract, and a PostgreSQL persistence adapter. Self-hosting is a legitimate choice, and this service does not
          fork the engine — it consumes the published artifact, so what you would run is the same code.
        </P>
        <Table head={["", "Self-hosted engine", "Hosted API"]}>
          <Row>
            <Cell>
              <B>The decision logic</B>
            </Cell>
            <Cell>Yes — identical</Cell>
            <Cell>Yes — identical</Cell>
          </Row>
          <Row>
            <Cell>
              <B>You operate</B>
            </Cell>
            <Cell>The process, PostgreSQL, upgrades, backups</Cell>
            <Cell>Nothing</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Multi-tenant isolation</B>
            </Cell>
            <Cell>You build it</Cell>
            <Cell>Built in — pool, audit trail, and event stream per tenant</Cell>
          </Row>
          <Row>
            <Cell>
              <B>API keys</B>
            </Cell>
            <Cell>You build it</Cell>
            <Cell>Issue, hashed storage, rotation, instant revocation</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Dashboard, audit queries, score curves</B>
            </Cell>
            <Cell>Not included — the trail is write-only upstream</Cell>
            <Cell>Included</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Usage metering and alerting</B>
            </Cell>
            <Cell>You build it</Cell>
            <Cell>Included</Cell>
          </Row>
        </Table>
        <P>
          Rough rule: if you want the behaviour and already run stateful services, self-host. If you want the behaviour
          plus keys, tenancy, an audit trail you can query, and somebody else on call, use the hosted API.
        </P>

        <SubHeading>Can I migrate between them?</SubHeading>
        <P>
          The reputation model is the same either way and the gRPC contract is the engine&apos;s, not ours, so client
          code ports across by changing the address and the auth header. Reputation state does not transfer today —
          pools warm up again from live traffic, which for most workloads takes hours rather than days.
        </P>
      </Section>

      <Section id="bugs" title="Where do I report a bug?">
        <P>
          It depends on which half is wrong, and the split is the same one described in{" "}
          <DocsLink href="/docs">Introduction</DocsLink>.
        </P>
        <SubHeading>Engine behaviour → the public repository</SubHeading>
        <P>
          File it at <A href={`${GITHUB_REPO_URL}/issues`}>PreAgile/reputation-pool</A> if it is about what the engine
          decides:
        </P>
        <Bullets>
          <Bullet>a state transition that fires when it should not, or does not when it should;</Bullet>
          <Bullet>the cooldown curve, the score penalties, or the exponential backoff;</Bullet>
          <Bullet>selection — which candidate gets picked, and how weighting behaves;</Bullet>
          <Bullet>lease semantics: fencing tokens, expiry, renew and release;</Bullet>
          <Bullet>
            the gRPC contract and message shapes in <C>advisor.proto</C>.
          </Bullet>
        </Bullets>
        <P>
          These belong upstream because the fix belongs in code everyone runs, and because the discussion is worth having
          in public. A hosted-only patch would be a fork of the exact logic you are meant to be able to audit.
        </P>
        <SubHeading>Hosting behaviour → us</SubHeading>
        <P>
          Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          if it is about running the service:
        </P>
        <Bullets>
          <Bullet>authentication, API keys, JWTs, the login flow;</Bullet>
          <Bullet>tenant isolation, or seeing anything you should not;</Bullet>
          <Bullet>the REST control plane, the dashboard, metering, or the audit read side;</Bullet>
          <Bullet>availability, latency, deployments.</Bullet>
        </Bullets>
        <Callout tone="warn" title="Security issues: do not open a public issue">
          <P>
            Anything touching tenant isolation, key handling, or authentication goes by email first — for both halves.
            Include what you did, what you saw, and roughly when; do not include a raw API key.
          </P>
        </Callout>
        <P>
          Not sure which side it is? Email us. Misrouting an engine bug costs one forwarded message; sitting on it costs
          more.
        </P>
      </Section>

      <Section id="misc" title="Anything else">
        <SubHeading>Why can I not reach the gRPC data plane on your host?</SubHeading>
        <P>
          Because it is not published. Compose binds port <C>9093</C> to <C>127.0.0.1</C> and the reverse proxy has no
          gRPC route and no TLS termination for one. That binding is also load-bearing: the login throttle trusts{" "}
          <C>X-Forwarded-For</C> on the premise that the app is unreachable except through the proxy, so opening the
          data plane is a redesign of that defence rather than a port change. Until it happens,{" "}
          <DocsLink href="/docs/quickstart">Quickstart</DocsLink> runs the loop against a stack you start, and the
          client code is identical apart from the address and the channel credentials.
        </P>

        <SubHeading>Is there a REST equivalent of Acquire and Report?</SubHeading>
        <P>
          Not today. The data plane is gRPC only — the control plane is REST. If an HTTP data plane is what stands between
          you and using this, tell us; it is a known onboarding cost, not a principled refusal.
        </P>

        <SubHeading>Can I scrape Prometheus metrics?</SubHeading>
        <P>
          The service exposes a Prometheus endpoint, but it is not routed to the public internet — the trust boundary is
          the network, so only in-cluster scrapers reach it. Customer-facing metrics access is not available yet; the
          dashboard and <C>GET /api/usage</C> are the supported views.
        </P>

        <SubHeading>Is there self-serve signup?</SubHeading>
        <P>
          No. Tenants are onboarded by hand today, deliberately — each pool gets set up with someone watching. Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          with a sentence about your workload.
        </P>

        <SubHeading>Are these docs available in Korean?</SubHeading>
        <P>
          Not yet — the docs are English-only for now, while the marketing site is available in both English and Korean.
          Korean documentation is planned.
        </P>
      </Section>

      <DocsPager slug={SLUG} />
    </>
  );
}

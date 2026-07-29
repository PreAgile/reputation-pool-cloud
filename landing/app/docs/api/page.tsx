import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import {
  B,
  Bullet,
  Bullets,
  C,
  Callout,
  Cell,
  CodeBlock,
  DocsLink,
  Endpoint,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "api";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG);

export default function DocsApiPage() {
  return (
    <>
      <PageHeader title={PAGE.title} summary={PAGE.summary} />

      <Section id="conventions" title="Conventions">
        <Bullets>
          <Bullet>
            <B>Base</B> — <C>https://&lt;your-console-host&gt;/api</C>, or <C>http://localhost:8080/api</C> against a
            stack you started yourself. The control plane is served from the same origin as the dashboard, so browser
            tooling needs no CORS setup.
          </Bullet>
          <Bullet>
            <B>Auth</B> — every endpoint except <C>POST /api/auth/login</C> requires{" "}
            <C>Authorization: Bearer &lt;jwt&gt;</C>. API keys do not work here; see{" "}
            <DocsLink href="/docs/authentication">Authentication</DocsLink>.
          </Bullet>
          <Bullet>
            <B>Tenant</B> — scoped reads use the tenant on your token, never a parameter. There is no way to ask for
            another tenant&apos;s data.
          </Bullet>
          <Bullet>
            <B>Times</B> — ISO-8601 instants in UTC. <C>null</C> means &quot;not set&quot; (no cooldown, no expiry, not
            revoked).
          </Bullet>
          <Bullet>
            <B>Errors</B> — RFC 7807 <C>application/problem+json</C>. The curated reason is in <C>detail</C>.
          </Bullet>
        </Bullets>
        <CodeBlock language="json" title="error shape">
          {`{"type":"about:blank","title":"Not Found","status":404,"detail":"resource not found"}`}
        </CodeBlock>
        <Table head={["Status", "When"]}>
          <Row>
            <Cell>
              <C>400</C>
            </Cell>
            <Cell>Malformed input the endpoint validates itself — an unknown resource kind, a corrupt cursor.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>401</C>
            </Cell>
            <Cell>Missing, malformed, or expired token; or wrong login credentials. Log in again.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>403</C>
            </Cell>
            <Cell>
              The token is not bound to a tenant, targets another tenant, or its tenant is suspended/deleted.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>404</C>
            </Cell>
            <Cell>The addressed thing does not exist for your tenant.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>409</C>
            </Cell>
            <Cell>The write conflicts with existing state.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>429</C>
            </Cell>
            <Cell>
              Login throttled. Honour <C>Retry-After</C>.
            </Cell>
          </Row>
        </Table>
        <Callout title="This is the control plane only">
          <P>
            <C>Acquire</C>, <C>Report</C>, <C>Register</C>, <C>Renew</C>, <C>Release</C>, and the live event stream are
            gRPC RPCs on the data plane, not REST endpoints — there is no HTTP gateway in front of them today. See{" "}
            <DocsLink href="/docs/quickstart">Quickstart</DocsLink> for those, and the{" "}
            <a href="#grpc" className="font-medium text-accent hover:underline">
              gRPC summary
            </a>{" "}
            at the bottom of this page.
          </P>
          <P>
            The reverse split matters too: this REST surface is the <B>only</B> plane published to the internet. The
            gRPC port is bound to loopback in every deployment, so the RPCs below are reachable from a stack you run
            yourself and not from a hosted address.
          </P>
        </Callout>
      </Section>

      <Section id="auth" title="Authentication">
        <Endpoint id="post-login" method="POST" path="/api/auth/login">
          <P>Exchanges admin credentials for a control-plane JWT. The only public endpoint under /api.</P>
          <CodeBlock language="json" title="request">
            {`{"username":"admin","password":"…"}`}
          </CodeBlock>
          <CodeBlock language="json" title="200 OK">
            {`{"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}`}
          </CodeBlock>
          <P>
            <B>Errors.</B> <C>401 invalid credentials</C> for a wrong username, a wrong password, <B>and</B> an
            unconfigured console — the three are indistinguishable on purpose. <C>429</C> once this source IP has been
            throttled.
          </P>
        </Endpoint>
      </Section>

      <Section id="pools" title="Pool state">
        <Endpoint id="get-resources" method="GET" path="/api/pools/resources">
          <P>
            KPI summary plus one row per resource your tenant&apos;s pool knows — registered, blocklisted, or merely seen
            in a cell. Rows are ordered by <C>kind</C> then <C>value</C>.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`{
  "summary": {
    "registered": 42,
    "blocklisted": 1,
    "totalCells": 96,
    "cellsByState": {"HEALTHY": 81, "COOLING": 12, "RECOVERING": 3, "BLOCKLISTED": 0}
  },
  "resources": [
    {
      "kind": "PROXY",
      "value": "proxy-1.example.net:8080",
      "registered": true,
      "blocked": false,
      "blockedUntil": null,
      "blockPermanent": false,
      "contexts": 2,
      "state": "COOLING",
      "score": -34.0,
      "recentWindow": [true, true, false, false]
    }
  ]
}`}
          </CodeBlock>
          <P>
            A row aggregates the resource&apos;s cells into a representative rollup, and the rule is
            &quot;surface the weakest context&quot; — that is the one an operator needs to see first:
          </P>
          <Bullets>
            <Bullet>
              <C>state</C> — the worst-severity cell state (<C>BLOCKLISTED</C> &gt; <C>COOLING</C> &gt;{" "}
              <C>RECOVERING</C> &gt; <C>HEALTHY</C>), or <C>BLOCKLISTED</C> outright if the resource is blocked, or{" "}
              <C>HEALTHY</C> if it has no cells yet.
            </Bullet>
            <Bullet>
              <C>score</C> — the lowest score across the cells; <C>null</C> when there are none.
            </Bullet>
            <Bullet>
              <C>recentWindow</C> — success flags (oldest → newest) of the <B>worst-scoring</B> cell&apos;s window; an
              empty array when there are no cells. Severity and worst score are computed independently, so a row can read{" "}
              <C>COOLING</C> while showing the window of whichever context is dragging its score down.
            </Bullet>
            <Bullet>
              <C>contexts</C> — how many cells the resource holds. <C>0</C> means registered but never reported on.
            </Bullet>
            <Bullet>
              <C>blockedUntil</C> — the expiry of a temporary block; <C>null</C> when unblocked <B>or</B> permanent, so
              read it together with <C>blockPermanent</C>.
            </Bullet>
          </Bullets>
        </Endpoint>

        <Endpoint id="get-resource" method="GET" path="/api/pools/resources/{kind}/{value}">
          <P>One resource expanded into its per-context cells, sorted by context.</P>
          <Table head={["Path param", "Values"]}>
            <Row>
              <Cell>
                <C>kind</C>
              </Cell>
              <Cell>
                <C>PROXY</C> · <C>ACCOUNT</C> · <C>SESSION</C> (case-insensitive)
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>value</C>
              </Cell>
              <Cell>The resource value, URL-encoded.</Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "kind": "PROXY",
  "value": "proxy-1.example.net:8080",
  "registered": true,
  "blocked": false,
  "blockedUntil": null,
  "blockPermanent": false,
  "cells": [
    {
      "context": "checkout-us",
      "score": -34.0,
      "consecutiveFailures": 2,
      "consecutiveSuccesses": 0,
      "windowSize": 10,
      "state": "COOLING",
      "cooldownUntil": "2026-07-29T10:41:02Z",
      "updatedAt": "2026-07-29T09:41:02Z"
    },
    {
      "context": "search-eu",
      "score": 35.0,
      "consecutiveFailures": 0,
      "consecutiveSuccesses": 7,
      "windowSize": 10,
      "state": "HEALTHY",
      "cooldownUntil": null,
      "updatedAt": "2026-07-29T09:44:18Z"
    }
  ]
}`}
          </CodeBlock>
          <P>
            <B>Errors.</B> <C>400 invalid resource kind or value</C> for an unknown kind or a blank value.{" "}
            <C>404 resource not found</C> when the pool has never seen this resource — that is, it has no cells, is not
            registered, and is not blocked.
          </P>
        </Endpoint>

        <Endpoint id="get-score-history" method="GET" path="/api/pools/resources/{kind}/{value}/score-history">
          <P>
            The resource&apos;s sampled score curve, one ascending-time series per context. This is what the
            dashboard&apos;s 24-hour chart draws.
          </P>
          <Table head={["Query param", "Default", "Notes"]}>
            <Row>
              <Cell>
                <C>hours</C>
              </Cell>
              <Cell>
                <C>24</C>
              </Cell>
              <Cell>
                How far back to read. Clamped to <C>[1, 720]</C> (30 days), so an out-of-range value is silently
                corrected rather than rejected — and no caller can trigger an unbounded scan.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "contexts": [
    {"context": "checkout-us",
     "points": [{"at":"2026-07-29T08:00:00Z","score":15.0},
                {"at":"2026-07-29T08:01:00Z","score":-15.0}]},
    {"context": "search-eu",
     "points": [{"at":"2026-07-29T08:00:00Z","score":30.0}]}
  ]
}`}
          </CodeBlock>
          <P>
            Scores are sampled on a timer (once a minute), not written on every report, so the curve is a sampled view
            rather than a full history of outcomes. An unknown resource returns <C>200</C> with an empty{" "}
            <C>contexts</C> array — there is simply no series. Samples are retained for seven days; see{" "}
            <DocsLink href="/docs/faq">FAQ</DocsLink>.
          </P>
        </Endpoint>

        <Endpoint id="post-block" method="POST" path="/api/pools/resources/{kind}/{value}/block">
          <P>
            Blocklists a resource — the operator override that isolates it from selection in <B>every</B> context at
            once. Returns <C>204 No Content</C>.
          </P>
          <Table head={["Query param", "Default", "Notes"]}>
            <Row>
              <Cell>
                <C>permanent</C>
              </Cell>
              <Cell>
                <C>false</C>
              </Cell>
              <Cell>
                <C>true</C> blocks with no expiry, released only by an explicit unblock.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>seconds</C>
              </Cell>
              <Cell>
                <C>3600</C>
              </Cell>
              <Cell>
                TTL of a temporary block. Ignored when <C>permanent=true</C>; a zero or negative value falls back to the
                default.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="bash" title="temporary and permanent">
            {`curl -sS -X POST "https://$RP_HOST/api/pools/resources/proxy/proxy-1/block?seconds=7200" \\
  -H "Authorization: Bearer $RP_JWT"

curl -sS -X POST "https://$RP_HOST/api/pools/resources/proxy/proxy-1/block?permanent=true" \\
  -H "Authorization: Bearer $RP_JWT"`}
          </CodeBlock>
          <P>
            The block emits <C>RESOURCE_BLOCKLISTED</C>, so it lands in the audit trail and the live stream with the
            rest of the timeline. Blocking an already-blocked resource replaces the entry. <C>400</C> for an invalid
            kind or value.
          </P>
        </Endpoint>

        <Endpoint id="delete-block" method="DELETE" path="/api/pools/resources/{kind}/{value}/block">
          <P>
            Releases a resource from the blocklist. Returns <C>204 No Content</C>, and emits{" "}
            <C>RESOURCE_UNBLOCKED</C> only if it really was blocked — so unblocking something that is not blocked is a
            harmless no-op rather than a phantom audit entry. <C>400</C> for an invalid kind or value.
          </P>
          <P>
            Releasing does not reset reputation. The resource returns to selection with its cells exactly as they were,
            so a cell that is still cooling stays benched for its own context until its cooldown expires.
          </P>
        </Endpoint>
      </Section>

      <Section id="events" title="Audit events">
        <Endpoint id="get-events" method="GET" path="/api/events">
          <P>
            One page of your tenant&apos;s audit trail, newest first, with keyset (cursor) pagination — the cost of a
            page is flat no matter how far back you have scrolled.
          </P>
          <Table head={["Query param", "Default", "Notes"]}>
            <Row>
              <Cell>
                <C>cursor</C>
              </Cell>
              <Cell>—</Cell>
              <Cell>
                Opaque, URL-safe. Absent means &quot;start at the latest&quot;; otherwise the page immediately older than
                the cursor.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>limit</C>
              </Cell>
              <Cell>
                <C>50</C>
              </Cell>
              <Cell>
                Page size, clamped to <C>[1, 500]</C>.
              </Cell>
            </Row>
          </Table>
          <CodeBlock language="json" title="200 OK">
            {`{
  "events": [
    {"seq": 918, "eventType": "RESOURCE_COOLED", "resourceKind": "PROXY",
     "resourceValue": "proxy-1.example.net:8080", "context": "checkout-us",
     "occurredAt": "2026-07-29T09:41:02Z", "until": "2026-07-29T10:41:02Z", "cause": "BLOCKED"},
    {"seq": 917, "eventType": "RESOURCE_LEASED", "resourceKind": "PROXY",
     "resourceValue": "proxy-1.example.net:8080", "context": "checkout-us",
     "occurredAt": "2026-07-29T09:40:58Z", "until": "2026-07-29T09:41:28Z", "cause": null}
  ],
  "nextCursor": "OTE3"
}`}
          </CodeBlock>
          <Table head={["Field", "Meaning"]}>
            <Row>
              <Cell>
                <C>seq</C>
              </Cell>
              <Cell>The ledger&apos;s total order. Strictly decreasing within and across pages.</Cell>
            </Row>
            <Row>
              <Cell>
                <C>eventType</C>
              </Cell>
              <Cell>
                <C>RESOURCE_LEASED</C> · <C>LEASE_RELEASED</C> · <C>RESOURCE_COOLED</C> · <C>RESOURCE_RECOVERED</C> ·{" "}
                <C>RESOURCE_BLOCKLISTED</C> · <C>RESOURCE_UNBLOCKED</C>
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>context</C>
              </Cell>
              <Cell>
                The cell&apos;s context, or <C>null</C> for resource-level events such as a blocklist change.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>until</C>
              </Cell>
              <Cell>
                Cooldown end, lease expiry, or block expiry depending on the type; <C>null</C> when the type has no
                deadline (or the block is permanent).
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>cause</C>
              </Cell>
              <Cell>
                The <C>FailureType</C> behind a <C>RESOURCE_COOLED</C>; <C>null</C> otherwise.
              </Cell>
            </Row>
            <Row>
              <Cell>
                <C>nextCursor</C>
              </Cell>
              <Cell>
                Pass it back as <C>cursor</C> for the next older page. <C>null</C> means this was the last page.
              </Cell>
            </Row>
          </Table>
          <P>
            <B>Errors.</B> <C>400 invalid cursor</C> for a cursor you did not get from this endpoint. Do not construct
            cursors — the encoding is not part of the contract.
          </P>
          <CodeBlock language="bash" title="walking the whole trail">
            {`cursor=""
while :; do
  page=$(curl -sS "https://$RP_HOST/api/events?limit=500&cursor=$cursor" \\
           -H "Authorization: Bearer $RP_JWT")
  echo "$page" | jq -c '.events[]'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done`}
          </CodeBlock>
        </Endpoint>
      </Section>

      <Section id="usage" title="Usage">
        <Endpoint id="get-usage" method="GET" path="/api/usage">
          <P>
            Your tenant&apos;s metered usage: the last 30 days of granted-lease counts, the current calendar
            month&apos;s total, and the most recently sampled pool size. Days are UTC.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`{
  "monthLeaseTotal": 128400,
  "poolSize": 42,
  "dailyLeases": [
    {"date": "2026-07-28", "count": 5120},
    {"date": "2026-07-29", "count": 3980}
  ]
}`}
          </CodeBlock>
          <P>
            A lease is counted when it is <B>granted</B>, so an <C>Acquire</C> that returned <C>granted: false</C> does
            not count. Counts are accumulated in memory and flushed on a timer (once a minute), so the current day&apos;s
            number trails live traffic slightly. Days with no activity are absent from the array rather than present with
            a zero.
          </P>
        </Endpoint>
      </Section>

      <Section id="api-keys" title="API keys">
        <P>
          All three endpoints take a <C>tenantId</C> path parameter, and it must be the tenant your token is bound to —
          otherwise <C>403 forbidden</C>, checked before existence so the response cannot reveal whether another tenant
          exists. A <C>tenantId</C> that does not exist answers <C>404 tenant not found</C>. Storage, rotation, and
          revocation semantics are in <DocsLink href="/docs/authentication">Authentication</DocsLink>.
        </P>

        <Endpoint id="post-api-key" method="POST" path="/api/tenants/{tenantId}/api-keys">
          <P>
            Mints a data-plane API key. Returns <C>201 Created</C>. The body is optional; omit it for an unlabelled key.
          </P>
          <CodeBlock language="json" title="request (optional)">
            {`{"label":"worker-01"}`}
          </CodeBlock>
          <CodeBlock language="json" title="201 Created">
            {`{
  "id": "5f1c2b40-…",
  "rawToken": "rp_9Q3xK7bT…",
  "label": "worker-01",
  "prefix": "rp_9Q3xK7bT",
  "createdAt": "2026-07-29T09:12:44Z"
}`}
          </CodeBlock>
          <Callout tone="warn" title="rawToken appears here and nowhere else">
            <P>
              Only a SHA-256 digest is stored, so no endpoint can return this value again. Capture it from this response
              or issue a new key.
            </P>
          </Callout>
        </Endpoint>

        <Endpoint id="get-api-keys" method="GET" path="/api/tenants/{tenantId}/api-keys">
          <P>
            All of the tenant&apos;s keys, oldest first — never key material, only the non-secret display prefix. A
            non-null <C>revokedAt</C> means the key no longer authenticates.
          </P>
          <CodeBlock language="json" title="200 OK">
            {`[
  {"id":"5f1c2b40-…","label":"worker-01","prefix":"rp_9Q3xK7bT",
   "createdAt":"2026-07-29T09:12:44Z","revokedAt":null}
]`}
          </CodeBlock>
        </Endpoint>

        <Endpoint id="delete-api-key" method="DELETE" path="/api/tenants/{tenantId}/api-keys/{keyId}">
          <P>
            Revokes an active key by its <C>id</C>. Returns <C>204 No Content</C>. Effective immediately — the next gRPC
            call with that key fails.
          </P>
          <P>
            <B>Errors.</B> <C>404 api key not found</C> covers all three of &quot;unknown id&quot;, &quot;already
            revoked&quot;, and &quot;belongs to another tenant&quot;, without distinguishing them.
          </P>
        </Endpoint>
      </Section>

      <Section id="grpc" title="gRPC data plane, for reference">
        <P>
          Not REST, but listed here so the whole surface is in one place. Service{" "}
          <C>io.github.preagile.reputationpool.grpc.v1.ReputationAdvisor</C>, authenticated with <C>x-api-key</C>
          metadata, served on port <C>9093</C> of the app container — published on <C>127.0.0.1</C> only, so you reach
          it from a stack you started rather than from a hosted hostname. Message shapes and runnable calls are in{" "}
          <DocsLink href="/docs/quickstart">Quickstart</DocsLink>.
        </P>
        <Table head={["RPC", "Request → response", "Notes"]}>
          <Row>
            <Cell>
              <C>Register</C>
            </Cell>
            <Cell>
              <C>ResourceId</C> → empty
            </Cell>
            <Cell>Idempotent. Makes the resource eligible for selection.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Acquire</C>
            </Cell>
            <Cell>
              <C>Context</C> → <C>granted</C>, <C>lease</C>
            </Cell>
            <Cell>
              <C>granted: false</C> with no lease is a normal answer, not an error.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>Report</C>
            </Cell>
            <Cell>
              <C>ResourceId</C>, <C>Context</C>, <C>Outcome</C> → empty
            </Cell>
            <Cell>The only call that moves reputation, and the only one that creates a cell.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Renew</C>
            </Cell>
            <Cell>
              <C>LeaseHandle</C> → <C>renewed</C>, <C>lease</C>
            </Cell>
            <Cell>Refuses a blocklisted resource — the lease then lapses at its TTL.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>Release</C>
            </Cell>
            <Cell>
              <C>LeaseHandle</C> → <C>released</C>
            </Cell>
            <Cell>Only the current holder&apos;s fencing token can release.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>SubscribeEvents</C>
            </Cell>
            <Cell>
              empty → <C>stream PoolEvent</C>
            </Cell>
            <Cell>Live, tenant-scoped. The durable equivalent is <C>GET /api/events</C>.</Cell>
          </Row>
        </Table>
        <SubHeading>gRPC status codes</SubHeading>
        <Table head={["Status", "When"]}>
          <Row>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>Missing, unknown, or revoked key; or the key&apos;s tenant is not active.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>UNAVAILABLE</C>
            </Cell>
            <Cell>Credentials could not be checked (store unreachable). Retryable.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>INVALID_ARGUMENT</C>
            </Cell>
            <Cell>
              Malformed request — an unset <C>kind</C>, a blank resource value, a missing context.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>RESOURCE_EXHAUSTED</C>
            </Cell>
            <Cell>
              The call would create new pool state (a new resource on <C>Register</C>, a new cell on <C>Report</C>) past
              the service-wide budget. Calls that only touch existing state are never affected — see{" "}
              <DocsLink href="/docs/faq">FAQ</DocsLink>.
            </Cell>
          </Row>
        </Table>
      </Section>

      <DocsPager slug={SLUG} />
    </>
  );
}

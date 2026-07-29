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
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "authentication";
const LOCALE = "en";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

export default function DocsAuthenticationPage() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="two-credentials" title="Two credentials, one per plane">
        <Table head={["", "Data plane (gRPC)", "Control plane (REST)"]}>
          <Row>
            <Cell>
              <B>Credential</B>
            </Cell>
            <Cell>API key</Cell>
            <Cell>Admin JWT</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Sent as</B>
            </Cell>
            <Cell>
              <C>x-api-key</C> metadata
            </Cell>
            <Cell>
              <C>Authorization: Bearer …</C>
            </Cell>
          </Row>
          <Row>
            <Cell>
              <B>Lifetime</B>
            </Cell>
            <Cell>Until revoked</Cell>
            <Cell>One hour by default</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Belongs to</B>
            </Cell>
            <Cell>A tenant</Cell>
            <Cell>An admin login, bound to a tenant</Cell>
          </Row>
          <Row>
            <Cell>
              <B>Used by</B>
            </Cell>
            <Cell>Your workers</Cell>
            <Cell>The dashboard and your tooling</Cell>
          </Row>
        </Table>
        <P>
          They are not interchangeable. The gRPC server runs its own interceptor on its own port and never looks at{" "}
          <C>Authorization</C>; the servlet security chain never looks at <C>x-api-key</C>. Sending the wrong one is
          indistinguishable from sending nothing.
        </P>
        <Callout tone="warn" title="Where each credential is usable today">
          <P>
            The admin JWT works against the hosted control plane. The API key works against a gRPC port that is bound to
            loopback in every deployment, so today it authenticates calls to a stack you run yourself — see{" "}
            <DocsLink slug="quickstart" locale={LOCALE}>Quickstart</DocsLink>. Everything below about issuing, storage, rotation,
            and revocation is the same in both cases; keys are minted through the control plane either way.
          </P>
        </Callout>
      </Section>

      <Section id="api-keys" title="API keys">
        <SubHeading>Issuing</SubHeading>
        <P>
          Keys are minted per tenant, either from the dashboard&apos;s API keys screen or with{" "}
          <C>POST /api/tenants/&#123;tenantId&#125;/api-keys</C>. An optional <C>label</C> lets you tell them apart later
          (&quot;worker-01&quot;, &quot;staging&quot;) — it is not part of the credential.
        </P>
        <CodeBlock language="json" title="201 Created — the only response that contains rawToken">
          {`{
  "id": "5f1c2b40-…",
  "rawToken": "rp_9Q3xK7bT…",
  "label": "worker-01",
  "prefix": "rp_9Q3xK7bT",
  "createdAt": "2026-07-29T09:12:44Z"
}`}
        </CodeBlock>

        <SubHeading>Format and storage</SubHeading>
        <P>
          A raw key is <C>rp_</C> followed by the base64url encoding of 256 random bits from a cryptographic RNG. The{" "}
          <C>rp_</C> prefix namespaces it and makes an accidental leak greppable in logs and repositories.
        </P>
        <P>What is persisted is deliberately not enough to authenticate with:</P>
        <Bullets>
          <Bullet>
            <B>the SHA-256 digest</B> of the raw key — the lookup hashes what you send and compares digests, so the raw
            key is never stored or compared in the clear;
          </Bullet>
          <Bullet>
            <B>a display prefix</B> (<C>rp_</C> + 8 characters) — non-secret, and the only thing listings ever show;
          </Bullet>
          <Bullet>the label, creation time, and revocation time.</Bullet>
        </Bullets>
        <Callout title="Why SHA-256 and not a password KDF">
          <P>
            bcrypt/argon2 exist to make <B>low-entropy</B> secrets expensive to guess. An API key here is 256 bits of
            randomness, so brute-forcing it is infeasible regardless of hash speed — a KDF would only add latency to
            every single gRPC call while buying nothing. Passwords and high-entropy tokens are different problems.
          </P>
        </Callout>

        <SubHeading>The raw key is shown exactly once</SubHeading>
        <P>
          Because only a digest is kept, there is no operation anywhere that can return a key&apos;s value again — not
          the API, not the dashboard, not the database. If you lose it, you issue a new one. Listing keys is therefore
          safe by construction: it cannot leak key material even to a legitimate admin.
        </P>
        <CodeBlock language="json" title="GET …/api-keys — no key material, ever">
          {`[
  {"id":"5f1c2b40-…","label":"worker-01","prefix":"rp_9Q3xK7bT",
   "createdAt":"2026-07-29T09:12:44Z","revokedAt":null},
  {"id":"a08e77c1-…","label":"laptop","prefix":"rp_LmN4pQr8",
   "createdAt":"2026-06-02T11:40:10Z","revokedAt":"2026-07-01T08:00:00Z"}
]`}
        </CodeBlock>

        <SubHeading>Rotation</SubHeading>
        <P>
          There is no &quot;rotate&quot; operation, and that is intentional — rotation is issue-then-revoke, which is
          also the only sequence with no window where nothing works:
        </P>
        <Bullets>
          <Bullet>Issue a new key. Both keys are now valid.</Bullet>
          <Bullet>Roll the new key out to your workers and confirm traffic is flowing on it.</Bullet>
          <Bullet>Revoke the old key by its <C>id</C>.</Bullet>
        </Bullets>
        <P>
          Give each deployment unit its own labelled key. Then rotating one worker, or revoking a key that leaked from
          one machine, does not interrupt the others.
        </P>

        <SubHeading>Revocation is immediate</SubHeading>
        <P>
          <C>DELETE /api/tenants/&#123;tenantId&#125;/api-keys/&#123;keyId&#125;</C> stamps the key as revoked. The
          gRPC lookup only ever considers keys with no revocation timestamp, so the key stops working on its very next
          call — there is no cache to wait out. Revoking an already-revoked or unknown key answers <C>404</C>, without
          revealing which of the two it was.
        </P>

        <SubHeading>What a rejected call looks like</SubHeading>
        <Table head={["Situation", "gRPC status", "Why"]}>
          <Row>
            <Cell>No key, unknown key, or revoked key</Cell>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>All three are answered identically — the response never reveals whether a key exists.</Cell>
          </Row>
          <Row>
            <Cell>Key belongs to a suspended or deleted tenant</Cell>
            <Cell>
              <C>UNAUTHENTICATED</C>
            </Cell>
            <Cell>
              The lookup additionally requires an active tenant, so a frozen tenant&apos;s traffic stops even though its
              keys are still unrevoked.
            </Cell>
          </Row>
          <Row>
            <Cell>The key store is unreachable</Cell>
            <Cell>
              <C>UNAVAILABLE</C>
            </Cell>
            <Cell>
              An outage must not masquerade as bad credentials: <C>UNAVAILABLE</C> is diagnosable and retryable, a false{" "}
              <C>UNAUTHENTICATED</C> would send you hunting for a key problem that does not exist.
            </Cell>
          </Row>
        </Table>
      </Section>

      <Section id="jwt" title="The dashboard session (admin JWT)">
        <P>
          The control plane is token-only and stateless: no server session, no login cookie, and therefore no CSRF token
          — there is nothing ambient for a cross-site request to ride on. You exchange credentials for a JWT once and
          attach it to each request.
        </P>
        <CodeBlock language="bash" title="POST /api/auth/login — the one public control-plane endpoint">
          {`curl -sS -X POST "https://$RP_HOST/api/auth/login" \\
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"…"}'

# {"token":"eyJhbGciOiJIUzI1NiJ9…","tokenType":"Bearer","expiresInSeconds":3600}`}
        </CodeBlock>
        <P>The token is HS256-signed by the service and carries two claims that matter:</P>
        <Bullets>
          <Bullet>
            <C>sub</C> — the admin username.
          </Bullet>
          <Bullet>
            <C>tenant</C> — <B>the tenant boundary every scoped read is evaluated against.</B> Server-decided at login;
            never taken from a query parameter, a header, or a request body.
          </Bullet>
        </Bullets>
        <P>
          That last point is the tenancy rule in one line: pool reads, the events feed, and usage are all scoped to the
          token&apos;s own <C>tenant</C> claim, so there is no request shape that can point them at another tenant. A
          token with no <C>tenant</C> claim is rejected rather than defaulted.
        </P>

        <SubHeading>Cross-tenant requests fail closed, and quietly</SubHeading>
        <P>
          Key management takes a <C>tenantId</C> in the path. If it is not the tenant your token is bound to, the answer
          is <C>403 forbidden</C> — and that check runs <B>before</B> the &quot;does this tenant exist&quot; check, so a
          403-versus-404 difference cannot be used to probe which tenants exist.
        </P>

        <SubHeading>Login is rate-limited per source IP</SubHeading>
        <P>
          v1 has a single admin account, so locking &quot;the account&quot; after failed attempts would be a
          self-inflicted outage. The limiter blocks the <B>source IP</B> instead: five failed attempts in fifteen minutes
          block that IP for fifteen minutes, answered with <C>429</C> and a <C>Retry-After</C> header. A successful login
          clears that IP&apos;s counter, and a global per-second cap sits behind it as a backstop against attempts spread
          across many addresses.
        </P>
        <Callout tone="warn" title="Login failures are deliberately uninformative">
          <P>
            A wrong username, a wrong password, and an unconfigured console are all a bare <C>401 invalid credentials</C>
            . Credentials are also compared in constant time, so response timing cannot tell you which field was right.
            Do not build retry logic that branches on the reason — there is only one.
          </P>
        </Callout>

        <SubHeading>Expiry</SubHeading>
        <P>
          Tokens last one hour by default and there is no refresh endpoint: when the token expires, every call answers{" "}
          <C>401</C> and you log in again. Scripts that run longer than an hour should re-login on <C>401</C> rather than
          assume a token is good for the whole run. The dashboard does exactly this, sending you back to the login screen.
        </P>
      </Section>

      <Section id="checklist" title="Operational checklist">
        <Bullets>
          <Bullet>One labelled API key per deployment unit — not one shared key for the fleet.</Bullet>
          <Bullet>Keys go straight into your secret store from the issue response; nothing else can read them back.</Bullet>
          <Bullet>Rotate by issuing first and revoking second, so there is no gap.</Bullet>
          <Bullet>
            Never put a key in a URL. It belongs in the <C>x-api-key</C> metadata header, which does not end up in access
            logs or referrers.
          </Bullet>
          <Bullet>
            Treat <C>UNAUTHENTICATED</C> as terminal (fix the key) and <C>UNAVAILABLE</C> as retryable (back off).
          </Bullet>
        </Bullets>
        <P>
          Next: <DocsLink slug="api" locale={LOCALE}>REST API reference</DocsLink> for the endpoints these credentials open.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}

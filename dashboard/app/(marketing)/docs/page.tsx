import type { Metadata } from "next";
import { DocsPager } from "@/components/docs/docs-pager";
import { A, B, Bullet, Bullets, C, Callout, DocsLink, P, PageHeader, Section } from "@/components/docs/prose";
import { CONTACT_EMAIL, GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG);

export default function DocsIntroPage() {
  return (
    <>
      <PageHeader title={PAGE.title} summary={PAGE.summary} />

      <Section id="what-it-is" title="What this is">
        <P>
          reputation·pool is a hosted reputation API for pools of interchangeable resources — proxies, accounts,
          sessions. You register the resources you own, ask the pool for one whenever you need it, and report what
          happened when you are done. In exchange, the pool stops handing out resources that keep failing, benches them
          for a cooldown, eases them back in when they look healthy again, and records every one of those decisions.
        </P>
        <P>
          That loop is the whole product surface. There are three calls you will use constantly — <C>Register</C>,{" "}
          <C>Acquire</C>, <C>Report</C> — and a REST control plane for everything around them: keys, pool state, the
          audit trail, usage.
        </P>
      </Section>

      <Section id="when-to-use" title="When to reach for it">
        <P>
          The signal is simple: you already have, or are about to write, code that decides <B>which</B> resource to use
          next and <B>when to stop using</B> one. That code always grows the same way — a cooldown map, then a blocklist,
          then per-endpoint exceptions, then a way to see why something was benched.
        </P>
        <Bullets>
          <Bullet>
            <B>Scraping / data-collection infrastructure</B> rotating a proxy pool, where a burned proxy silently ruins a
            run instead of failing loudly.
          </Bullet>
          <Bullet>
            <B>Account-based automation</B> where a ban or a rate-limit on one account has to take that account out of
            rotation without taking the rest with it.
          </Bullet>
          <Bullet>
            <B>Any pool with per-destination health</B> — the same resource can be perfectly fine for one target and
            burned for another. That distinction is the core of the model; see{" "}
            <DocsLink href="/docs/concepts">Concepts</DocsLink>.
          </Bullet>
        </Bullets>
        <P>
          It is a poor fit if your pool has one member, if resources are not interchangeable, or if you need routing
          decisions made from request payloads rather than from observed outcomes. The pool only knows what you report.
        </P>
      </Section>

      <Section id="two-planes" title="Two planes, two credentials">
        <P>
          The service is split by traffic shape, and the split matters because the two halves authenticate differently.
        </P>
        <Bullets>
          <Bullet>
            <B>Data plane (gRPC).</B> <C>Register</C>, <C>Acquire</C>, <C>Report</C>, <C>Renew</C>, <C>Release</C>,{" "}
            <C>SubscribeEvents</C> on the <C>ReputationAdvisor</C> service. This is the hot path your workers call.
            Authenticated with an API key in the <C>x-api-key</C> metadata header.
          </Bullet>
          <Bullet>
            <B>Control plane (REST).</B> <C>/api/**</C> — read pool state, read the audit trail, read usage, manage API
            keys. This is what the dashboard runs on and what your tooling scripts against. Authenticated with an admin
            JWT in the <C>Authorization: Bearer</C> header.
          </Bullet>
        </Bullets>
        <P>
          Both are documented here: <DocsLink href="/docs/quickstart">Quickstart</DocsLink> walks the data-plane loop,{" "}
          <DocsLink href="/docs/api">REST API reference</DocsLink> covers the control plane, and{" "}
          <DocsLink href="/docs/authentication">Authentication</DocsLink> explains which credential belongs where.
        </P>
      </Section>

      <Section id="open-core" title="Hosted API vs the open-source engine">
        <P>
          The decision engine is open source. Scoring, the four states and the transitions between them, the cooldown
          curve, lease fencing, and the selection strategy all live in{" "}
          <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A> under Apache-2.0, and this service consumes it as a
          published dependency rather than a fork. Everything a paragraph in{" "}
          <DocsLink href="/docs/concepts">Concepts</DocsLink> says about behaviour is behaviour you can read the source
          of, and reproduce by self-hosting.
        </P>
        <P>What the hosted service adds is everything around the engine:</P>
        <Bullets>
          <Bullet>Multi-tenant isolation — one pool, audit trail, and event stream per tenant.</Bullet>
          <Bullet>API keys: issuing, hashed storage, rotation, immediate revocation.</Bullet>
          <Bullet>A durable audit trail with a query surface, plus a reputation-score time series.</Bullet>
          <Bullet>Usage metering, the dashboard, alerting, and running the thing.</Bullet>
        </Bullets>
        <Callout title="Why this matters for trust, not just licensing">
          <P>
            The part that decides whether your proxy gets benched for an hour is the part you can audit. If you disagree
            with the cooldown curve, you can read exactly what it is, open an issue against the engine, or run your own
            copy. See <DocsLink href="/docs/faq">FAQ</DocsLink> for where to file which kind of bug.
          </P>
        </Callout>
      </Section>

      <Section id="next" title="Where to go next">
        <Bullets>
          <Bullet>
            <DocsLink href="/docs/quickstart">Quickstart</DocsLink> — key to first <C>Report</C>, with curl, Java, and
            TypeScript.
          </Bullet>
          <Bullet>
            <DocsLink href="/docs/concepts">Concepts</DocsLink> — the model: resources, contexts, cells, states.
          </Bullet>
          <Bullet>
            <DocsLink href="/docs/api">REST API reference</DocsLink> — every control-plane endpoint and its errors.
          </Bullet>
        </Bullets>
        <P>
          Access is still onboarded by hand — there is no self-serve signup yet. Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and we will set up your tenant and a first key.
        </P>
      </Section>

      <DocsPager slug={SLUG} />
    </>
  );
}

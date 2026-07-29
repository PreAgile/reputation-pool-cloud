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
  CodeBlock,
  DocsLink,
  P,
  PageHeader,
  Row,
  Section,
  SubHeading,
  Table,
} from "@/components/docs/prose";
import { GITHUB_REPO_URL } from "@/components/marketing/constants";
import { docsMetadata, docsPage } from "@/lib/docs-manifest";

const SLUG = "concepts";
const LOCALE = "en";
const PAGE = docsPage(SLUG)!;

export const metadata: Metadata = docsMetadata(SLUG, LOCALE);

export default function DocsConceptsPage() {
  return (
    <>
      <PageHeader title={PAGE.title[LOCALE]} summary={PAGE.summary[LOCALE]} />

      <Section id="resource" title="Resource">
        <P>
          A resource is one interchangeable member of your pool, identified by a <C>kind</C> and a <C>value</C>:
        </P>
        <Bullets>
          <Bullet>
            <C>kind</C> — <C>PROXY</C>, <C>ACCOUNT</C>, or <C>SESSION</C>.
          </Bullet>
          <Bullet>
            <C>value</C> — an opaque string that you choose and that means something to you: a proxy endpoint, an account
            id, a session handle. The pool never parses it.
          </Bullet>
        </Bullets>
        <P>
          The pair is the identity. <C>PROXY</C>/<C>proxy-1</C> and <C>ACCOUNT</C>/<C>proxy-1</C> are two different
          resources. Registering is idempotent, so calling <C>Register</C> on every worker boot is the normal pattern.
        </P>
      </Section>

      <Section id="context" title="Context">
        <P>
          A context is a string naming <B>what the resource is being used for</B> — <C>checkout-us</C>, <C>search-eu</C>,{" "}
          <C>login-jp</C>. You pass it to <C>Acquire</C> and to <C>Report</C>, and it is the second half of every
          reputation lookup.
        </P>
        <P>
          Contexts are free-form and created on first use; there is no registration step. Choose them so that{" "}
          <B>one context is one thing that can burn a resource independently</B> — usually a destination, a tenant of
          yours, or a workload. Too coarse (<C>default</C> for everything) and one bad destination benches a resource for
          all of them. Too fine (one per request) and no cell ever accumulates enough history to be useful, plus every
          new cell counts against the pool&apos;s cell budget.
        </P>
      </Section>

      <Section id="cell" title="ReputationCell — the (resource × context) pair">
        <P>
          Reputation is not stored per resource. It is stored per <B>resource × context</B> pair, and that pair is called
          a reputation cell. One resource holds as many cells as the contexts it has been used in, each with its own
          score, its own streaks, and its own cooldown.
        </P>
        <Table head={["Field", "Meaning"]}>
          <Row>
            <Cell>
              <C>score</C>
            </Cell>
            <Cell>
              Continuous reputation in <C>[-100, 100]</C>, starting at <C>0.0</C>. Moves on every reported outcome and
              weights selection.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>state</C>
            </Cell>
            <Cell>
              <C>HEALTHY</C> · <C>COOLING</C> · <C>RECOVERING</C> · <C>BLOCKLISTED</C> — the gate that decides whether
              this cell can be handed out.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>consecutiveFailures</C>
            </Cell>
            <Cell>Failure streak. Reaching the cool threshold is what starts a cooldown.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>consecutiveSuccesses</C>
            </Cell>
            <Cell>Success streak. Reaching the recover threshold is what ends probation.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>windowSize</C>
            </Cell>
            <Cell>
              How many recent outcomes are retained (10 by default). The streak counters are unbounded running values;
              the window is the bounded recent history.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>cooldownUntil</C>
            </Cell>
            <Cell>
              When the current cooldown expires, or <C>null</C> when the cell is not cooling.
            </Cell>
          </Row>
          <Row>
            <Cell>
              <C>updatedAt</C>
            </Cell>
            <Cell>When the last outcome was applied to this cell.</Cell>
          </Row>
        </Table>
        <P>
          A cell is created by <C>Report</C>, never by <C>Acquire</C>. That is why a freshly registered resource shows{" "}
          <C>contexts: 0</C> in the dashboard until you report on it: <C>Acquire</C> scores a candidate against a
          transient, never-persisted fresh cell, so a resource nobody has reported on is treated as neutral and{" "}
          <C>HEALTHY</C> — new resources are selectable immediately rather than having to earn their way in.
        </P>

        <SubHeading>Why per context is the whole point</SubHeading>
        <P>
          Take one proxy and two destinations. The proxy gets hard-blocked by the checkout endpoint but keeps working
          perfectly against search. With reputation stored per resource, that single block is a fact about the proxy, so
          you either lose a working proxy for search or keep feeding a burned proxy to checkout. Both are wrong, and
          which one you get depends on a threshold you had to guess.
        </P>
        <CodeBlock language="text" title="one proxy, two independent cells">
          {`PROXY proxy-1.example.net:8080
├─ context "checkout-us"  score -34.0  state COOLING    cooldownUntil 10:41:02
└─ context "search-eu"    score  35.0  state HEALTHY    cooldownUntil null

Acquire("search-eu")   → may return proxy-1   (its search-eu cell is healthy)
Acquire("checkout-us") → will not return it   (its checkout-us cell is cooling)`}
        </CodeBlock>
        <P>
          With cells, the block is a fact about <B>this proxy in this context</B>. The proxy keeps serving search at full
          throughput while checkout routes around it, and it re-earns checkout on its own. Nothing in your code has to
          model that — you only ever report per context, and the isolation falls out of the key.
        </P>
        <Callout title="One exception, on purpose: the blocklist">
          <P>
            Cooling is per cell; the <B>blocklist is per resource</B>. An operator blocklisting a proxy isolates it from
            every context at once, because &quot;this resource must not be used&quot; is a decision about the resource,
            not about one destination. That asymmetry is deliberate — see{" "}
            <a href="#blocklist" className="font-medium text-accent hover:underline">
              Blocklist
            </a>{" "}
            below.
          </P>
        </Callout>
      </Section>

      <Section id="states" title="The four states">
        <Table head={["State", "Selectable?", "Meaning"]}>
          <Row>
            <Cell>
              <C>HEALTHY</C>
            </Cell>
            <Cell>Yes</Cell>
            <Cell>Trusted. The normal state.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>COOLING</C>
            </Cell>
            <Cell>No</Cell>
            <Cell>Benched until its cooldown expires.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>RECOVERING</C>
            </Cell>
            <Cell>Yes</Cell>
            <Cell>On probation — handed out again, but still proving itself.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>BLOCKLISTED</C>
            </Cell>
            <Cell>No</Cell>
            <Cell>Isolated until explicitly released. Never left by traffic alone.</Cell>
          </Row>
        </Table>
        <CodeBlock language="text" title="the normal cycle">
          {`                 consecutiveFailures >= coolAfter (2)
   ┌───────────┐ ───────────────────────────────────▶ ┌───────────┐
   │  HEALTHY  │                                      │  COOLING  │
   └───────────┘ ◀─────────────────────┐              └───────────┘
        ▲                              │                    │
        │ consecutiveSuccesses         │                    │ cooldown expired,
        │ >= recoverAfter (2)          │                    │ then one success
        │                        ┌────────────┐ ◀───────────┘
        └──────────────────────  │ RECOVERING │
                                 └────────────┘

   BLOCKLISTED is reachable from any state via an operator block, and is left
   only by unblock or block expiry — never by reported outcomes.`}
        </CodeBlock>

        <SubHeading>Cooling: what a failure actually does</SubHeading>
        <P>
          Every reported failure lowers the score and increments the failure streak. Only when the streak reaches the
          cool threshold (<C>2</C> by default) does the cell move to <C>COOLING</C> — a single blip does not bench a
          healthy resource. The penalty and the cooldown length both depend on the failure type you report:
        </P>
        <Table head={["FailureType", "Score penalty", "Base cooldown", "Use it for"]}>
          <Row>
            <Cell>
              <C>BLOCKED</C>
            </Cell>
            <Cell>30</Cell>
            <Cell>1 h</Cell>
            <Cell>An active block: 403, captcha wall, ban page.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>TLS_HANDSHAKE</C>
            </Cell>
            <Cell>15</Cell>
            <Cell>5 min</Cell>
            <Cell>TLS negotiation failed — often interception or a dead endpoint.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>CONNECTION_RESET</C>
            </Cell>
            <Cell>10</Cell>
            <Cell>2 min</Cell>
            <Cell>Connection dropped mid-flight.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>TIMEOUT</C>
            </Cell>
            <Cell>5</Cell>
            <Cell>1 min</Cell>
            <Cell>No response in time.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>SLOW</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>30 s</Cell>
            <Cell>Completed, but too slowly to be worth using.</Cell>
          </Row>
        </Table>
        <P>
          The cooldown is that base doubled for each consecutive failure, capped at 64× —{" "}
          <C>base(type) × 2^min(consecutiveFailures - 1, 6)</C>. So a proxy that keeps getting blocked goes 1 h, 2 h,
          4 h… rather than being retried every hour forever, while a merely slow one starts at 30 s.
        </P>
        <Callout tone="warn" title="Report the type honestly">
          <P>
            <C>BLOCKED</C> is 15× the penalty and 120× the cooldown of <C>SLOW</C>. Mapping every error to{" "}
            <C>BLOCKED</C> because it is the obvious one will empty your pool; mapping everything to <C>SLOW</C> will
            keep handing out burned resources. The failure type is the main tuning knob you actually control.
          </P>
        </Callout>
        <P>
          While a cooldown is still running, further failures keep moving the score but <B>do not</B> restart the
          cooldown or re-emit the cooling event — a late-arriving result belongs to the incident already being punished,
          not to a new one. That is what stops one bad minute from turning into an exponentially growing bench.
        </P>

        <SubHeading>Recovery: how a cell earns its way back</SubHeading>
        <P>
          Recovery is success-driven, not just time-driven. Once the cooldown has expired, the cell is not silently
          healthy again — the next reported success moves it to <C>RECOVERING</C>, and the success streak restarts from
          that moment, so successes you happened to report while it was still cooling cannot shortcut probation. After{" "}
          <C>recoverAfter</C> consecutive successes (<C>2</C> by default) it is promoted back to <C>HEALTHY</C> and a{" "}
          <C>ResourceRecovered</C> event is emitted.
        </P>
        <P>
          <C>RECOVERING</C> is selectable, which is the point: probation means &quot;back in rotation, being watched&quot;,
          not &quot;waiting on the bench&quot;. A single failure during probation resets the success streak and, at the
          cool threshold, benches it again.
        </P>
      </Section>

      <Section id="score" title="Score and how selection uses it">
        <P>
          Score is a continuous value in <C>[-100, 100]</C>, clamped at both ends. A success adds <C>5</C>; a failure
          subtracts the penalty for its type. It is a separate signal from state: state decides <B>whether</B> a cell can
          be handed out, score decides <B>how likely</B> it is to be chosen among those that can.
        </P>
        <P>
          Selection is a score-weighted random choice, not &quot;always the best&quot;. Each eligible candidate&apos;s
          weight is <C>(score − lowestScoreAmongCandidates) + 1.0</C>, so higher scores win more often but every eligible
          candidate keeps a nonzero chance. Two things follow, both deliberate: load spreads across the healthy pool
          instead of hammering the single best resource, and the weakest eligible candidate still gets an occasional turn
          — which is how a resource on the edge of recovery gets re-probed instead of starving forever.
        </P>
        <Callout title="Weights are relative to the candidates, not to the absolute scale">
          <P>
            Among an already-eligible set, what matters is which are better than the others <B>right now</B>. A pool
            where everything sits at <C>-40</C> distributes exactly like a pool where everything sits at <C>+40</C>.
          </P>
        </Callout>
      </Section>

      <Section id="blocklist" title="Blocklist">
        <P>
          The blocklist is the operator override, and unlike everything above it is keyed by <B>resource</B>, not by
          cell. Blocking isolates a resource from selection in every context at once; the engine will never put it into
          or take it out of that set on its own.
        </P>
        <Bullets>
          <Bullet>
            <B>Temporary</B> — <C>POST …/block?seconds=3600</C>. Expires on its own.
          </Bullet>
          <Bullet>
            <B>Permanent</B> — <C>POST …/block?permanent=true</C>. Released only by an explicit unblock.
          </Bullet>
          <Bullet>
            <B>Release</B> — <C>DELETE …/block</C>, which emits <C>RESOURCE_UNBLOCKED</C>.
          </Bullet>
        </Bullets>
        <P>
          A block also beats an in-flight acquire: if a resource is blocked between being picked and the lease being
          claimed, the claim is undone rather than honoured — a <C>block</C> call that has already returned can never be
          bypassed. And <C>Renew</C> refuses to extend a lease on a blocklisted resource, so an existing hold lapses at
          its TTL instead of being kept alive.
        </P>
        <P>
          Because <C>BLOCKLISTED</C> is terminal for the engine, reported outcomes on a blocklisted resource still move
          the score and window — evidence for a later release decision — but cannot change its state.
        </P>
      </Section>

      <Section id="leases" title="Leases">
        <P>
          <C>Acquire</C> does not just recommend a resource, it <B>leases</B> it: an exclusive hold for one context,
          valid for 30 seconds by default. While a resource is leased, no other <C>Acquire</C> will hand it out — even
          for a different context — so two workers never share one proxy by accident.
        </P>
        <Bullets>
          <Bullet>
            <C>Renew</C> extends the lease by another TTL. Use it when your work outlives the window.
          </Bullet>
          <Bullet>
            <C>Release</C> hands the resource back immediately. Not required for correctness — expiry is the safety net —
            but releasing promptly is what keeps the pool busy instead of waiting out TTLs.
          </Bullet>
          <Bullet>
            The lease carries a monotonically increasing <B>fencing token</B>. <C>Renew</C> and <C>Release</C> act only
            for the current holder, so a worker whose lease already expired and was re-acquired by someone else cannot
            disturb the new lease.
          </Bullet>
        </Bullets>
        <P>
          Leases are runtime coordination, not durable state: they are not included in the pool snapshot, so nothing is
          held immediately after a restart.
        </P>
      </Section>

      <Section id="events" title="Events">
        <P>
          Every decision above is emitted as an event, both to the live gRPC <C>SubscribeEvents</C> stream and to the
          durable audit trail that <C>GET /api/events</C> reads. The event types you will see:{" "}
          <C>RESOURCE_LEASED</C>, <C>LEASE_RELEASED</C>, <C>RESOURCE_COOLED</C> (with the causing failure type and the
          cooldown end), <C>RESOURCE_RECOVERED</C>, <C>RESOURCE_BLOCKLISTED</C>, <C>RESOURCE_UNBLOCKED</C>. An acquire
          that found nothing eligible is reported on the live stream as <C>AcquisitionRejected</C>.
        </P>
      </Section>

      <Section id="defaults" title="Defaults in one place">
        <Table head={["Knob", "Default", "What it controls"]}>
          <Row>
            <Cell>
              <C>windowSize</C>
            </Cell>
            <Cell>10</Cell>
            <Cell>Recent outcomes retained per cell.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>coolAfter</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>Consecutive failures before cooling.</Cell>
          </Row>
          <Row>
            <Cell>
              <C>recoverAfter</C>
            </Cell>
            <Cell>2</Cell>
            <Cell>Consecutive successes to leave probation.</Cell>
          </Row>
          <Row>
            <Cell>lease TTL</Cell>
            <Cell>30 s</Cell>
            <Cell>How long an acquired lease stays valid.</Cell>
          </Row>
          <Row>
            <Cell>cooldown backoff cap</Cell>
            <Cell>64× base</Cell>
            <Cell>Ceiling on exponential cooldown growth.</Cell>
          </Row>
          <Row>
            <Cell>score range</Cell>
            <Cell>−100 … 100</Cell>
            <Cell>Clamp on the continuous reputation value.</Cell>
          </Row>
        </Table>
        <P>
          These are the hosted deployment&apos;s values, and they mirror the engine&apos;s reference defaults. Every rule
          on this page — the penalties, the backoff curve, the transition conditions, the selection weights — is
          implemented in the open-source engine at <A href={GITHUB_REPO_URL}>PreAgile/reputation-pool</A>, so you can
          read the source rather than take this page&apos;s word for it. Next:{" "}
          <DocsLink slug="authentication" locale={LOCALE}>Authentication</DocsLink>.
        </P>
      </Section>

      <DocsPager slug={SLUG} locale={LOCALE} />
    </>
  );
}

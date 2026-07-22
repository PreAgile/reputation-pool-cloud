import type { Dict } from "./dictionary";

/** 인라인 코드 강조(악센트) — body ReactNode 안에서 재사용. */
const C = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[0.92em] text-accent">{children}</code>
);

/** 영어 사전(기본 로케일). 기존 하드코딩 문자열을 그대로 이전한다. */
export const en: Dict = {
  meta: {
    title: "reputation·pool — The reputation API for proxy & account pools",
    description:
      "Stop hand-rolling cooldowns, blocklists, and lease logic. Grab the healthiest resource and report what happened — a verified open-source engine keeps the pool healthy for you.",
  },

  a11y: { enlarge: "Enlarge screenshot", closeDialog: "Close" },

  nav: {
    links: { features: "Features", how: "How it works", docs: "Docs" },
    getStarted: "Get started",
    github: "GitHub",
    openSource: "open source",
    home: "reputation·pool home",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    language: "Language",
  },

  hero: {
    badge: "Reputation infrastructure for your resource pools",
    title: "The reputation API for proxy & account pools.",
    bodyLead: "Stop hand-rolling cooldowns, blocklists, and lease logic.",
    bodyBold: "Grab the healthiest resource and report what happened",
    bodyTail: "— a verified open-source engine keeps the pool healthy for you.",
    ctaPrimary: "Get started",
    ctaSecondary: "Read the docs",
    footnote: "Powered by a fully open-source, formally-tested engine",
  },

  trust: {
    heading: "Trust comes from the engine, not logos",
    items: [
      { title: "Open source", sub: "the whole engine, on GitHub" },
      { title: "Lincheck", sub: "concurrency proven correct" },
      { title: "Mutation-tested", sub: "tests that catch real bugs" },
      { title: "Audit trail", sub: "every decision on record" },
    ],
  },

  features: {
    label: "Why teams switch",
    heading: "Bad resources step aside — you just use the healthy ones.",
    items: [
      {
        kicker: "Automatic cooldown & recovery",
        title: "Failing resources step aside, then earn their way back.",
        body: "Just report what happened. When a resource keeps failing, the engine benches it for a cooldown and takes it out of rotation — then eases it back in over time to check whether it's healthy again. So a bad proxy fixes itself instead of ruining your run.",
        alt: "reputation-pool dashboard — pool overview: per-resource state, score and recent verdicts",
      },
      {
        kicker: "Per-context isolation",
        title: "A problem in one place never spreads to another.",
        body: (
          <>
            Reputation is tracked per <C>resource × context</C> — its own cell. If <C>checkout-us</C> goes bad on a
            proxy, <C>search-eu</C> on that same proxy is untouched — each context keeps its own health and cooldown.
          </>
        ),
        alt: "reputation-pool dashboard — resource detail: per-context reputation curve",
      },
      {
        kicker: "Real-time dashboard",
        title: "Watch every hand-out, cooldown, and recovery live.",
        body: (
          <>
            Pool status, reputation curves, and a live event stream — at a glance, with no SQL and no guessing. Metrics
            also ship to <C>/actuator/prometheus</C>, straight into your own Grafana.
          </>
        ),
        alt: "reputation-pool dashboard — live event stream of leases, cools and recoveries",
      },
    ],
  },

  caps: {
    label: "Everything included",
    heading: "Built for real automation infrastructure.",
    intro:
      "No add-ons, no paywalled basics — everything a serious workload needs is here from day one.",
    items: [
      {
        title: "gRPC & REST",
        body: "One engine, two ways in — gRPC for the fast path, REST for your tooling.",
      },
      {
        title: "Live event stream",
        body: "Subscribe to every hand-out, cooldown, block, and recovery the moment it happens.",
      },
      {
        title: "Prometheus metrics",
        body: (
          <>
            Scrape <C>/actuator/prometheus</C> straight into your own Grafana.
          </>
        ),
      },
      {
        title: "Audit trail",
        body: "Every cooldown, block, and hand-out decision saved to a durable, queryable log.",
      },
      {
        title: "Per-context reputation",
        body: (
          <>
            Health tracked per <C>resource × context</C> — one context&apos;s failures never spill into another.
          </>
        ),
      },
      {
        title: "Open-source engine",
        body: "The core is Apache-2.0 on GitHub. Self-host it, or let us run the hosted API.",
      },
    ],
  },

  steps: {
    label: "How it works",
    heading: "Three calls. The engine does the rest.",
    intro:
      "Works over gRPC or REST — register your resources once, then grab one and report the result per context. Cooldown, isolation, and recovery are never your code to write.",
    items: [
      { title: "Issue a key", body: "Create an API key in the dashboard and point your client at the gRPC or REST endpoint." },
      { title: "Register & acquire", body: "Register your resources once, then ask for the healthiest one per context." },
      { title: "Report the outcome", body: "Tell the pool what happened. Cooldown, isolation, and recovery all happen automatically." },
    ],
  },

  docs: {
    label: "Docs",
    heading: "Up and running in five minutes.",
    intro:
      "Issue a key, register a resource, then acquire and report — the quickstart walks the full round trip, in your language.",
    items: [
      { tag: "5 min", title: "Quickstart", body: "Key → Register → Acquire → Report, end to end, copy-paste ready.", go: "Start building →" },
      { tag: "Reference", title: "API reference", body: "Six gRPC RPCs and the REST control plane, every field documented.", go: "Browse the API →" },
      { tag: "Guide", title: "Concepts", body: "Reputation, cooldown, contexts, leases — how the engine actually thinks.", go: "Learn the model →" },
    ],
  },

  contact: {
    label: "Get access",
    heading: "We're onboarding teams one by one.",
    body: "No self-serve signup yet — we set up each team by hand so your pool starts healthy. Tell us about your workload and we'll get you a key.",
    cta: "Email us",
    orWrite: "or write to",
  },

  footer: {
    columns: [
      { heading: "Product", links: ["Features", "How it works", "Docs"] },
      { heading: "Open source", links: ["GitHub", "Engine", "Changelog"] },
      { heading: "Company", links: ["Contact"] },
    ],
    rights: "reputation·pool",
  },
};

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
      "Stop hand-rolling cooldowns, blocklists, and lease logic. Acquire the healthiest resource and report the outcome — a verified open-source engine heals the pool for you.",
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
    badge: "Reputation infrastructure for resource pools",
    title: "The reputation API for proxy & account pools.",
    bodyLead: "Stop hand-rolling cooldowns, blocklists, and lease logic.",
    bodyBold: "Acquire the healthiest resource, report the outcome",
    bodyTail: "— a verified open-source engine heals the pool for you.",
    ctaPrimary: "Get started",
    ctaSecondary: "Read the docs",
    footnote: "Powered by a fully open-source, formally-tested engine",
  },

  trust: {
    heading: "Trust comes from the engine, not logos",
    items: [
      { title: "Open source", sub: "full engine on GitHub" },
      { title: "Lincheck", sub: "linearizability proof" },
      { title: "Mutation-tested", sub: "tests that catch real bugs" },
      { title: "Audit trail", sub: "every decision on record" },
    ],
  },

  features: {
    label: "Why teams switch",
    heading: "Reputation, cooling, and isolation — solved.",
    items: [
      {
        kicker: "Automatic cooling & recovery",
        title: "Failing resources step aside, then earn their way back.",
        body: "Report an outcome and the engine cools the resource on failure patterns, isolates it, and re-probes on a probability curve — so a bad proxy recovers on its own instead of poisoning your run.",
        alt: "reputation-pool dashboard — pool overview: per-resource state, score and recent verdicts",
      },
      {
        kicker: "Context isolation",
        title: "A failure in one context never taints another.",
        body: (
          <>
            Reputation lives per <C>resource × context</C> cell. <C>checkout-us</C> going bad on a proxy doesn&apos;t
            touch <C>search-eu</C> — each context keeps its own health and cooling curve.
          </>
        ),
        alt: "reputation-pool dashboard — resource detail: per-context reputation curve",
      },
      {
        kicker: "Real-time dashboard",
        title: "See every lease, cool, and recovery as it happens.",
        body: (
          <>
            Pool state, reputation curves, and a live event stream — no SQL, no guesswork. Metrics ship to{" "}
            <C>/actuator/prometheus</C> for your Grafana too.
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
      "No add-ons, no tiers to unlock the basics — the pool ships with the surfaces and signals a serious workload needs.",
    items: [
      {
        title: "gRPC & REST",
        body: "One engine, two surfaces — a gRPC data plane for hot paths and a REST control plane for tooling.",
      },
      {
        title: "Live event stream",
        body: "Subscribe to every lease, cool, block, and recovery the moment it happens.",
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
        body: "Every cooling, block, and lease decision written to a durable, queryable log.",
      },
      {
        title: "Per-context reputation",
        body: (
          <>
            Health tracked per <C>resource × context</C> — one context&apos;s failures never taint another.
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
      "Works over gRPC or REST — register your resources once, then acquire and report per context. Cooling, isolation, and recovery are never your code.",
    items: [
      { title: "Issue a key", body: "Create an API key in the dashboard and point your client at the gRPC or REST endpoint." },
      { title: "Register & acquire", body: "Register your resources once, then ask for the healthiest one per context." },
      { title: "Report the outcome", body: "Tell the pool what happened. Cooling, isolation, and recovery are automatic." },
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
      { tag: "Guide", title: "Concepts", body: "Reputation, cooling, contexts, leases — how the engine actually thinks.", go: "Learn the model →" },
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

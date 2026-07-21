import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { BrowserFrame } from "./browser-frame";
import { Brand } from "./logo";
import { CONTACT_EMAIL, CONTACT_MAILTO, GITHUB_REPO_URL } from "./constants";

/** 1080px 래퍼 — 확정 시안의 .wrap. */
const WRAP = "mx-auto max-w-[1080px] px-6";
/** 링크형 CTA 공통(링크 안 <button> 금지 — nested-interactive 회피). */
const CTA = "inline-flex items-center justify-center";

/* ─────────────────────────────  Hero  ───────────────────────────── */

/** 히어로 다크 코드 패널 — acquire → report 루프(확정 시안 그대로, 영문 주석). */
function CodePanel() {
  const Comment = ({ children }: { children: React.ReactNode }) => (
    <span className="text-code-muted">{children}</span>
  );
  const M = ({ children }: { children: React.ReactNode }) => (
    <span className="text-accent">{children}</span>
  );
  const Str = ({ children }: { children: React.ReactNode }) => (
    <span className="text-ok">{children}</span>
  );
  return (
    <div className="overflow-hidden rounded-[16px] border border-white/10 shadow-[0_24px_60px_-20px_rgba(15,25,50,0.45)]">
      <div className="flex items-center gap-2 border-b border-white/5 bg-code-bg px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
        </span>
        <span className="ml-2 font-mono text-[12px] text-code-muted">Advisor.java</span>
      </div>
      <pre className="overflow-x-auto bg-code-bg px-5 py-5 font-mono text-[13.5px] leading-[1.85] text-code-ink">
        <code>
          <div className="whitespace-pre">
            <span className="text-[#77c8e0]">var</span> lease = advisor.<M>acquire</M>(
            <Str>&quot;checkout-us&quot;</Str>); <Comment>{"  // healthiest resource, right now"}</Comment>
          </div>
          <div className="whitespace-pre">useResource(lease.resource());</div>
          <div className="whitespace-pre">{" "}</div>
          <div className="whitespace-pre">
            <Comment>{"// report the outcome — that's it"}</Comment>
          </div>
          <div className="whitespace-pre">
            advisor.<M>report</M>(lease, Outcome.<M>success</M>(latency));
          </div>
          <div className="whitespace-pre">
            <Comment>{"// on failure? report(lease, Outcome.failure(TIMEOUT))"}</Comment>
          </div>
          <div className="whitespace-pre">
            <Comment>{"// → the engine cools, isolates & re-probes automatically"}</Comment>
          </div>
        </code>
      </pre>
    </div>
  );
}

export function Hero() {
  return (
    <header className="border-b border-line bg-[radial-gradient(1200px_400px_at_78%_-8%,var(--accent-soft)_0%,transparent_60%)]">
      <div className={cn(WRAP, "grid items-center gap-12 py-16 sm:py-[72px] lg:grid-cols-[1.05fr_0.95fr]")}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 font-mono text-[12.5px] text-accent">
            Reputation infrastructure for resource pools
          </span>
          <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.04] tracking-tight text-ink sm:text-5xl lg:text-[54px]">
            The reputation API for proxy &amp; account pools.
          </h1>
          <p className="mt-5 max-w-[34ch] text-pretty text-lg leading-relaxed text-muted">
            Stop hand-rolling cooldowns, blocklists, and lease logic.{" "}
            <b className="font-semibold text-ink">Acquire the healthiest resource, report the outcome</b> — a
            verified open-source engine heals the pool for you.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#contact" className={buttonClass("primary", `${CTA} px-5 py-2.5 text-[15px] text-accent-ink`)}>
              Get started
            </Link>
            <Link href="#docs" className={buttonClass("ghost", `${CTA} px-5 py-2.5 text-[15px]`)}>
              Read the docs
            </Link>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
            <span className="text-ok" aria-hidden="true">
              ●
            </span>
            Powered by a fully open-source, formally-tested engine
          </p>
        </div>
        <CodePanel />
      </div>
    </header>
  );
}

/* ─────────────────────────────  Trust strip  ───────────────────────────── */

const TRUST: { title: string; sub: string; icon: React.ReactNode }[] = [
  {
    title: "Open source",
    sub: "full engine on GitHub",
    icon: (
      <path d="M12 2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.8 6 21l1-5.8L2.8 8.1l5.8-.8z" strokeLinejoin="round" />
    ),
  },
  {
    title: "Lincheck",
    sub: "linearizability proof",
    icon: (
      <>
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    title: "Mutation-tested",
    sub: "tests that catch real bugs",
    icon: (
      <>
        <path d="M7 3v6l-3 5a5 5 0 0 0 5 7h6a5 5 0 0 0 5-7l-3-5V3" strokeLinejoin="round" />
        <path d="M7 3h10" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Audit trail",
    sub: "every decision on record",
    icon: (
      <>
        <path d="M6 3h9l3 3v15H6z" strokeLinejoin="round" />
        <path d="M9 12h6M9 16h6" strokeLinecap="round" />
      </>
    ),
  },
];

export function TrustSignals() {
  return (
    <section className="border-b border-line bg-surface">
      <div className={cn(WRAP, "flex flex-wrap items-center gap-y-4 py-5")}>
        <span className="mr-6 text-[13px] font-semibold text-muted">Trust comes from the engine, not logos</span>
        {TRUST.map((s, i) => (
          <div
            key={s.title}
            className={cn(
              "flex items-center gap-2.5 px-5",
              i > 0 && "border-l border-line",
              i === 0 && "pl-0",
            )}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-[18px] shrink-0 text-accent" aria-hidden="true">
              {s.icon}
            </svg>
            <span>
              <span className="block text-[13.5px] font-semibold text-ink">{s.title}</span>
              <span className="block text-[11.5px] text-muted">{s.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────  Features (교차행 + 실제 스크린샷)  ───────────────────────────── */

const FEATURES: {
  kicker: string;
  title: string;
  body: React.ReactNode;
  img: string;
  alt: string;
  url: string;
  reversed: boolean;
}[] = [
  {
    kicker: "Automatic cooling & recovery",
    title: "Failing resources step aside, then earn their way back.",
    body: "Report an outcome and the engine cools the resource on failure patterns, isolates it, and re-probes on a probability curve — so a bad proxy recovers on its own instead of poisoning your run.",
    img: "/marketing/overview-dark.png",
    alt: "reputation-pool dashboard — pool overview: per-resource state, score and recent verdicts",
    url: "app.reputationpool.io/overview",
    reversed: false,
  },
  {
    kicker: "Context isolation",
    title: "A failure in one context never taints another.",
    body: (
      <>
        Reputation lives per <code className="font-mono text-[0.92em] text-accent">resource × context</code> cell.{" "}
        <code className="font-mono text-[0.92em] text-accent">checkout-us</code> going bad on a proxy doesn&apos;t touch{" "}
        <code className="font-mono text-[0.92em] text-accent">search-eu</code> — each context keeps its own health and
        cooling curve.
      </>
    ),
    img: "/marketing/detail-dark.png",
    alt: "reputation-pool dashboard — resource detail: per-context reputation curve",
    url: "app.reputationpool.io/resources/proxy",
    reversed: true,
  },
  {
    kicker: "Real-time dashboard",
    title: "See every lease, cool, and recovery as it happens.",
    body: (
      <>
        Pool state, reputation curves, and a live event stream — no SQL, no guesswork. Metrics ship to{" "}
        <code className="font-mono text-[0.92em] text-accent">/actuator/prometheus</code> for your Grafana too.
      </>
    ),
    img: "/marketing/events-dark.png",
    alt: "reputation-pool dashboard — live event stream of leases, cools and recoveries",
    url: "app.reputationpool.io/events",
    reversed: false,
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          Why teams switch
        </span>
        <h2 className="mt-3 max-w-[16ch] text-balance text-3xl font-bold leading-tight tracking-tight text-ink sm:text-[38px]">
          Reputation, cooling, and isolation — solved.
        </h2>

        <div className="mt-14 flex flex-col gap-[74px]">
          {FEATURES.map((f) => (
            <div key={f.kicker} className="grid items-center gap-14 lg:grid-cols-[1fr_1.15fr]">
              <div className={cn(f.reversed && "lg:order-2")}>
                <span className="font-mono text-xs uppercase tracking-[0.05em] text-muted">{f.kicker}</span>
                <h3 className="mt-3.5 text-[23px] font-semibold tracking-tight text-ink">{f.title}</h3>
                <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
              <div className={cn(f.reversed && "lg:order-1")}>
                <BrowserFrame src={f.img} alt={f.alt} url={f.url} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Capabilities  ───────────────────────────── */

const CAPS: { title: string; body: React.ReactNode; icon: React.ReactNode }[] = [
  {
    title: "gRPC & REST",
    body: "One engine, two surfaces — a gRPC data plane for hot paths and a REST control plane for tooling.",
    icon: <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />,
  },
  {
    title: "Live event stream",
    body: "Subscribe to every lease, cool, block, and recovery the moment it happens.",
    icon: <path d="M4 12h4l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    title: "Prometheus metrics",
    body: (
      <>
        Scrape <code className="font-mono text-[0.92em] text-accent">/actuator/prometheus</code> straight into your own
        Grafana.
      </>
    ),
    icon: <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" strokeLinecap="round" />,
  },
  {
    title: "Audit trail",
    body: "Every cooling, block, and lease decision written to a durable, queryable log.",
    icon: (
      <>
        <path d="M6 3h9l3 3v15H6z" strokeLinejoin="round" />
        <path d="M9 12h6M9 16h6" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Per-context reputation",
    body: (
      <>
        Health tracked per <code className="font-mono text-[0.92em] text-accent">resource × context</code> — one
        context&apos;s failures never taint another.
      </>
    ),
    icon: (
      <>
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="13" width="7" height="7" rx="1.5" />
        <path d="M6.5 11v3.5H17" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Open-source engine",
    body: "The core is Apache-2.0 on GitHub. Self-host it, or let us run the hosted API.",
    icon: (
      <path
        d="M9 18c-4 1-4-2-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.3 1.3 5.3 1.6 5.3 1.6a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 8c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

export function Capabilities() {
  return (
    <section className="border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          Everything included
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">
          Built for real automation infrastructure.
        </h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">
          No add-ons, no tiers to unlock the basics — the pool ships with the surfaces and signals a serious workload
          needs.
        </p>
        <div className="mt-11 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPS.map((c) => (
            <div key={c.title} className="rounded-[13px] border border-line bg-surface p-5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mb-3 size-[22px] text-accent" aria-hidden="true">
                {c.icon}
              </svg>
              <div className="text-[15px] font-bold tracking-tight text-ink">{c.title}</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  How it works  ───────────────────────────── */

const STEPS: { n: string; title: string; body: string; code: string }[] = [
  {
    n: "1",
    title: "Issue a key",
    body: "Create an API key in the dashboard and point your client at the gRPC or REST endpoint.",
    code: "rp_live_…",
  },
  {
    n: "2",
    title: "Register & acquire",
    body: "Register your resources once, then ask for the healthiest one per context.",
    code: 'acquire("checkout-us")',
  },
  {
    n: "3",
    title: "Report the outcome",
    body: "Tell the pool what happened. Cooling, isolation, and recovery are automatic.",
    code: "report(lease, success)",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          How it works
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">
          Three calls. The engine does the rest.
        </h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">
          Works over gRPC or REST — register your resources once, then acquire and report per context. Cooling,
          isolation, and recovery are never your code.
        </p>
        <ol className="mt-12 grid gap-7 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="grid size-[34px] place-items-center rounded-[9px] border border-line font-mono text-[13px] font-bold text-accent">
                {s.n}
              </span>
              <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              <code className="mt-2.5 inline-block rounded-[7px] border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-accent">
                {s.code}
              </code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Docs  ───────────────────────────── */

const DOCS: { tag: string; title: string; body: string; go: string }[] = [
  {
    tag: "5 min",
    title: "Quickstart",
    body: "Key → Register → Acquire → Report, end to end, copy-paste ready.",
    go: "Start building →",
  },
  {
    tag: "Reference",
    title: "API reference",
    body: "Six gRPC RPCs and the REST control plane, every field documented.",
    go: "Browse the API →",
  },
  {
    tag: "Guide",
    title: "Concepts",
    body: "Reputation, cooling, contexts, leases — how the engine actually thinks.",
    go: "Learn the model →",
  },
];

export function Docs() {
  return (
    <section id="docs" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">Docs</span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">
          Up and running in five minutes.
        </h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">
          Issue a key, register a resource, then acquire and report — the quickstart walks the full round trip, in your
          language.
        </p>
        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DOCS.map((d) => (
            <Link
              key={d.title}
              href="/docs"
              className="group rounded-[14px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-accent"
            >
              <span className="rounded-[6px] border border-accent/20 bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                {d.tag}
              </span>
              <h3 className="mt-3 text-[17px] font-semibold tracking-tight text-ink">{d.title}</h3>
              <p className="mb-3.5 mt-2 text-[13.5px] leading-relaxed text-muted">{d.body}</p>
              <span className="text-[13px] font-bold text-accent">{d.go}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Contact (결제 없음 — mailto)  ───────────────────────────── */

export function Contact() {
  return (
    <section id="contact" className="scroll-mt-20 border-b border-line bg-code-bg text-center">
      <div className={cn(WRAP, "py-[84px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[#7fb0f5]">
          Get access
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-code-ink sm:text-[38px]">
          We&apos;re onboarding teams one by one.
        </h2>
        <p className="mx-auto mt-4 max-w-[46ch] text-[17px] leading-relaxed text-code-muted">
          No self-serve signup yet — we set up each team by hand so your pool starts healthy. Tell us about your
          workload and we&apos;ll get you a key.
        </p>
        <a
          href={CONTACT_MAILTO}
          className={cn(CTA, "mt-7 rounded-[11px] bg-white px-5 py-2.5 text-[15px] font-bold text-code-bg transition hover:brightness-95")}
        >
          Email us
        </a>
        <p className="mt-3.5 font-mono text-[12.5px] text-code-muted">
          or write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#bcd2f5] hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Footer  ───────────────────────────── */

const FOOTER: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    heading: "Open source",
    links: [
      { label: "GitHub", href: GITHUB_REPO_URL, external: true },
      { label: "Engine", href: GITHUB_REPO_URL, external: true },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Contact", href: CONTACT_MAILTO },
      { label: "Status", href: "/status" },
    ],
  },
];

export function Footer() {
  return (
    <footer>
      <div className={cn(WRAP, "flex flex-wrap items-start gap-x-10 gap-y-5 pb-14 pt-11")}>
        <div className="mr-auto">
          <Brand />
        </div>
        {FOOTER.map((col) => (
          <div key={col.heading} className="flex flex-col gap-2.5">
            <span className="text-xs font-bold uppercase tracking-[0.05em] text-muted">{col.heading}</span>
            {col.links.map((l) =>
              l.external || l.href.startsWith("mailto:") ? (
                <a
                  key={l.label}
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="text-[13.5px] text-muted hover:text-ink"
                >
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} className="text-[13.5px] text-muted hover:text-ink">
                  {l.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
      <div className={WRAP}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line py-5 text-[12.5px] text-muted">
          <span>© {new Date().getFullYear()} reputation·pool</span>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}

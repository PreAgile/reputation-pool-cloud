import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { BrowserFrame } from "./browser-frame";
import { Brand } from "./logo";
import { CONTACT_EMAIL, CONTACT_MAILTO, GITHUB_REPO_URL } from "./constants";
import { LOCALE_PATH, type Dict, type Locale } from "./i18n";

/** 1080px 래퍼 — 확정 시안의 .wrap. */
const WRAP = "mx-auto max-w-[1080px] px-6";
/** 링크형 CTA 공통(링크 안 <button> 금지 — nested-interactive 회피). */
const CTA = "inline-flex items-center justify-center";

/**
 * 모든 섹션은 로케일 사전(dict)과 locale 을 받는다. 산문은 dict 에서, 아이콘·href·이미지·코드 스니펫 등
 * 비번역 구조는 아래 *_STRUCT 상수에서 읽어 index 로 결합한다. locale 로 해시 링크 base(`/` vs `/ko`)와
 * 스크린샷 소스 프리픽스(en vs ko)를 결정한다.
 */
type SectionProps = { dict: Dict; locale: Locale };

/* ─────────────────────────────  Hero  ───────────────────────────── */

/** 히어로 다크 코드 패널 — acquire → report 루프. 코드/주석은 언어 중립이라 번역하지 않는다. */
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
          <div className="whitespace-pre">{" "}</div>
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

export function Hero({ dict, locale }: SectionProps) {
  const base = LOCALE_PATH[locale];
  const h = dict.hero;
  return (
    <header className="border-b border-line bg-[radial-gradient(1200px_400px_at_78%_-8%,var(--accent-soft)_0%,transparent_60%)]">
      <div className={cn(WRAP, "grid items-center gap-12 py-16 sm:py-[72px] lg:grid-cols-[1.05fr_0.95fr]")}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 font-mono text-[12.5px] text-accent">
            {h.badge}
          </span>
          <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.04] tracking-tight text-ink sm:text-5xl lg:text-[54px]">
            {h.title}
          </h1>
          <p className="mt-5 max-w-[34ch] text-pretty text-lg leading-relaxed text-muted">
            {h.bodyLead} <b className="font-semibold text-ink">{h.bodyBold}</b> {h.bodyTail}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={`${base}#contact`} className={buttonClass("primary", `${CTA} px-5 py-2.5 text-[15px] text-accent-ink`)}>
              {h.ctaPrimary}
            </Link>
            <Link href={`${base}#docs`} className={buttonClass("ghost", `${CTA} px-5 py-2.5 text-[15px]`)}>
              {h.ctaSecondary}
            </Link>
          </div>
          <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
            <span className="text-ok" aria-hidden="true">
              ●
            </span>
            {h.footnote}
          </p>
        </div>
        <CodePanel />
      </div>
    </header>
  );
}

/* ─────────────────────────────  Trust strip  ───────────────────────────── */

/** 신뢰 배지 아이콘(비번역) — dict.trust.items 와 index 로 결합. */
const TRUST_ICONS: React.ReactNode[] = [
  <path key="i" d="M12 2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.8 6 21l1-5.8L2.8 8.1l5.8-.8z" strokeLinejoin="round" />,
  <g key="i">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </g>,
  <g key="i">
    <path d="M7 3v6l-3 5a5 5 0 0 0 5 7h6a5 5 0 0 0 5-7l-3-5V3" strokeLinejoin="round" />
    <path d="M7 3h10" strokeLinecap="round" />
  </g>,
  <g key="i">
    <path d="M6 3h9l3 3v15H6z" strokeLinejoin="round" />
    <path d="M9 12h6M9 16h6" strokeLinecap="round" />
  </g>,
];

export function TrustSignals({ dict }: SectionProps) {
  return (
    <section className="border-b border-line bg-surface">
      <div className={cn(WRAP, "flex flex-wrap items-center gap-y-4 py-5")}>
        <span className="mr-6 text-[13px] font-semibold text-muted">{dict.trust.heading}</span>
        {dict.trust.items.map((s, i) => (
          <div
            key={s.title}
            className={cn(
              "flex items-center gap-2.5 px-5",
              i > 0 && "border-l border-line",
              i === 0 && "pl-0",
            )}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-[18px] shrink-0 text-accent" aria-hidden="true">
              {TRUST_ICONS[i]}
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

/** 기능행 구조(비번역): 스크린샷 키·좌우 배치·주소줄 URL. dict.features.items 와 index 로 결합. */
const FEATURE_STRUCT: { shot: string; url: string; reversed: boolean }[] = [
  { shot: "overview", url: "app.reputationpool.io/overview", reversed: false },
  { shot: "detail", url: "app.reputationpool.io/resources/proxy", reversed: true },
  { shot: "events", url: "app.reputationpool.io/events", reversed: false },
];

export function Features({ dict, locale }: SectionProps) {
  return (
    <section id="features" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          {dict.features.label}
        </span>
        <h2 className="mt-3 max-w-[16ch] text-balance text-3xl font-bold leading-tight tracking-tight text-ink sm:text-[38px]">
          {dict.features.heading}
        </h2>

        <div className="mt-14 flex flex-col gap-[74px]">
          {dict.features.items.map((f, i) => {
            const s = FEATURE_STRUCT[i];
            // 스크린샷은 로케일 일치: EN=영어 목업, KO=실제 대시보드. 테마별 라이트/다크 2종을 BrowserFrame 이 CSS 로 스왑.
            const shot = `/marketing/${s.shot}-${locale}`;
            return (
              <div key={f.kicker} className="grid items-center gap-14 lg:grid-cols-[1fr_1.15fr]">
                <div className={cn(s.reversed && "lg:order-2")}>
                  <span className="font-mono text-xs uppercase tracking-[0.05em] text-muted">{f.kicker}</span>
                  <h3 className="mt-3.5 text-[23px] font-semibold tracking-tight text-ink">{f.title}</h3>
                  <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{f.body}</p>
                </div>
                <div className={cn(s.reversed && "lg:order-1")}>
                  <BrowserFrame
                    srcLight={`${shot}-light.png`}
                    srcDark={`${shot}-dark.png`}
                    alt={f.alt}
                    url={s.url}
                    enlargeLabel={dict.a11y.enlarge}
                    closeLabel={dict.a11y.closeDialog}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Capabilities  ───────────────────────────── */

/** 역량 카드 아이콘(비번역) — dict.caps.items 와 index 로 결합. */
const CAP_ICONS: React.ReactNode[] = [
  <path key="i" d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />,
  <path key="i" d="M4 12h4l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />,
  <path key="i" d="M4 20V10M9 20V4M14 20v-7M19 20V8" strokeLinecap="round" />,
  <g key="i">
    <path d="M6 3h9l3 3v15H6z" strokeLinejoin="round" />
    <path d="M9 12h6M9 16h6" strokeLinecap="round" />
  </g>,
  <g key="i">
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="13" width="7" height="7" rx="1.5" />
    <path d="M6.5 11v3.5H17" strokeLinecap="round" />
  </g>,
  <path
    key="i"
    d="M9 18c-4 1-4-2-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.3 1.3 5.3 1.6 5.3 1.6a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 8c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V20"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
];

export function Capabilities({ dict }: SectionProps) {
  return (
    <section className="border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          {dict.caps.label}
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">{dict.caps.heading}</h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">{dict.caps.intro}</p>
        <div className="mt-11 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {dict.caps.items.map((c, i) => (
            <div key={c.title} className="rounded-[13px] border border-line bg-surface p-5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mb-3 size-[22px] text-accent" aria-hidden="true">
                {CAP_ICONS[i]}
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

/** 단계 번호·코드 스니펫(비번역) — dict.steps.items 와 index 로 결합. */
const STEP_META: { n: string; code: string }[] = [
  { n: "1", code: "rp_live_…" },
  { n: "2", code: 'acquire("checkout-us")' },
  { n: "3", code: "report(lease, success)" },
];

export function HowItWorks({ dict }: SectionProps) {
  return (
    <section id="how" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          {dict.steps.label}
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">{dict.steps.heading}</h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">{dict.steps.intro}</p>
        <ol className="mt-12 grid gap-7 md:grid-cols-3">
          {dict.steps.items.map((s, i) => (
            <li key={STEP_META[i].n}>
              <span className="grid size-[34px] place-items-center rounded-[9px] border border-line font-mono text-[13px] font-bold text-accent">
                {STEP_META[i].n}
              </span>
              <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              <code className="mt-2.5 inline-block rounded-[7px] border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-accent">
                {STEP_META[i].code}
              </code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Docs  ───────────────────────────── */

export function Docs({ dict }: SectionProps) {
  return (
    <section id="docs" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">
          {dict.docs.label}
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-[38px]">{dict.docs.heading}</h2>
        <p className="mt-3.5 max-w-[52ch] text-[17px] text-muted">{dict.docs.intro}</p>
        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dict.docs.items.map((d) => (
            // 전용 docs 라우트는 후속 슬라이스 → 실제 문서가 사는 공개 레포로 연결(404 회피).
            <a
              key={d.title}
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="group rounded-[14px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-accent"
            >
              <span className="rounded-[6px] border border-accent/20 bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                {d.tag}
              </span>
              <h3 className="mt-3 text-[17px] font-semibold tracking-tight text-ink">{d.title}</h3>
              <p className="mb-3.5 mt-2 text-[13.5px] leading-relaxed text-muted">{d.body}</p>
              <span className="text-[13px] font-bold text-accent">{d.go}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Contact (결제 없음 — mailto)  ───────────────────────────── */

export function Contact({ dict }: SectionProps) {
  return (
    <section id="contact" className="scroll-mt-20 border-b border-line bg-code-bg text-center">
      <div className={cn(WRAP, "py-[84px]")}>
        <span className="font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[#7fb0f5]">
          {dict.contact.label}
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-code-ink sm:text-[38px]">{dict.contact.heading}</h2>
        <p className="mx-auto mt-4 max-w-[46ch] text-[17px] leading-relaxed text-code-muted">{dict.contact.body}</p>
        <a
          href={CONTACT_MAILTO}
          className={cn(CTA, "mt-7 rounded-[11px] bg-white px-5 py-2.5 text-[15px] font-bold text-code-bg transition hover:brightness-95")}
        >
          {dict.contact.cta}
        </a>
        <p className="mt-3.5 font-mono text-[12.5px] text-code-muted">
          {dict.contact.orWrite}{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#bcd2f5] hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Footer  ───────────────────────────── */

/** 푸터 링크 구조(비번역: href/external) — dict.footer.columns 와 index 로 결합. */
function footerHrefs(base: string): { href: string; external?: boolean }[][] {
  return [
    // Product: Features, How it works, Docs(→ 공개 레포)
    [{ href: `${base}#features` }, { href: `${base}#how` }, { href: GITHUB_REPO_URL, external: true }],
    // Open source: GitHub, Engine, Changelog(→ Releases)
    [{ href: GITHUB_REPO_URL, external: true }, { href: GITHUB_REPO_URL, external: true }, { href: `${GITHUB_REPO_URL}/releases`, external: true }],
    // Company: Contact(mailto)
    [{ href: CONTACT_MAILTO }],
  ];
}

export function Footer({ dict, locale }: SectionProps) {
  const base = LOCALE_PATH[locale];
  const hrefs = footerHrefs(base);
  const year = new Date().getFullYear();
  return (
    <footer>
      <div className={cn(WRAP, "flex flex-wrap items-start gap-x-10 gap-y-5 pb-14 pt-11")}>
        <div className="mr-auto">
          <Brand />
        </div>
        {dict.footer.columns.map((col, ci) => (
          <div key={col.heading} className="flex flex-col gap-2.5">
            <span className="text-xs font-bold uppercase tracking-[0.05em] text-muted">{col.heading}</span>
            {col.links.map((label, li) => {
              const l = hrefs[ci][li];
              return l.external || l.href.startsWith("mailto:") ? (
                <a
                  key={label}
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="text-[13.5px] text-muted hover:text-ink"
                >
                  {label}
                </a>
              ) : (
                <Link key={label} href={l.href} className="text-[13.5px] text-muted hover:text-ink">
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className={WRAP}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line py-5 text-[12.5px] text-muted">
          {/* Terms/Privacy 는 법무 슬라이스(D10) 라우트가 생기면 추가한다. 지금은 404 회피를 위해 저작권만. */}
          <span>© {year} {dict.footer.rights}</span>
        </div>
      </div>
    </footer>
  );
}

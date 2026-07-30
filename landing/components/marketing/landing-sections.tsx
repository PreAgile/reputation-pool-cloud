import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DOCS_ROOT, docsHref } from "@/lib/docs-manifest";
import { SITE_HOST } from "@/lib/site";
import { statusHref } from "@/lib/status";
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

/**
 * 본문 한 줄 길이(측정값). `ch` 는 라틴 글자 하나 폭 기준이라 **같은 `ch` 값이 로케일에 따라 전혀 다른
 * 글자 수**를 담는다 — 한글 글리프는 라틴의 약 두 배 폭이므로 `52ch` 짜리 단에는 한글이 절반밖에 안 들어가고,
 * 그래서 마지막 줄에 한 단어만 남는 고아 줄바꿈("있습니다." 처럼)이 생긴다. 로케일별로 따로 주고, 여기에
 * `text-pretty` 를 함께 써서 브라우저가 마지막 줄을 혼자 남기지 않게 한다.
 *
 * 이전에는 이 조정이 필요한 곳마다 `locale === "ko" ? ... : ...` 를 인라인으로 흩뿌려 놨고(히어로·기능 헤딩),
 * 정작 본문 단락 세 곳은 두 로케일 공용 `52ch` 라 한글에서만 깨졌다. 한 곳으로 모은다.
 */
const MEASURE_BODY: Record<Locale, string> = { ko: "max-w-[36rem]", en: "max-w-[52ch]" };
/** 헤딩 측정값 — 본문보다 넉넉하게. 헤딩은 짧고 크므로 좁은 단에 넣으면 어색하게 두 줄로 접힌다. */
const MEASURE_HEAD: Record<Locale, string> = { ko: "max-w-[44rem]", en: "max-w-[38rem]" };

/**
 * 섹션 머리(eyebrow + 헤딩 + 선택 본문)를 가운데로 펼친다.
 *
 * 쇼케이스 섹션의 헤딩을 좁은 단에 좌측 정렬로 두면 오른쪽 절반이 비어 화면이 한쪽으로 쏠려 보인다.
 * 가운데 정렬 + 넉넉한 측정값이면 헤딩이 가로로 펼쳐지고, 아래 콘텐츠(같은 폭의 스크린샷들)와 축이 맞는다.
 */
function SectionHead({
  label,
  heading,
  body,
  locale,
  tone = "light",
}: {
  label: string;
  heading: string;
  body?: React.ReactNode;
  locale: Locale;
  tone?: "light" | "dark";
}) {
  return (
    <div className={cn("mx-auto text-center", MEASURE_HEAD[locale])}>
      {/* 다크 배경에서는 본문 accent 가 너무 어두워 읽히지 않으므로 밝은 쪽을 쓴다. */}
      <span
        className={cn(
          "font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em]",
          tone === "dark" ? "text-[#7fb0f5]" : "text-accent",
        )}
      >
        {label}
      </span>
      <h2
        className={cn(
          "mt-3 text-balance text-3xl font-bold leading-tight tracking-tight sm:text-[38px]",
          tone === "dark" ? "text-code-ink" : "text-ink",
        )}
      >
        {heading}
      </h2>
      {body != null && (
        <p
          className={cn(
            "mx-auto mt-4 text-pretty text-[17px] leading-relaxed",
            MEASURE_BODY[locale],
            tone === "dark" ? "text-code-muted" : "text-muted",
          )}
        >
          {body}
        </p>
      )}
    </div>
  );
}

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
          {/* 각 줄은 이 패널 내부 폭(약 50자)에 들어가야 한다. `overflow-x-auto` 라 넘쳐도 깨지지는 않지만,
              macOS 의 오버레이 스크롤바는 스크롤 전까지 보이지 않으므로 사용자에게는 그냥 "잘린 코드" 로
              읽힌다 — 히어로에서 가장 중요한 마지막 두 줄(엔진이 알아서 한다는 문구)이 그렇게 잘려 있었다.
              그래서 주석을 짧게 끊어 스크롤 없이 전부 보이게 한다. */}
          <div className="whitespace-pre">
            <Comment>{"// healthiest resource, right now"}</Comment>
          </div>
          <div className="whitespace-pre">
            <span className="text-[#77c8e0]">var</span> lease = advisor.<M>acquire</M>(
            <Str>&quot;checkout-us&quot;</Str>);
          </div>
          <div className="whitespace-pre">useResource(lease.resource());</div>
          <div className="whitespace-pre">{" "}</div>
          <div className="whitespace-pre">
            <Comment>{"// report the outcome — that's it"}</Comment>
          </div>
          <div className="whitespace-pre">
            advisor.<M>report</M>(lease, Outcome.<M>success</M>(latency));
          </div>
          <div className="whitespace-pre">{" "}</div>
          <div className="whitespace-pre">
            <Comment>{"// on failure? Outcome.failure(TIMEOUT)"}</Comment>
          </div>
          <div className="whitespace-pre">
            <Comment>{"// → engine cools, isolates & re-probes"}</Comment>
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
          {/* ch 단위는 라틴 기준 — 한글은 글자폭이 넓어 같은 ch 가 더 좁게 줄바꿈된다. ko 는 넉넉히. */}
          <p className={cn("mt-5 text-pretty text-lg leading-relaxed text-muted", locale === "ko" ? "max-w-[26rem]" : "max-w-[34ch]")}>
            {h.bodyLead} <b className="font-semibold text-ink">{h.bodyBold}</b> {h.bodyTail}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={`${base}#contact`} className={buttonClass("primary", `${CTA} px-5 py-2.5 text-[15px] text-accent-ink`)}>
              {h.ctaPrimary}
            </Link>
            {/* 전용 docs 사이트(#121)로 — 방문자의 로케일을 유지한다(#143). */}
            <Link href={DOCS_ROOT[locale]} className={buttonClass("ghost", `${CTA} px-5 py-2.5 text-[15px]`)}>
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

/**
 * 배지 사이 세로 구분선을 "그 줄의 첫 칸이 아닌 칸"에만 붙이는 클래스.
 *
 * 이전 구현은 `flex flex-wrap` 컨테이너에 `i > 0 && "border-l"` 이었다. `i` 는 **배열에서 몇 번째**라는
 * 사실이고, 구분선이 필요한 조건은 **이 줄에서 몇 번째**라는 사실이다. flex-wrap 에서는 줄바꿈 지점을
 * 컨테이너 폭과 *텍스트 길이*가 런타임에 정하므로 이 둘이 갈린다 — 영어에서 `Audit trail` 이 둘째 줄로
 * 넘어가면 그 항목이 `border-l` 을 들고 가서 줄 맨 앞에 세로선이 떠 있었고 윗줄과 축도 어긋났다.
 * 한국어는 라벨이 짧아 4개가 우연히 한 줄에 들어가 멀쩡해 보였을 뿐이다(이슈 #120).
 *
 * grid 로 열 수를 고정하면 "줄의 첫 칸"이 텍스트와 무관한 **정적 사실**이 된다: 2열에서는 홀수 칸,
 * 4열에서는 `4n+1` 칸이 줄 머리다. 그래서 구분선은 없는 상태에서 **더하는 방향으로만** 쓴다.
 *   - 2열(기본): 짝수 칸(`2n`)은 줄 머리가 아니다 → 구분선 + 왼쪽 여백.
 *   - 4열(md↑): 여기에 `4n+3` 칸도 줄 머리가 아니게 되므로 → 구분선 + 왼쪽 여백.
 *
 * `border-l-0` 으로 되돌리는 규칙을 두지 않는 이유: `[&:nth-child(…)]` 와 `md:[&:nth-child(…)]` 는
 * 특이도가 같아서 어느 쪽이 이기는지가 생성 순서에 달린다. 두 규칙이 같은 값을 더하기만 하면
 * 순서와 무관하게 결과가 하나뿐이다. 항목 수가 4개에서 늘어도 같은 규칙이 그대로 성립한다.
 */
const TRUST_DIVIDER =
  "[&:nth-child(2n)]:border-l [&:nth-child(2n)]:border-line [&:nth-child(2n)]:pl-5" +
  " md:[&:nth-child(4n+3)]:border-l md:[&:nth-child(4n+3)]:border-line md:[&:nth-child(4n+3)]:pl-5";

export function TrustSignals({ dict }: SectionProps) {
  return (
    <section className="border-b border-line bg-surface">
      {/* 헤딩은 자기 줄로 — 배지 격자와 축을 섞지 않으면 두 열/네 열 어디서도 정렬이 흔들리지 않는다. */}
      <div className={cn(WRAP, "py-5")}>
        <span className="block text-[13px] font-semibold text-muted">{dict.trust.heading}</span>
        <div className="mt-3.5 grid grid-cols-2 gap-y-4 md:grid-cols-4">
          {dict.trust.items.map((s, i) => (
            <div key={s.title} className={cn("flex items-start gap-2.5 pr-5", TRUST_DIVIDER)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-0.5 size-[18px] shrink-0 text-accent" aria-hidden="true">
                {TRUST_ICONS[i]}
              </svg>
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">{s.title}</span>
                <span className="block text-[11.5px] text-muted">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Features (교차행 + 실제 스크린샷)  ───────────────────────────── */

/**
 * 기능 블록 구조(비번역): 스크린샷 키·주소줄 URL. dict.features.items 와 index 로 결합.
 * 주소줄은 실제 서비스 호스트를 쓴다 — 이전에는 DNS 가 없는 `app.reputationpool.io` 를 보여줬다.
 */
const FEATURE_STRUCT: { shot: string; url: string }[] = [
  { shot: "overview", url: `${SITE_HOST}/overview` },
  { shot: "detail", url: `${SITE_HOST}/resources/proxy` },
  { shot: "events", url: `${SITE_HOST}/events` },
];

/**
 * 제품 쇼케이스. 섹션 헤더를 가운데로 넓게 펼치고, 그 아래에 기능 블록을 하나씩 쌓는다 —
 * 각 블록은 [가운데 정렬 설명 → 컨테이너 전체 폭 스크린샷] 이다.
 *
 * <b>왜 좌우 교차(2단) 배치를 버렸나.</b> 이전 구조는 `lg:grid-cols-[1fr_1.15fr]` 에 `lg:order-*` 로
 * 좌우만 뒤집었는데, 순서만 바뀌고 **컬럼 폭은 그대로**여서 짝수 행 스크린샷이 좁은 `1fr` 쪽에 들어갔다.
 * 결과적으로 같은 크기(2880×1920)인 세 스크린샷이 화면에서 서로 다른 크기로 보였다. 세 장을 "같은 제품의
 * 연속된 화면"으로 읽히게 하려면 폭이 같아야 하고, 그건 한 컬럼에 쌓을 때 자동으로 보장된다.
 * `items-center` 로 텍스트가 행 중앙에 떠서 블록마다 시작 높이가 달라 보이던 문제도 같이 사라진다.
 */
export function Features({ dict, locale }: SectionProps) {
  return (
    <section id="features" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <SectionHead label={dict.features.label} heading={dict.features.heading} locale={locale} />

        <div className="mt-16 flex flex-col gap-[104px]">
          {dict.features.items.map((f, i) => {
            const s = FEATURE_STRUCT[i];
            // 스크린샷은 로케일 일치: EN=영어 목업, KO=실제 대시보드. 테마별 라이트/다크 2종을 BrowserFrame 이 CSS 로 스왑.
            const shot = `/marketing/${s.shot}-${locale}`;
            return (
              <article key={f.kicker}>
                <div className={cn("mx-auto text-center", MEASURE_BODY[locale])}>
                  <span className="font-mono text-xs uppercase tracking-[0.05em] text-muted">{f.kicker}</span>
                  <h3 className="mt-3 text-balance text-[26px] font-semibold leading-snug tracking-tight text-ink">
                    {f.title}
                  </h3>
                  <p className="mt-3.5 text-pretty text-[15.5px] leading-relaxed text-muted">{f.body}</p>
                </div>
                {/* 컨테이너 전체 폭 — 세 스크린샷이 같은 비율(3:2)이라 높이까지 정확히 같아진다. */}
                <div className="mt-9">
                  <BrowserFrame
                    srcLight={`${shot}-light.png`}
                    srcDark={`${shot}-dark.png`}
                    alt={f.alt}
                    url={s.url}
                    enlargeLabel={dict.a11y.enlarge}
                    closeLabel={dict.a11y.closeDialog}
                  />
                </div>
              </article>
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

export function Capabilities({ dict, locale }: SectionProps) {
  return (
    <section className="border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <SectionHead label={dict.caps.label} heading={dict.caps.heading} body={dict.caps.intro} locale={locale} />
        <div className="mt-12 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
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

export function HowItWorks({ dict, locale }: SectionProps) {
  return (
    <section id="how" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <SectionHead label={dict.steps.label} heading={dict.steps.heading} body={dict.steps.intro} locale={locale} />
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

/**
 * docs 카드가 가리키는 실제 문서 슬러그(비번역) — dict.docs.items 와 index 로 결합.
 *
 * 이전에는 세 카드가 모두 공개 GitHub 레포를 가리켰다(전용 docs 라우트가 없어 404 회피용). 이제 docs 가
 * 실제로 존재하므로(#121) 각 카드가 해당 문서 페이지로 들어간다. URL 은 **슬러그 + 방문자 로케일**로
 * 매니페스트가 만든다(#143) — 경로를 손으로 적어 두면 한국어 랜딩의 카드가 영어 문서로 떨어진다.
 *
 * 타입을 `string[]` 이 아니라 **사전 항목 튜플에서 매핑**해 만든다. index 로 결합하는 두 목록이라
 * 길이가 어긋나면 `docsHref(undefined, locale)` 가 되어 `/docs/undefined` 링크가 조용히 나가는데,
 * 그건 렌더도 되고 테스트도 통과한다(404 는 배포 후에야 보인다). 이 매핑이 그 어긋남을 컴파일 시점에
 * 잡는다 — 사전에 카드를 추가하면 여기서 원소가 하나 모자란다고 컴파일이 깨진다.
 */
type SlugsMatching<T extends readonly unknown[]> = { [K in keyof T]: string };
const DOCS_CARD_SLUGS: SlugsMatching<Dict["docs"]["items"]> = ["quickstart", "api", "concepts"];

export function Docs({ dict, locale }: SectionProps) {
  return (
    // id="docs" 는 남겨 둔다 — nav·히어로 CTA 는 이제 docs 사이트로 가지만, 밖에서 공유된 `#docs` 링크가
    // 아무 데도 도착하지 않는 것보다 이 섹션에 도착하는 편이 낫다.
    <section id="docs" className="scroll-mt-20 border-b border-line">
      <div className={cn(WRAP, "py-[88px]")}>
        <SectionHead label={dict.docs.label} heading={dict.docs.heading} body={dict.docs.intro} locale={locale} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dict.docs.items.map((d, i) => (
            <Link
              key={d.title}
              href={docsHref(DOCS_CARD_SLUGS[i], locale)}
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
        {/* 엔진 레포 링크는 유지한다 — 문서가 생겼어도 "판단 로직을 직접 읽을 수 있다"는 건 진짜 신뢰 신호다. */}
        <p className="mt-8 text-center text-[14px] text-muted">
          {dict.docs.engineNote}{" "}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-accent hover:underline"
          >
            {dict.docs.engineCta}
          </a>
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────  Contact (결제 없음 — mailto)  ───────────────────────────── */

export function Contact({ dict, locale }: SectionProps) {
  return (
    <section id="contact" className="scroll-mt-20 border-b border-line bg-code-bg text-center">
      <div className={cn(WRAP, "py-[84px]")}>
        <SectionHead
          label={dict.contact.label}
          heading={dict.contact.heading}
          body={dict.contact.body}
          locale={locale}
          tone="dark"
        />
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
function footerHrefs(locale: Locale): { href: string; external?: boolean }[][] {
  const base = LOCALE_PATH[locale];
  return [
    // Product: Features, How it works, Docs(→ 전용 docs 사이트 #121, 로케일 유지 #143), Status(#145)
    //
    // 상태 페이지는 푸터에서 링크한다 — 서비스가 이상할 때 사람이 제일 먼저 훑는 자리이고, 랜딩·docs
    // 어느 화면에서 막혔든 같은 위치에 있어야 하기 때문이다(푸터는 두 표면이 공유하는 유일한 영역이다).
    // 오리진 다운 화면(#134)에서의 링크는 앱 서버 쪽 레이어라 여기 범위가 아니다.
    [{ href: `${base}#features` }, { href: `${base}#how` }, { href: DOCS_ROOT[locale] }, { href: statusHref(locale) }],
    // Open source: GitHub, Engine, Changelog(→ Releases)
    [{ href: GITHUB_REPO_URL, external: true }, { href: GITHUB_REPO_URL, external: true }, { href: `${GITHUB_REPO_URL}/releases`, external: true }],
    // Company: Contact(mailto)
    [{ href: CONTACT_MAILTO }],
  ];
}

export function Footer({ dict, locale }: SectionProps) {
  const hrefs = footerHrefs(locale);
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

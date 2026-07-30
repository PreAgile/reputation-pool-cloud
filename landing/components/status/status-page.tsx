import { HtmlLang } from "@/components/html-lang";
import { CONTACT_MAILTO } from "@/components/marketing/constants";
import { getDict } from "@/components/marketing/i18n";
import { Footer } from "@/components/marketing/landing-sections";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatDuration,
  formatUtc,
  incidentsNewestFirst,
  isResolved,
  resolvedMinutes,
  serviceState,
  type Incident,
  type ServiceState,
  INCIDENTS,
  LOG_STARTED_ON,
} from "@/lib/incidents";
import type { Locale } from "@/lib/locale";

/**
 * 상태 페이지 본문 (#145) — 두 로케일 라우트(`app/status`·`app/ko/status`)가 공유한다.
 *
 * ## 왜 컴포넌트이고 라우트마다의 페이지가 아닌가
 * docs 셸(`components/docs/docs-shell.tsx`)과 같은 이유다. App Router 규칙상 라우트는 둘이어야 하지만
 * 구조가 두 벌 있으면 반드시 갈린다. 여기서는 그 위험이 특히 큰데, 이 화면의 존재 이유가 **정직하게
 * 말하는 것**이기 때문이다 — 한쪽 언어에서만 고지 문구가 빠지면 그 언어의 독자는 수동 로그를 자동
 * 관측으로 오해한다. 문구는 사전(`dict.status`)이, 사고는 `lib/incidents.ts` 가, 배치는 이 파일이
 * 각각 한 곳씩 맡는다.
 *
 * ## 이 화면이 하지 않는 것
 * 가용률 퍼센트를 만들지 않는다. 관측이 없으므로 계산할 재료가 없고, 있는 척하는 숫자는 없는 것보다
 * 나쁘다. 대신 업타임 섹션이 "왜 아직 없고 무엇이 그 자리에 들어올 것인지"를 적는다.
 *
 * 자동 새로고침도 하지 않는다. 정적 내보내기라 이 HTML 은 빌드 시점에 굳고, 갱신은 사고를 기입해
 * 다시 배포할 때 일어난다. 그래서 진행 중 사고의 "지속 시간"도 표시하지 않는다 —
 * `resolvedMinutes()` 가 진행 중에 `null` 을 주는 것이 그 결정을 코드로 못 박은 것이다.
 */

/** 본문 폭 — docs 보다 좁다. 이 페이지는 훑어보는 화면이지 읽어 내려가는 문서가 아니다. */
const WRAP = "mx-auto w-full max-w-[720px] px-6";

/**
 * 현재 상태 배너의 색.
 *
 * `no-recorded-incident` 에 **초록을 쓰지 않는다.** 초록 점은 "방금 확인했고 멀쩡하다"로 읽히는데
 * 지금 우리가 아는 것은 "아무도 열린 사고를 적지 않았다"뿐이다. 자동 관측이 붙으면 그때 초록을
 * 쓸 자격이 생긴다. 색은 보조 신호일 뿐이고 상태는 언제나 문장으로도 적힌다(색각·흑백 대응).
 */
const STATE_STYLE: Record<ServiceState, { dot: string; text: string }> = {
  "no-recorded-incident": { dot: "bg-muted", text: "text-ink" },
  degraded: { dot: "bg-cool", text: "text-cool-ink" },
  outage: { dot: "bg-block", text: "text-block-ink" },
};

/** 심각도 배지 색. 라벨 텍스트가 항상 함께 나가므로 색은 거들 뿐이다. */
const SEVERITY_STYLE = {
  outage: "bg-block/12 text-block-ink",
  degraded: "bg-cool/12 text-cool-ink",
} as const;

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[20px] font-bold tracking-tight text-ink">
      {children}
    </h2>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-pretty text-[15px] leading-relaxed text-muted">{children}</p>;
}

/** 사고 한 건. 발생·종료·지속을 `<dl>` 로 두어 라벨과 값의 관계가 스크린리더에도 남게 한다. */
function IncidentEntry({ incident, locale, dict }: { incident: Incident; locale: Locale; dict: StatusCopy }) {
  const resolved = isResolved(incident);
  const minutes = resolvedMinutes(incident);
  return (
    <li id={`incident-${incident.id}`} className="scroll-mt-20 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-[6px] px-2 py-0.5 text-[11.5px] font-bold tracking-wide",
            SEVERITY_STYLE[incident.severity],
          )}
        >
          {dict.log.severity[incident.severity]}
        </span>
        <span className="rounded-[6px] border border-line px-2 py-0.5 text-[11.5px] font-semibold text-muted">
          {resolved ? dict.log.resolved : dict.log.ongoing}
        </span>
      </div>

      <h3 className="mt-2.5 text-[16.5px] font-semibold tracking-tight text-ink">{incident.title[locale]}</h3>

      <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[12.5px] text-muted">
        <div className="flex gap-1.5">
          <dt className="font-semibold">{dict.log.startedLabel}</dt>
          <dd>
            <time dateTime={incident.startedAt}>{formatUtc(incident.startedAt)}</time>
          </dd>
        </div>
        {incident.resolvedAt !== null && (
          <div className="flex gap-1.5">
            <dt className="font-semibold">{dict.log.endedLabel}</dt>
            <dd>
              <time dateTime={incident.resolvedAt}>{formatUtc(incident.resolvedAt)}</time>
            </dd>
          </div>
        )}
        {minutes !== null && (
          <div className="flex gap-1.5">
            <dt className="font-semibold">{dict.log.durationLabel}</dt>
            <dd>{formatDuration(minutes, locale)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 max-w-[62ch] text-pretty text-[15px] leading-relaxed text-muted">
        {incident.narrative[locale]}
      </p>
    </li>
  );
}

/** 사전의 상태 페이지 슬라이스만 따로 부르는 이름 — 하위 컴포넌트가 사전 전체를 받지 않게. */
type StatusCopy = ReturnType<typeof getDict>["status"];

/**
 * @param incidents 기본값이 로그의 단일 출처(`INCIDENTS`)다. 이 컴포넌트는 로그에 대한 **순수한 뷰**이고
 *   자기 데이터를 가져오지 않으므로, 인자를 열어 두면 실제 로그를 오염시키지 않고 사고가 있는 화면을
 *   렌더해 볼 수 있다. 두 라우트는 이 인자를 넘기지 않는다 — 넘기는 순간 로그가 두 곳이 된다.
 */
export function StatusPage({ locale, incidents: log = INCIDENTS }: { locale: Locale; incidents?: Incident[] }) {
  const dict = getDict(locale);
  const copy = dict.status;
  const state = serviceState(log);
  const incidents = incidentsNewestFirst(log);

  return (
    <div lang={locale} className="flex min-h-screen flex-col bg-bg">
      <HtmlLang lang={locale} />
      <MarketingNav nav={dict.nav} a11y={dict.a11y} locale={locale} />

      <main className={cn(WRAP, "flex-1 py-10 lg:py-14")}>
        <header>
          <h1 className="text-balance text-[32px] font-bold leading-tight tracking-tight text-ink">
            {copy.heading}
          </h1>
          <p className="mt-3 max-w-[62ch] text-pretty text-[16px] leading-relaxed text-muted">{copy.lead}</p>
        </header>

        {/* 현재 상태 — 이 페이지에서 가장 먼저 읽히는 한 줄. */}
        <section aria-labelledby="current-state" className="mt-8 rounded-[14px] border border-line bg-surface p-5">
          <h2 id="current-state" className="text-xs font-bold uppercase tracking-[0.06em] text-muted">
            {copy.state.label}
          </h2>
          <p className={cn("mt-2 flex items-center gap-2.5 text-[17px] font-semibold", STATE_STYLE[state].text)}>
            {/* 점은 장식이다 — 같은 내용이 바로 옆 문장에 있으므로 보조기기에서 숨긴다. */}
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATE_STYLE[state].dot)} />
            {state === "outage" ? copy.state.outage : state === "degraded" ? copy.state.degraded : copy.state.none}
          </p>
          <p className="mt-3 max-w-[62ch] text-pretty text-[13.5px] leading-relaxed text-muted">
            {copy.state.derivedFrom}
          </p>
        </section>

        <section aria-labelledby="uptime" className="mt-10">
          <SectionHeading id="uptime">{copy.uptime.heading}</SectionHeading>
          <Body>{copy.uptime.absent}</Body>
          <Body>{copy.uptime.rejected}</Body>
          <Body>{copy.uptime.next}</Body>
        </section>

        <section aria-labelledby="incidents" className="mt-10">
          <SectionHeading id="incidents">{copy.log.heading}</SectionHeading>
          <p className="mt-3 font-mono text-[12.5px] text-muted">
            <span className="font-semibold">{copy.log.sinceLabel}</span>{" "}
            <time dateTime={LOG_STARTED_ON}>{LOG_STARTED_ON}</time> (UTC)
          </p>
          <Body>{copy.log.scope}</Body>

          {incidents.length === 0 ? (
            <p className="mt-5 rounded-[12px] border border-dashed border-line px-4 py-5 text-[15px] text-muted">
              {copy.log.empty}
            </p>
          ) : (
            <ol className="mt-6 space-y-6">
              {incidents.map((incident) => (
                <IncidentEntry key={incident.id} incident={incident} locale={locale} dict={copy} />
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="independence" className="mt-10">
          <SectionHeading id="independence">{copy.independence.heading}</SectionHeading>
          <Body>{copy.independence.body}</Body>
        </section>

        <section aria-labelledby="report" className="mt-10 border-t border-line pt-8">
          <SectionHeading id="report">{copy.report.heading}</SectionHeading>
          <Body>{copy.report.body}</Body>
          <a href={CONTACT_MAILTO} className={buttonClass("primary", "mt-4 inline-flex items-center justify-center")}>
            {copy.report.cta}
          </a>
        </section>
      </main>

      <Footer dict={dict} locale={locale} />
    </div>
  );
}

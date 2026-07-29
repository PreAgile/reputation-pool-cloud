import Link from "next/link";
import { cn } from "@/lib/cn";
import { docsHref } from "@/lib/docs-manifest";
import type { Locale } from "@/lib/locale";

/**
 * docs 본문을 조립하는 프레젠테이션 프리미티브 (#121).
 *
 * 페이지마다 같은 Tailwind 클래스 뭉치를 다시 적으면 여섯 페이지가 서로 조금씩 다른 타이포로 갈라진다.
 * 그래서 문단·헤딩·코드 블록·콜아웃·엔드포인트 헤더를 여기 한 곳에 두고 페이지는 **내용만** 쓴다.
 * 로케일별 페이지가 둘(en·ko)이 된 뒤에는 이 단일화가 더 중요해졌다 — 프로즈는 갈려도 타이포는
 * 갈리지 않아야 한다(#143).
 *
 * MDX 툴체인은 쓰지 않는다(이 PR 에서 런타임 의존성을 늘리지 않는다) — 평범한 TSX 컴포넌트이므로
 * 타입 검사와 vitest 렌더가 그대로 적용되고, 코드 스니펫 안에 인라인 강조를 섞을 때도 별도 파서가
 * 필요 없다.
 */

/* ─────────────────────────────  본문 타이포  ───────────────────────────── */

/** 페이지 머리 — h1 + 매니페스트의 한 줄 요약(리드). */
export function PageHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <header className="border-b border-line pb-7">
      <h1 className="text-balance text-[34px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
      <p className="mt-3 text-pretty text-[17px] leading-relaxed text-muted">{summary}</p>
    </header>
  );
}

/**
 * 본문 섹션. `id` 를 받으므로 다른 문서에서 `#anchor` 로 깊게 링크할 수 있고, `scroll-mt-20` 으로
 * sticky nav 아래에 헤딩이 가려지지 않는다.
 */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 scroll-mt-20" id={id}>
      <h2 className="text-[22px] font-bold tracking-tight text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 섹션 안의 소제목. */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-7 text-[16.5px] font-semibold tracking-tight text-ink">{children}</h3>;
}

/** 본문 문단. 한 줄 길이는 읽기 편한 폭으로 제한한다. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3.5 max-w-[68ch] text-pretty text-[15.5px] leading-relaxed text-muted">{children}</p>;
}

/** 불릿 목록. */
export function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-3.5 max-w-[68ch] list-disc space-y-2 pl-5 text-[15.5px] leading-relaxed text-muted">
      {children}
    </ul>
  );
}

export function Bullet({ children }: { children: React.ReactNode }) {
  return <li className="text-pretty">{children}</li>;
}

/**
 * 인라인 코드. `whitespace-nowrap` 은 랜딩 사전과 같은 이유다 — 브라우저는 하이픈을 줄바꿈 지점으로
 * 보므로 `checkout-us` 가 `checkout-` / `us` 로 쪼개져 값이 달라 보인다.
 */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="whitespace-nowrap rounded-[5px] border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
      {children}
    </code>
  );
}

/** 본문 안의 강조(굵게). */
export function B({ children }: { children: React.ReactNode }) {
  return <b className="font-semibold text-ink">{children}</b>;
}

/** 외부 링크(새 탭). 내부 docs 링크는 `DocsLink` 를 쓴다. */
export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
      {children}
    </a>
  );
}

/**
 * 다른 docs 페이지로 가는 내부 링크(클라이언트 내비게이션).
 *
 * `href` 대신 **슬러그 + 로케일**을 받는다 (#143). 경로를 손으로 적게 두면 한국어 페이지에서
 * `/docs/concepts` 라고 쓰는 실수 한 번에 독자가 영어 문서로 넘어가고, 그건 리뷰에서 잡히기 어렵다.
 * 슬러그만 받으면 URL 은 매니페스트가 만들고 링크는 언제나 같은 로케일 안에 머문다.
 *
 * 같은 페이지 안의 앵커(`#blocklist`)는 로케일 문제가 없으므로 평범한 `<a>` 를 그대로 쓴다.
 */
export function DocsLink({
  slug,
  locale,
  children,
}: {
  slug: string;
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <Link href={docsHref(slug, locale)} className="font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}

/* ─────────────────────────────  코드 블록  ───────────────────────────── */

/**
 * 언어 라벨이 붙은 코드 블록. 랜딩 히어로의 코드 패널과 같은 터미널 톤(`code-*` 토큰)을 쓰므로
 * 라이트/다크 어디서든 코드가 같은 색으로 읽힌다.
 *
 * 라벨을 붙이는 이유: 퀵스타트 한 페이지에 curl·grpcurl·Java·TypeScript 가 연달아 나오는데, 라벨이
 * 없으면 어떤 블록을 어디에 붙여야 하는지 코드를 읽어서 짐작해야 한다.
 *
 * `overflow-x-auto` 를 쓰되 긴 줄은 그대로 넘긴다 — 코드에 임의 줄바꿈을 넣으면 복붙이 깨진다.
 */
export function CodeBlock({
  language,
  title,
  children,
}: {
  language: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="mt-4 overflow-hidden rounded-[12px] border border-line">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/5 bg-code-bg px-4 py-2">
        <span className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.06em] text-code-muted">
          {language}
        </span>
        {title != null && <span className="truncate font-mono text-[11.5px] text-code-muted">{title}</span>}
      </figcaption>
      <pre className="overflow-x-auto bg-code-bg px-4 py-4 font-mono text-[13px] leading-[1.75] text-code-ink">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/* ─────────────────────────────  콜아웃  ───────────────────────────── */

type CalloutTone = "note" | "warn";

const CALLOUT_STYLE: Record<CalloutTone, string> = {
  note: "border-accent/25 bg-accent-soft",
  warn: "border-cool/40 bg-cool/10",
};

/**
 * 주의/참고 블록. 색만으로 구분하지 않고 제목 텍스트를 항상 함께 노출한다 — 색각 이상이나 흑백
 * 인쇄에서도 "이건 경고다"가 읽혀야 하기 때문이다(a11y).
 */
export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: CalloutTone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className={cn("mt-5 max-w-[68ch] rounded-[12px] border p-4", CALLOUT_STYLE[tone])}>
      <p className="text-[13.5px] font-bold text-ink">{title}</p>
      <div className="mt-1.5 text-[14.5px] leading-relaxed text-muted [&>*:first-child]:mt-0">{children}</div>
    </aside>
  );
}

/* ─────────────────────────────  엔드포인트 헤더  ───────────────────────────── */

export type HttpMethod = "GET" | "POST" | "DELETE";

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET: "bg-accent/12 text-accent",
  POST: "bg-ok/12 text-ok-ink",
  DELETE: "bg-block/12 text-block-ink",
};

/**
 * REST 리퍼런스의 엔드포인트 머리 — 메서드 배지 + 경로 + 한 줄 설명.
 *
 * `id` 를 받아 `<h3>` 를 앵커로 만든다: API 문서에서 가장 잦은 사용 방식이 "이 엔드포인트 링크 좀"
 * 이므로, 엔드포인트마다 고유 URL 이 있어야 한다.
 */
export function Endpoint({
  id,
  method,
  path,
  children,
}: {
  id: string;
  method: HttpMethod;
  path: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-8 scroll-mt-20 border-t border-line pt-6 first:mt-0 first:border-t-0 first:pt-0" id={id}>
      <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className={cn(
            "rounded-[6px] px-2 py-0.5 font-mono text-[11.5px] font-bold tracking-wide",
            METHOD_STYLE[method],
          )}
        >
          {method}
        </span>
        <span className="break-all font-mono text-[14.5px] font-semibold text-ink">{path}</span>
      </h3>
      {children}
    </div>
  );
}

/* ─────────────────────────────  표  ───────────────────────────── */

/**
 * 파라미터/필드 표. 넓은 표가 페이지 전체를 좌우로 스크롤시키지 않도록 자기 컨테이너 안에서만
 * 넘치게 한다(`overflow-x-auto`).
 */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead className="bg-surface-2">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-line align-top">{children}</tr>;
}

export function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-3.5 py-2.5 text-muted">{children}</td>;
}

import Link from "next/link";
import { docsHref, docsNeighbours } from "@/lib/docs-manifest";
import type { Locale } from "@/lib/locale";

/**
 * 본문 하단 prev/next (#121). 순서는 사이드바와 같은 원본(`lib/docs-manifest.ts`)에서 나온다.
 *
 * 경계는 비운다: 첫 페이지에 prev 가 없고 마지막 페이지에 next 가 없다. 문서를 순환시키면(마지막 →
 * 처음) "여기가 끝"이라는 신호가 사라져서 독자가 같은 문서를 두 번 돈다. 한쪽만 있을 때 남은 링크가
 * 반대편으로 밀리지 않도록 `justify-between` 대신 두 칸 격자를 쓰고 빈 칸을 자리로 남긴다.
 *
 * prev/next 는 **절대 로케일을 넘지 않는다** (#143). 이웃은 슬러그로 계산하고 URL 은 이 페이지의
 * 로케일 루트에서 만들기 때문에, 한국어 문서를 순서대로 읽다가 다음 장에서 영어가 튀어나오는 일이
 * 구조적으로 불가능하다 — 언어를 바꾸는 것은 스위처의 일이다.
 */

/** 방향 라벨. 화살표는 방향이므로 번역하지 않고, 단어만 로케일에 맞춘다. */
const PAGER_LABEL: Record<Locale, { nav: string; prev: string; next: string }> = {
  en: { nav: "Pagination", prev: "← Previous", next: "Next →" },
  ko: { nav: "문서 페이지 이동", prev: "← 이전", next: "다음 →" },
};

export function DocsPager({ slug, locale }: { slug: string; locale: Locale }) {
  const { prev, next } = docsNeighbours(slug);
  if (prev == null && next == null) return null;
  const label = PAGER_LABEL[locale];

  return (
    <nav aria-label={label.nav} className="mt-14 grid gap-3 border-t border-line pt-7 sm:grid-cols-2">
      {prev != null ? (
        <Link
          href={docsHref(prev.slug, locale)}
          className="rounded-[12px] border border-line bg-surface p-4 transition hover:border-accent"
        >
          <span className="block text-[12px] font-semibold text-muted">{label.prev}</span>
          <span className="mt-1 block text-[15px] font-semibold text-ink">{prev.title[locale]}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next != null && (
        <Link
          href={docsHref(next.slug, locale)}
          className="rounded-[12px] border border-line bg-surface p-4 text-right transition hover:border-accent sm:col-start-2"
        >
          <span className="block text-[12px] font-semibold text-muted">{label.next}</span>
          <span className="mt-1 block text-[15px] font-semibold text-ink">{next.title[locale]}</span>
        </Link>
      )}
    </nav>
  );
}

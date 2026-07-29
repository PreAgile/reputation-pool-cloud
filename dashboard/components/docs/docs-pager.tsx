import Link from "next/link";
import { docsHref, docsNeighbours } from "@/lib/docs-manifest";

/**
 * 본문 하단 prev/next (#121). 순서는 사이드바와 같은 원본(`lib/docs-manifest.ts`)에서 나온다.
 *
 * 경계는 비운다: 첫 페이지에 prev 가 없고 마지막 페이지에 next 가 없다. 문서를 순환시키면(마지막 →
 * 처음) "여기가 끝"이라는 신호가 사라져서 독자가 같은 문서를 두 번 돈다. 한쪽만 있을 때 남은 링크가
 * 반대편으로 밀리지 않도록 `justify-between` 대신 두 칸 격자를 쓰고 빈 칸을 자리로 남긴다.
 */
export function DocsPager({ slug }: { slug: string }) {
  const { prev, next } = docsNeighbours(slug);
  if (prev == null && next == null) return null;

  return (
    <nav aria-label="Pagination" className="mt-14 grid gap-3 border-t border-line pt-7 sm:grid-cols-2">
      {prev != null ? (
        <Link
          href={docsHref(prev.slug)}
          className="rounded-[12px] border border-line bg-surface p-4 transition hover:border-accent"
        >
          <span className="block text-[12px] font-semibold text-muted">← Previous</span>
          <span className="mt-1 block text-[15px] font-semibold text-ink">{prev.title}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next != null && (
        <Link
          href={docsHref(next.slug)}
          className="rounded-[12px] border border-line bg-surface p-4 text-right transition hover:border-accent sm:col-start-2"
        >
          <span className="block text-[12px] font-semibold text-muted">Next →</span>
          <span className="mt-1 block text-[15px] font-semibold text-ink">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}

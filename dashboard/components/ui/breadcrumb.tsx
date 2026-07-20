import Link from "next/link";
import { cn } from "@/lib/cn";

/** 한 조각. href 있으면 링크, 마지막 항목은 항상 현재 위치(aria-current)로 표기. */
export type Crumb = { label: string; href?: string };

/**
 * 경로형 브레드크럼. `<nav aria-label>` + `<ol>` 로 위치 계층을 알리고,
 * 마지막 조각에 aria-current="page" 를 붙인다. 구분자(/)는 장식이라 스크린리더에서 숨긴다.
 */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  // 항목이 없으면 빈 nav를 남기지 않고 아무것도 그리지 않는다.
  if (items.length === 0) return null;
  return (
    <nav aria-label="위치 경로" className={cn("mb-4", className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="font-semibold text-muted hover:text-ink">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "max-w-[16rem] truncate",
                    last ? "font-bold text-ink" : "font-semibold text-muted",
                  )}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-muted">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

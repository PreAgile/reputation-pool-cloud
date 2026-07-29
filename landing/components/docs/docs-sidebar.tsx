"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { docsHref, docsSections } from "@/lib/docs-manifest";

/**
 * docs 좌측 사이드바 (#121) — 섹션·페이지 목록을 `lib/docs-manifest.ts` 에서 파생한다.
 *
 * 현재 페이지는 `usePathname()` 으로 판별한다(레이아웃에서 슬러그를 내려주지 않는다): docs 하위 여섯
 * 페이지가 전부 같은 레이아웃을 공유하므로, 각 페이지가 "나는 누구다"를 사이드바에 전달하는 배선을
 * 여섯 번 반복하는 대신 경로 한 곳에서 읽는다. 활성 표시는 색뿐 아니라 `aria-current="page"` 로도
 * 노출한다 — 색만으로는 스크린리더에 아무 정보가 아니다(대시보드 `AppShell` 과 같은 규칙).
 *
 * 모바일에서는 목록을 접는다. 데스크톱 목록과 모바일 목록을 각각 렌더하면 같은 링크가 DOM 에 두 벌
 * 생기므로(스크린리더에 중복 내비게이션), 목록은 **한 벌만** 두고 lg 미만에서만 토글 버튼으로
 * 여닫는다. `lg:block` 이 항상 이기므로 데스크톱에서는 토글 상태와 무관하게 항상 펼쳐져 있다.
 */
export function DocsSidebar({ label = "Docs" }: { label?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = docsSections();

  return (
    <nav aria-label={label} className="lg:sticky lg:top-[76px] lg:w-[220px] lg:shrink-0 lg:self-start">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="docs-nav-list"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 text-sm font-semibold text-ink lg:hidden"
      >
        {label}
        <svg
          viewBox="0 0 16 16"
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>

      <div id="docs-nav-list" className={cn("mt-3 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        {sections.map((group) => (
          <div key={group.section} className="mb-5 last:mb-0">
            <p className="px-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">{group.section}</p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {group.pages.map((page) => {
                const href = docsHref(page.slug);
                const active = pathname === href;
                return (
                  <li key={page.slug}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block rounded-[9px] px-3 py-1.5 text-[14px]",
                        active
                          ? "bg-accent-soft font-semibold text-accent"
                          : "font-medium text-muted hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

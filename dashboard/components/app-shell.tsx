"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";
import { UserMenu } from "./user-menu";

/** 사이드바 접힘 상태 localStorage 키. "1"=접힘, 그 외=펼침. */
const COLLAPSE_KEY = "rp_sidebar_collapsed";

type NavItem = { href: string; label: string; icon: React.ReactNode };

/** 16px 스트로크 아이콘(접힌 레일에서 라벨 대신 노출). currentColor 로 상태색 상속. */
const NAV: NavItem[] = [
  {
    href: "/overview",
    label: "풀 오버뷰",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/events",
    label: "라이브 이벤트",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 8h3l2-5 3 10 2-5h3" />
      </svg>
    ),
  },
  {
    href: "/keys",
    label: "API 키",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="5" cy="5" r="3" />
        <path d="M7 7l6 6M11 11l1.5-1.5M13 13l1.5-1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/usage",
    label: "사용량",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 14V2M2 14h12" />
        <path d="M5 11V8M8.5 11V5M12 11V9" />
      </svg>
    ),
  },
  {
    href: "/admin",
    label: "관리자",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M8 1.5l5.5 2v4c0 3-2.3 5.3-5.5 6.5C4.8 12.8 2.5 10.5 2.5 7.5v-4l5.5-2z" />
      </svg>
    ),
  },
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0 transition-transform", collapsed && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

/** 사이드바 항목 한 줄. 접힘 상태면 Radix Tooltip 으로 라벨을 노출한다(펼침이면 툴팁 없이 라벨만). */
function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const link = (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold",
        collapsed && "justify-center",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {item.icon}
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-opacity duration-200",
          collapsed && "sr-only",
        )}
      >
        {item.label}
      </span>
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink shadow-md"
        >
          {item.label}
          <Tooltip.Arrow className="fill-surface" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 접힘 상태를 localStorage 에서 복원(하이드레이션 후). 초기 SSR 은 항상 펼침.
  // 사생활 보호 모드/스토리지 차단 환경에서 localStorage 접근이 throw 할 수 있어 감싼다.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* localStorage 차단 환경 — 기본(펼침) 유지 */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* localStorage 차단 환경 — 상태만 전환하고 영속화는 생략 */
      }
      return next;
    });
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "flex shrink-0 flex-col gap-1 overflow-hidden border-r border-line bg-surface px-3 py-4 transition-[width] ease-out",
            collapsed ? "w-16" : "w-60",
          )}
          style={{ transitionDuration: "var(--motion-slow)" }}
        >
          <div className={cn("mb-2 px-3 py-2", collapsed && "px-0 text-center")}>
            <div className="text-sm font-extrabold tracking-tight">{collapsed ? "rp" : "reputation-pool"}</div>
            {!collapsed && <div className="text-xs text-muted">콘솔</div>}
          </div>

          <nav className="flex flex-col gap-1">
            {NAV.map((n) => {
              const active = path === n.href || path.startsWith(`${n.href}/`);
              return <NavLink key={n.href} item={n} active={active} collapsed={collapsed} />;
            })}
          </nav>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            className={cn(
              "mt-auto flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink",
              collapsed && "justify-center",
            )}
          >
            <ChevronIcon collapsed={collapsed} />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">접기</span>}
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/80 px-6 backdrop-blur">
            <div className="flex min-w-0 items-center gap-4">
              {/* Tenant Switcher 보류(#55): 멀티테넌트 미도입 → 단일 테넌트 정적 표시.
                  후속으로 멀티테넌트 도입 시 이 라벨을 Radix DropdownMenu 스위처로 교체한다. */}
              <span className="shrink-0 text-xs font-bold text-muted">
                tenant · <span className="text-ink">lemong</span>
              </span>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="명령 팔레트 열기"
                aria-keyshortcuts="Meta+K Control+K"
                className="flex min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-ink"
              >
                <SearchIcon />
                <span className="truncate">리소스·화면 검색</span>
                <kbd className="ml-1 hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline">
                  ⌘K
                </kbd>
              </button>
            </div>
            <UserMenu />
          </header>
          <main className="p-6">{children}</main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </Tooltip.Provider>
  );
}

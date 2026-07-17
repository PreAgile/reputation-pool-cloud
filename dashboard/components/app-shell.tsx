"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "풀 오버뷰" },
  { href: "/events", label: "라이브 이벤트" },
  { href: "/keys", label: "API 키" },
  { href: "/usage", label: "사용량" },
  { href: "/admin", label: "관리자" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-4">
        <div className="mb-2 px-3 py-2">
          <div className="text-sm font-extrabold tracking-tight">reputation-pool</div>
          <div className="text-xs text-muted">콘솔</div>
        </div>
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-[10px] px-3 py-2 text-sm font-semibold",
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={logout}
          className="mt-auto rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-muted hover:text-ink"
        >
          로그아웃
        </button>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface/80 px-6 backdrop-blur">
          <span className="text-xs font-bold text-muted">
            tenant · <span className="text-ink">lemong</span>
          </span>
          <ThemeToggle />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

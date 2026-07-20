"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";

/**
 * 상단바 우측 유저 메뉴. 기존 Radix DropdownMenu 재사용.
 * 테마 토글(라이트/다크) + 로그아웃(파괴적, 상태색 빨강)을 한 메뉴로 묶는다.
 * 테마 항목은 onSelect 에서 preventDefault 로 메뉴를 닫지 않고 즉시 전환한다.
 */
export function UserMenu() {
  const { logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuPrimitive.Trigger
        aria-label="계정 메뉴 열기"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface-2 text-sm font-bold text-ink",
          "transition-colors hover:bg-surface data-[state=open]:bg-surface",
        )}
      >
        <span aria-hidden="true">A</span>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <div className="px-2.5 py-1.5">
          <div className="text-sm font-bold text-ink">admin</div>
          <div className="text-xs text-muted">단일 테넌트 · lemong</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // 테마만 바꾸고 메뉴는 열어둔다(연속 전환 편의).
            e.preventDefault();
            setTheme(dark ? "light" : "dark");
          }}
        >
          <span aria-hidden="true" className="mr-2">
            {mounted ? (dark ? "☀︎" : "☾") : "☀︎"}
          </span>
          {mounted && dark ? "라이트 모드" : "다크 모드"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={logout}>
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

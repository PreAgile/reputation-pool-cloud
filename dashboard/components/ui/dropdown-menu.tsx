"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";

/**
 * Radix DropdownMenu 래퍼 — 행별 "⋯" 빠른 액션 메뉴.
 * role=menu·바깥클릭 닫힘·방향키(↑/↓/Home/End)·Esc 는 Radix 가 기본 제공한다.
 * enter/exit 는 globals 의 rp-anim-pop(origin scale+fade)로 그린다.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** "⋯" 아이콘 트리거(기본 트리거 버튼). label 로 스크린리더 이름을 준다. */
export function DropdownMenuIconTrigger({
  className,
  label = "작업 메뉴 열기",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger> & { label?: string }) {
  return (
    <DropdownMenuPrimitive.Trigger
      aria-label={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-[8px] text-lg leading-none text-muted",
        "transition-colors hover:bg-surface-2 hover:text-ink",
        "data-[state=open]:bg-surface-2 data-[state=open]:text-ink",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">⋯</span>
    </DropdownMenuPrimitive.Trigger>
  );
}

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "rp-anim-pop z-50 min-w-[10rem] rounded-[12px] border border-line bg-surface p-1 shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/** 메뉴 항목. destructive=true 면 파괴적 액션(폐기 등)이라 상태색 빨강으로 표시. */
export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center rounded-[8px] px-2.5 py-2 text-sm font-semibold outline-none",
        destructive
          ? "text-block-ink data-[highlighted]:bg-block/12"
          : "text-ink data-[highlighted]:bg-surface-2",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-line", className)}
      {...props}
    />
  );
}

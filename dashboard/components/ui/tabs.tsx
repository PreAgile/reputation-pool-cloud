"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

/**
 * Radix Tabs 래퍼. 헤드리스 프리미티브를 토스형 토큰으로 스타일한다.
 * role=tablist·방향키(←/→/Home/End)·활성 tab 포커스 관리는 Radix 가 기본 제공한다.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // 활성 칩: accent-soft 배경으로 전환(base 모션). 비활성은 muted → hover 시 ink.
        "rounded-full px-3 py-1.5 text-sm font-bold text-muted",
        "transition-[color,background-color] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-std)]",
        "hover:text-ink data-[state=active]:bg-accent-soft data-[state=active]:text-accent",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
}

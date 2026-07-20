"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

/**
 * 기간 프리셋. hours 는 평판 곡선(score-history?hours=)에, days 는 사용량 일별창 필터에 쓴다.
 * 커스텀 범위(캘린더 그리드)는 후속 작업 — 지금은 프리셋만 우선 제공한다.
 */
export type RangePreset = {
  key: "24h" | "7d" | "30d";
  label: string;
  hours: number;
  days: number;
};

export const RANGE_PRESETS: RangePreset[] = [
  { key: "24h", label: "최근 24시간", hours: 24, days: 1 },
  { key: "7d", label: "최근 7일", hours: 24 * 7, days: 7 },
  { key: "30d", label: "최근 30일", hours: 24 * 30, days: 30 },
];

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Radix Popover 기반 날짜 범위 피커. 트리거는 캘린더 아이콘 + 현재 라벨 필 버튼,
 * 팝오버는 프리셋 목록(선택 시 닫힘). fade+slide 애니메이션은 globals 의 rp-anim-popover.
 */
export function DateRangePicker({
  value,
  onChange,
  className,
  label = "기간 선택",
}: {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-label={`${label} · 현재 ${value.label}`}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-bold text-ink",
          "transition-colors hover:bg-surface-2 data-[state=open]:border-accent data-[state=open]:text-accent",
          className,
        )}
      >
        <CalendarIcon />
        {value.label}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          aria-label={label}
          className="rp-anim-popover z-50 w-44 rounded-[12px] border border-line bg-surface p-1 shadow-md"
        >
          {RANGE_PRESETS.map((p) => {
            const active = p.key === value.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-sm font-semibold transition-colors",
                  active ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2",
                )}
              >
                {p.label}
                {active && <CheckIcon />}
              </button>
            );
          })}
          {/* 커스텀 범위(캘린더 그리드)는 후속 — 지금은 프리셋만. */}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

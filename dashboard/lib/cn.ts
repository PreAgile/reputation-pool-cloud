import { twMerge } from "tailwind-merge";

/**
 * 조건부 className 합치기. tailwind-merge로 상충 유틸을 last-wins로 정규화한다
 * (예: cn("px-2", cond && "px-4") → 조건 성립 시 "px-4"만 남음).
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

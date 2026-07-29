"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * `label` 을 받는 이유: 이 버튼은 두 언어의 랜딩에 같이 놓인다. 예전에는 `aria-label` 이 한국어로
 * 박혀 있어 **영어 페이지에서도 스크린리더가 "테마 전환"을 읽었다.** 같은 내비게이션의
 * `LanguageSwitcher`·`BrowserFrame` 은 이미 사전에서 라벨을 받고 있었다 — 이것만 빠져 있었다.
 */
export function ThemeToggle({ label = "테마 전환" }: { label?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-[10px] border border-line px-2.5 py-1.5 text-sm text-muted hover:text-ink hover:bg-surface-2"
    >
      {mounted ? (dark ? "☾" : "☀︎") : "☀︎"}
    </button>
  );
}

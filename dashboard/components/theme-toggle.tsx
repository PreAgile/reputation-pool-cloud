"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label="테마 전환"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-[10px] border border-line px-2.5 py-1.5 text-sm text-muted hover:text-ink hover:bg-surface-2"
    >
      {mounted ? (dark ? "☾" : "☀︎") : "☀︎"}
    </button>
  );
}

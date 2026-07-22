"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { LOCALES, LOCALE_PATH, LOCALE_LABEL, type Locale } from "./i18n";

/**
 * 언어 스위처(AFFiNE식) — 지구본 + 현재 언어. 클릭 시 로케일 목록 드롭다운.
 * 각 항목은 해당 로케일 랜딩 경로(`/`·`/ko`)로 링크. 바깥클릭·Esc 로 닫힌다.
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1.5 text-[13px] font-medium text-muted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" strokeLinecap="round" />
        </svg>
        {LOCALE_LABEL[current]}
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 z-50 mt-1 min-w-[128px] rounded-[10px] border border-line bg-surface p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          {LOCALES.map((l) => (
            <li key={l} role="none">
              <Link
                role="menuitem"
                href={LOCALE_PATH[l]}
                onClick={() => setOpen(false)}
                aria-current={l === current ? "true" : undefined}
                className={cn(
                  "block rounded-[7px] px-2.5 py-1.5 text-[13px] hover:bg-surface-2",
                  l === current ? "font-semibold text-ink" : "text-muted",
                )}
              >
                {LOCALE_LABEL[l]}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

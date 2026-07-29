"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { localePathFor, rememberLocale } from "@/lib/locale";
import { LOCALES, LOCALE_LABEL, type Locale } from "./i18n";

/**
 * 언어 스위처(AFFiNE식) — 지구본 + 현재 언어. 클릭 시 로케일 목록 드롭다운.
 * 바깥클릭·Esc 로 닫힌다.
 *
 * (#110) 항목을 고르면 **이동 전에** `rp_locale` 쿠키를 심는다. 이게 자동 판별(`middleware.ts`)보다
 * 우선하므로, `/ko` 에서 English 를 골라 `/` 로 가도 다시 `/ko` 로 튕기지 않는다 — 자동 이동과
 * 되돌리기가 무한히 싸우는 루프를 쿠키 우선순위로 끊는다.
 *
 * (#143) 각 항목은 **지금 보고 있는 페이지의 그 언어 판**을 가리킨다. 이전에는 로케일 랜딩 경로
 * (`/`·`/ko`)로 고정돼 있었는데, 한국어 docs 가 생기면서 `/docs/api` 에서 한국어를 고르면 문서를 잃고
 * 랜딩으로 떨어졌다 — 스위처는 언어를 바꾸는 장치이고 위치를 바꾸는 장치가 아니다. 목적지는
 * `usePathname()` + `localePathFor()` 로 계산한다: 현재 슬러그를 레이아웃까지 내려보내는 배선을
 * 라우트마다 반복하는 대신 경로 한 곳에서 읽는다(`DocsSidebar` 가 활성 페이지를 판별하는 방식과 동일).
 *
 * `prefetch={false}` 인 이유: 프리페치는 클릭 **전에**(따라서 쿠키가 심기기 전에) 일어나므로,
 * 프리페치된 `/` 응답이 "쿠키 없음 → /ko 로 리다이렉트"인 상태로 캐시될 수 있다. 그 캐시를 쓰면
 * 쿠키를 심어도 되돌리기가 먹히지 않는다.
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
                href={localePathFor(pathname ?? "/", l)}
                prefetch={false}
                onClick={() => {
                  rememberLocale(l);
                  setOpen(false);
                }}
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

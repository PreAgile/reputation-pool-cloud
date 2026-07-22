"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";

/**
 * 스크린샷을 감싸는 가벼운 브라우저 크롬(트래픽 라이트 + 주소줄). 라이트/다크 캡처 2장을 CSS(`dark:`)로 스왑해
 * 현재 테마에 맞는 샷을 보여준다(JS·깜빡임 없음). 이미지를 클릭하면 전체화면 라이트박스로 확대한다.
 */
function ThemeImg({
  srcLight,
  srcDark,
  alt,
  priority,
  className,
}: {
  srcLight: string;
  srcDark: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const loading = priority ? "eager" : "lazy";
  // display:none(hidden) 쪽은 접근성 트리에서 빠지므로 양쪽 모두 alt 를 두어 보이는 쪽만 읽히게 한다.
  // 스크린샷은 정적 자산 — next/image 대신 <img>(자체 호스팅 PNG, 최적화 불필요).
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={srcLight} alt={alt} loading={loading} className={cn("block w-full dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={srcDark} alt={alt} loading={loading} className={cn("hidden w-full dark:block", className)} />
    </>
  );
}

export function BrowserFrame({
  srcLight,
  srcDark,
  alt,
  url = "app.reputation-pool.dev",
  enlargeLabel = "Enlarge screenshot",
  closeLabel = "Close",
  className,
  priority = false,
}: {
  srcLight: string;
  srcDark: string;
  alt: string;
  url?: string;
  enlargeLabel?: string;
  closeLabel?: string;
  className?: string;
  priority?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <figure
        className={cn(
          "overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
          className,
        )}
      >
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-block/70" />
            <span className="size-2.5 rounded-full bg-cool/70" />
            <span className="size-2.5 rounded-full bg-ok/70" />
          </span>
          <span className="ml-2 hidden flex-1 truncate rounded-md bg-surface px-2.5 py-1 text-center font-mono text-[11px] text-muted sm:block">
            {url}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={enlargeLabel}
          className="block w-full cursor-zoom-in"
        >
          <ThemeImg srcLight={srcLight} srcDark={srcDark} alt={alt} priority={priority} />
        </button>
      </figure>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[92vh] w-full max-w-[1200px] overflow-hidden rounded-[14px] border border-line shadow-2xl"
          >
            <ThemeImg srcLight={srcLight} srcDark={srcDark} alt={alt} priority className="max-h-[92vh] object-contain" />
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label={closeLabel}
              className="absolute right-2.5 top-2.5 grid size-9 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

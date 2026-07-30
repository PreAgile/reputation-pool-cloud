"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * 라이트박스 안에서 포커스를 순환시킬 때 대상이 되는 요소들. 지금 모달에는 닫기 버튼 하나뿐이지만,
 * 나중에 캡션이나 링크가 들어와도 트랩이 자동으로 따라오도록 일반 선택자로 둔다.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * 열려 있는 동안의 키보드 계약 (#140).
   *
   * 세 가지를 함께 처리해야 모달이 키보드 사용자에게 성립한다 — 하나라도 빠지면 "닫은 뒤 내가 어디
   * 있는지 모르는" 상태가 된다.
   *
   * 1. **트리거 기억과 복원.** 열 때 "확대" 버튼을 잡아 두고 닫힐 때 그리로 돌려보낸다. Escape·닫기
   *    버튼·배경 클릭 어느 경로로 닫혀도 cleanup 한 곳을 지나므로 복원이 한 번만, 빠짐없이 일어난다.
   * 2. **포커스 트랩.** Tab 이 모달을 빠져나가면 뒤에 있는 랜딩 전체를 훑게 된다. 마지막 요소에서
   *    Tab, 첫 요소에서 Shift+Tab 을 잡아 되감는다.
   * 3. **배경 비활성화.** `aria-modal` 은 스크린리더에게 알리는 신호일 뿐 포커스를 막지 않는다.
   *    `inert` 는 포커스와 접근성 트리 양쪽에서 빼므로 둘을 같이 쓴다. 다이얼로그를 `document.body`
   *    로 포털하는 이유가 여기 있다 — 그래야 "배경" 이 body 의 나머지 직계 자식으로 딱 떨어진다.
   *    (포털은 덤으로 조상의 `overflow:hidden`·`transform` 이 만드는 컨테이닝 블록도 벗어난다.)
   *
   * Radix Dialog 를 들이면 1~3 이 공짜지만 랜딩의 런타임 의존성은 여섯 개뿐이고, 이 모달의 포커스
   * 대상은 닫기 버튼 하나다. 마케팅 페이지 번들에 다이얼로그 라이브러리를 얹을 이유가 되지 않는다.
   */
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeRef.current?.focus();

    const backdrop = dialogRef.current;
    const madeInert: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === backdrop || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      madeInert.push(child);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !backdrop) return;
      const focusable = Array.from(backdrop.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !backdrop.contains(active);
      if (e.shiftKey ? active === first || outside : active === last || outside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      madeInert.forEach((el) => el.removeAttribute("inert"));
      trigger?.focus();
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
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={enlargeLabel}
          className="block w-full cursor-zoom-in"
        >
          <ThemeImg srcLight={srcLight} srcDark={srcDark} alt={alt} priority={priority} />
        </button>
      </figure>

      {open &&
        createPortal(
          <div
            ref={dialogRef}
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
              <ThemeImg
                srcLight={srcLight}
                srcDark={srcDark}
                alt={alt}
                priority
                className="max-h-[92vh] object-contain"
              />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={closeLabel}
                className="absolute right-2.5 top-2.5 grid size-9 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

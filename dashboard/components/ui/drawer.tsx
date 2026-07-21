"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

/**
 * 우측에서 슬라이드로 열리는 시트(Drawer). Radix Dialog(스크림·focus trap·aria-modal·Esc·바깥클릭)
 * 위에 얹어, 리스트에서 벗어나지 않고 상세를 미리 보는 "맥락 유지" 패턴에 쓴다(#52 P4).
 * 열림 상태는 부모가 제어한다(controlled). 애니메이션은 globals.css 의 rp-anim-drawer.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="rp-anim-scrim fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "rp-anim-drawer fixed right-0 top-0 z-50 flex h-full w-[min(26rem,92vw)] flex-col",
            "border-l border-line bg-surface shadow-lg focus:outline-none",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-extrabold tracking-tight text-ink">
                {title}
              </Dialog.Title>
              {description != null && (
                <Dialog.Description className="mt-0.5 truncate text-xs text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="미리보기 닫기"
              className="-mr-1 shrink-0 rounded-[8px] p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

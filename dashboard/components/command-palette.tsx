"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { api } from "@/lib/api";
import type { PoolOverview, ResourceKind, ResourceOverview } from "@/lib/types";
import { cn } from "@/lib/cn";

/** 팔레트에서 이동할 수 있는 6개 화면(사이드바 내비와 1:1). */
const SCREENS: { href: string; label: string; hint: string }[] = [
  { href: "/", label: "풀 오버뷰", hint: "등록 리소스 평판 상태" },
  { href: "/events", label: "라이브 이벤트", hint: "실시간 감사 이벤트" },
  { href: "/keys", label: "API 키", hint: "키 발급·폐기" },
  { href: "/usage", label: "사용량", hint: "임대·풀 규모" },
  { href: "/admin", label: "관리자", hint: "테넌트·헬스" },
];

const KIND_LABEL: Record<ResourceKind, string> = {
  PROXY: "프록시",
  ACCOUNT: "계정",
  SESSION: "세션",
};

function detailHref(r: ResourceOverview): string {
  return `/resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.value)}`;
}

/**
 * 커맨드 팔레트(⌘K). Radix Dialog(스크림·focus trap·aria-modal) + cmdk(필터·↑↓/↵) 조합.
 * 항목: 6개 화면 이동 + 오버뷰 데이터에서 리소스 값 검색 → 상세로 점프.
 * 리소스 목록은 열릴 때 한 번 /pools/resources 로 받아 캐시한다(닫아도 유지).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [resources, setResources] = useState<ResourceOverview[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 전역 단축키 ⌘K / Ctrl+K 로 토글(Esc·바깥클릭 닫기는 Radix Dialog 가 처리).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // 열릴 때 한 번만 오버뷰 데이터를 받아 리소스 검색 소스로 쓴다(실패는 조용히 무시 — 화면 이동은 항상 가능).
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    api<PoolOverview>("/pools/resources")
      .then((d) => {
        // 204/빈 본문/예상 밖 구조여도 안전하게 — d?.resources 가 없으면 검색 소스만 비활성.
        if (alive && d?.resources) {
          setResources(d.resources);
          setLoaded(true);
        }
      })
      .catch(() => {
        /* 검색 소스가 없어도 화면 이동 항목은 동작한다 */
      });
    return () => {
      alive = false;
    };
  }, [open, loaded]);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="rp-anim-scrim fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-label="명령 팔레트"
          className={cn(
            "rp-anim-dialog fixed left-1/2 top-[15vh] z-50 w-[min(92vw,40rem)] -translate-x-1/2",
            "overflow-hidden rounded-[14px] border border-line bg-surface shadow-lg",
          )}
        >
          <Dialog.Title className="sr-only">명령 팔레트</Dialog.Title>
          <Dialog.Description className="sr-only">
            화면 이동 또는 리소스 값 검색. 위/아래 방향키로 이동하고 Enter 로 실행합니다.
          </Dialog.Description>

          <Command
            label="명령 팔레트"
            className="flex max-h-[60vh] flex-col"
            // 리소스 값은 특수문자가 많아 cmdk 기본 fuzzy 대신 부분일치(대소문자 무시)로 필터.
            filter={(value, search) =>
              value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <div className="border-b border-line px-4">
              <Command.Input
                autoFocus
                placeholder="화면 이동 또는 리소스 값 검색…"
                className="w-full bg-transparent py-3.5 text-sm text-ink placeholder:text-muted focus:outline-none"
              />
            </div>

            <Command.List className="overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                일치하는 항목이 없습니다.
              </Command.Empty>

              <Command.Group
                heading="화면 이동"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
              >
                {SCREENS.map((s) => (
                  <Command.Item
                    key={s.href}
                    value={`${s.label} ${s.hint}`}
                    onSelect={() => go(s.href)}
                    className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-sm text-ink outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink"
                  >
                    <span className="font-semibold">{s.label}</span>
                    <span className="truncate text-xs text-muted">{s.hint}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              {resources.length > 0 && (
                <Command.Group
                  heading="리소스"
                  className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
                >
                  {resources.map((r) => (
                    <Command.Item
                      key={`${r.kind}:${r.value}`}
                      value={`${r.value} ${KIND_LABEL[r.kind]} ${r.kind}`.toLowerCase()}
                      onSelect={() => go(detailHref(r))}
                      className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-sm text-ink outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink"
                    >
                      <span className="truncate font-mono">{r.value}</span>
                      <span className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-muted">
                        {KIND_LABEL[r.kind]}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

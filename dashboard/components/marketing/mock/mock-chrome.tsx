import { cn } from "@/lib/cn";
import type { ResourceKind, ResourceState } from "@/lib/types";

/**
 * 마케팅 전용 영어 목업 크롬(사이드바 + 헤더). 실제 대시보드(app-shell)의 룩을 영어 라벨로 재현한다.
 * 오직 스크린샷 캡처용이며(preview 라우트 → scripts/marketing-shots.ts), 실제 제품 코드가 아니다.
 * 대시보드 UI 가 바뀌면 이 목업은 수동으로 맞춰야 한다.
 */

const NAV: { label: string; icon: React.ReactNode }[] = [
  {
    label: "Pool overview",
    icon: (
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    label: "Live events",
    icon: (
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 8h3l2-5 3 10 2-5h3" />
      </svg>
    ),
  },
  {
    label: "API keys",
    icon: (
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="5" cy="5" r="3" />
        <path d="M7 7l6 6M11 11l1.5-1.5M13 13l1.5-1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Usage",
    icon: (
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 14V2M2 14h12" />
        <path d="M5 11V8M8.5 11V5M12 11V9" />
      </svg>
    ),
  },
  {
    label: "Admin",
    icon: (
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M8 1.5l5.5 2v4c0 3-2.3 5.3-5.5 6.5C4.8 12.8 2.5 10.5 2.5 7.5v-4l5.5-2z" />
      </svg>
    ),
  },
];

/** 영어 상태 배지 — 실제 StatusBadge 와 동일 색 토큰, 라벨만 영어. */
const STATE: Record<ResourceState, { label: string; cls: string }> = {
  HEALTHY: { label: "Healthy", cls: "text-ok-ink bg-ok/12" },
  COOLING: { label: "Cooling", cls: "text-cool-ink bg-cool/12" },
  RECOVERING: { label: "Recovering", cls: "text-recover-ink bg-recover/12" },
  BLOCKLISTED: { label: "Blocked", cls: "text-block-ink bg-block/12" },
};

export function StateBadge({ state }: { state: ResourceState }) {
  const m = STATE[state] ?? STATE.HEALTHY;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold", m.cls)}>
      <span className="size-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

const KIND: Record<ResourceKind, string> = { PROXY: "Proxy", ACCOUNT: "Account", SESSION: "Session" };

export function KindBadge({ kind }: { kind: ResourceKind }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-muted">
      {KIND[kind] ?? kind}
    </span>
  );
}

/** 미니 스파크라인(영어 목업용, 순수 CSS) — 성공=ok, 실패=block. */
export function Spark({ flags }: { flags: boolean[] }) {
  return (
    <span className="inline-flex items-end gap-0.5 align-middle" aria-hidden>
      {flags.map((ok, i) => (
        <span key={i} className={cn("w-1 rounded-[1px]", ok ? "h-3 bg-ok/70" : "h-1.5 bg-block/70")} />
      ))}
    </span>
  );
}

/** 접힌 오버플로 메뉴 아이콘(정적). */
export function DotsIcon() {
  return (
    <span className="inline-grid size-7 place-items-center rounded-[8px] text-muted">
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
        <circle cx="8" cy="3" r="1.3" />
        <circle cx="8" cy="8" r="1.3" />
        <circle cx="8" cy="13" r="1.3" />
      </svg>
    </span>
  );
}

/**
 * 사이드바(펼침) + 상단 헤더를 갖춘 영어 대시보드 셸. `active` 로 현재 nav 를 강조한다.
 */
export function MockShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-4">
        <div className="mb-2 px-3 py-2">
          <div className="text-sm font-extrabold tracking-tight">reputation-pool</div>
          <div className="text-xs text-muted">Console</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <span
              key={n.label}
              className={cn(
                "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold",
                n.label === active ? "bg-accent-soft text-accent" : "text-muted",
              )}
            >
              {n.icon}
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
            </span>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold text-muted">
          <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-left">Collapse</span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/80 px-6 backdrop-blur">
          <div className="flex min-w-0 items-center gap-4">
            <span className="shrink-0 text-xs font-bold text-muted">
              tenant · <span className="text-ink">lemong</span>
            </span>
            <span className="flex min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-1.5 text-sm text-muted">
              <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
              <span className="truncate">Search resources & views</span>
              <kbd className="ml-1 hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline">
                ⌘K
              </kbd>
            </span>
          </div>
          <span className="grid size-8 place-items-center rounded-full bg-accent text-xs font-bold text-accent-ink">LE</span>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

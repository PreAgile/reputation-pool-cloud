import { cn } from "@/lib/cn";
import { marketingEventsFixture } from "@/test/marketing-fixtures";
import { MockShell } from "./mock-chrome";

/** 이벤트 타입 → 영어 라벨 + 색 토큰. */
const EVENT: Record<string, { label: string; cls: string }> = {
  RESOURCE_LEASED: { label: "Leased", cls: "text-accent bg-accent-soft" },
  RESOURCE_COOLED: { label: "Cooled", cls: "text-cool-ink bg-cool/12" },
  RESOURCE_BLOCKLISTED: { label: "Blocked", cls: "text-block-ink bg-block/12" },
  RESOURCE_RECOVERED: { label: "Recovered", cls: "text-recover-ink bg-recover/12" },
  RESOURCE_UNBLOCKED: { label: "Unblocked", cls: "text-ok-ink bg-ok/12" },
  LEASE_RELEASED: { label: "Released", cls: "text-muted bg-surface-2" },
};

function time(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 영어 "Live events" 목업 — 이벤트 스트림 표. 마케팅 스크린샷 전용. */
export function EventsMock() {
  const rows = marketingEventsFixture.events;
  return (
    <MockShell active="Live events">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-xl font-extrabold tracking-tight">Live events</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/12 px-2 py-0.5 text-xs font-bold text-ok-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            Live
          </span>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 text-right font-bold">Seq</th>
                  <th className="px-4 py-2.5 font-bold">Time</th>
                  <th className="px-4 py-2.5 font-bold">Event</th>
                  <th className="px-4 py-2.5 font-bold">Resource</th>
                  <th className="px-4 py-2.5 font-bold">Context</th>
                  <th className="px-4 py-2.5 font-bold">Cause</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const ev = EVENT[e.eventType] ?? { label: e.eventType, cls: "text-muted bg-surface-2" };
                  return (
                    <tr key={e.seq} className="border-t border-line">
                      <td className="tnum px-4 py-2.5 text-right font-mono text-muted">{e.seq}</td>
                      <td className="tnum px-4 py-2.5 font-mono text-muted">{time(e.occurredAt)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold", ev.cls)}>
                          {ev.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-ink">{e.resourceValue}</td>
                      <td className="px-4 py-2.5 font-mono text-muted">{e.context ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-muted">{e.cause ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MockShell>
  );
}

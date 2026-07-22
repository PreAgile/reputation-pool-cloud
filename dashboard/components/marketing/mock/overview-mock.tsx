import { cn } from "@/lib/cn";
import type { ResourceOverview, ResourceState } from "@/lib/types";
import { marketingOverviewFixture } from "@/test/marketing-fixtures";
import { MockShell, StateBadge, KindBadge, Spark, DotsIcon } from "./mock-chrome";

const SEVERITY: Record<ResourceState, number> = { BLOCKLISTED: 3, COOLING: 2, RECOVERING: 1, HEALTHY: 0 };

function formatBlock(r: ResourceOverview): string {
  if (!r.blocked) return "—";
  if (r.blockPermanent) return "Permanent";
  if (r.blockedUntil) {
    const d = new Date(r.blockedUntil);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  }
  return "Blocked";
}

function Tile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div className={cn("tnum text-[22px] font-extrabold leading-none tracking-tight", accent && "text-accent")}>{value}</div>
      <div className="mt-1.5 text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}

/** 영어 "Pool overview" 목업 — KPI + 필터 + 리소스 표(심각도순). 마케팅 스크린샷 전용. */
export function OverviewMock() {
  const s = marketingOverviewFixture.summary;
  const rows = marketingOverviewFixture.resources
    .slice()
    .sort((a, b) => SEVERITY[b.state] - SEVERITY[a.state] || (a.score ?? 1e9) - (b.score ?? 1e9));

  return (
    <MockShell active="Pool overview">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5">
          <h1 className="text-xl font-extrabold tracking-tight">Pool overview</h1>
          <p className="mt-1 text-sm text-muted">Reputation of every registered resource, at a glance.</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Registered" value={s.registered} />
          <Tile label="Blocked" value={s.blocklisted} />
          <Tile label="Cooling" value={s.cellsByState?.COOLING ?? 0} />
          <Tile label="Recovering" value={s.cellsByState?.RECOVERING ?? 0} />
          <Tile label="Cells" value={s.totalCells} accent />
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {["All", "Proxy", "Account", "Session"].map((k, i) => (
              <span
                key={k}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-bold",
                  i === 0 ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted",
                )}
              >
                {k}
              </span>
            ))}
          </div>
          <span className="flex w-full items-center rounded-[10px] border border-line bg-surface px-3 py-1.5 text-sm text-muted sm:w-56">
            Search resource value
          </span>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-bold">Kind</th>
                  <th className="px-4 py-2.5 font-bold">Resource</th>
                  <th className="px-4 py-2.5 font-bold">State</th>
                  <th className="px-4 py-2.5 text-right font-bold">Score</th>
                  <th className="px-4 py-2.5 font-bold">Recent verdicts</th>
                  <th className="px-4 py-2.5 text-right font-bold">Contexts</th>
                  <th className="px-4 py-2.5 font-bold">Block</th>
                  <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}:${r.value}`} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <KindBadge kind={r.kind} />
                    </td>
                    <td className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-ink">{r.value}</td>
                    <td className="px-4 py-2.5">
                      <StateBadge state={r.state} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-mono">
                      {r.score != null ? r.score.toFixed(2) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Spark flags={r.recentWindow} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{r.contexts}</td>
                    <td className="px-4 py-2.5 text-muted">{formatBlock(r)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex justify-end">
                        <DotsIcon />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MockShell>
  );
}

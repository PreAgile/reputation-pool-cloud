import { cn } from "@/lib/cn";
import { marketingDetailFixture, marketingScoreHistoryFixture } from "@/test/marketing-fixtures";
import { MockShell, StateBadge } from "./mock-chrome";

/** 컨텍스트별 선 색(테마 토큰). */
const LINE = ["text-accent", "text-ok", "text-recover"];

const W = 720;
const H = 240;
const PAD = 24;

/** score(-100..100) 시계열을 폴리라인 points 로. */
function toPoints(points: { score: number }[]): string {
  const n = points.length;
  return points
    .map((p, i) => {
      const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
      const y = PAD + ((100 - p.score) / 200) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** 영어 리소스 상세 목업 — 컨텍스트별 평판 곡선(커스텀 SVG) + 셀 요약. 마케팅 스크린샷 전용. */
export function DetailMock() {
  const d = marketingDetailFixture;
  const yZero = PAD + (100 / 200) * (H - 2 * PAD);

  return (
    <MockShell active="Pool overview">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-muted">
          <span>Pool overview</span>
          <span aria-hidden>/</span>
          <span className="font-mono">PROXY</span>
          <span aria-hidden>/</span>
          <span className="font-mono text-ink">{d.value}</span>
        </nav>

        <div className="mb-5 flex items-center gap-3">
          <h1 className="font-mono text-xl font-extrabold tracking-tight">{d.value}</h1>
          <StateBadge state="HEALTHY" />
        </div>

        <div className="rounded-[14px] border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Reputation over time</h2>
            <div className="flex items-center gap-4 text-xs text-muted">
              {marketingScoreHistoryFixture.contexts.map((c, i) => (
                <span key={c.context} className={cn("flex items-center gap-1.5", LINE[i])}>
                  <span className="size-2 rounded-full bg-current" />
                  <span className="font-mono text-muted">{c.context}</span>
                </span>
              ))}
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Per-context reputation curve">
            {/* 0 기준선 */}
            <line x1={PAD} y1={yZero} x2={W - PAD} y2={yZero} className="stroke-line" strokeDasharray="3 4" strokeWidth="1" />
            {marketingScoreHistoryFixture.contexts.map((c, i) => (
              <polyline
                key={c.context}
                points={toPoints(c.points)}
                className={LINE[i]}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {d.cells.map((c) => (
            <div key={c.context} className="rounded-[13px] border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-ink">{c.context}</span>
                <StateBadge state={c.state} />
              </div>
              <div className="mt-3 tnum text-2xl font-extrabold tracking-tight">{c.score.toFixed(1)}</div>
              <div className="mt-1 text-xs text-muted">
                {c.consecutiveSuccesses > 0
                  ? `${c.consecutiveSuccesses} in a row · window ${c.windowSize}`
                  : `${c.consecutiveFailures} failing · window ${c.windowSize}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockShell>
  );
}

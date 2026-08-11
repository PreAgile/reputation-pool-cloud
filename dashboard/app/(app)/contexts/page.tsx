"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type {
  ContextDetail,
  ContextHistory,
  ContextOverview,
  ContextSummary,
  ResourceState,
} from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Sparkline } from "@/components/sparkline";
import { DateRangePicker, RANGE_PRESETS, type RangePreset } from "@/components/ui/date-range-picker";
import { usePoll } from "@/lib/use-poll";

/** 현재 상태 폴링 주기. 추이(롤업)는 시간 단위라 같이 자주 부를 이유가 없다 — 기간 변경 때만 부른다. */
const POLL_MS = 15_000;

/**
 * 시리즈 색 슬롯. 기능색(ok/cool/recover/block)과 분리된 카테고리 팔레트로, globals.css 에서
 * 라이트/다크 각각 검증된 값이 들어온다. 순서 고정 — 색은 컨텍스트를 따르지 순위를 따르지 않는다.
 */
const SERIES_TOKENS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

/** 색 슬롯 수를 넘는 컨텍스트는 새 색을 만들지 않고 곡선에서 접는다(표는 전부 보여준다). */
const MAX_SERIES = SERIES_TOKENS.length;

/** 이 시간 넘게 갱신이 없으면 "조용함"으로 표시한다. 고장 판정이 아니라 눈에 띄게 하는 장치. */
const QUIET_AFTER_MS = 24 * 3600 * 1000;

/** 차트가 먹는 wide 행: ms 타임스탬프 + 컨텍스트별 평균 점수. */
type ChartRow = { t: number } & Record<string, number>;

function fmtScore(n: number): string {
  return n.toFixed(2);
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** 절대 시각(월/일 시:분) — 여러 날 범위에서도 모호하지 않게. */
function fmtStamp(t: number | string): string {
  const d = typeof t === "number" ? new Date(t) : new Date(t);
  return Number.isNaN(d.getTime())
    ? String(t)
    : d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "3분 전"/"4일 전" 상대 표기. 마지막 활동이 얼마나 오래됐는지가 이 화면의 핵심 신호다. */
function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.round(hour / 24)}일 전`;
}

function isQuiet(iso: string | null, now: number): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) || now - t > QUIET_AFTER_MS;
}

/** 상태 분포 막대 — 100% 스택 하나. 셀 수가 큰 컨텍스트도 구성비가 바로 읽힌다. */
function StateBar({ byState, total }: { byState: Record<ResourceState, number>; total: number }) {
  const all: { state: ResourceState; count: number; color: string }[] = [
    { state: "HEALTHY", count: byState.HEALTHY ?? 0, color: "var(--ok)" },
    { state: "RECOVERING", count: byState.RECOVERING ?? 0, color: "var(--recover)" },
    { state: "COOLING", count: byState.COOLING ?? 0, color: "var(--cool)" },
    { state: "BLOCKLISTED", count: byState.BLOCKLISTED ?? 0, color: "var(--block)" },
  ];
  const segments = all.filter((s) => s.count > 0);
  if (total === 0) return <span className="text-muted">—</span>;
  return (
    // gap-[2px] — 인접 세그먼트 사이 표면색 간극(붙은 색 두 개가 새 색으로 읽히는 것을 막는다).
    <div className="flex h-2 w-full min-w-24 gap-[2px] overflow-hidden rounded-full">
      {segments.map((s) => (
        <span
          key={s.state}
          title={`${s.state} ${s.count}`}
          style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
          className="block first:rounded-l-full last:rounded-r-full"
        />
      ))}
    </div>
  );
}

/** 곡선 툴팁: 그 시각의 모든 컨텍스트를 점수 내림차순으로. 값은 텍스트 토큰, 색은 점이 진다. */
function CurveTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const rows = [...payload]
    .filter((p) => typeof p.value === "number")
    .sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-semibold text-muted tnum">{fmtStamp(label as number)}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.dataKey as string} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="text-ink">{r.dataKey as string}</span>
            <span className="ml-auto pl-3 font-mono tnum text-ink">{fmtScore(Number(r.value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContextsPage() {
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [history, setHistory] = useState<ContextHistory | null>(null);
  const [detail, setDetail] = useState<ContextDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangePreset>(RANGE_PRESETS[1]);
  // 상대 시각("4일 전")은 데이터가 아니라 "지금"에 따라 변한다 — 폴링마다 기준 시각을 다시 잡는다.
  const [now, setNow] = useState(() => Date.now());

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api<ContextOverview>("/contexts"));
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<ContextHistory>(`/contexts/score-history?hours=${range.hours}`));
    } catch {
      // 추이는 보조 정보 — 실패해도 현재 상태 표는 그대로 쓸 수 있게 조용히 비운다.
      setHistory(null);
    }
  }, [range.hours]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  usePoll(() => void loadOverview(), POLL_MS, true);

  // 선택된 컨텍스트의 리소스 목록. 선택이 바뀔 때만 부른다(표 전체를 매번 끌어오지 않기 위해).
  // detailError 를 따로 두는 이유: 실패를 detail=null 로만 표현하면 로딩과 구분되지 않아 "불러오는 중…"
  // 이 영구히 남는다.
  const loadDetail = useCallback(async (context: string) => {
    setDetailError(null);
    try {
      return await api<ContextDetail>(`/contexts/${encodeURIComponent(context)}/resources`);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "불러오지 못했습니다");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let live = true;
    setDetail(null);
    void loadDetail(selected).then((d) => {
      if (live) setDetail(d);
    });
    return () => {
      live = false;
    };
  }, [selected, loadDetail]);

  const contexts = useMemo(() => overview?.contexts ?? [], [overview]);

  /**
   * 컨텍스트 → 색 슬롯. **전체 목록 기준 인덱스**라 곡선에 몇 개가 그려지든 한 컨텍스트의 색은 고정이다
   * (색은 엔티티를 따르고 순위를 따르지 않는다).
   */
  const colorOf = useCallback(
    (context: string) => {
      const i = contexts.findIndex((c) => c.context === context);
      return SERIES_TOKENS[(i < 0 ? 0 : i) % MAX_SERIES];
    },
    [contexts],
  );

  // 곡선에 올릴 컨텍스트: 셀이 많은 순 상위 MAX_SERIES 개(색 슬롯을 넘기지 않는다).
  const charted = useMemo(
    () =>
      [...contexts]
        .sort((a, b) => b.cells - a.cells)
        .slice(0, MAX_SERIES)
        .map((c) => c.context),
    [contexts],
  );
  const foldedAway = contexts.length - charted.length;

  // 컨텍스트별 시계열 → 하나의 wide 행 배열(시각 오름차순). 버킷 시각이 서로 어긋나도 합쳐진다.
  const chartRows = useMemo(() => {
    if (!history) return [] as ChartRow[];
    const byTime = new Map<number, ChartRow>();
    for (const series of history.contexts) {
      if (!charted.includes(series.context)) continue;
      for (const p of series.points) {
        const t = new Date(p.at).getTime();
        if (Number.isNaN(t)) continue;
        const row = byTime.get(t) ?? ({ t } as ChartRow);
        row[series.context] = Number(p.averageScore.toFixed(4));
        byTime.set(t, row);
      }
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [history, charted]);

  const totalCells = contexts.reduce((sum, c) => sum + c.cells, 0);
  const quietCount = contexts.filter((c) => isQuiet(c.lastUpdatedAt, now)).length;
  const hasCurve = chartRows.length > 1 && charted.length > 0;

  if (error && !overview) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader />
        <Card>
          <EmptyState
            tone="error"
            title="컨텍스트를 불러오지 못했습니다"
            description={error}
            action={{ label: "다시 시도", onClick: () => void loadOverview() }}
          />
        </Card>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader />
        <div className="text-sm text-muted">불러오는 중…</div>
      </div>
    );
  }

  if (contexts.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader />
        <Card>
          <EmptyState
            title="아직 컨텍스트가 없습니다"
            description="클라이언트가 Report 를 보내면 (리소스 × 컨텍스트) 셀이 생기고, 여기에 컨텍스트별 상태가 쌓입니다."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader />

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="컨텍스트 수" value={fmtNum(contexts.length)} accent />
        <StatTile label="전체 셀 수" value={fmtNum(totalCells)} />
        <StatTile label="24시간 넘게 조용한 컨텍스트" value={fmtNum(quietCount)} />
      </section>

      {/* 컨텍스트별 평판 추이 — 시간 롤업에서 읽으므로 90일까지 열려 있다. */}
      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">컨텍스트별 평균 평판 · {range.label}</h2>
          <DateRangePicker value={range} onChange={setRange} label="추이 기간 선택" />
        </div>
        <Card className="p-4">
          {hasCurve ? (
            <>
              {/* 시리즈가 2개 이상이면 범례는 항상 있다 — 정체성이 색에만 실리지 않게. */}
              {charted.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {charted.map((context) => (
                    <span key={context} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <span className="size-2 rounded-full" style={{ background: colorOf(context) }} />
                      {context}
                    </span>
                  ))}
                </div>
              )}
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(t) => fmtStamp(t as number)}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      stroke="var(--line)"
                      minTickGap={48}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      stroke="var(--line)"
                      width={44}
                      tickFormatter={(v) => fmtScore(v as number)}
                    />
                    <Tooltip content={<CurveTooltip />} cursor={{ stroke: "var(--muted)", strokeWidth: 1 }} />
                    {charted.map((context) => (
                      <Line
                        key={context}
                        type="monotone"
                        dataKey={context}
                        name={context}
                        stroke={colorOf(context)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {foldedAway > 0 && (
                <p className="mt-2 text-xs text-muted">
                  셀이 많은 {MAX_SERIES}개만 그렸습니다 · 나머지 {foldedAway}개는 아래 표에 있습니다.
                </p>
              )}
            </>
          ) : (
            <EmptyState
              title="추이를 그릴 만큼 쌓이지 않았습니다"
              description="컨텍스트 추이는 시간 단위로 집계됩니다. 한 시간 이상 지나면 여기에 컨텍스트별 곡선이 그려집니다."
            />
          )}
        </Card>
      </section>

      {/* 컨텍스트 표 — 마지막 활동이 이 화면의 핵심 열이다. */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-bold text-ink">컨텍스트</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-bold">컨텍스트</th>
                  <th className="px-4 py-2.5 text-right font-bold">셀</th>
                  <th className="px-4 py-2.5 font-bold">상태</th>
                  <th className="px-4 py-2.5 font-bold">분포</th>
                  <th className="px-4 py-2.5 text-right font-bold">평균</th>
                  <th className="px-4 py-2.5 text-right font-bold">최저</th>
                  <th className="px-4 py-2.5 font-bold">마지막 활동</th>
                </tr>
              </thead>
              <tbody>
                {contexts.map((c) => (
                  <ContextRow
                    key={c.context}
                    summary={c}
                    color={colorOf(c.context)}
                    now={now}
                    selected={selected === c.context}
                    onSelect={() => setSelected((prev) => (prev === c.context ? null : c.context))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* 선택한 컨텍스트의 리소스 — 서버가 심각도 → 낮은 점수 순으로 정렬해 준다. */}
      {selected && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">
              <span className="font-mono">{selected}</span> 안의 리소스
            </h2>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              닫기
            </Button>
          </div>
          <Card className="overflow-hidden">
            {detail ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 font-bold">리소스</th>
                      <th className="px-4 py-2.5 font-bold">상태</th>
                      <th className="px-4 py-2.5 text-right font-bold">점수</th>
                      <th className="px-4 py-2.5 font-bold">최근 결과</th>
                      <th className="px-4 py-2.5 text-right font-bold">연속 실패</th>
                      <th className="px-4 py-2.5 font-bold">갱신</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.resources.slice(0, 100).map((r) => (
                      <tr key={`${r.kind}:${r.value}`} className="border-t border-line hover:bg-surface-2">
                        <td className="px-4 py-2.5">
                          <a
                            href={`/resources/${r.kind}/${encodeURIComponent(r.value)}`}
                            className="font-mono text-ink hover:text-accent"
                          >
                            {r.value}
                          </a>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge state={r.state} />
                        </td>
                        <td className="tnum px-4 py-2.5 text-right font-mono text-ink">{fmtScore(r.score)}</td>
                        <td className="px-4 py-2.5">
                          <Sparkline flags={r.recentWindow} />
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-muted">{r.consecutiveFailures}</td>
                        <td className="tnum whitespace-nowrap px-4 py-2.5 text-muted">{fmtAgo(r.updatedAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.resources.length > 100 && (
                  <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                    상위 100개만 표시했습니다 · 전체 {fmtNum(detail.resources.length)}개
                  </p>
                )}
              </div>
            ) : detailError ? (
              <EmptyState
                tone="error"
                title="리소스 목록을 불러오지 못했습니다"
                description={detailError}
                action={{
                  label: "다시 시도",
                  onClick: () => void loadDetail(selected).then(setDetail),
                }}
              />
            ) : (
              <div className="p-4 text-sm text-muted">불러오는 중…</div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

function ContextRow({
  summary,
  color,
  now,
  selected,
  onSelect,
}: {
  summary: ContextSummary;
  color: string;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const quiet = isQuiet(summary.lastUpdatedAt, now);
  return (
    <tr className={cn("border-t border-line hover:bg-surface-2", selected && "bg-accent-soft/50")}>
      <td className="px-4 py-2.5">
        {/* 행 전체가 아니라 버튼이 펼치기를 맡는다 — <tr> 은 포커스 대상이 아니어서 키보드로는 열 수 없다. */}
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          className="flex items-center gap-2 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="font-mono font-bold text-ink">{summary.context}</span>
        </button>
      </td>
      <td className="tnum px-4 py-2.5 text-right text-ink">{fmtNum(summary.cells)}</td>
      <td className="px-4 py-2.5">
        <StatusBadge state={summary.state} />
      </td>
      <td className="px-4 py-2.5">
        <StateBar byState={summary.cellsByState} total={summary.cells} />
      </td>
      <td className="tnum px-4 py-2.5 text-right font-mono text-ink">{fmtScore(summary.averageScore)}</td>
      <td className="tnum px-4 py-2.5 text-right font-mono text-muted">{fmtScore(summary.worstScore)}</td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <span
          className={cn(
            "tnum inline-flex items-center gap-1.5 text-sm",
            quiet ? "font-bold text-cool-ink" : "text-muted",
          )}
        >
          {/* 조용함은 색만으로 알리지 않는다 — 점 + 굵기 + "조용함" 라벨이 함께 진다. */}
          {quiet && <span className="size-1.5 rounded-full bg-cool" />}
          {fmtAgo(summary.lastUpdatedAt, now)}
          {quiet && <span className="text-xs">· 조용함</span>}
        </span>
      </td>
    </tr>
  );
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h1 className="mb-2 text-xl font-extrabold tracking-tight text-ink">컨텍스트</h1>
      <p className="text-sm text-muted">
        어떤 컨텍스트를 돌리고 있고, 그중 무너지거나 조용해진 게 있는지 봅니다. 리소스 축에서는 보고가 끊긴
        컨텍스트가 건강한 것과 똑같이 보이므로, 마지막 활동 시각이 여기서 가장 중요한 열입니다.
      </p>
    </div>
  );
}

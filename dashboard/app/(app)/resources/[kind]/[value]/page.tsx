"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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
import type { AuditEventPage, AuditEventRecord, ResourceDetail, ScoreHistory } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DateRangePicker,
  RANGE_PRESETS,
  type RangePreset,
} from "@/components/ui/date-range-picker";
import { usePoll } from "@/lib/use-poll";

/** score-history 컨텍스트별 시계열을 recharts LineChart 한 판이 먹는 wide 포맷으로 병합. */
type ChartRow = { t: number } & Record<string, number>;

/** 첫 라인은 토스 블루(accent), 나머지는 기능색 토큰을 순환(다크모드는 CSS 변수가 알아서 대응). */
const LINE_TOKENS = ["var(--accent)", "var(--recover)", "var(--cool)", "var(--ok)", "var(--block)"];

function fmtClock(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Toss형 툴팁: surface 카드 + 라인색 점. 다크/라이트 토큰으로 자동 대응. */
function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-muted tnum">{fmtClock(label as number)}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink">{String(p.dataKey)}</span>
          <span className="ml-auto font-mono tnum text-ink">{Number(p.value).toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ResourceDetailPage() {
  const params = useParams<{ kind: string; value: string }>();
  const kind = params.kind; // 경로는 소문자, 백엔드가 대문자로 정규화
  const value = params.value;
  const toast = useToast();

  // 상세 로드 전에도 그릴 수 있도록 경로 파라미터로 브레드크럼을 구성(풀 오버뷰 / KIND / value).
  // KIND 는 전용 경로가 없어 링크 없이(중간 조각), value 는 현재 위치로 표기된다.
  const crumbs = [
    { label: "풀 오버뷰", href: "/" },
    { label: (kind ?? "").toUpperCase() },
    { label: value ?? "" },
  ];

  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 평판 곡선 조회 기간(프리셋). 기본 최근 24시간 — 원천이 분당 1점이라 이 범위면 충분.
  const [range, setRange] = useState<RangePreset>(RANGE_PRESETS[0]);

  const base = `/pools/resources/${encodeURIComponent(kind)}/${encodeURIComponent(value)}`;

  // 상세는 차단/해제·주기 갱신 때 다시 불러와야 하므로 콜백으로 분리.
  const reloadDetail = useCallback(() => {
    return api<ResourceDetail>(base)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, [base]);

  // 곡선/타임라인은 보조 데이터 — 실패해도 상세 자체는 보이도록 조용히 빈 상태 처리.
  // 곡선 조회 기간은 날짜 범위 피커(range.hours)로 파라미터화.
  const reloadAux = useCallback(() => {
    api<ScoreHistory>(`${base}/score-history?hours=${range.hours}`)
      .then(setHistory)
      .catch(() => setHistory({ contexts: [] }));
    api<AuditEventPage>("/events?limit=100")
      .then((p) => setEvents(p.events))
      .catch(() => setEvents([]));
  }, [base, range.hours]);

  useEffect(() => {
    if (!kind || !value) return;
    void reloadDetail();
    reloadAux();
  }, [kind, value, reloadDetail, reloadAux]);

  // 보이는 동안 30초마다 갱신(곡선은 원천이 분당 1점이라 이 주기면 충분). 백그라운드 탭이면 정지.
  usePoll(() => {
    void reloadDetail();
    reloadAux();
  }, 30000);

  // 수동 차단/해제 (운영자 개입). block은 영구 또는 seconds(임시) 중 하나. 성공 후 상세를 다시 불러와 갱신.
  async function mutate(action: "unblock" | "blockPermanent" | "blockTemp") {
    if (acting) return;
    setActing(true);
    setActionError(null);
    try {
      if (action === "blockPermanent") {
        await api<void>(`${base}/block?permanent=true`, { method: "POST" });
      } else if (action === "blockTemp") {
        await api<void>(`${base}/block?seconds=3600`, { method: "POST" });
      } else {
        await api<void>(`${base}/block`, { method: "DELETE" });
      }
      await reloadDetail();
      toast.success(
        action === "blockPermanent"
          ? "영구 차단했습니다."
          : action === "blockTemp"
            ? "1시간 차단했습니다."
            : "차단을 해제했습니다.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "요청에 실패했습니다";
      setActionError(msg);
      toast.error(`요청 실패 · ${msg}`);
    } finally {
      setActing(false);
    }
  }

  // score-history → wide 포맷 병합(시각 오름차순). 컨텍스트별로 라인 하나.
  const { chartRows, contexts } = useMemo(() => {
    if (!history) return { chartRows: [] as ChartRow[], contexts: [] as string[] };
    const byTime = new Map<number, ChartRow>();
    for (const c of history.contexts) {
      for (const pt of c.points) {
        const t = new Date(pt.at).getTime();
        const row = byTime.get(t) ?? ({ t } as ChartRow);
        row[c.context] = pt.score;
        byTime.set(t, row);
      }
    }
    return {
      chartRows: [...byTime.values()].sort((a, b) => a.t - b.t),
      contexts: history.contexts.map((c) => c.context),
    };
  }, [history]);

  // 이 리소스의 감사 이벤트만 클라이언트 필터(서버측 리소스 필터 없음) → 시간 내림차순.
  const timeline = useMemo(() => {
    if (!events || !detail) return [] as AuditEventRecord[];
    return events
      .filter((e) => e.resourceKind === detail.kind && e.resourceValue === detail.value)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [events, detail]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <Breadcrumb items={crumbs} />
        <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {error}</Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl">
        <Breadcrumb items={crumbs} />
        <DetailSkeleton />
      </div>
    );
  }

  const hasCurve = chartRows.length > 0 && contexts.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumb items={crumbs} />

      {/* 헤더: kind 배지 + value + 차단 상태 + 수동 차단/해제 */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
          {detail.kind}
        </span>
        <h1 className="font-mono text-xl font-extrabold tracking-tight text-ink">{detail.value}</h1>
        {detail.blocked && (
          <div className="flex items-center gap-2">
            <StatusBadge state="BLOCKLISTED" />
            <span className="text-xs font-semibold text-muted">
              {detail.blockPermanent ? "영구 차단" : `해제 예정 ${fmtDateTime(detail.blockedUntil)}`}
            </span>
          </div>
        )}
        {/* 수동 차단/해제 (운영자 개입). 엔진에 자동 차단이 없어 이 버튼이 유일한 격리 경로. */}
        <div className="ml-auto flex gap-2">
          {detail.blocked ? (
            <Button variant="ghost" disabled={acting} onClick={() => mutate("unblock")}>
              {acting ? "처리 중…" : "차단 해제"}
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={acting} onClick={() => mutate("blockTemp")}>
                {acting ? "처리 중…" : "1시간 차단"}
              </Button>
              <Button variant="ghost" disabled={acting} onClick={() => mutate("blockPermanent")}>
                영구 차단
              </Button>
            </>
          )}
        </div>
      </div>
      {actionError && <div className="mb-4 text-sm text-block">요청 실패 · {actionError}</div>}
      {!actionError && <div className="mb-6" />}

      {/* 곡선/셀/타임라인을 세로 스택 대신 탭으로(방향키·활성 칩 전환은 Radix Tabs 기본). */}
      <Tabs defaultValue="curve">
        <TabsList aria-label="리소스 상세 보기">
          <TabsTrigger value="curve">평판 곡선</TabsTrigger>
          <TabsTrigger value="cells">컨텍스트별 셀</TabsTrigger>
          <TabsTrigger value="timeline">감사 타임라인</TabsTrigger>
        </TabsList>

        {/* 평판 곡선 — 기간은 날짜 범위 피커로 파라미터화(24h/7d/30d). */}
        <TabsContent value="curve">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">평판 곡선 · {range.label}</h2>
            <DateRangePicker value={range} onChange={setRange} label="곡선 기간 선택" />
          </div>
          <Card className="p-4">
            {hasCurve ? (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(t) => fmtClock(t as number)}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      stroke="var(--line)"
                      minTickGap={40}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      stroke="var(--line)"
                      width={48}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {contexts.map((ctx, i) => (
                      <Line
                        key={ctx}
                        type="monotone"
                        dataKey={ctx}
                        name={ctx}
                        stroke={LINE_TOKENS[i % LINE_TOKENS.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted">
                샘플 아직 없음
              </div>
            )}
            {hasCurve && contexts.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 pl-1 text-xs">
                {contexts.map((ctx, i) => (
                  <span key={ctx} className="flex items-center gap-1.5 text-muted">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: LINE_TOKENS[i % LINE_TOKENS.length] }}
                    />
                    {ctx}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* 컨텍스트별 셀 표 */}
        <TabsContent value="cells">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-bold">컨텍스트</th>
                    <th className="px-4 py-2.5 text-right font-bold">score</th>
                    <th className="px-4 py-2.5 font-bold">상태</th>
                    <th className="px-4 py-2.5 text-right font-bold">연속 실패</th>
                    <th className="px-4 py-2.5 text-right font-bold">연속 성공</th>
                    <th className="px-4 py-2.5 text-right font-bold" title="점수 계산에 쓰는 최근 판정 개수">
                      평가 표본
                    </th>
                    <th className="px-4 py-2.5 font-bold" title="냉각(COOLING)이 풀리는 시각">냉각 해제 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.cells.map((c) => (
                    <tr key={c.context} className="border-t border-line">
                      <td className="px-4 py-2.5 font-mono text-ink">{c.context}</td>
                      <td className="tnum px-4 py-2.5 text-right font-mono text-ink">
                        {c.score.toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge state={c.state} />
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">{c.consecutiveFailures}</td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">{c.consecutiveSuccesses}</td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">{c.windowSize}</td>
                      <td className="tnum px-4 py-2.5 text-muted">{fmtDateTime(c.cooldownUntil)}</td>
                    </tr>
                  ))}
                  {detail.cells.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        셀이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* 감사 타임라인 */}
        <TabsContent value="timeline">
          <Card className="p-2">
            {events === null ? (
              <div className="px-2 py-6 text-center text-sm text-muted">불러오는 중…</div>
            ) : timeline.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted">이 리소스의 감사 이벤트가 없습니다.</div>
            ) : (
              <ul className="divide-y divide-line">
                {timeline.map((e) => (
                  <li key={e.seq} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-bold text-ink">
                      {e.eventType}
                    </span>
                    <span className="tnum text-xs text-muted">{fmtDateTime(e.occurredAt)}</span>
                    {e.context && <span className="font-mono text-xs text-muted">{e.context}</span>}
                    {e.cause && <span className="text-xs text-muted">· {e.cause}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 상세 로딩 스켈레톤: 헤더 · 평판 곡선 카드 · 셀 표 자리를 실제 레이아웃과 비슷하게 채운다. */
function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">불러오는 중</span>
      {/* 헤더 줄: kind 배지 + value */}
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="ml-auto h-9 w-24 rounded-[10px]" />
      </div>
      {/* 평판 곡선 카드 */}
      <Skeleton className="mb-3 h-4 w-40" />
      <Card className="mb-6 p-4">
        <Skeleton className="h-72 w-full" />
      </Card>
      {/* 셀 표 */}
      <Skeleton className="mb-3 h-4 w-28" />
      <Card className="p-4">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}

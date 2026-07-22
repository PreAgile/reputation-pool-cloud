"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api } from "@/lib/api";
import type {
  AuditEventPage,
  AuditEventRecord,
  CellView,
  ResourceDetail,
  ResourceState,
  ScoreHistory,
} from "@/lib/types";
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

/**
 * 곡선 위에 마킹할 상태 전이 감사 이벤트만 화이트리스트로 고른다.
 * (LEASED/RELEASED 같은 상시 이벤트는 잡음이라 제외 — 격리/냉각/회복만 곡선 판독에 의미가 있다.)
 */
const ANNOTATIONS: Record<string, { label: string; color: string }> = {
  RESOURCE_COOLED: { label: "쿨다운 진입", color: "var(--cool)" },
  RESOURCE_RECOVERED: { label: "회복", color: "var(--recover)" },
  RESOURCE_BLOCKLISTED: { label: "차단", color: "var(--block)" },
  RESOURCE_UNBLOCKED: { label: "차단 해제", color: "var(--ok)" },
};

/**
 * y축(0~1) 임계 구간 밴드. 낮은 점수대는 쿨다운을 유발하는 위험 구간, 높은 점수대는 양호 구간.
 * fillOpacity 를 아주 낮게 둬서 곡선 판독을 방해하지 않고 라이트/다크 모두 은은하게 깔린다.
 */
const SCORE_BANDS: { y1: number; y2: number; color: string }[] = [
  { y1: 0, y2: 0.4, color: "var(--block)" }, // 위험(쿨다운 유발 구간)
  { y1: 0.4, y2: 0.7, color: "var(--cool)" }, // 주의
  { y1: 0.7, y2: 1, color: "var(--ok)" }, // 양호
];

function fmtClock(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 툴팁·주석 호버용: 여러 날 범위(7d/30d)에서도 모호하지 않게 날짜+시각을 함께 표기. */
function fmtStamp(t: number): string {
  return new Date(t).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

/**
 * Toss형 툴팁: surface 카드 + 라인색 점. 다크/라이트 토큰으로 자동 대응.
 * 여러 컨텍스트를 점수 내림차순으로 정렬해 크로스헤어 위치의 서열을 한눈에 읽게 한다.
 */
function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const rows = [...payload]
    .filter((p) => p.value != null)
    .sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="min-w-[132px] rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-semibold text-muted tnum">{fmtStamp(label as number)}</div>
      <div className="flex flex-col gap-1">
        {rows.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="truncate text-ink">{String(p.dataKey)}</span>
            <span className="ml-auto font-mono tnum text-ink">{Number(p.value).toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 곡선 위 이벤트 주석 마커: 세로 ReferenceLine 상단에 얹는 색점.
 * 넓은 투명 히트영역 + SVG {@code <title>} 로 호버 시 어떤 이벤트인지 네이티브 툴팁으로 보여준다.
 */
function EventMarker(props: { cx: number; cy: number; color: string; title: string }) {
  const { cx, cy, color, title } = props;
  return (
    <g style={{ cursor: "help" }}>
      <title>{title}</title>
      {/* 히트영역: 작은 점만으로는 호버가 어려워 투명 원을 넓게 깐다. */}
      <circle cx={cx} cy={cy} r={9} fill="transparent" />
      <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </g>
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
    { label: "풀 오버뷰", href: "/overview" },
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

  // 곡선 주석: 상태 전이 이벤트(냉각/회복/차단/해제)만, 현재 곡선의 시간 도메인 안에 드는 것만 남긴다.
  // (곡선 x축이 [dataMin, dataMax] 라 범위 밖 이벤트는 마킹해도 보이지 않는다.)
  const annotations = useMemo(() => {
    if (chartRows.length === 0) return [] as { key: string; t: number; label: string; color: string; title: string }[];
    const first = chartRows[0].t;
    const last = chartRows[chartRows.length - 1].t;
    return timeline
      .filter((e) => ANNOTATIONS[e.eventType])
      .map((e) => {
        const t = new Date(e.occurredAt).getTime();
        const meta = ANNOTATIONS[e.eventType];
        const parts = [meta.label, fmtStamp(t)];
        if (e.context) parts.push(e.context);
        if (e.cause) parts.push(e.cause);
        return { key: `${e.seq}`, t, label: meta.label, color: meta.color, title: parts.join(" · ") };
      })
      .filter((a) => a.t >= first && a.t <= last);
  }, [timeline, chartRows]);

  // 주석 범례: 곡선에 실제로 찍힌 이벤트 종류만(중복 제거, 정의 순서 유지).
  const annotationKinds = useMemo(() => {
    const seen = new Set(annotations.map((a) => a.label));
    return Object.values(ANNOTATIONS).filter((m) => seen.has(m.label));
  }, [annotations]);

  // 헤더 요약 스탯: 대표(최저) 셀·최악 상태·건강 분포·추세를 셀/곡선 데이터에서 계산.
  const stats = useMemo(() => {
    const cells = detail?.cells ?? [];
    const RANK: Record<ResourceState, number> = { HEALTHY: 0, RECOVERING: 1, COOLING: 2, BLOCKLISTED: 3 };
    // 대표 셀 = 최저 점수(오버뷰의 "score = 최저" 의미와 일치). 없으면 null.
    const worstCell = cells.reduce<CellView | null>(
      (acc, c) => (acc === null || c.score < acc.score ? c : acc),
      null,
    );
    // 최악 상태(차단이면 무조건 BLOCKLISTED). 배지로 노출.
    const worstState: ResourceState = detail?.blocked
      ? "BLOCKLISTED"
      : cells.reduce<ResourceState>((acc, c) => (RANK[c.state] > RANK[acc] ? c.state : acc), "HEALTHY");
    const healthy = cells.filter((c) => c.state === "HEALTHY").length;
    const attention = cells.length - healthy;
    // 추세: 대표 셀 컨텍스트 곡선의 (마지막 - 처음) Δ. 곡선이 없으면 null.
    let trend: number | null = null;
    if (worstCell && history) {
      const series = history.contexts.find((c) => c.context === worstCell.context);
      if (series && series.points.length >= 2) {
        trend = series.points[series.points.length - 1].score - series.points[0].score;
      }
    }
    return { worstCell, worstState, healthy, attention, contexts: cells.length, trend };
  }, [detail, history]);

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
      {actionError && <div className="mb-3 text-sm text-block">요청 실패 · {actionError}</div>}

      {/* 요약 스탯 행: 대표 점수(+추세) · 컨텍스트 분포 · 격리 상태 · 최근 판정. 셀/곡선 데이터로 계산. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="대표 점수" hint="가장 낮은 컨텍스트 점수">
          {stats.worstCell ? (
            <div className="flex items-baseline gap-2">
              <span className="tnum font-mono text-2xl font-extrabold text-ink">
                {stats.worstCell.score.toFixed(2)}
              </span>
              <TrendChip delta={stats.trend} />
            </div>
          ) : (
            <span className="text-2xl font-extrabold text-muted">—</span>
          )}
        </StatBox>

        <StatBox label="컨텍스트" hint="이 리소스의 컨텍스트 셀 수">
          <div className="flex items-baseline gap-2">
            <span className="tnum text-2xl font-extrabold text-ink">{stats.contexts}</span>
            <span className="text-xs font-semibold text-muted">
              정상 {stats.healthy} · 주의 {stats.attention}
            </span>
          </div>
        </StatBox>

        <StatBox label="격리 상태" hint="수동 차단 여부 / 최악 상태">
          <div className="flex flex-col items-start gap-1">
            <StatusBadge state={stats.worstState} />
            <span className="text-xs font-semibold text-muted">
              {detail.blocked
                ? detail.blockPermanent
                  ? "영구 차단"
                  : `해제 예정 ${fmtDateTime(detail.blockedUntil)}`
                : "격리 없음"}
            </span>
          </div>
        </StatBox>

        <StatBox label="최근 판정" hint="대표 컨텍스트의 연속 성공/실패">
          {stats.worstCell ? (
            stats.worstCell.consecutiveFailures > 0 ? (
              <div className="flex items-baseline gap-2">
                <span className="tnum text-2xl font-extrabold text-block-ink">
                  {stats.worstCell.consecutiveFailures}
                </span>
                <span className="text-xs font-semibold text-muted">연속 실패</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="tnum text-2xl font-extrabold text-ok-ink">
                  {stats.worstCell.consecutiveSuccesses}
                </span>
                <span className="text-xs font-semibold text-muted">연속 성공</span>
              </div>
            )
          ) : (
            <span className="text-2xl font-extrabold text-muted">—</span>
          )}
        </StatBox>
      </div>

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
                  <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
                    {/* 임계 구간 밴드(라인 뒤에 은은하게). 위험/주의/양호 점수대. */}
                    {SCORE_BANDS.map((b) => (
                      <ReferenceArea
                        key={b.y1}
                        y1={b.y1}
                        y2={b.y2}
                        fill={b.color}
                        fillOpacity={0.05}
                        stroke="none"
                        ifOverflow="hidden"
                      />
                    ))}
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
                      label={{
                        value: "시각",
                        position: "insideBottom",
                        offset: -8,
                        style: { fill: "var(--muted)", fontSize: 11, fontWeight: 600 },
                      }}
                    />
                    <YAxis
                      domain={[0, 1]}
                      ticks={[0, 0.25, 0.5, 0.75, 1]}
                      tickFormatter={(v) => (v as number).toFixed(2)}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      stroke="var(--line)"
                      width={64}
                      label={{
                        value: "평판 점수 (0–1)",
                        angle: -90,
                        position: "insideLeft",
                        offset: 12,
                        style: { textAnchor: "middle", fill: "var(--muted)", fontSize: 11, fontWeight: 600 },
                      }}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.5 }}
                    />
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
                    {/* 이벤트 주석: 세로 가이드(정렬) + 상단 마커(호버 툴팁). 라인 위에 얹혀 곡선과 x축 정렬. */}
                    {annotations.map((a) => (
                      <ReferenceLine
                        key={`l-${a.key}`}
                        x={a.t}
                        stroke={a.color}
                        strokeDasharray="4 3"
                        strokeOpacity={0.65}
                        ifOverflow="hidden"
                      />
                    ))}
                    {annotations.map((a) => (
                      <ReferenceDot
                        key={`d-${a.key}`}
                        x={a.t}
                        y={1}
                        r={0}
                        ifOverflow="hidden"
                        shape={(p: { cx?: number; cy?: number }) => (
                          <EventMarker cx={p.cx ?? 0} cy={p.cy ?? 0} color={a.color} title={a.title} />
                        )}
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
            {/* 주석 범례: 곡선에 실제로 찍힌 이벤트 종류만 노출(마커 색과 일치). */}
            {hasCurve && annotationKinds.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-1 text-xs">
                <span className="font-semibold text-muted">이벤트</span>
                {annotationKinds.map((m) => (
                  <span key={m.label} className="flex items-center gap-1.5 text-muted">
                    <span
                      className="size-2 rounded-full ring-2 ring-surface"
                      style={{ background: m.color }}
                    />
                    {m.label}
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
                    <th className="px-4 py-2.5 font-bold" title="Cooldown(COOLING)이 풀리는 시각">Cooldown 해제 시각</th>
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

/** 요약 스탯 한 칸: 라벨(작게) + 값(children). surface-2 박스로 카드와 톤 분리. */
function StatBox({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface-2 px-3.5 py-3" title={hint}>
      <div className="mb-1.5 text-xs font-semibold text-muted">{label}</div>
      {children}
    </div>
  );
}

/** 추세 칩: 대표 컨텍스트 곡선의 Δ. 상승은 ok, 하락은 block 색. 거의 평탄하거나 데이터 없으면 표시 안 함. */
function TrendChip({ delta }: { delta: number | null }) {
  if (delta === null || Math.abs(delta) < 0.005) return null;
  const up = delta > 0;
  return (
    <span
      className={`tnum inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-ok-ink" : "text-block-ink"}`}
      title="선택 기간 동안의 점수 변화(대표 컨텍스트)"
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(delta).toFixed(2)}
    </span>
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

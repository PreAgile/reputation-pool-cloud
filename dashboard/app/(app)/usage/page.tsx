"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api } from "@/lib/api";
import type { UsageSummary } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DateRangePicker,
  RANGE_PRESETS,
  type RangePreset,
} from "@/components/ui/date-range-picker";

/** 일별 리스 바 차트가 먹는 행: ms 타임스탬프 + count. */
type ChartRow = { t: number; count: number };

/** "yyyy-MM-dd" → "MM/DD"(축 라벨용). 파싱 실패 시 원본 반환. */
function fmtDay(input: string | number): string {
  const d = typeof input === "number" ? new Date(input) : new Date(`${input}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(input);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

/** 천 단위 구분 기호(로케일 무관 고정) — tnum과 함께 자릿수 정렬. */
function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** Toss형 툴팁: surface 카드 + accent 점. 라이트/다크 토큰으로 자동 대응. */
function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-muted tnum">{fmtDay(label as number)}</div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="text-ink">임대</span>
        <span className="ml-auto font-mono tnum text-ink">{fmtNum(value)}</span>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 일별 리스 창(프리셋). 서버가 이 창만큼만 돌려주므로(usage?days=) 클라이언트가 다시 자르지 않는다.
  const [range, setRange] = useState<RangePreset>(RANGE_PRESETS[2]);

  // 요청 세대: 기간을 바꾸면 이전 요청이 늦게 도착해 새 기간의 화면을 덮어쓸 수 있다. dispatch 때 자기
  // 세대를 잡고, 반영 직전 여전히 최신일 때만 상태를 바꾼다(라이브 이벤트 화면과 같은 방식).
  const reqSeq = useRef(0);

  const load = useCallback(() => {
    const my = ++reqSeq.current;
    setError(null);
    // 새 기간의 응답이 오기 전까지 옛 기간 수치를 새 라벨과 함께 보여주지 않는다.
    setData(null);
    api<UsageSummary>(`/usage?days=${range.days}`)
      .then((res) => {
        if (my === reqSeq.current) setData(res);
      })
      .catch((e) => {
        if (my === reqSeq.current) setError(e instanceof Error ? e.message : "불러오지 못했습니다");
      });
  }, [range.days]);

  useEffect(() => {
    load();
  }, [load]);

  // dailyLeases → 시각 오름차순 바 차트 행 + 창 합계. 창 자르기는 서버가 이미 했다.
  const { chartRows, windowTotal } = useMemo(() => {
    if (!data) return { chartRows: [] as ChartRow[], windowTotal: 0 };
    const rows = data.dailyLeases
      .map((d) => ({ t: new Date(`${d.date}T00:00:00`).getTime(), count: d.count }))
      .filter((r) => !Number.isNaN(r.t))
      .sort((a, b) => a.t - b.t);
    return { chartRows: rows, windowTotal: rows.reduce((sum, r) => sum + r.count, 0) };
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader />
        <Card>
          <EmptyState
            tone="error"
            title="사용량을 불러오지 못했습니다"
            description={error}
            action={{ label: "다시 시도", onClick: load }}
          />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader />
        <div className="text-sm text-muted">불러오는 중…</div>
      </div>
    );
  }

  const hasBars = chartRows.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader />

      {/* 미터 타일 */}
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="이번 달 임대 건수" value={fmtNum(data.monthLeaseTotal)} accent />
        <StatTile label="등록 리소스 수" value={fmtNum(data.poolSize)} />
        <StatTile label={`${range.label} 임대 건수`} value={fmtNum(windowTotal)} />
      </section>

      {/* 일별 리스 차트 — 기간은 날짜 범위 피커로 파라미터화(24h/7d/30d). */}
      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">일별 임대 · {range.label}</h2>
          <DateRangePicker value={range} onChange={setRange} label="사용량 기간 선택" />
        </div>
        <Card className="p-4">
          {hasBars ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) => fmtDay(t as number)}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    stroke="var(--line)"
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    stroke="var(--line)"
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                  <Bar
                    dataKey="count"
                    name="임대"
                    fill="var(--accent)"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="아직 임대 기록이 없습니다"
              description={
                data.poolSize > 0
                  ? "리소스는 등록돼 있지만 임대 기록이 없습니다. 임대 건수는 Acquire 로 리소스를 받아갈 때만 쌓입니다 — 클라이언트가 Register·Report 만 쓰고 리소스를 직접 고르고 있다면 이 값은 계속 0 입니다."
                  : "선택한 기간에 리소스 임대가 없었습니다. 기간을 넓히거나 트래픽이 쌓이면 여기에 일별 추이가 그려집니다."
              }
            />
          )}
        </Card>
      </section>

      {/* 문의 CTA — 과금 미연동 프로토타입이라 결제/요금 표기 없이 메일 문의만 안내 */}
      <section className="mb-6">
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink">더 높은 한도·전용 지원이 필요하신가요?</h3>
            <p className="mt-1 text-sm text-muted">
              사용량이 늘고 있다면 메일로 문의 주세요. 상황에 맞게 도와드리겠습니다.
            </p>
          </div>
          {/* TODO(#6): 실제 문의 주소로 교체 */}
          <a href="mailto:contact@example.com" className="shrink-0">
            <Button className="w-full sm:w-auto">메일로 문의하기</Button>
          </a>
        </Card>
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h1 className="mb-2 text-xl font-extrabold tracking-tight text-ink">사용량</h1>
      <p className="text-sm text-muted">이번 달 리소스 임대 건수와 등록된 리소스 수를 한눈에 봅니다.</p>
    </div>
  );
}

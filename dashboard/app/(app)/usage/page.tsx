"use client";

import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    api<UsageSummary>("/usage")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, []);

  // dailyLeases → 시각 오름차순 바 차트 행 + 최근 30일 합계.
  const { chartRows, windowTotal } = useMemo(() => {
    if (!data) return { chartRows: [] as ChartRow[], windowTotal: 0 };
    const rows = data.dailyLeases
      .map((d) => ({ t: new Date(`${d.date}T00:00:00`).getTime(), count: d.count }))
      .filter((r) => !Number.isNaN(r.t))
      .sort((a, b) => a.t - b.t);
    const total = data.dailyLeases.reduce((sum, d) => sum + d.count, 0);
    return { chartRows: rows, windowTotal: total };
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader />
        <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {error}</Card>
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
        <StatTile label="최근 30일 임대 건수" value={fmtNum(windowTotal)} />
      </section>

      {/* 일별 리스 차트 */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-bold text-ink">일별 임대 · 최근 30일</h2>
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
            <div className="flex h-40 items-center justify-center text-sm text-muted">
              아직 임대 기록이 없습니다.
            </div>
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

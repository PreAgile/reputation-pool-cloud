"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { PoolOverview, ResourceKind, ResourceOverview, ResourceState } from "@/lib/types";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/cn";
import { usePoll } from "@/lib/use-poll";

/** 심각도 정렬용 가중치: 높을수록 위로. BLOCKLISTED > COOLING > RECOVERING > HEALTHY. */
const SEVERITY: Record<ResourceState, number> = {
  BLOCKLISTED: 3,
  COOLING: 2,
  RECOVERING: 1,
  HEALTHY: 0,
};

const KIND_LABEL: Record<ResourceKind, string> = {
  PROXY: "프록시",
  ACCOUNT: "계정",
  SESSION: "세션",
};

const KINDS: ResourceKind[] = ["PROXY", "ACCOUNT", "SESSION"];

function KindBadge({ kind }: { kind: ResourceKind }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-muted">
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

/** 차단 만료 표기: 영구면 "영구", 시각 있으면 로컬 시각, 없으면 "—". */
function formatBlock(r: ResourceOverview): string {
  if (!r.blocked) return "—";
  if (r.blockPermanent) return "영구";
  if (r.blockedUntil) {
    const d = new Date(r.blockedUntil);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  }
  return "차단";
}

export default function OverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<PoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ResourceKind | "ALL">("ALL");

  const load = useCallback(() => {
    api<PoolOverview>("/pools/resources")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 보이는 동안 15초마다 갱신(백그라운드 탭이면 자동 정지). 상태·score가 알아서 최신으로.
  usePoll(load, 15000);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.resources
      .filter((r) => (kindFilter === "ALL" ? true : r.kind === kindFilter))
      .filter((r) => (q ? r.value.toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => {
        const sev = SEVERITY[b.state] - SEVERITY[a.state];
        if (sev !== 0) return sev;
        // 같은 심각도면 낮은 score 먼저(위험한 것 위로), score 없으면 뒤로.
        const as = a.score ?? Number.POSITIVE_INFINITY;
        const bs = b.score ?? Number.POSITIVE_INFINITY;
        return as - bs;
      });
  }, [data, query, kindFilter]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold tracking-tight">풀 오버뷰</h1>
        <p className="mt-1 text-sm text-muted">등록된 리소스의 평판 상태를 한눈에 확인합니다.</p>
      </div>

      {error && (
        <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {error}</Card>
      )}
      {!error && !data && <div className="text-sm text-muted">불러오는 중…</div>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="등록" value={data.summary.registered} />
            <StatTile label="차단" value={data.summary.blocklisted} />
            <StatTile label="냉각" value={data.summary.cellsByState?.COOLING ?? 0} />
            <StatTile label="회복" value={data.summary.cellsByState?.RECOVERING ?? 0} />
            <StatTile label="셀 총계" value={data.summary.totalCells} accent />
          </div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(["ALL", ...KINDS] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-bold transition",
                    kindFilter === k
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-surface text-muted hover:text-ink",
                  )}
                >
                  {k === "ALL" ? "전체" : KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="리소스 값 검색"
              className="w-full rounded-[10px] border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none sm:w-56"
            />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-bold">종류</th>
                    <th className="px-4 py-2.5 font-bold">리소스</th>
                    <th className="px-4 py-2.5 font-bold">상태</th>
                    <th className="px-4 py-2.5 text-right font-bold">score</th>
                    <th className="px-4 py-2.5 font-bold">최근 판정</th>
                    <th className="px-4 py-2.5 text-right font-bold">컨텍스트</th>
                    <th className="px-4 py-2.5 font-bold">차단</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const go = () =>
                      router.push(`/resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.value)}`);
                    return (
                    <tr
                      key={`${r.kind}:${r.value}`}
                      onClick={go}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          go();
                        }
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`${r.value} 상세 보기`}
                      className="cursor-pointer border-t border-line transition hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <td className="px-4 py-2.5">
                        <KindBadge kind={r.kind} />
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-ink" title={r.value}>
                        {r.value}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge state={r.state} />
                      </td>
                      <td className="tnum px-4 py-2.5 text-right font-mono">
                        {r.score != null ? r.score.toFixed(2) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Sparkline flags={r.recentWindow} />
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">{r.contexts}</td>
                      <td className="px-4 py-2.5 text-muted">{formatBlock(r)}</td>
                    </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        {data.resources.length === 0
                          ? "등록된 리소스가 없습니다."
                          : "조건에 맞는 리소스가 없습니다."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

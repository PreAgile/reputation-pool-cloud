"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PoolOverview } from "@/lib/types";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

export default function OverviewPage() {
  const [data, setData] = useState<PoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PoolOverview>("/pools/resources")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-xl font-extrabold tracking-tight">풀 오버뷰</h1>

      {error && <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {error}</Card>}
      {!error && !data && <div className="text-sm text-muted">불러오는 중…</div>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="등록" value={data.summary.registered} />
            <StatTile label="냉각" value={data.summary.cellsByState?.COOLING ?? 0} />
            <StatTile label="회복" value={data.summary.cellsByState?.RECOVERING ?? 0} />
            <StatTile label="블록" value={data.summary.blocklisted} />
            <StatTile label="셀" value={data.summary.totalCells} accent />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-bold">리소스</th>
                    <th className="px-4 py-2.5 font-bold">종류</th>
                    <th className="px-4 py-2.5 font-bold">상태</th>
                    <th className="px-4 py-2.5 text-right font-bold">score</th>
                    <th className="px-4 py-2.5 text-right font-bold">컨텍스트</th>
                  </tr>
                </thead>
                <tbody>
                  {data.resources.map((r) => (
                    <tr key={`${r.kind}:${r.value}`} className="border-t border-line">
                      <td className="px-4 py-2.5 font-mono text-ink">{r.value}</td>
                      <td className="px-4 py-2.5 text-muted">{r.kind}</td>
                      <td className="px-4 py-2.5">
                        {r.state ? (
                          <StatusBadge state={r.state} />
                        ) : r.blocked ? (
                          <StatusBadge state="BLOCKLISTED" />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right">
                        {r.score != null ? r.score.toFixed(2) : "—"}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">{r.contexts}</td>
                    </tr>
                  ))}
                  {data.resources.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted">
                        등록된 리소스가 없습니다.
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

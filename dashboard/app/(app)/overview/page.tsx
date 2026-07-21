"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PoolOverview, ResourceKind, ResourceOverview, ResourceState } from "@/lib/types";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Sparkline } from "@/components/sparkline";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuIconTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
  const toast = useToast();
  const [data, setData] = useState<PoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ResourceKind | "ALL">("ALL");
  // 오버플로 메뉴로 차단/해제가 진행 중인 행 키(중복 클릭 방지).
  const [actingKey, setActingKey] = useState<string | null>(null);
  // 값 클릭 시 리스트를 벗어나지 않고 여는 미리보기 드로어의 대상 리소스(#52 P4).
  const [preview, setPreview] = useState<ResourceOverview | null>(null);

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

  // 오버플로 메뉴의 빠른 차단/해제(상세 화면과 같은 mutation·toast 재사용). 성공 후 목록 재로딩.
  async function onAction(r: ResourceOverview, action: "unblock" | "blockPermanent" | "blockTemp") {
    const rowKey = `${r.kind}:${r.value}`;
    if (actingKey) return;
    setActingKey(rowKey);
    const base = `/pools/resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.value)}`;
    try {
      if (action === "blockPermanent") {
        await api<void>(`${base}/block?permanent=true`, { method: "POST" });
      } else if (action === "blockTemp") {
        await api<void>(`${base}/block?seconds=3600`, { method: "POST" });
      } else {
        await api<void>(`${base}/block`, { method: "DELETE" });
      }
      load();
      toast.success(
        action === "blockPermanent"
          ? "영구 차단했습니다."
          : action === "blockTemp"
            ? "1시간 차단했습니다."
            : "차단을 해제했습니다.",
      );
    } catch (e) {
      toast.error(`요청 실패 · ${e instanceof Error ? e.message : "요청에 실패했습니다"}`);
    } finally {
      setActingKey(null);
    }
  }

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
      {!error && !data && <OverviewSkeleton />}

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
                    <th className="px-4 py-2.5 text-right font-bold">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    return (
                    <tr
                      key={`${r.kind}:${r.value}`}
                      className="border-t border-line transition hover:bg-surface-2"
                    >
                      <td className="px-4 py-2.5">
                        <KindBadge kind={r.kind} />
                      </td>
                      {/* 값 셀은 이동 링크 대신 미리보기 드로어 트리거다 — 리스트 맥락을 유지한 채
                          상세를 보고, 드로어 안의 "전체 상세 보기"로만 페이지 이동한다(#52 P4).
                          행 전체를 트리거로 감싸면 오버플로 메뉴가 nested-interactive 가 되므로 값 셀만. */}
                      <td className="max-w-[16rem] truncate px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setPreview(r)}
                          title={r.value}
                          aria-label={`${r.value} 미리보기`}
                          className="rounded-[4px] text-left font-mono text-ink hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {r.value}
                        </button>
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
                      <td className="px-4 py-2.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuIconTrigger label={`${r.value} 작업 메뉴 열기`} />
                          <DropdownMenuContent>
                            {r.blocked ? (
                              <DropdownMenuItem onSelect={() => onAction(r, "unblock")}>
                                차단 해제
                              </DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem onSelect={() => onAction(r, "blockTemp")}>
                                  1시간 차단
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  destructive
                                  onSelect={() => onAction(r, "blockPermanent")}
                                >
                                  영구 차단
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted">
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

      <ResourcePreviewDrawer
        resource={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </div>
  );
}

/**
 * 리소스 미리보기 드로어: 오버뷰에서 값을 클릭하면 리스트를 벗어나지 않고 요약(상태·score·최근 판정·차단)을
 * 보여주고, "전체 상세 보기"로만 상세 페이지로 이동한다(#52 P4). 열림은 resource 유무로 제어한다.
 */
function ResourcePreviewDrawer({
  resource,
  onOpenChange,
}: {
  resource: ResourceOverview | null;
  onOpenChange: (open: boolean) => void;
}) {
  // 닫힘 애니메이션(rp-anim-drawer-out, 120~240ms) 동안 Radix 는 Content 를 잠시 유지한다. resource 가
  // 즉시 null 이 되면 그 사이 제목·본문이 먼저 사라진 빈 드로어가 슬라이드 아웃돼 깜빡인다 — 마지막
  // 리소스를 붙잡아 내용을 끝까지 유지한다(리뷰 반영). 열림 여부는 여전히 현재 resource 로만 판단한다.
  const [active, setActive] = useState<ResourceOverview | null>(null);
  useEffect(() => {
    if (resource) setActive(resource);
  }, [resource]);
  const r = resource ?? active;
  const detailHref = r
    ? `/resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.value)}`
    : "#";
  return (
    <Drawer
      open={resource != null}
      onOpenChange={onOpenChange}
      title={r ? r.value : ""}
      description={r ? (KIND_LABEL[r.kind] ?? r.kind) : undefined}
    >
      {r && (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-[5rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">상태</dt>
            <dd>
              <StatusBadge state={r.state} />
            </dd>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">score</dt>
            <dd className="tnum font-mono text-ink">
              {r.score != null ? r.score.toFixed(2) : <span className="text-muted">—</span>}
            </dd>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">컨텍스트</dt>
            <dd className="tnum text-ink">{r.contexts}</dd>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">차단</dt>
            <dd className="text-muted">{formatBlock(r)}</dd>
          </dl>

          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              최근 판정
            </div>
            <Sparkline flags={r.recentWindow} />
          </div>

          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 self-start rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            전체 상세 보기
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      )}
    </Drawer>
  );
}

/** 오버뷰 로딩 스켈레톤: KPI 5칸 + 필터/검색 줄 + 표 자리를 실제 레이아웃대로 채운다. */
function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">불러오는 중</span>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[76px] w-full rounded-[14px]" />
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-8 w-56 rounded-full" />
        <Skeleton className="h-8 w-56 rounded-[10px]" />
      </div>
      <Card className="p-4">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}

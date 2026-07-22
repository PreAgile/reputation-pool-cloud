"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { PoolOverview, PoolSummary, ResourceKind, ResourceOverview, ResourceState } from "@/lib/types";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Sparkline } from "@/components/sparkline";
import { useToast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuIconTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { usePoll } from "@/lib/use-poll";

const POLL_MS = 15000;
/** 한 번에 보여줄 행 수. 넘으면 "더 보기"로 점증 노출(가상화까지는 과함). */
const PAGE_SIZE = 25;

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

type SortKey = "severity" | "value" | "score" | "contexts";

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

/** 오름차순 기준 비교(정렬 방향은 호출부에서 부호로 뒤집는다). */
function cmpAsc(a: ResourceOverview, b: ResourceOverview, key: SortKey): number {
  switch (key) {
    case "severity": {
      const s = SEVERITY[a.state] - SEVERITY[b.state];
      if (s !== 0) return s;
      // 같은 심각도면 낮은 score 먼저(위험한 것 위로), score 없으면 뒤로.
      return (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY);
    }
    case "score":
      return (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY);
    case "contexts":
      return a.contexts - b.contexts;
    case "value":
      return a.value.localeCompare(b.value);
  }
}

/** 초 단위 상대 시각: "방금 · 12초 전". */
function fmtAgo(seconds: number): string {
  if (seconds <= 1) return "방금";
  if (seconds < 60) return `${seconds}초 전`;
  const m = Math.floor(seconds / 60);
  return `${m}분 전`;
}

export default function OverviewPage() {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<PoolOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ResourceKind | "ALL">("ALL");
  // 오버플로 메뉴로 차단/해제가 진행 중인 행 키(중복 클릭 방지).
  const [actingKey, setActingKey] = useState<string | null>(null);

  // 라이브 인디케이터 상태.
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 정렬·페이지네이션.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "severity", dir: "desc" });
  const [visible, setVisible] = useState(PAGE_SIZE);

  // 폴링 사이 증감/변경 감지용. 직전 요약과 행 상태를 ref로 보관한다.
  const prevSummaryRef = useRef<PoolSummary | null>(null);
  const prevRowsRef = useRef<Map<string, { state: ResourceState; score: number | null }>>(new Map());
  const [deltas, setDeltas] = useState<Partial<Record<keyof PoolSummary | "cooling" | "recovering", number>>>({});
  // 이번 갱신으로 상태/score가 바뀐 행 키(잠깐 하이라이트 후 fade).
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api<PoolOverview>("/pools/resources")
      .then((d) => {
        setData(d);
        setLastUpdated(Date.now());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 보이는 동안 15초마다 갱신(백그라운드 탭·일시정지면 건너뜀). 상태·score가 알아서 최신으로.
  usePoll(load, POLL_MS, !paused);

  // "N초 전" 표기를 위해 1초마다 시계만 갱신(네트워크 호출 없음).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 데이터가 바뀌면: KPI 증감 계산 + 변경된 행 하이라이트(직전 스냅샷 대비).
  useEffect(() => {
    if (!data) return;

    const prev = prevSummaryRef.current;
    if (prev) {
      setDeltas({
        registered: data.summary.registered - prev.registered,
        blocklisted: data.summary.blocklisted - prev.blocklisted,
        totalCells: data.summary.totalCells - prev.totalCells,
        cooling: (data.summary.cellsByState?.COOLING ?? 0) - (prev.cellsByState?.COOLING ?? 0),
        recovering: (data.summary.cellsByState?.RECOVERING ?? 0) - (prev.cellsByState?.RECOVERING ?? 0),
      });
    }
    prevSummaryRef.current = data.summary;

    const prevMap = prevRowsRef.current;
    const nextMap = new Map<string, { state: ResourceState; score: number | null }>();
    const changedKeys = new Set<string>();
    for (const r of data.resources) {
      const key = `${r.kind}:${r.value}`;
      nextMap.set(key, { state: r.state, score: r.score });
      const p = prevMap.get(key);
      if (p && (p.state !== r.state || p.score !== r.score)) changedKeys.add(key);
    }
    prevRowsRef.current = nextMap;

    if (changedKeys.size > 0) {
      setChanged(changedKeys);
      const t = setTimeout(() => setChanged(new Set()), 2200);
      return () => clearTimeout(t);
    }
  }, [data]);

  // 필터·검색이 바뀌면 노출 개수를 처음으로 되돌린다.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, kindFilter]);

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

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "value" || key === "score" ? "asc" : "desc" },
    );
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.resources
      .filter((r) => (kindFilter === "ALL" ? true : r.kind === kindFilter))
      .filter((r) => (q ? r.value.toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => (sort.dir === "asc" ? 1 : -1) * cmpAsc(a, b, sort.key));
  }, [data, query, kindFilter, sort]);

  const shown = rows.slice(0, visible);
  const secondsAgo = lastUpdated != null ? Math.max(0, Math.floor((now - lastUpdated) / 1000)) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">풀 오버뷰</h1>
          <p className="mt-1 text-sm text-muted">등록된 리소스의 평판 상태를 한눈에 확인합니다.</p>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-1.5 text-xs">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  paused ? "bg-muted" : "bg-ok motion-safe:animate-pulse",
                )}
              />
              <span className="font-bold text-ink">
                {paused ? "일시정지됨" : "실시간"}
              </span>
              {secondsAgo != null && (
                <span className="tnum text-muted">· {fmtAgo(secondsAgo)} 갱신</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="rounded-[10px] border border-line bg-surface-2 px-3 py-1.5 text-sm font-bold text-ink transition hover:bg-surface"
            >
              {paused ? "재개" : "일시정지"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {error}</Card>
      )}
      {!error && !data && <OverviewSkeleton />}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="등록" value={data.summary.registered} delta={deltas.registered} />
            <StatTile
              label="Blocked"
              value={data.summary.blocklisted}
              tone={data.summary.blocklisted > 0 ? "block" : "default"}
              delta={deltas.blocklisted}
              deltaTone={(deltas.blocklisted ?? 0) > 0 ? "bad" : "good"}
            />
            <StatTile
              label="Cooldown"
              value={data.summary.cellsByState?.COOLING ?? 0}
              tone={(data.summary.cellsByState?.COOLING ?? 0) > 0 ? "cool" : "default"}
              delta={deltas.cooling}
              deltaTone={(deltas.cooling ?? 0) > 0 ? "bad" : "good"}
            />
            <StatTile
              label="Recovering"
              value={data.summary.cellsByState?.RECOVERING ?? 0}
              tone={(data.summary.cellsByState?.RECOVERING ?? 0) > 0 ? "recover" : "default"}
              delta={deltas.recovering}
            />
            <StatTile label="셀 총계" value={data.summary.totalCells} accent delta={deltas.totalCells} />
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
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-bold">종류</th>
                    <SortHeader label="리소스" sortKey="value" sort={sort} onSort={toggleSort} />
                    <SortHeader label="상태" sortKey="severity" sort={sort} onSort={toggleSort} />
                    <SortHeader label="score" sortKey="score" align="right" sort={sort} onSort={toggleSort} />
                    <th className="px-4 py-2.5 font-bold">최근 판정</th>
                    <SortHeader label="컨텍스트" sortKey="contexts" align="right" sort={sort} onSort={toggleSort} />
                    <th className="px-4 py-2.5 font-bold">차단</th>
                    <th className="px-4 py-2.5 text-right font-bold">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const rowKey = `${r.kind}:${r.value}`;
                    const detailHref = `/resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.value)}`;
                    const isChanged = changed.has(rowKey);
                    return (
                    <tr
                      key={rowKey}
                      onClick={() => router.push(detailHref)}
                      className={cn(
                        "group cursor-pointer border-t border-line transition-colors duration-700 hover:bg-surface-2",
                        isChanged && "bg-accent-soft",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <KindBadge kind={r.kind} />
                      </td>
                      {/* 행 전체가 상세로 가는 클릭 대상이다. 값 셀은 키보드·중간클릭·새 탭을 위해 실제
                          링크로 두고(같은 목적지), 오버플로 메뉴 td 는 stopPropagation 으로 행 이동을 막는다. */}
                      <td className="max-w-[16rem] truncate px-4 py-2.5">
                        <Link
                          href={detailHref}
                          title={r.value}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-[4px] font-mono text-ink underline-offset-2 group-hover:text-accent group-hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {r.value}
                        </Link>
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
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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
            {rows.length > visible && (
              <div className="border-t border-line px-4 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-2 text-sm font-bold text-ink transition hover:bg-surface"
                >
                  {rows.length - visible}개 더 보기
                </button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** 정렬 가능한 컬럼 헤더. 활성 컬럼이면 방향 화살표(↑/↓)를 보이고, 클릭으로 방향 토글. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("px-4 py-2.5 font-bold", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`${label} 기준 정렬`}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink",
          active ? "text-ink" : "text-muted",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[10px]", !active && "opacity-30")}>
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
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

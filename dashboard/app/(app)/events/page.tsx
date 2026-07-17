"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { AuditEventPage, AuditEventRecord, ResourceKind } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePoll } from "@/lib/use-poll";

/** 첫 페이지(최근 50건)를 다시 불러오는 폴링 주기. */
const POLL_MS = 5000;
const POLL_SECONDS = POLL_MS / 1000;
const PAGE_SIZE = 50;

/**
 * 이벤트 유형 → 한글 라벨 + 기능색 톤. 색은 은은하게(bg는 12% 틴트),
 * dot + 텍스트로 유형을 구분한다. 백엔드 PoolEvent 6종과 1:1.
 */
const EVENT_META: Record<string, { label: string; cls: string }> = {
  RESOURCE_COOLED: { label: "냉각 진입", cls: "text-cool-ink bg-cool/12" },
  RESOURCE_RECOVERED: { label: "회복", cls: "text-recover-ink bg-recover/12" },
  RESOURCE_BLOCKLISTED: { label: "차단", cls: "text-block-ink bg-block/12" },
  RESOURCE_UNBLOCKED: { label: "차단 해제", cls: "text-ok-ink bg-ok/12" },
  RESOURCE_LEASED: { label: "임대", cls: "text-accent bg-accent-soft" },
  LEASE_RELEASED: { label: "반납", cls: "text-muted bg-muted/12" },
};

/** 필터 드롭다운/정렬에 쓰는 알려진 유형 순서. */
const EVENT_TYPES = [
  "RESOURCE_LEASED",
  "LEASE_RELEASED",
  "RESOURCE_COOLED",
  "RESOURCE_RECOVERED",
  "RESOURCE_BLOCKLISTED",
  "RESOURCE_UNBLOCKED",
] as const;

const KIND_LABEL: Record<ResourceKind, string> = {
  PROXY: "프록시",
  ACCOUNT: "계정",
  SESSION: "세션",
};
const KINDS: ResourceKind[] = ["PROXY", "ACCOUNT", "SESSION"];

/** RESOURCE_COOLED 의 cause(FailureType) → 한글. */
const CAUSE_LABEL: Record<string, string> = {
  CONNECTION_RESET: "연결 리셋",
  TLS_HANDSHAKE: "TLS 핸드셰이크",
  TIMEOUT: "타임아웃",
  BLOCKED: "차단됨",
};

function eventMeta(type: string): { label: string; cls: string } {
  return EVENT_META[type] ?? { label: type, cls: "text-muted bg-muted/12" };
}

/** ISO-8601 → 월/일 시:분:초(로컬). 파싱 실패 시 원문. */
function fmtOccurred(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 만료 표기: until 있으면 로컬 시각, 없는 BLOCKLISTED는 영구, 그 외 "—". */
function fmtUntil(e: AuditEventRecord): string {
  if (e.until) {
    const d = new Date(e.until);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return e.until;
  }
  if (e.eventType === "RESOURCE_BLOCKLISTED") return "영구";
  return "—";
}

function EventBadge({ type }: { type: string }) {
  const m = eventMeta(type);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold",
        m.cls,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-muted">
      {KIND_LABEL[kind as ResourceKind] ?? kind}
    </span>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState<AuditEventRecord[] | null>(null);
  const [firstError, setFirstError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);

  // 필터(전부 클라이언트측 — 서버는 page/size만 지원).
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [kindFilter, setKindFilter] = useState<ResourceKind | "ALL">("ALL");
  const [query, setQuery] = useState("");

  // 최초 성공 로드 여부: 폴링 실패를 조용히 넘길지(직전 데이터 유지) 판단.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<AuditEventPage>(`/events?page=0&size=${PAGE_SIZE}`);
      loadedRef.current = true;
      setEvents(res.events);
      setLastUpdated(new Date());
      setFirstError(null);
      setPollWarning(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "불러오지 못했습니다";
      // 첫 로드 실패는 에러 화면, 이후 폴링 실패는 직전 데이터 유지 + 작은 경고.
      if (loadedRef.current) setPollWarning(msg);
      else setFirstError(msg);
    }
  }, []);

  // 최초 1회 즉시 로드.
  useEffect(() => {
    void load();
  }, [load]);

  // 폴링: 일시정지가 아니고 탭이 보일 때만 첫 페이지를 주기 갱신(usePoll이 백그라운드 탭을 건너뛴다).
  usePoll(() => void load(), POLL_MS, !paused);

  const rows = useMemo(() => {
    if (!events) return [];
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => (typeFilter === "ALL" ? true : e.eventType === typeFilter))
      .filter((e) => (kindFilter === "ALL" ? true : e.resourceKind === kindFilter))
      .filter((e) =>
        q
          ? e.resourceValue.toLowerCase().includes(q) ||
            (e.context?.toLowerCase().includes(q) ?? false)
          : true,
      )
      .slice()
      .sort((a, b) => b.seq - a.seq); // seq 단조증가 → 시간 내림차순
  }, [events, typeFilter, kindFilter, query]);

  const filtering = typeFilter !== "ALL" || kindFilter !== "ALL" || query.trim() !== "";

  return (
    <div className="mx-auto max-w-6xl">
      {/* 헤더 + 실시간 상태 */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">라이브 이벤트</h1>
          <p className="mt-1 text-sm text-muted">
            풀에서 발생한 최근 감사 이벤트를 시간 내림차순으로 봅니다. (최근 {PAGE_SIZE}건)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                paused ? "bg-muted" : "bg-ok motion-safe:animate-pulse",
              )}
            />
            <span className="font-bold text-ink">
              {paused ? "일시정지됨" : `실시간 · ${POLL_SECONDS}초마다`}
            </span>
            {lastUpdated && (
              <span className="tnum text-muted">· {fmtClock(lastUpdated)} 갱신</span>
            )}
          </div>
          <Button variant="ghost" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "재개" : "일시정지"}
          </Button>
        </div>
      </div>

      {/* 폴링 실패 경고(직전 데이터 유지 중) */}
      {pollWarning && !firstError && (
        <Card className="mb-4 border-cool/40 bg-cool/8 px-4 py-2.5 text-xs font-semibold text-cool-ink">
          최신 갱신 실패 · {pollWarning} — 직전 데이터를 표시 중입니다.
        </Card>
      )}

      {/* 첫 로드 실패 */}
      {firstError && (
        <Card className="p-4 text-sm text-block">불러오지 못했습니다 · {firstError}</Card>
      )}

      {/* 첫 로드 중 */}
      {!firstError && events === null && <div className="text-sm text-muted">불러오는 중…</div>}

      {events !== null && (
        <>
          {/* 필터 */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
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
                  {k === "ALL" ? "전체 종류" : KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="이벤트 유형 필터"
                className="rounded-[10px] border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink focus:border-accent focus:outline-none"
              >
                <option value="ALL">모든 유형</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_META[t].label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="리소스·컨텍스트 검색"
                className="w-full rounded-[10px] border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none sm:w-56"
              />
            </div>
          </div>

          <div className="mb-2 text-xs text-muted">
            <span className="tnum font-bold text-ink">{rows.length}</span>건
            {filtering && <span> · 필터 적용됨</span>}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 font-bold">시각</th>
                    <th className="px-4 py-2.5 font-bold">유형</th>
                    <th className="px-4 py-2.5 font-bold">리소스</th>
                    <th className="px-4 py-2.5 font-bold">컨텍스트</th>
                    <th className="px-4 py-2.5 font-bold">원인</th>
                    <th className="px-4 py-2.5 font-bold">만료</th>
                    <th className="px-4 py-2.5 text-right font-bold">seq</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.seq} className="border-t border-line align-top hover:bg-surface-2">
                      <td className="tnum whitespace-nowrap px-4 py-2.5 font-mono text-muted">
                        {fmtOccurred(e.occurredAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <EventBadge type={e.eventType} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <KindBadge kind={e.resourceKind} />
                          <span
                            className="max-w-[16rem] truncate font-mono text-ink"
                            title={e.resourceValue}
                          >
                            {e.resourceValue}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {e.context ? (
                          <span className="font-mono text-ink">{e.context}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {e.cause ? (CAUSE_LABEL[e.cause] ?? e.cause) : "—"}
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-2.5 text-muted">
                        {fmtUntil(e)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right font-mono text-muted">{e.seq}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        {events.length === 0
                          ? "아직 기록된 이벤트가 없습니다."
                          : "조건에 맞는 이벤트가 없습니다."}
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

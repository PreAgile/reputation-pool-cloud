"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { CellView, ResourceKind, ResourceState } from "@/lib/types";
import {
  contextsWorstFirst,
  representativeContext,
  scoreDistribution,
  sortRowsWorstFirst,
  stateCounts,
  type HeatmapRow,
} from "@/lib/heatmap";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkline } from "@/components/sparkline";

/**
 * Resource × Context 상태 격자(#124).
 *
 * 행=리소스, 열=컨텍스트, 칸 색=state. 집계 평균 하나로는 "전체가 고르게 나쁘다(공통 원인)"와
 * "몇 개만 나쁘다(그 리소스·컨텍스트만 차단)"를 구분할 수 없다 — 두 경우의 평균이 같을 수 있다.
 * 격자는 그 모양을 색으로 즉시 보여주고, 위의 분포 요약이 같은 판정을 숫자(평균·σ·단봉/이봉)로 적는다.
 *
 * 색은 상태에만 쓴다(장식 금지). 색만으로 전달하지 않도록 칸마다 상태 머리글자(H/C/R/B)를 함께 찍고,
 * 접근 이름에 "리소스 × 컨텍스트 · 상태 · score" 를 모두 넣는다.
 */

/** 칸 하나의 표기 — 라벨은 StatusBadge 와 같은 영어 도메인 용어, glyph 는 색 없이도 상태를 읽는 채널. */
const STATE_UI: Record<ResourceState, { label: string; glyph: string; cell: string }> = {
  HEALTHY: { label: "Healthy", glyph: "H", cell: "bg-ok/12 text-ok-ink hover:bg-ok/25" },
  COOLING: { label: "Cooldown", glyph: "C", cell: "bg-cool/12 text-cool-ink hover:bg-cool/25" },
  RECOVERING: { label: "Recovering", glyph: "R", cell: "bg-recover/12 text-recover-ink hover:bg-recover/25" },
  BLOCKLISTED: { label: "Blocked", glyph: "B", cell: "bg-block/12 text-block-ink hover:bg-block/25" },
};

/** 빈 칸(그 컨텍스트에서 쓰인 적 없음) — 건강한 칸과 뜻이 다르므로 색이 아니라 파선·중립색으로 구분한다. */
const EMPTY_CELL = "border border-dashed border-line bg-surface-2 text-muted/70 hover:bg-surface";

const MODALITY_TEXT = {
  UNIMODAL: "단봉 — 고르게 퍼져 있다(공통 원인 의심)",
  BIMODAL: "이봉 — 두 무리로 갈린다(일부 리소스·컨텍스트만 문제)",
  INSUFFICIENT: "표본 부족 — 셀이 적어 분포를 판정하지 않는다",
} as const;

const MODALITY_HINT =
  "정렬한 score 들의 가장 큰 틈이 전체 범위의 35% 이상이고 양쪽 무리가 각각 15% 이상이면 이봉으로 본다.";

/** 오버뷰·커맨드 팔레트와 같은 링크 규칙(경로는 소문자 kind, 값은 URL 인코딩). */
function detailHref(kind: ResourceKind, value: string): string {
  return `/resources/${kind.toLowerCase()}/${encodeURIComponent(value)}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

/** 격자 안 좌표. col 0 은 행 머리(리소스), 1.. 은 contexts[col-1]. */
type Pos = [row: number, col: number];

export function CellHeatmap({ rows, className }: { rows: HeatmapRow[]; className?: string }) {
  const sorted = useMemo(() => sortRowsWorstFirst(rows), [rows]);
  const contexts = useMemo(() => contextsWorstFirst(rows), [rows]);
  const dist = useMemo(() => scoreDistribution(rows), [rows]);
  const counts = useMemo(() => stateCounts(rows), [rows]);

  // 로빙 tabindex: 격자 전체가 탭 정지 한 칸이고, 안에서는 화살표로 이동한다(ARIA grid 패턴).
  const [pos, setPos] = useState<Pos>([0, 0]);
  // 미니 상세가 가리키는 칸. 마우스가 격자를 벗어나도 마지막 값을 유지한다(깜빡임 방지).
  const [active, setActive] = useState<Pos | null>(null);
  const cellRefs = useRef(new Map<string, HTMLAnchorElement>());

  if (sorted.length === 0) {
    return (
      <EmptyState
        className={className}
        title="격자에 그릴 리소스가 없습니다"
        description={
          <>
            리소스를 등록하고 lease/report 를 한 번 이상 보내면 여기에 Resource × Context 격자가 그려집니다.{" "}
            <Link href="/overview" className="font-bold text-accent underline underline-offset-2">
              풀 오버뷰에서 등록 상태 확인
            </Link>
          </>
        }
      />
    );
  }

  if (contexts.length === 0) {
    return (
      <EmptyState
        className={className}
        title="아직 판정된 컨텍스트가 없습니다"
        description={
          <>
            리소스 {sorted.length}개는 등록돼 있지만 어떤 컨텍스트에서도 성공/실패 보고가 없습니다. 워커에서
            lease → report 를 한 번 보내면 그 컨텍스트가 열로 나타납니다.{" "}
            <Link href="/events" className="font-bold text-accent underline underline-offset-2">
              실시간 이벤트에서 유입 확인
            </Link>
          </>
        }
      />
    );
  }

  function focusCell(next: Pos) {
    setPos(next);
    setActive(next);
    cellRefs.current.get(`${next[0]}:${next[1]}`)?.focus();
  }

  function onGridKeyDown(e: React.KeyboardEvent<HTMLTableElement>) {
    const [r, c] = pos;
    let nr = r;
    let nc = c;
    switch (e.key) {
      case "ArrowRight":
        nc = Math.min(c + 1, contexts.length);
        break;
      case "ArrowLeft":
        nc = Math.max(c - 1, 0);
        break;
      case "ArrowDown":
        nr = Math.min(r + 1, sorted.length - 1);
        break;
      case "ArrowUp":
        nr = Math.max(r - 1, 0);
        break;
      case "Home":
        nc = 0;
        break;
      case "End":
        nc = contexts.length;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (nr === r && nc === c) return;
    focusCell([nr, nc]);
  }

  return (
    <div className={className}>
      {/* 분포 요약 — 모양을 안 보고도 "공통 원인 의심"을 읽게 하는 한 줄. 색을 쓰지 않는다(색은 상태 전용). */}
      <p className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted">
        <span className="tnum">
          셀 <b className="font-bold text-ink">{dist.count}</b>개
        </span>
        <span aria-hidden>·</span>
        <span className="tnum">
          평균 <b className="font-bold text-ink">{fmtScore(dist.mean)}</b>
        </span>
        <span aria-hidden>·</span>
        <span className="tnum" title="모표준편차 — 값들이 평균에서 얼마나 흩어져 있는지">
          σ <b className="font-bold text-ink">{fmtScore(dist.stdDev)}</b>
        </span>
        <span aria-hidden>·</span>
        <span className="font-bold text-ink" title={MODALITY_HINT}>
          {MODALITY_TEXT[dist.modality]}
        </span>
      </p>

      {/* 범례 — 색·머리글자·개수를 같이 둬서 색을 못 보는 사람도 격자를 읽을 수 있다. */}
      <ul className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
        {(Object.keys(STATE_UI) as ResourceState[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "grid size-4 place-items-center rounded-[4px] text-[10px] font-bold",
                STATE_UI[s].cell,
              )}
            >
              {STATE_UI[s].glyph}
            </span>
            <span className="font-semibold text-ink">{STATE_UI[s].label}</span>
            <span className="tnum">{counts[s]}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className={cn("grid size-4 place-items-center rounded-[4px] text-[10px] font-bold", EMPTY_CELL)}>
            –
          </span>
          <span className="font-semibold text-ink">사용 이력 없음</span>
        </li>
      </ul>

      {/* 미니 상세 — hover/포커스한 칸의 값. 자리를 미리 잡아 두어 격자가 흔들리지 않는다. */}
      <Inspector rows={sorted} contexts={contexts} at={active} />

      <Card className="overflow-hidden">
        {/* 스크롤은 이 컨테이너 안에서만 일어난다(가로·세로 모두). 페이지 전체가 밀리지 않게 overscroll 도 가둔다. */}
        <div className="max-h-[28rem] overflow-auto overscroll-contain">
          <table
            role="grid"
            aria-label="Resource × Context 상태 격자"
            className="border-separate border-spacing-0 text-sm"
            onKeyDown={onGridKeyDown}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 border-b border-r border-line bg-surface px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted"
                >
                  리소스
                </th>
                {contexts.map((ctx) => (
                  <th
                    key={ctx}
                    scope="col"
                    title={ctx}
                    className="sticky top-0 z-20 max-w-[8rem] truncate border-b border-line bg-surface px-2 py-2 text-left font-mono text-xs font-bold text-muted"
                  >
                    {ctx}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, r) => {
                const byContext = new Map(row.cells.map((c) => [c.context, c]));
                const href = detailHref(row.resource.kind, row.resource.value);
                const headerFocused = pos[0] === r && pos[1] === 0;
                return (
                  <tr key={`${row.resource.kind}:${row.resource.value}`}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r border-line bg-surface p-0 text-left font-normal"
                    >
                      <Link
                        href={href}
                        ref={(el) => {
                          if (el) cellRefs.current.set(`${r}:0`, el);
                        }}
                        tabIndex={headerFocused ? 0 : -1}
                        onFocus={() => {
                          setPos([r, 0]);
                          setActive([r, 0]);
                        }}
                        onMouseEnter={() => setActive([r, 0])}
                        aria-label={`${row.resource.kind} ${row.resource.value} · ${STATE_UI[row.resource.state].label} · score ${fmtScore(row.resource.score)} · 상세로 이동`}
                        className="flex max-w-[15rem] items-center gap-2 truncate px-3 py-1 font-mono text-xs text-ink motion-safe:transition-colors hover:text-accent"
                      >
                        <span aria-hidden className="text-[10px] font-bold text-muted">
                          {row.resource.kind.slice(0, 1)}
                        </span>
                        <span className="truncate" title={row.resource.value}>
                          {row.resource.value}
                        </span>
                      </Link>
                    </th>
                    {contexts.map((ctx, i) => {
                      const cell = byContext.get(ctx);
                      const c = i + 1;
                      const focused = pos[0] === r && pos[1] === c;
                      const name = cell
                        ? `${row.resource.kind} ${row.resource.value} × ${ctx} · ${STATE_UI[cell.state].label} · score ${cell.score.toFixed(2)}`
                        : `${row.resource.kind} ${row.resource.value} × ${ctx} · 사용 이력 없음`;
                      return (
                        <td key={ctx} role="gridcell" className="border-b border-line p-0.5">
                          <Link
                            href={href}
                            ref={(el) => {
                              if (el) cellRefs.current.set(`${r}:${c}`, el);
                            }}
                            tabIndex={focused ? 0 : -1}
                            onFocus={() => {
                              setPos([r, c]);
                              setActive([r, c]);
                            }}
                            onMouseEnter={() => setActive([r, c])}
                            aria-label={name}
                            className={cn(
                              "grid size-7 place-items-center rounded-[6px] text-[11px] font-bold motion-safe:transition-colors",
                              cell ? STATE_UI[cell.state].cell : EMPTY_CELL,
                            )}
                          >
                            <span aria-hidden>{cell ? STATE_UI[cell.state].glyph : "–"}</span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** 미니 상세 한 칸: 작은 라벨 + 값. */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className="tnum mt-0.5 text-sm font-bold text-ink">{children}</div>
    </div>
  );
}

/**
 * hover/포커스한 칸의 미니 상세. 격자 위 고정 자리에 그려 500칸에 툴팁 500개를 띄우지 않는다
 * (스크린리더는 칸의 접근 이름으로 같은 정보를 이미 받는다).
 */
function Inspector({
  rows,
  contexts,
  at,
}: {
  rows: HeatmapRow[];
  contexts: string[];
  at: Pos | null;
}) {
  // 라벨 붙은 group: 스크린리더가 "선택한 칸 상세"로 찾아갈 수 있고, 테스트도 이 영역만 볼 수 있다.
  const box =
    "mb-3 flex min-h-[4.25rem] flex-wrap items-center gap-x-6 gap-y-2 rounded-[12px] border border-line bg-surface-2 px-3.5 py-2.5";
  const boxProps = { role: "group", "aria-label": "선택한 칸 상세", className: box } as const;

  if (at === null) {
    return (
      <div {...boxProps}>
        <p className="text-sm text-muted">
          칸에 마우스를 올리거나 격자에 포커스를 두고 화살표 키로 이동하면 여기에 상세가 나옵니다.
        </p>
      </div>
    );
  }

  const row = rows[at[0]];
  if (!row) return <div {...boxProps} />;

  // col 0 = 행 머리: 리소스 단위 rollup(대표 셀 기준)을 보여준다.
  if (at[1] === 0) {
    const rep = representativeContext(row);
    return (
      <div {...boxProps}>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-muted">{row.resource.kind}</div>
          <div className="truncate font-mono text-sm font-bold text-ink">{row.resource.value}</div>
        </div>
        <Field label="상태">{STATE_UI[row.resource.state].label}</Field>
        <Field label="최저 score">{fmtScore(row.resource.score)}</Field>
        <Field label="컨텍스트">{row.resource.contexts}</Field>
        <Field label="차단">
          {row.resource.blocked
            ? row.resource.blockPermanent
              ? "영구"
              : fmtDateTime(row.resource.blockedUntil)
            : "—"}
        </Field>
        <Field label="최근 판정" hint={rep ? `대표(최저 score) 셀 ${rep} 의 창` : undefined}>
          <Sparkline flags={row.resource.recentWindow} />
        </Field>
      </div>
    );
  }

  const context = contexts[at[1] - 1];
  const cell: CellView | undefined = row.cells.find((c) => c.context === context);

  if (!cell) {
    return (
      <div {...boxProps}>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-muted">
            {row.resource.value} × {context}
          </div>
          <div className="text-sm font-bold text-ink">사용 이력 없음</div>
        </div>
        <p className="text-sm text-muted">
          이 리소스는 그 컨텍스트에서 한 번도 쓰이지 않았습니다. 건강한 셀과 다른 뜻입니다.
        </p>
      </div>
    );
  }

  // recentWindow 는 읽기모델상 리소스 대표(최저 score) 셀의 창이라, 그 셀에서만 스파크라인을 보여준다.
  const isRepresentative = representativeContext(row) === context;

  return (
    <div {...boxProps}>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-muted">{row.resource.value}</div>
        <div className="truncate font-mono text-sm font-bold text-ink">{context}</div>
      </div>
      <Field label="상태">{STATE_UI[cell.state].label}</Field>
      <Field label="score">{cell.score.toFixed(2)}</Field>
      <Field label="연속 실패">{cell.consecutiveFailures}</Field>
      <Field label="Cooldown 해제" hint="COOLING 이 풀리는 시각">
        {fmtDateTime(cell.cooldownUntil)}
      </Field>
      <Field label="평가 표본" hint="점수 계산에 쓰는 최근 판정 개수">
        {cell.windowSize}
      </Field>
      {isRepresentative && (
        <Field label="최근 판정" hint="이 셀이 리소스 대표(최저 score) 셀이라 최근 판정 창을 보여준다">
          <Sparkline flags={row.resource.recentWindow} />
        </Field>
      )}
    </div>
  );
}

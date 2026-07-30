/**
 * Cell 히트맵(#124) 미리보기 픽스처 — `/preview/heatmap` 이 실데이터 없이 격자를 그리는 데 쓴다.
 *
 * test/fixtures.ts(컴포넌트·MSW·시각 회귀가 공유)는 건드리지 않는다. 여기 값은 오직 preview 라우트와
 * 히트맵 테스트에서만 쓰이며 스냅샷 baseline 과 무관하다.
 *
 * 값은 "일부만 나쁘다"가 눈에 보이도록 짰다 — 리소스 하나(proxy-kr-seoul-08)가 통째로 무너져 있고
 * 컨텍스트 하나(checkout)가 여러 리소스에서 동시에 나쁘다. 행/열 어느 쪽 문제인지 격자로 갈린다.
 */
import type { CellView, ResourceKind, ResourceState } from "../lib/types";
import type { HeatmapRow } from "../lib/heatmap";
import { STATE_SEVERITY } from "../lib/heatmap";

/** 성공(true)/실패(false) 판정 창을 "1010" 문자열로 간결히 쓰기 위한 헬퍼. */
function win(pattern: string): boolean[] {
  return [...pattern].map((c) => c === "1");
}

export function cell(
  context: string,
  score: number,
  state: ResourceState,
  extra: Partial<CellView> = {},
): CellView {
  return {
    context,
    score,
    consecutiveFailures: state === "HEALTHY" ? 0 : 3,
    consecutiveSuccesses: state === "HEALTHY" ? 7 : 0,
    windowSize: 10,
    state,
    cooldownUntil: state === "COOLING" ? "2026-07-30T12:40:00Z" : null,
    updatedAt: "2026-07-30T12:05:00Z",
    ...extra,
  };
}

/**
 * 행 하나. `state`/`score`/`contexts` 는 셀에서 그대로 유도해(백엔드 representativeOf 와 같은 규칙)
 * 픽스처가 읽기모델과 어긋날 수 없게 한다. `window` 는 대표(최저 score) 셀의 판정 창이다.
 */
export function row(
  kind: ResourceKind,
  value: string,
  cells: CellView[],
  opts: { window: string; blocked?: boolean; blockPermanent?: boolean; blockedUntil?: string | null } = {
    window: "",
  },
): HeatmapRow {
  const blocked = opts.blocked ?? false;
  let worstState: ResourceState = "HEALTHY";
  let worstScore: number | null = null;
  for (const c of cells) {
    if (STATE_SEVERITY[c.state] > STATE_SEVERITY[worstState]) worstState = c.state;
    if (worstScore === null || c.score < worstScore) worstScore = c.score;
  }
  return {
    resource: {
      kind,
      value,
      blocked,
      blockedUntil: opts.blockedUntil ?? null,
      blockPermanent: opts.blockPermanent ?? false,
      contexts: cells.length,
      state: blocked ? "BLOCKLISTED" : worstState,
      score: worstScore,
      recentWindow: win(opts.window),
    },
    cells,
  };
}

/** 리소스 8 × 컨텍스트 6(빈 칸 섞임) — 격자가 실제 운영처럼 보이도록. */
export const heatmapFixture: HeatmapRow[] = [
  row(
    "PROXY",
    "proxy-kr-seoul-08",
    [
      cell("checkout", -94.2, "BLOCKLISTED"),
      cell("search", -88.5, "BLOCKLISTED"),
      cell("listing", -71.0, "COOLING"),
    ],
    { window: "00000010", blocked: true, blockPermanent: true },
  ),
  row(
    "ACCOUNT",
    "acct-buyer-231",
    [
      cell("checkout", -62.4, "COOLING"),
      cell("cart", 33.0, "RECOVERING"),
      cell("listing", 44.1, "HEALTHY"),
    ],
    { window: "00100010", blocked: true, blockedUntil: "2026-07-30T13:10:00Z" },
  ),
  row(
    "PROXY",
    "proxy-jp-tokyo-02",
    [cell("checkout", -55.7, "COOLING"), cell("search", 51.3, "HEALTHY"), cell("listing", 60.2, "HEALTHY")],
    { window: "01000110" },
  ),
  row(
    "SESSION",
    "sess-mobile-a1",
    [cell("checkout", -41.9, "COOLING"), cell("cart", 35.4, "RECOVERING")],
    { window: "00101010" },
  ),
  row(
    "PROXY",
    "proxy-us-east-11",
    [cell("checkout", 31.5, "RECOVERING"), cell("search", 63.4, "HEALTHY"), cell("detail", 70.1, "HEALTHY")],
    { window: "10101101" },
  ),
  row(
    "ACCOUNT",
    "acct-buyer-004",
    [cell("search", 58.9, "HEALTHY"), cell("listing", 66.7, "HEALTHY"), cell("detail", 74.5, "HEALTHY")],
    { window: "11101111" },
  ),
  row(
    "PROXY",
    "proxy-de-fra-05",
    [cell("search", 61.2, "HEALTHY"), cell("detail", 69.8, "HEALTHY"), cell("login", 72.4, "HEALTHY")],
    { window: "11111011" },
  ),
  row(
    "SESSION",
    "sess-desktop-c9",
    [cell("cart", 64.0, "HEALTHY"), cell("login", 71.6, "HEALTHY")],
    { window: "11111110" },
  ),
];

/** 리소스는 등록됐지만 아직 어떤 컨텍스트에서도 판정이 없는 상태(빈 상태 2종 중 하나). */
export const heatmapNoCellsFixture: HeatmapRow[] = [
  row("PROXY", "proxy-new-01", []),
  row("ACCOUNT", "acct-new-01", []),
];

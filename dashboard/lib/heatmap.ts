/**
 * Cell 히트맵(#124)의 순수 계산 — 축 정렬과 분포 판정. 렌더에서 분리해 단위 테스트한다.
 *
 * 이 화면이 2차원인 이유: 집계 평균 하나로는 "전체가 고르게 나쁘다(공통 원인)"와
 * "몇 개만 나쁘다(그 리소스·컨텍스트만 차단)"를 구분할 수 없다. 두 경우의 평균이 같을 수 있기
 * 때문이다(단봉 vs 이봉). {@link scoreDistribution} 이 그 구분을 숫자로도 내놓고, 격자는 같은
 * 사실을 색으로 보여준다.
 */
import type { CellView, ResourceOverview, ResourceState } from "@/lib/types";

/**
 * 격자 한 행 = 리소스 하나.
 *
 * 새 스키마를 만들지 않고 기존 읽기모델 두 조각을 그대로 합성한다.
 * - `resource` — `/api/pools/overview` 의 {@link ResourceOverview}(행 머리, 대표 rollup)
 * - `cells` — `/api/pools/resources/{kind}/{value}` 의 {@link CellView}[](컨텍스트별 칸)
 *
 * 실데이터 배선 시에도 이 두 응답을 조합하면 되므로 격자 전용 타입이 백엔드와 갈리지 않는다.
 */
export interface HeatmapRow {
  resource: ResourceOverview;
  cells: CellView[];
}

/** 백엔드 PoolViewAssembler.severity 와 동일한 서열(클수록 심각). */
export const STATE_SEVERITY: Record<ResourceState, number> = {
  BLOCKLISTED: 3,
  COOLING: 2,
  RECOVERING: 1,
  HEALTHY: 0,
};

/**
 * 행 정렬: 최악 우선(상태 심각도 desc → 최저 score asc → 값 asc).
 * score 가 null 인(셀이 아직 없는) 리소스는 볼 게 없으므로 같은 심각도 안에서 뒤로 민다.
 * 원본 배열은 건드리지 않는다.
 */
export function sortRowsWorstFirst(rows: HeatmapRow[]): HeatmapRow[] {
  return rows.slice().sort((a, b) => {
    const sev = STATE_SEVERITY[b.resource.state] - STATE_SEVERITY[a.resource.state];
    if (sev !== 0) return sev;
    const as = a.resource.score;
    const bs = b.resource.score;
    if (as !== bs) {
      if (as === null) return 1;
      if (bs === null) return -1;
      return as - bs;
    }
    return a.resource.value.localeCompare(b.resource.value);
  });
}

/**
 * 열(컨텍스트) 축: 나쁜 컨텍스트 우선(셀 심각도 합 desc → 이름 asc).
 * "특정 컨텍스트만 무너졌다"가 격자 왼쪽에 모여 클릭 없이 읽히게 하는 정렬이다.
 */
export function contextsWorstFirst(rows: HeatmapRow[]): string[] {
  const weight = new Map<string, number>();
  for (const row of rows) {
    for (const cell of row.cells) {
      weight.set(cell.context, (weight.get(cell.context) ?? 0) + STATE_SEVERITY[cell.state]);
    }
  }
  return [...weight.keys()].sort((a, b) => {
    const w = (weight.get(b) ?? 0) - (weight.get(a) ?? 0);
    return w !== 0 ? w : a.localeCompare(b);
  });
}

/**
 * 그 리소스의 대표 셀 컨텍스트 — 최저 score(동점이면 먼저 나온 셀).
 * 백엔드 `representativeOf` 와 같은 규칙이라 {@link ResourceOverview#recentWindow} 가
 * "어느 셀의 창인지"를 화면에서 정확히 지목할 수 있다. 셀이 없으면 null.
 */
export function representativeContext(row: HeatmapRow): string | null {
  let best: CellView | null = null;
  for (const cell of row.cells) {
    if (best === null || cell.score < best.score) best = cell;
  }
  return best?.context ?? null;
}

/** 격자 전체의 상태별 셀 개수(범례 옆 카운트). */
export function stateCounts(rows: HeatmapRow[]): Record<ResourceState, number> {
  const counts: Record<ResourceState, number> = {
    HEALTHY: 0,
    COOLING: 0,
    RECOVERING: 0,
    BLOCKLISTED: 0,
  };
  for (const row of rows) {
    for (const cell of row.cells) counts[cell.state] += 1;
  }
  return counts;
}

/** 분포의 모양 판정. INSUFFICIENT 는 "모른다"이지 "단봉"이 아니다. */
export type Modality = "UNIMODAL" | "BIMODAL" | "INSUFFICIENT";

export interface ScoreDistribution {
  /** 표본(셀) 개수. */
  count: number;
  /** 평균. 셀이 없으면 null. */
  mean: number | null;
  /** 모표준편차(σ). 셀이 없으면 null. */
  stdDev: number | null;
  modality: Modality;
  /** 이봉일 때 두 무리의 경계값(낮은 무리 최댓값 / 높은 무리 최솟값). 아니면 null. */
  split: { low: number; high: number } | null;
}

/** 분포 모양을 말하려면 최소한 이만큼은 있어야 한다(그 아래는 판정하지 않는다). */
const MIN_SAMPLES = 8;
/** 가장 큰 틈이 전체 범위의 이 비율 이상이면 "갈라졌다"고 본다. */
const MIN_GAP_RATIO = 0.35;
/** 양쪽 무리가 각각 이 비율 이상이어야 이봉이다(이상치 하나로 이봉이 되지 않게). */
const MIN_CLUSTER_SHARE = 0.15;

/**
 * 셀 score 들의 평균·σ·단봉/이봉 판정.
 *
 * 판정은 휴리스틱이다: 정렬한 값들에서 **가장 큰 틈**을 찾아, 그 틈이 전체 범위의
 * {@link MIN_GAP_RATIO} 이상이고 틈 양쪽이 각각 표본의 {@link MIN_CLUSTER_SHARE} 이상이면 이봉으로 본다.
 * 실측 사례(이슈 #124)로 검증한다 — 200개가 58~74 에 고르게 퍼지면 단봉(공통 원인),
 * 70개 ~0 / 130개 ~95 면 **평균이 같아도** 이봉(일부만 차단).
 */
export function scoreDistribution(rows: HeatmapRow[]): ScoreDistribution {
  const scores: number[] = [];
  for (const row of rows) {
    for (const cell of row.cells) scores.push(cell.score);
  }
  const count = scores.length;
  if (count === 0) {
    return { count: 0, mean: null, stdDev: null, modality: "INSUFFICIENT", split: null };
  }

  const mean = scores.reduce((a, b) => a + b, 0) / count;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);

  if (count < MIN_SAMPLES) {
    return { count, mean, stdDev, modality: "INSUFFICIENT", split: null };
  }

  const sorted = scores.slice().sort((a, b) => a - b);
  const range = sorted[count - 1] - sorted[0];
  if (range === 0) {
    return { count, mean, stdDev, modality: "UNIMODAL", split: null };
  }

  let gap = 0;
  let at = -1;
  for (let i = 1; i < count; i++) {
    const g = sorted[i] - sorted[i - 1];
    if (g > gap) {
      gap = g;
      at = i;
    }
  }
  const lowShare = at / count;
  const bimodal =
    gap / range >= MIN_GAP_RATIO &&
    lowShare >= MIN_CLUSTER_SHARE &&
    1 - lowShare >= MIN_CLUSTER_SHARE;

  return {
    count,
    mean,
    stdDev,
    modality: bimodal ? "BIMODAL" : "UNIMODAL",
    split: bimodal ? { low: sorted[at - 1], high: sorted[at] } : null,
  };
}

/**
 * 마케팅 스크린샷 전용 픽스처 — 랜딩(#16)의 실제 대시보드 스크린샷을 "풍성하게" 찍기 위한 데이터.
 *
 * test/fixtures.ts(스냅샷 회귀·컴포넌트 테스트가 공유)는 절대 건드리지 않는다.
 * 여기 값들은 오직 scripts/marketing-shots.ts 의 route-stub 에만 쓰이며, 시각 회귀 baseline 과 무관하다.
 * 다양한 상태(HEALTHY/COOLING/RECOVERING/BLOCKLISTED)·score·스파크라인을 섞어 표가 실제 운영처럼 보이게 한다.
 */
import type {
  PoolOverview,
  ResourceDetail,
  ScoreHistory,
  AuditEventPage,
} from "../lib/types";

/** 성공(true)/실패(false) 최근 판정 윈도우를 문자열("1010")로 간결히 쓰기 위한 헬퍼. */
function win(pattern: string): boolean[] {
  return [...pattern].map((c) => c === "1");
}

export const marketingOverviewFixture: PoolOverview = {
  summary: {
    registered: 14,
    blocklisted: 2,
    totalCells: 31,
    cellsByState: { HEALTHY: 22, COOLING: 4, RECOVERING: 3, BLOCKLISTED: 2 },
  },
  resources: [
    {
      kind: "PROXY",
      value: "proxy-kr-seoul-08",
      blocked: true,
      blockedUntil: null,
      blockPermanent: true,
      contexts: 3,
      state: "BLOCKLISTED",
      score: -92.4,
      recentWindow: win("00000010"),
    },
    {
      kind: "ACCOUNT",
      value: "acct-crawler-42",
      blocked: true,
      blockedUntil: "2026-07-21T18:30:00Z",
      blockPermanent: false,
      contexts: 2,
      state: "BLOCKLISTED",
      score: -74.1,
      recentWindow: win("00100000"),
    },
    {
      kind: "PROXY",
      value: "proxy-us-east-15",
      blocked: false,
      blockedUntil: "2026-07-21T15:10:00Z",
      blockPermanent: false,
      contexts: 4,
      state: "COOLING",
      score: -18.6,
      recentWindow: win("10100101"),
    },
    {
      kind: "SESSION",
      value: "sess-mobile-a19",
      blocked: false,
      blockedUntil: "2026-07-21T15:02:00Z",
      blockPermanent: false,
      contexts: 1,
      state: "COOLING",
      score: -12.3,
      recentWindow: win("11010010"),
    },
    {
      kind: "ACCOUNT",
      value: "acct-search-07",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 2,
      state: "RECOVERING",
      score: 6.8,
      recentWindow: win("01101011"),
    },
    {
      kind: "PROXY",
      value: "proxy-jp-tokyo-03",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 3,
      state: "RECOVERING",
      score: 11.2,
      recentWindow: win("01011011"),
    },
    {
      kind: "PROXY",
      value: "proxy-kr-seoul-01",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 4,
      state: "HEALTHY",
      score: 88.5,
      recentWindow: win("11111011"),
    },
    {
      kind: "PROXY",
      value: "proxy-eu-west-11",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 3,
      state: "HEALTHY",
      score: 81.0,
      recentWindow: win("11110111"),
    },
    {
      kind: "ACCOUNT",
      value: "acct-collector-12",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 2,
      state: "HEALTHY",
      score: 76.4,
      recentWindow: win("11111110"),
    },
    {
      kind: "SESSION",
      value: "sess-web-77c",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 1,
      state: "HEALTHY",
      score: 72.9,
      recentWindow: win("11101111"),
    },
    {
      kind: "PROXY",
      value: "proxy-sg-01",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 2,
      state: "HEALTHY",
      score: 69.3,
      recentWindow: win("11011111"),
    },
    {
      kind: "ACCOUNT",
      value: "acct-index-33",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 2,
      state: "HEALTHY",
      score: 64.7,
      recentWindow: win("11111101"),
    },
    {
      kind: "SESSION",
      value: "sess-api-5b2",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 1,
      state: "HEALTHY",
      score: 58.1,
      recentWindow: win("10111111"),
    },
    {
      kind: "PROXY",
      value: "proxy-us-west-04",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 3,
      state: "HEALTHY",
      score: 52.6,
      recentWindow: win("11110110"),
    },
  ],
};

/** 상세 크롭용 — 평판 곡선(다중 컨텍스트)이 실제 시계열처럼 보이게 24포인트씩. */
export const marketingDetailFixture: ResourceDetail = {
  kind: "PROXY",
  value: "proxy-kr-seoul-01",
  blocked: false,
  blockedUntil: null,
  blockPermanent: false,
  cells: [
    {
      context: "us-east",
      score: 88.5,
      consecutiveFailures: 0,
      consecutiveSuccesses: 41,
      windowSize: 50,
      state: "HEALTHY",
      cooldownUntil: null,
      updatedAt: "2026-07-21T14:30:00Z",
    },
    {
      context: "eu-west",
      score: 61.2,
      consecutiveFailures: 0,
      consecutiveSuccesses: 12,
      windowSize: 50,
      state: "HEALTHY",
      cooldownUntil: null,
      updatedAt: "2026-07-21T14:29:00Z",
    },
    {
      context: "ap-tokyo",
      score: -14.8,
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      windowSize: 50,
      state: "COOLING",
      cooldownUntil: "2026-07-21T15:05:00Z",
      updatedAt: "2026-07-21T14:31:00Z",
    },
  ],
};

/** 상세 곡선 크롭 — 3개 컨텍스트가 서로 다른 궤적(회복/안정/냉각)을 그리게. */
function curve(base: number, deltas: number[]): { at: string; score: number }[] {
  let score = base;
  const start = Date.parse("2026-07-21T00:00:00Z");
  return deltas.map((d, i) => {
    score = Math.max(-100, Math.min(100, score + d));
    return { at: new Date(start + i * 60 * 60 * 1000).toISOString(), score: Number(score.toFixed(1)) };
  });
}

export const marketingScoreHistoryFixture: ScoreHistory = {
  contexts: [
    {
      context: "us-east",
      points: curve(70, [3, 4, 2, 5, -2, 3, 4, 2, 1, 3, -1, 2, 4, 1, 2, 3, -1, 2, 1, 2, 1, 1, 2, 1]),
    },
    {
      context: "eu-west",
      points: curve(40, [2, 3, 1, 2, 4, 2, -3, 1, 2, 3, 2, 1, 2, -2, 3, 2, 1, 2, 1, 2, 1, 2, 1, 1]),
    },
    {
      context: "ap-tokyo",
      points: curve(20, [-4, -6, -8, -5, 3, 6, 4, -10, -12, -6, 4, 8, 6, 4, 2, -3, -8, 5, 7, 4, 3, 2, 1, 2]),
    },
  ],
};

const EVENTS_RAW: Array<[string, string, string, string | null, string | null, string | null]> = [
  // [eventType, kind, value, context, cause, until]
  ["RESOURCE_BLOCKLISTED", "PROXY", "proxy-kr-seoul-08", "ap-tokyo", null, null],
  ["RESOURCE_COOLED", "PROXY", "proxy-us-east-15", "us-east", "TIMEOUT", "2026-07-21T15:10:00Z"],
  ["RESOURCE_LEASED", "PROXY", "proxy-kr-seoul-01", "us-east", null, null],
  ["RESOURCE_COOLED", "SESSION", "sess-mobile-a19", "eu-west", "CONNECTION_RESET", "2026-07-21T15:02:00Z"],
  ["LEASE_RELEASED", "PROXY", "proxy-eu-west-11", "eu-west", null, null],
  ["RESOURCE_RECOVERED", "ACCOUNT", "acct-search-07", "us-east", null, null],
  ["RESOURCE_LEASED", "ACCOUNT", "acct-collector-12", "us-east", null, null],
  ["RESOURCE_BLOCKLISTED", "ACCOUNT", "acct-crawler-42", "eu-west", "BLOCKED", "2026-07-21T18:30:00Z"],
  ["RESOURCE_LEASED", "PROXY", "proxy-jp-tokyo-03", "ap-tokyo", null, null],
  ["RESOURCE_RECOVERED", "PROXY", "proxy-jp-tokyo-03", "ap-tokyo", null, null],
  ["LEASE_RELEASED", "SESSION", "sess-web-77c", "eu-west", null, null],
  ["RESOURCE_COOLED", "PROXY", "proxy-us-west-04", "us-east", "TLS_HANDSHAKE", "2026-07-21T14:58:00Z"],
  ["RESOURCE_LEASED", "PROXY", "proxy-sg-01", "ap-tokyo", null, null],
  ["RESOURCE_UNBLOCKED", "PROXY", "proxy-us-east-15", "us-east", null, null],
];

export const marketingEventsFixture: AuditEventPage = {
  events: EVENTS_RAW.map(([eventType, resourceKind, resourceValue, context, cause, until], i) => ({
    seq: EVENTS_RAW.length - i,
    eventType,
    resourceKind,
    resourceValue,
    context,
    occurredAt: new Date(Date.parse("2026-07-21T14:31:00Z") - i * 47 * 1000).toISOString(),
    until,
    cause,
  })),
  nextCursor: null,
};

/**
 * 결정론적 테스트 픽스처 — component/integration(MSW)과 visual(Playwright route stub)이 공유한다.
 * 라이브 생성기와 달리 값이 고정돼 있어야 스크린샷·단언이 흔들리지 않는다.
 */
import type {
  PoolOverview,
  ResourceDetail,
  ScoreHistory,
  AuditEventPage,
  UsageSummary,
  Tenant,
  ApiKeySummary,
} from "../lib/types";

export const overviewFixture: PoolOverview = {
  summary: {
    registered: 3,
    blocklisted: 1,
    totalCells: 5,
    cellsByState: { HEALTHY: 3, COOLING: 1, RECOVERING: 0, BLOCKLISTED: 1 },
  },
  resources: [
    {
      kind: "PROXY",
      value: "proxy-bad",
      blocked: true,
      blockedUntil: null,
      blockPermanent: true,
      contexts: 1,
      state: "BLOCKLISTED",
      score: -80,
      recentWindow: [false, false, false, false],
    },
    {
      kind: "ACCOUNT",
      value: "acct-cool",
      blocked: false,
      blockedUntil: "2026-07-18T09:00:00Z",
      blockPermanent: false,
      contexts: 2,
      state: "COOLING",
      score: -10,
      recentWindow: [true, false, false, true],
    },
    {
      kind: "PROXY",
      value: "proxy-good",
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      contexts: 2,
      state: "HEALTHY",
      score: 42,
      recentWindow: [true, true, true, false, true],
    },
  ],
};

export const detailFixture: ResourceDetail = {
  kind: "PROXY",
  value: "proxy-good",
  blocked: false,
  blockedUntil: null,
  blockPermanent: false,
  cells: [
    {
      context: "us-east",
      score: 42,
      consecutiveFailures: 0,
      consecutiveSuccesses: 6,
      windowSize: 10,
      state: "HEALTHY",
      cooldownUntil: null,
      updatedAt: "2026-07-18T08:30:00Z",
    },
    {
      context: "eu-west",
      score: -10,
      consecutiveFailures: 2,
      consecutiveSuccesses: 0,
      windowSize: 10,
      state: "COOLING",
      cooldownUntil: "2026-07-18T09:00:00Z",
      updatedAt: "2026-07-18T08:31:00Z",
    },
  ],
};

export const scoreHistoryFixture: ScoreHistory = {
  contexts: [
    {
      context: "us-east",
      points: [
        { at: "2026-07-18T06:00:00Z", score: 10 },
        { at: "2026-07-18T07:00:00Z", score: 30 },
        { at: "2026-07-18T08:00:00Z", score: 42 },
      ],
    },
  ],
};

export const eventsFixture: AuditEventPage = {
  events: [
    {
      seq: 3,
      eventType: "RESOURCE_COOLED",
      resourceKind: "ACCOUNT",
      resourceValue: "acct-cool",
      context: "eu-west",
      occurredAt: "2026-07-18T08:31:00Z",
      until: null,
      cause: "TIMEOUT",
    },
    {
      seq: 2,
      eventType: "RESOURCE_LEASED",
      resourceKind: "PROXY",
      resourceValue: "proxy-good",
      context: "us-east",
      occurredAt: "2026-07-18T08:30:00Z",
      until: null,
      cause: null,
    },
  ],
  page: 0,
  size: 50,
  hasMore: false,
};

export const usageFixture: UsageSummary = {
  monthLeaseTotal: 1280,
  poolSize: 3,
  dailyLeases: [
    { date: "2026-07-16", count: 400 },
    { date: "2026-07-17", count: 520 },
    { date: "2026-07-18", count: 360 },
  ],
};

/** 관리자 화면 — 테넌트 목록(최신 생성순 정렬 검증용으로 생성일 섞음). */
export const tenantsFixture: Tenant[] = [
  {
    id: "default",
    name: "기본 테넌트",
    status: "ACTIVE",
    createdAt: "2026-07-10T09:00:00Z",
  },
  {
    id: "acme",
    name: "Acme Corp",
    status: "ACTIVE",
    createdAt: "2026-07-17T12:00:00Z",
  },
  {
    id: "old-co",
    name: "Old Co",
    status: "SUSPENDED",
    createdAt: "2026-07-01T00:00:00Z",
  },
];

/** API 키 화면 — 활성 2 + 폐기 1(활성 먼저·최신순 정렬 검증용). */
export const apiKeysFixture: ApiKeySummary[] = [
  {
    id: "key-active-new",
    label: "프로덕션 수집기",
    prefix: "rp_live_ab",
    createdAt: "2026-07-17T10:00:00Z",
    revokedAt: null,
  },
  {
    id: "key-active-old",
    label: null,
    prefix: "rp_live_cd",
    createdAt: "2026-07-12T10:00:00Z",
    revokedAt: null,
  },
  {
    id: "key-revoked",
    label: "구 스테이징",
    prefix: "rp_live_ef",
    createdAt: "2026-07-15T10:00:00Z",
    revokedAt: "2026-07-16T10:00:00Z",
  },
];

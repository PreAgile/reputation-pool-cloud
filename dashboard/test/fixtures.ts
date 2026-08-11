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
  ContextOverview,
  ContextDetail,
  ContextHistory,
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
  nextCursor: null,
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

/**
 * 컨텍스트 화면 — 서버가 이름 오름차순으로 준 컨텍스트 요약.
 * BAEMIN 은 방금 갱신됐고 CPEATS 는 나흘째 조용하다(정체 표시 검증용).
 */
export const contextsFixture: ContextOverview = {
  contexts: [
    {
      context: "BAEMIN",
      cells: 587,
      blocked: 2,
      cellsByState: { HEALTHY: 580, COOLING: 4, RECOVERING: 1, BLOCKLISTED: 2 },
      averageScore: 0.82,
      worstScore: 0.11,
      bestScore: 0.99,
      lastUpdatedAt: "2026-08-11T04:20:00Z",
    },
    {
      context: "CPEATS",
      cells: 5,
      blocked: 0,
      cellsByState: { HEALTHY: 5, COOLING: 0, RECOVERING: 0, BLOCKLISTED: 0 },
      averageScore: 0.74,
      worstScore: 0.6,
      bestScore: 0.9,
      lastUpdatedAt: "2026-08-07T07:50:00Z",
    },
  ],
};

/** 컨텍스트 하나를 펼친 리소스 목록(서버가 심각도 → 낮은 점수 순으로 정렬해 준다). */
export const contextDetailFixture: ContextDetail = {
  context: "BAEMIN",
  resources: [
    {
      kind: "PROXY",
      value: "203.0.113.7:8080",
      registered: true,
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      state: "COOLING",
      score: 0.11,
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      windowSize: 3,
      recentWindow: [false, false, false],
      cooldownUntil: "2026-08-11T05:00:00Z",
      updatedAt: "2026-08-11T04:20:00Z",
    },
    {
      kind: "PROXY",
      value: "decodo:isp:10001",
      registered: true,
      blocked: false,
      blockedUntil: null,
      blockPermanent: false,
      state: "HEALTHY",
      score: 0.95,
      consecutiveFailures: 0,
      consecutiveSuccesses: 12,
      windowSize: 3,
      recentWindow: [true, true, true],
      cooldownUntil: null,
      updatedAt: "2026-08-11T04:19:00Z",
    },
  ],
};

/** 컨텍스트별 시간 롤업 추이 — 두 시리즈가 겹쳐 그려지는지 검증용. */
export const contextHistoryFixture: ContextHistory = {
  contexts: [
    {
      context: "BAEMIN",
      points: [
        { at: "2026-08-11T02:00:00Z", averageScore: 0.8, minScore: 0.1, maxScore: 1, cells: 587 },
        { at: "2026-08-11T03:00:00Z", averageScore: 0.82, minScore: 0.11, maxScore: 1, cells: 587 },
      ],
    },
    {
      context: "CPEATS",
      points: [
        { at: "2026-08-11T02:00:00Z", averageScore: 0.75, minScore: 0.6, maxScore: 0.9, cells: 5 },
        { at: "2026-08-11T03:00:00Z", averageScore: 0.74, minScore: 0.6, maxScore: 0.9, cells: 5 },
      ],
    },
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

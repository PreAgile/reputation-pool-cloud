/** 백엔드 컨트롤 플레인(#11)·미터링(#10)·Phase0 읽기모델의 REST 응답 타입. */

export type ResourceState = "HEALTHY" | "COOLING" | "RECOVERING" | "BLOCKLISTED";
export type ResourceKind = "PROXY" | "ACCOUNT" | "SESSION";

export interface LoginResponse {
  token: string;
  tokenType: string;
  expiresInSeconds: number;
  /** 발급된 토큰의 권한: "admin"(전체) 또는 "viewer"(열람 전용). 표시용이며 권한 판정은 서버가 한다. */
  scope: string;
}

export interface Tenant {
  id: string;
  name: string;
  status: string;
  createdAt: string; // ISO-8601
}

export interface PoolSummary {
  registered: number;
  blocklisted: number;
  totalCells: number;
  cellsByState: Record<ResourceState, number>;
}

/**
 * 리소스 오버뷰 행. 백엔드 PoolViewAssembler.ResourceOverview(#35) 직렬화와 1:1 매핑한다.
 * state 는 항상 존재(최악 심각도; blocked면 BLOCKLISTED), recentWindow 는 셀이 없으면 빈 배열.
 */
export interface ResourceOverview {
  kind: ResourceKind;
  value: string;
  blocked: boolean;
  blockedUntil: string | null;
  blockPermanent: boolean;
  contexts: number;
  state: ResourceState; // 항상 존재(최악 심각도; blocked면 BLOCKLISTED)
  score: number | null; // 최저 score, 셀 없으면 null
  recentWindow: boolean[]; // 최저-score 셀의 window 성공 플래그(오래된→최신), 셀 없으면 []
}

export interface PoolOverview {
  summary: PoolSummary;
  resources: ResourceOverview[];
}

export interface CellView {
  context: string;
  score: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  windowSize: number;
  state: ResourceState;
  cooldownUntil: string | null;
  updatedAt: string;
}

export interface ResourceDetail {
  kind: ResourceKind;
  value: string;
  blocked: boolean;
  blockedUntil: string | null;
  blockPermanent: boolean;
  cells: CellView[];
}

/** Phase0: 리소스 상세 24h 평판 곡선. */
export interface ScoreHistory {
  contexts: { context: string; points: { at: string; score: number }[] }[];
}

/**
 * 컨텍스트 축 읽기 모델(백엔드 ContextViewAssembler / ContextRollupReader 와 1:1).
 *
 * 리소스 축(PoolOverview)이 "이 리소스가 어떤가"를 답한다면 이쪽은 "어떤 컨텍스트를 돌리고 있고,
 * 그중 무너지거나 조용해진 게 있나"를 답한다. `lastUpdatedAt` 이 그 핵심 신호 — 보고가 끊긴
 * 컨텍스트는 리소스 축에서는 건강한 것과 구분되지 않는다.
 */
export interface ContextSummary {
  context: string;
  cells: number; // 이 컨텍스트의 셀 수(= 리소스 수)
  blocked: number; // 그중 차단된 리소스에 얹힌 셀 수
  cellsByState: Record<ResourceState, number>;
  averageScore: number;
  worstScore: number;
  bestScore: number;
  lastUpdatedAt: string | null; // ISO-8601. 이 컨텍스트에서 가장 최근 셀 갱신 시각
}

export interface ContextOverview {
  contexts: ContextSummary[];
}

/** 컨텍스트 하나 안의 리소스 행(심각도 → 낮은 점수 순으로 서버가 정렬해 준다). */
export interface ContextResourceRow {
  kind: ResourceKind;
  value: string;
  registered: boolean;
  blocked: boolean;
  blockedUntil: string | null;
  blockPermanent: boolean;
  state: ResourceState;
  score: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  windowSize: number;
  recentWindow: boolean[];
  cooldownUntil: string | null;
  updatedAt: string;
}

export interface ContextDetail {
  context: string;
  resources: ContextResourceRow[];
}

/**
 * 컨텍스트별 시간 단위 평판 추이. raw score_sample(7일 보존)이 아니라 시간 롤업에서 읽으므로
 * 30일·90일 창을 줘도 가볍다.
 */
export interface ContextHistory {
  contexts: {
    context: string;
    points: { at: string; averageScore: number; minScore: number; maxScore: number; cells: number }[];
  }[];
}

export interface AuditEventRecord {
  seq: number;
  eventType: string;
  resourceKind: string;
  resourceValue: string;
  context: string | null;
  occurredAt: string;
  until: string | null;
  cause: string | null;
}

/**
 * 이벤트 페이지 응답(#30 keyset 페이지네이션). `nextCursor` 는 더 과거 페이지를 부를 불투명 커서로,
 * 마지막 페이지면 null(= 더 없음). 백엔드 EventController.EventsResponse 와 1:1.
 */
export interface AuditEventPage {
  events: AuditEventRecord[];
  nextCursor: string | null;
}

export interface UsageSummary {
  monthLeaseTotal: number;
  poolSize: number;
  dailyLeases: { date: string; count: number }[];
}

export interface IssuedApiKey {
  id: string;
  rawToken: string; // 발급 직후 1회만
  label: string | null;
  prefix: string;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  label: string | null;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
}

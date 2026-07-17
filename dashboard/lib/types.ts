/** 백엔드 컨트롤 플레인(#11)·미터링(#10)·Phase0 읽기모델의 REST 응답 타입. */

export type ResourceState = "HEALTHY" | "COOLING" | "RECOVERING" | "BLOCKLISTED";
export type ResourceKind = "PROXY" | "ACCOUNT" | "SESSION";

export interface LoginResponse {
  token: string;
  tokenType: string;
  expiresInSeconds: number;
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

export interface AuditEventPage {
  events: AuditEventRecord[];
  page: number;
  size: number;
  hasMore: boolean;
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

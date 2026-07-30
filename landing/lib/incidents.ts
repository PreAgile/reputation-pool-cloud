/**
 * 상태 페이지(#145)의 **사고 로그 단일 출처**.
 *
 * 페이지(`components/status/status-page.tsx`)는 여기서 나오는 값만 읽는다. 문구를 페이지에 흩어 놓지
 * 않는 이유는 docs 매니페스트와 같다: 사고 하나를 기록하려고 두 로케일 페이지를 각각 고치게 두면
 * 반드시 한쪽만 고치는 날이 오고, 그 어긋남은 "한국어로 보면 사고가 없다"처럼 조용하게 나타난다.
 *
 * ## 왜 수동 기입인가
 * 사고는 드물고, 무슨 일이 있었는지 설명하는 문장은 사람만 쓸 수 있다. 자동 수집으로 만들 수 있는
 * 것은 "언제부터 언제까지 안 됐다"까지이고 그건 업타임 쪽 문제다(아래). 자동화를 기다리느라 로그를
 * 미루는 것보다 지금 손으로 적는 편이 낫다 — 이슈 #145 도 같은 판단이다.
 *
 * ## 업타임 수치가 여기 없는 이유
 * 이 모듈에는 가용률 숫자가 없고, 앞으로도 손으로 적지 않는다. 관측하지 않은 값을 사람이 적으면
 * 그건 측정이 아니라 주장이다. 자동 관측(외부 모니터 → Worker/KV)이 붙기 전까지 상태 페이지는
 * **알 수 있는 것만** 보여준다. Prometheus 재사용은 이미 탈락했다 — 서버가 죽으면 지표도 같이
 * 죽으므로 "서버가 죽었을 때 답을 주는 페이지"라는 목적과 정면으로 어긋난다(#145).
 *
 * ## 새 사고를 기록하는 법
 * `INCIDENTS` 배열에 항목을 하나 추가하고 배포한다. 순서는 신경 쓰지 않아도 된다(정렬은 아래에서
 * 파생시킨다). 진행 중이면 `resolvedAt` 을 `null` 로 두고, 해소되면 시각을 채워 다시 배포한다.
 * 시각은 **UTC ISO 8601** 로 적는다 — 페이지가 시간대 변환 없이 UTC 그대로 보여주므로 여기 적힌
 * 값이 곧 독자가 보는 값이다. 형식·정합성은 `incidentDataProblems()` 와 그 테스트가 잡는다.
 */
import type { Locale, Localised } from "@/lib/locale";

/**
 * 사고의 심각도. **두 가지뿐이다** — 쓰지 않을 등급을 미리 만들면 어떤 사고를 어디에 넣을지가
 * 매번 애매해진다.
 *
 * - `outage`   — 기능이 아예 되지 않았다.
 * - `degraded` — 되기는 했지만 느리거나 일부만 됐다.
 */
export type IncidentSeverity = "outage" | "degraded";

/** 심각도 순위(클수록 나쁘다). 여러 건이 겹칠 때 현재 상태를 고르는 데만 쓴다. */
const SEVERITY_RANK: Record<IncidentSeverity, number> = { degraded: 1, outage: 2 };

export interface Incident {
  /**
   * 안정적인 식별자. 목록 key 이자 앵커(`#incident-…`)라서, 한 번 배포한 뒤에는 바꾸지 않는다 —
   * 바꾸면 남이 공유한 링크가 죽는다. `YYYY-MM-DD-짧은이름` 형태를 쓴다.
   */
  id: string;
  severity: IncidentSeverity;
  /** 사고가 시작된 시각(UTC ISO 8601). */
  startedAt: string;
  /** 해소된 시각(UTC ISO 8601). **아직 진행 중이면 `null`** — 이 값이 곧 진행 여부다. */
  resolvedAt: string | null;
  /** 한 줄 제목 — 목록에서 이것만 읽어도 무슨 일이었는지 알 수 있게. */
  title: Localised;
  /** 경과 서술 — 무엇이 안 됐고, 원인이 무엇이었고, 무엇을 했는지. */
  narrative: Localised;
}

/**
 * 이 로그가 시작된 날(UTC). 빈 로그를 "사고가 한 번도 없었다"로 읽히게 두지 않기 위해 필요하다 —
 * 이 날짜 이전의 일은 기록되지 않았을 뿐 없었던 것이 아니다.
 */
export const LOG_STARTED_ON = "2026-07-30";

/**
 * 기록된 사고 전부. 시작은 빈 배열이다 — **지어낸 사고를 넣지 않는다.**
 *
 * 항목 예시(주석으로만 둔다):
 * ```ts
 * {
 *   id: "2026-08-01-grpc-timeout",
 *   severity: "degraded",
 *   startedAt: "2026-08-01T09:12:00Z",
 *   resolvedAt: "2026-08-01T09:48:00Z",
 *   title: { en: "Elevated gRPC latency", ko: "gRPC 지연 상승" },
 *   narrative: { en: "…", ko: "…" },
 * }
 * ```
 */
export const INCIDENTS: Incident[] = [];

/**
 * 페이지 머리에 띄우는 현재 상태.
 *
 * `no-recorded-incident` 는 **"정상"이 아니다.** 이 로그는 사람이 적는 것이라, 항목이 없다는 사실은
 * "지금 서비스가 살아 있다"가 아니라 "진행 중이라고 기록된 사고가 없다"만 뜻한다. 자동 관측이 붙기
 * 전까지 이 구분을 문구에서도 유지한다(사전의 `status.state.*` 참고) — 상태 페이지가 사실보다 강한
 * 말을 하기 시작하면 그때부터는 없느니만 못하다.
 */
export type ServiceState = "no-recorded-incident" | "degraded" | "outage";

/** 해소 시각이 적히면 끝난 사고다. */
export function isResolved(incident: Incident): boolean {
  return incident.resolvedAt !== null;
}

/** 아직 `resolvedAt` 이 없는 사고들(정렬 없음). */
export function ongoingIncidents(incidents: Incident[] = INCIDENTS): Incident[] {
  return incidents.filter((incident) => !isResolved(incident));
}

/**
 * 최신순 정렬. 시작 시각이 같으면 `id` 로 갈라 **같은 입력이 항상 같은 순서**가 되게 한다 —
 * 정적 내보내기라 순서가 흔들리면 배포마다 diff 가 생긴다.
 *
 * 입력 배열은 건드리지 않는다(`INCIDENTS` 를 제자리 정렬하면 import 순서에 따라 값이 달라진다).
 */
export function incidentsNewestFirst(incidents: Incident[] = INCIDENTS): Incident[] {
  return [...incidents].sort((a, b) => {
    const diff = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/**
 * 진행 중인 사고들 중 가장 나쁜 심각도. 하나도 없으면 `no-recorded-incident`.
 * 해소된 사고는 과거이므로 현재 상태에 영향을 주지 않는다.
 */
export function serviceState(incidents: Incident[] = INCIDENTS): ServiceState {
  const worst = ongoingIncidents(incidents).reduce<IncidentSeverity | null>(
    (acc, incident) =>
      acc === null || SEVERITY_RANK[incident.severity] > SEVERITY_RANK[acc] ? incident.severity : acc,
    null,
  );
  return worst ?? "no-recorded-incident";
}

/**
 * 해소된 사고의 지속 시간(분). **진행 중이면 `null`** — 진행 중인 사고의 길이는 "지금"에 따라 달라지고,
 * 이 페이지는 빌드 시점에 굳는 정적 HTML 이라 그 숫자를 적으면 배포 시각에 멈춘 값이 사실인 척한다.
 */
export function resolvedMinutes(incident: Incident): number | null {
  if (incident.resolvedAt === null) return null;
  return Math.round((Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) / 60_000);
}

/** 지속 시간 표기의 로케일별 단위. 문구가 아니라 계산에 붙는 단위라 사전이 아니라 여기 둔다. */
const DURATION_UNIT: Record<Locale, { hour: string; minute: string }> = {
  en: { hour: "h", minute: "m" },
  ko: { hour: "시간", minute: "분" },
};

/** `95` → `1h 35m` / `1시간 35분`. 한 시간 미만이면 분만 쓴다. */
export function formatDuration(minutes: number, locale: Locale): string {
  const unit = DURATION_UNIT[locale];
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${unit.minute}`;
  if (rest === 0) return `${hours}${unit.hour}`;
  return `${hours}${unit.hour} ${rest}${unit.minute}`;
}

/**
 * 사고 시각이 지켜야 하는 형식 — `YYYY-MM-DDTHH:mm:ssZ`. 초까지 적고, 끝은 반드시 리터럴 `Z` 다.
 *
 * <b>`Date.parse()` 만으로는 이 계약을 지킬 수 없다.</b> 훨씬 느슨해서, 형식이 어긋난 값을 통과시킨 뒤
 * **빌드 머신의 로컬 시간대**로 해석한다. KST 러너에서 실측한 결과다:
 *
 * ```
 * "2026-08-01 09:12:00"  → 2026-08-01T00:12:00Z   ← 9 시간 밀린다
 * "08/01/2026"           → 2026-07-31T15:00:00Z
 * "2026-08-01"           → 2026-08-01T00:00:00Z   (날짜만인데 통과)
 * ```
 *
 * CI 는 초록인데 작성자가 적은 시각과 공개되는 시각이 달라진다 — 사고 로그에서 시각이 틀리는 것은
 * 로그가 없는 것보다 나쁘다.
 */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * 위 형식을 만족하는 문자열만 epoch 밀리초로. 아니면 `null`.
 *
 * 정규식만으로는 부족해서 **되돌려 찍어 비교한다**: `Date.parse("2026-02-30T00:00:00Z")` 는 `NaN` 이
 * 아니라 3 월 2 일로 굴러간다(실측). 오타 하나가 조용히 다른 날짜가 되는 것을 여기서 막는다.
 *
 * 오프셋 표기(`+09:00`)도 거부한다. 파싱은 되지만, 손으로 적는 로그에서 같은 순간을 두 가지로 적을 수
 * 있게 두면 항목끼리 비교가 어려워지고 화면은 어차피 UTC 로만 표시한다.
 */
function parseUtcInstant(value: string): number | null {
  if (!UTC_INSTANT.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return `${new Date(at).toISOString().slice(0, 19)}Z` === value ? at : null;
}

/**
 * `2026-08-01T09:12:00Z` → `2026-08-01 09:12 UTC`.
 *
 * 시간대 변환을 하지 않는 이유: 정적 HTML 이라 독자의 시간대를 알 수 없고, 서버 시간대로 적으면
 * 어느 시간대인지 아무도 모른다. UTC 로 못 박고 그렇게 적혀 있음을 화면에 표시한다.
 *
 * {@link incidentDataProblems} 와 **같은 파서**를 쓴다. 검사와 표시가 서로 다른 기준을 쓰면 "검사는
 * 통과했는데 화면에는 다른 시각이 뜨는" 상태가 생긴다.
 */
export function formatUtc(iso: string): string {
  const at = parseUtcInstant(iso);
  if (at === null) {
    throw new Error(`invalid incident timestamp: "${iso}" (expected YYYY-MM-DDTHH:mm:ssZ)`);
  }
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * 손으로 적은 로그의 정합성 검사 — 사람이 적는 데이터라 오타가 전제다. 사람이 읽는 문제 목록을
 * 돌려주고, 테스트가 "`INCIDENTS` 에 대해 빈 배열"을 단정한다.
 *
 * 던지지 않고 목록을 돌려주는 이유: 예외는 처음 하나에서 멈추지만, 항목을 여러 개 붙여 넣는 상황에서
 * 필요한 것은 "무엇이 몇 개 틀렸는지" 전부다.
 */
export function incidentDataProblems(incidents: Incident[] = INCIDENTS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const incident of incidents) {
    if (seen.has(incident.id)) problems.push(`중복 id: "${incident.id}"`);
    seen.add(incident.id);

    const startedAt = parseUtcInstant(incident.startedAt);
    if (startedAt === null) {
      problems.push(
        `"${incident.id}" 의 startedAt 이 UTC ISO 8601(YYYY-MM-DDTHH:mm:ssZ) 이 아니다: "${incident.startedAt}"`,
      );
    }
    if (incident.resolvedAt === null) continue;

    const resolvedAt = parseUtcInstant(incident.resolvedAt);
    if (resolvedAt === null) {
      problems.push(
        `"${incident.id}" 의 resolvedAt 이 UTC ISO 8601(YYYY-MM-DDTHH:mm:ssZ) 이 아니다: "${incident.resolvedAt}"`,
      );
    } else if (startedAt !== null && resolvedAt < startedAt) {
      problems.push(`"${incident.id}" 의 해소 시각이 발생 시각보다 이르다`);
    }
  }
  return problems;
}

import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatUtc,
  incidentDataProblems,
  incidentsNewestFirst,
  isResolved,
  ongoingIncidents,
  resolvedMinutes,
  serviceState,
  type Incident,
  INCIDENTS,
} from "./incidents";

/** 픽스처 한 건. 테스트마다 필요한 필드만 덮어쓴다. */
function incident(overrides: Partial<Incident> & Pick<Incident, "id">): Incident {
  return {
    severity: "degraded",
    startedAt: "2026-08-01T09:00:00Z",
    resolvedAt: "2026-08-01T10:00:00Z",
    title: { en: "t", ko: "제목" },
    narrative: { en: "n", ko: "경과" },
    ...overrides,
  };
}

describe("사고 로그 (#145)", () => {
  describe("진행 여부", () => {
    it("resolvedAt 이 null 이면 → 진행 중으로 본다", () => {
      expect(isResolved(incident({ id: "a", resolvedAt: null }))).toBe(false);
      expect(isResolved(incident({ id: "b" }))).toBe(true);
    });

    it("진행 중인 것만 골라낸다 → 해소된 사고는 현재 상태에 영향을 주지 않는다", () => {
      const open = incident({ id: "open", resolvedAt: null });
      const done = incident({ id: "done" });

      expect(ongoingIncidents([done, open]).map((i) => i.id)).toEqual(["open"]);
    });
  });

  describe("현재 상태", () => {
    it("로그가 비어 있으면 → '정상'이 아니라 '기록된 사고 없음'이다", () => {
      expect(serviceState([])).toBe("no-recorded-incident");
    });

    it("해소된 사고만 있으면 → 기록된 진행 중 사고가 없다", () => {
      expect(serviceState([incident({ id: "done" })])).toBe("no-recorded-incident");
    });

    it("진행 중 사고가 여러 건이면 → 가장 나쁜 심각도가 이긴다", () => {
      const state = serviceState([
        incident({ id: "slow", severity: "degraded", resolvedAt: null }),
        incident({ id: "down", severity: "outage", resolvedAt: null }),
      ]);

      expect(state).toBe("outage");
    });

    it("장애가 이미 해소됐고 저하만 진행 중이면 → 저하로 표시한다", () => {
      const state = serviceState([
        incident({ id: "down", severity: "outage" }),
        incident({ id: "slow", severity: "degraded", resolvedAt: null }),
      ]);

      expect(state).toBe("degraded");
    });
  });

  describe("정렬", () => {
    it("최신순으로 정렬한다", () => {
      const older = incident({ id: "older", startedAt: "2026-08-01T09:00:00Z" });
      const newer = incident({ id: "newer", startedAt: "2026-08-02T09:00:00Z" });

      expect(incidentsNewestFirst([older, newer]).map((i) => i.id)).toEqual(["newer", "older"]);
    });

    // 정적 내보내기라 순서가 흔들리면 내용이 같아도 배포마다 diff 가 생긴다.
    it("시작 시각이 같으면 → id 로 갈라 항상 같은 순서가 된다", () => {
      const a = incident({ id: "a-first" });
      const b = incident({ id: "b-second" });

      expect(incidentsNewestFirst([b, a]).map((i) => i.id)).toEqual(["a-first", "b-second"]);
    });

    it("입력 배열을 제자리에서 바꾸지 않는다 → 단일 출처 배열이 import 순서에 따라 달라지지 않는다", () => {
      const input = [incident({ id: "older" }), incident({ id: "newer", startedAt: "2026-08-09T09:00:00Z" })];

      incidentsNewestFirst(input);

      expect(input.map((i) => i.id)).toEqual(["older", "newer"]);
    });
  });

  describe("지속 시간", () => {
    it("해소된 사고는 분 단위 지속 시간을 준다", () => {
      const value = resolvedMinutes(
        incident({ id: "a", startedAt: "2026-08-01T09:00:00Z", resolvedAt: "2026-08-01T10:35:00Z" }),
      );

      expect(value).toBe(95);
    });

    // 진행 중 사고의 길이는 "지금"에 따라 달라진다. 정적 HTML 에 적으면 빌드 시각에 멈춘 값이
    // 사실인 척하므로, 아예 계산하지 않는 것이 계약이다.
    it("진행 중이면 → 지속 시간을 계산하지 않는다(null)", () => {
      expect(resolvedMinutes(incident({ id: "a", resolvedAt: null }))).toBeNull();
    });

    it("한 시간 미만이면 분만, 넘으면 시간과 분을 로케일 단위로 적는다", () => {
      expect(formatDuration(35, "en")).toBe("35m");
      expect(formatDuration(35, "ko")).toBe("35분");
      expect(formatDuration(95, "en")).toBe("1h 35m");
      expect(formatDuration(95, "ko")).toBe("1시간 35분");
    });

    it("정확히 시간 단위로 떨어지면 → 0 분을 붙이지 않는다", () => {
      expect(formatDuration(120, "en")).toBe("2h");
      expect(formatDuration(120, "ko")).toBe("2시간");
    });
  });

  describe("시각 표기", () => {
    it("UTC 로 못 박아 표기한다 → 독자의 시간대를 모르는 정적 HTML 에서 해석이 갈리지 않는다", () => {
      expect(formatUtc("2026-08-01T09:12:00Z")).toBe("2026-08-01 09:12 UTC");
    });

    // 이 테스트는 "오프셋이 붙은 시각도 UTC 로 환산해 보여준다" 를 **대체**한다. 그쪽은 오프셋 표기를
    // 허용했는데, 모듈이 선언한 계약("UTC ISO 8601")과 어긋나고 같은 순간을 두 가지로 적을 수 있게
    // 만든다. 계약을 UTC 리터럴 하나로 좁히기로 했으므로(리뷰 지적) 이제 거부가 맞다.
    it("오프셋 표기는 거부한다 → 같은 순간을 두 가지로 적을 수 있으면 항목끼리 비교가 안 된다", () => {
      expect(() => formatUtc("2026-08-01T18:12:00+09:00")).toThrow(/invalid incident timestamp/);
    });

    it("파싱할 수 없는 값이면 → 조용히 넘기지 않고 던진다", () => {
      expect(() => formatUtc("어제쯤")).toThrow(/invalid incident timestamp/);
    });

    it("검사와 표시가 같은 파서를 쓴다 → 검사는 통과했는데 화면엔 다른 시각이 뜨는 일이 없다", () => {
      // incidentDataProblems 가 받아 준 값은 formatUtc 도 반드시 받아야 한다.
      const ok = incident({ id: "a", startedAt: "2026-08-01T09:12:00Z", resolvedAt: null });
      expect(incidentDataProblems([ok])).toEqual([]);
      expect(() => formatUtc(ok.startedAt)).not.toThrow();
    });
  });

  describe("손으로 적은 데이터의 정합성", () => {
    it("실제 로그에는 문제가 없다", () => {
      expect(incidentDataProblems()).toEqual([]);
    });

    it("id 가 겹치면 → 문제로 보고한다 (앵커가 두 사고를 가리키게 된다)", () => {
      const problems = incidentDataProblems([incident({ id: "same" }), incident({ id: "same" })]);

      expect(problems).toEqual([expect.stringContaining("중복 id")]);
    });

    it("시각이 ISO 8601 이 아니면 → 문제로 보고한다", () => {
      const problems = incidentDataProblems([incident({ id: "a", startedAt: "2026년 8월 1일" })]);

      expect(problems).toEqual([expect.stringContaining("startedAt")]);
    });

    // `Date.parse()` 는 아래 값들을 전부 통과시키고 **빌드 머신의 로컬 시간대**로 해석한다. KST 러너
    // 실측: "2026-08-01 09:12:00" → 2026-08-01T00:12Z (9 시간 밀림). CI 는 초록인데 작성자가 적은
    // 시각과 공개되는 시각이 달라진다. 시간대가 무엇이든 이 값들은 거부되어야 한다.
    it.each([
      ["날짜만", "2026-08-01"],
      ["슬래시 형식", "08/01/2026"],
      ["시간대 없는 datetime", "2026-08-01 09:12:00"],
      ["오프셋 표기", "2026-08-01T18:12:00+09:00"],
      ["소수 초", "2026-08-01T09:12:00.500Z"],
      ["T 대신 공백", "2026-08-01 09:12:00Z"],
      ["영어 날짜", "Aug 1 2026"],
    ])("느슨한 시각 형식(%s)은 거부한다 → 로컬 시간대로 해석돼 조용히 밀린다", (_label, value) => {
      expect(incidentDataProblems([incident({ id: "a", startedAt: value })])).toEqual([
        expect.stringContaining("startedAt"),
      ]);
    });

    it("존재하지 않는 날짜는 거부한다 → Date.parse 는 2026-02-30 을 3 월 2 일로 굴린다", () => {
      const problems = incidentDataProblems([incident({ id: "a", startedAt: "2026-02-30T00:00:00Z" })]);

      expect(problems).toEqual([expect.stringContaining("startedAt")]);
    });

    it("올바른 UTC 형식은 통과한다 → 엄격해진 검사가 정상 입력까지 막지 않는다", () => {
      expect(
        incidentDataProblems([
          incident({ id: "a", startedAt: "2026-08-01T09:12:00Z", resolvedAt: "2026-08-01T09:48:00Z" }),
          incident({ id: "b", startedAt: "2026-12-31T23:59:59Z", resolvedAt: null }),
        ]),
      ).toEqual([]);
    });

    it("해소가 발생보다 이르면 → 문제로 보고한다", () => {
      const problems = incidentDataProblems([
        incident({ id: "a", startedAt: "2026-08-01T10:00:00Z", resolvedAt: "2026-08-01T09:00:00Z" }),
      ]);

      expect(problems).toEqual([expect.stringContaining("이르다")]);
    });

    it("문제가 여러 건이면 → 첫 건에서 멈추지 않고 전부 모은다", () => {
      const problems = incidentDataProblems([
        incident({ id: "a", startedAt: "언젠가" }),
        incident({ id: "b", resolvedAt: "언젠가" }),
      ]);

      expect(problems).toHaveLength(2);
    });
  });

  // 업타임 수치는 관측이 붙기 전까지 이 모듈에 들어오지 않는다(#145). 손으로 적은 가용률은 측정이
  // 아니라 주장이고, 상태 페이지가 그걸 하기 시작하면 없느니만 못하다.
  it("로그에는 사고만 있고 가용률 수치는 없다", () => {
    for (const entry of INCIDENTS) {
      expect(Object.keys(entry).sort()).toEqual(
        ["id", "narrative", "resolvedAt", "severity", "startedAt", "title"].sort(),
      );
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  contextsWorstFirst,
  representativeContext,
  scoreDistribution,
  sortRowsWorstFirst,
  stateCounts,
  type HeatmapRow,
} from "./heatmap";
import { cell, row } from "@/test/heatmap-fixtures";

/** score 만 다른 셀 n 개짜리 1행 격자 — 분포 판정 테스트용. */
function gridOfScores(scores: number[]): HeatmapRow[] {
  return [
    row(
      "PROXY",
      "proxy-a",
      scores.map((s, i) => cell(`ctx-${i}`, s, "HEALTHY")),
      { window: "" },
    ),
  ];
}

describe("히트맵 축 정렬", () => {
  it("행은 최악 우선으로 정렬한다 — 심각도 desc → 최저 score asc", () => {
    const rows = [
      row("PROXY", "healthy", [cell("a", 70, "HEALTHY")], { window: "" }),
      row("PROXY", "blocked", [cell("a", -90, "BLOCKLISTED")], { window: "" }),
      row("PROXY", "cool-mild", [cell("a", -10, "COOLING")], { window: "" }),
      row("PROXY", "cool-severe", [cell("a", -60, "COOLING")], { window: "" }),
    ];

    expect(sortRowsWorstFirst(rows).map((r) => r.resource.value)).toEqual([
      "blocked",
      "cool-severe",
      "cool-mild",
      "healthy",
    ]);
  });

  it("같은 심각도·같은 score 면 값 이름순으로 안정 정렬한다", () => {
    const rows = [
      row("PROXY", "b", [cell("a", 10, "HEALTHY")], { window: "" }),
      row("PROXY", "a", [cell("a", 10, "HEALTHY")], { window: "" }),
    ];

    expect(sortRowsWorstFirst(rows).map((r) => r.resource.value)).toEqual(["a", "b"]);
  });

  it("셀이 없어 score 가 null 인 리소스는 같은 심각도 안에서 뒤로 민다", () => {
    const rows = [
      row("PROXY", "no-cells", [], { window: "" }),
      row("PROXY", "has-cells", [cell("a", 70, "HEALTHY")], { window: "" }),
    ];

    expect(sortRowsWorstFirst(rows).map((r) => r.resource.value)).toEqual(["has-cells", "no-cells"]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const rows = [
      row("PROXY", "healthy", [cell("a", 70, "HEALTHY")], { window: "" }),
      row("PROXY", "blocked", [cell("a", -90, "BLOCKLISTED")], { window: "" }),
    ];

    sortRowsWorstFirst(rows);
    expect(rows.map((r) => r.resource.value)).toEqual(["healthy", "blocked"]);
  });

  it("열은 심각도 합이 큰 컨텍스트부터, 동점이면 이름순으로 놓는다", () => {
    const rows = [
      row("PROXY", "p1", [cell("good", 70, "HEALTHY"), cell("bad", -90, "BLOCKLISTED")], { window: "" }),
      row("PROXY", "p2", [cell("good", 70, "HEALTHY"), cell("mid", -10, "COOLING"), cell("also", 70, "HEALTHY")], {
        window: "",
      }),
    ];

    expect(contextsWorstFirst(rows)).toEqual(["bad", "mid", "also", "good"]);
  });

  it("셀이 하나도 없으면 열 축은 빈 배열이다", () => {
    expect(contextsWorstFirst([row("PROXY", "p", [], { window: "" })])).toEqual([]);
  });
});

describe("대표 셀(recentWindow 의 주인)", () => {
  it("최저 score 셀의 컨텍스트를 고른다", () => {
    const r = row("PROXY", "p", [cell("a", 30, "HEALTHY"), cell("b", -5, "COOLING"), cell("c", 12, "RECOVERING")], {
      window: "",
    });

    expect(representativeContext(r)).toBe("b");
  });

  it("동점이면 먼저 나온 셀을 고른다 — 백엔드 representativeOf 와 같은 규칙", () => {
    const r = row("PROXY", "p", [cell("first", -5, "COOLING"), cell("second", -5, "COOLING")], { window: "" });

    expect(representativeContext(r)).toBe("first");
  });

  it("셀이 없으면 null 이다", () => {
    expect(representativeContext(row("PROXY", "p", [], { window: "" }))).toBeNull();
  });
});

describe("상태별 셀 개수", () => {
  it("모든 행의 셀을 상태별로 센다", () => {
    const rows = [
      row("PROXY", "p1", [cell("a", -90, "BLOCKLISTED"), cell("b", -10, "COOLING")], { window: "" }),
      row("PROXY", "p2", [cell("a", 70, "HEALTHY"), cell("b", 10, "RECOVERING"), cell("c", 71, "HEALTHY")], {
        window: "",
      }),
    ];

    expect(stateCounts(rows)).toEqual({ HEALTHY: 2, COOLING: 1, RECOVERING: 1, BLOCKLISTED: 1 });
  });
});

describe("score 분포 — 평균이 같아도 모양이 다르다(이 화면의 존재 이유)", () => {
  it("200개가 58~74 에 고르게 퍼지면 → 단봉(공통 원인 의심)", () => {
    // 이슈 #124 의 실측 사례: 평균 65, σ≈4.6, 균일 분포.
    const scores = Array.from({ length: 200 }, (_, i) => 58 + (i % 17));
    const d = scoreDistribution(gridOfScores(scores));

    expect(d.count).toBe(200);
    expect(d.mean).toBeCloseTo(66, 0);
    expect(d.modality).toBe("UNIMODAL");
    expect(d.split).toBeNull();
  });

  it("평균이 같아도 70개 ~0 / 130개 ~100 으로 갈리면 → 이봉(일부만 차단)", () => {
    // 0 이 70개, 100 이 130개 → 평균 65 로 위 균일 분포와 사실상 같은 자리인데 결론은 정반대다.
    const scores = [...Array<number>(70).fill(0), ...Array<number>(130).fill(100)];
    const d = scoreDistribution(gridOfScores(scores));

    expect(d.mean).toBe(65);
    expect(d.modality).toBe("BIMODAL");
    expect(d.split).toEqual({ low: 0, high: 100 });
  });

  it("한쪽 무리가 표본의 15% 미만이면(이상치 몇 개) 이봉으로 보지 않는다", () => {
    const scores = [...Array<number>(98).fill(70), ...Array<number>(2).fill(-90)];
    const d = scoreDistribution(gridOfScores(scores));

    expect(d.modality).toBe("UNIMODAL");
  });

  it("두 덩어리라도 틈이 전체 범위의 35% 미만이면 갈렸다고 보지 않는다", () => {
    // 0~30 과 40~70 두 덩어리(각 50개, 절반씩)지만 사이 틈은 10 으로 범위 70 의 14% 뿐이다.
    const scores = [
      ...Array.from({ length: 50 }, (_, i) => i % 31),
      ...Array.from({ length: 50 }, (_, i) => 40 + (i % 31)),
    ];
    const d = scoreDistribution(gridOfScores(scores));

    expect(d.modality).toBe("UNIMODAL");
  });

  it("셀이 8개 미만이면 판정을 보류한다 — 평균·σ 는 그대로 낸다", () => {
    const d = scoreDistribution(gridOfScores([0, 0, 0, 100, 100, 100, 100]));

    expect(d.count).toBe(7);
    expect(d.modality).toBe("INSUFFICIENT");
    expect(d.mean).toBeCloseTo(57.14, 2);
  });

  it("셀이 하나도 없으면 평균·σ 는 null 이고 판정하지 않는다", () => {
    const d = scoreDistribution([row("PROXY", "p", [], { window: "" })]);

    expect(d).toEqual({ count: 0, mean: null, stdDev: null, modality: "INSUFFICIENT", split: null });
  });

  it("모두 같은 값이면 σ 는 0 이고 단봉이다", () => {
    const d = scoreDistribution(gridOfScores(Array<number>(10).fill(42)));

    expect(d.stdDev).toBe(0);
    expect(d.modality).toBe("UNIMODAL");
  });

  it("σ 는 모표준편차로 계산한다 — 중간 흩어짐도 값이 맞아야 한다", () => {
    // 2,4,4,4,5,5,7,9 → 평균 5, 모표준편차 2 (교과서 예제).
    const d = scoreDistribution(gridOfScores([2, 4, 4, 4, 5, 5, 7, 9]));

    expect(d.mean).toBe(5);
    expect(d.stdDev).toBe(2);
  });
});

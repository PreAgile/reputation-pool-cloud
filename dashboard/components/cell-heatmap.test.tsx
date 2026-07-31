import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CellHeatmap } from "./cell-heatmap";
import { cell, heatmapFixture, heatmapNoCellsFixture, row } from "@/test/heatmap-fixtures";
import { seriousViolations } from "@/test/a11y";
import type { HeatmapRow } from "@/lib/heatmap";

/** hover/포커스한 칸을 설명하는 미니 상세 영역. */
function inspector(): HTMLElement {
  return screen.getByRole("group", { name: "선택한 칸 상세" });
}

/**
 * 작은 격자 2×3. p-bad 는 ctx-c 에서 쓰인 적이 없어(셀 없음) 빈 칸이 하나 생긴다.
 * 대표(최저 score) 셀은 p-bad × ctx-a.
 */
const rows: HeatmapRow[] = [
  row("PROXY", "p-good", [cell("ctx-a", 70, "HEALTHY"), cell("ctx-b", 65, "HEALTHY"), cell("ctx-c", 60, "HEALTHY")], {
    window: "1111",
  }),
  row("PROXY", "p-bad", [cell("ctx-a", -90, "BLOCKLISTED"), cell("ctx-b", -20, "COOLING")], { window: "0010" }),
];

describe("CellHeatmap — Resource × Context 상태 격자", () => {
  it("행=리소스·열=컨텍스트로 격자를 그리고, 나쁜 쪽을 앞에 놓는다", () => {
    render(<CellHeatmap rows={rows} />);

    const columns = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(columns).toEqual(["리소스", "ctx-a", "ctx-b", "ctx-c"]);

    const resources = screen.getAllByRole("rowheader").map((th) => th.textContent);
    expect(resources[0]).toContain("p-bad");
    expect(resources[1]).toContain("p-good");

    // 2행 × 3열 = 칸 6개(빈 칸 포함).
    expect(screen.getAllByRole("gridcell")).toHaveLength(6);
  });

  it("칸의 접근 이름에 리소스 × 컨텍스트 · 상태 · score 가 모두 들어간다 — 색 없이도 읽힌다", () => {
    render(<CellHeatmap rows={rows} />);

    expect(screen.getByRole("link", { name: "PROXY p-bad × ctx-a · Blocked · score -90.00" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PROXY p-good × ctx-c · Healthy · score 60.00" })).toBeInTheDocument();
  });

  it("쓰인 적 없는 칸은 건강한 칸과 다른 이름·다른 표기를 갖는다 — 빈 셀과 HEALTHY 는 다른 뜻이다", () => {
    render(<CellHeatmap rows={rows} />);

    const empty = screen.getByRole("link", { name: "PROXY p-bad × ctx-c · 사용 이력 없음" });
    const healthy = screen.getByRole("link", { name: "PROXY p-good × ctx-c · Healthy · score 60.00" });

    // 표기(머리글자)와 배경이 모두 달라야 한다. 상태색을 빈 칸에 쓰면 "건강함"으로 오독된다.
    expect(empty).toHaveTextContent("–");
    expect(healthy).toHaveTextContent("H");
    expect(empty).toHaveClass("border-dashed");
    expect(empty.className).not.toContain("bg-ok");
    expect(healthy.className).toContain("bg-ok");
  });

  it("칸을 클릭하면 기존 리소스 상세로 간다 — 링크 규칙은 오버뷰와 같다", () => {
    render(<CellHeatmap rows={[row("PROXY", "proxy/A B", [cell("ctx-a", 70, "HEALTHY")], { window: "1" })]} />);

    expect(screen.getByRole("link", { name: /× ctx-a/ })).toHaveAttribute(
      "href",
      "/resources/proxy/proxy%2FA%20B",
    );
  });

  it("hover 하면 미니 상세에 score·연속 실패·cooldown 해제 시각이 나온다", async () => {
    const user = userEvent.setup();
    const cooling = row(
      "PROXY",
      "p-cool",
      [cell("ctx-a", -20, "COOLING", { consecutiveFailures: 4, cooldownUntil: "2026-07-30T12:40:00Z" })],
      { window: "0011" },
    );
    render(<CellHeatmap rows={[cooling]} />);

    await user.hover(screen.getByRole("link", { name: /× ctx-a/ }));

    expect(within(inspector()).getByText("연속 실패").parentElement).toHaveTextContent("4");
    expect(within(inspector()).getByText("score").parentElement).toHaveTextContent("-20.00");
    expect(within(inspector()).getByText("Cooldown 해제")).toBeInTheDocument();
  });

  it("대표(최저 score) 셀의 상세에만 최근 판정 스파크라인을 보여준다", async () => {
    const user = userEvent.setup();
    render(<CellHeatmap rows={rows} />);

    // p-bad × ctx-a 가 최저 score → 읽기모델의 recentWindow 가 가리키는 셀이다.
    await user.hover(screen.getByRole("link", { name: /p-bad × ctx-a/ }));
    expect(within(inspector()).getByRole("img", { name: "최근 4회 중 1회 성공" })).toBeInTheDocument();

    // 같은 행의 다른 셀에는 그 창을 붙이지 않는다(읽기모델에 셀별 창이 없다).
    await user.hover(screen.getByRole("link", { name: /p-bad × ctx-b/ }));
    expect(screen.queryByRole("img", { name: /최근 4회/ })).not.toBeInTheDocument();
  });

  it("hover 전에는 미니 상세가 다음 동작을 안내한다", () => {
    render(<CellHeatmap rows={rows} />);

    expect(within(inspector()).getByText(/화살표 키로 이동하면/)).toBeInTheDocument();
  });

  it("격자는 탭 정지 한 칸이고, 안에서는 화살표 키로 칸을 순회한다", async () => {
    const user = userEvent.setup();
    render(<CellHeatmap rows={rows} />);

    // 로빙 tabindex: 탭 가능한 칸은 하나뿐이다(첫 행의 행 머리).
    const focusable = screen.getAllByRole("link").filter((a) => a.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);

    await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", expect.stringContaining("p-bad"));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAttribute("aria-label", "PROXY p-bad × ctx-a · Blocked · score -90.00");

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "PROXY p-good × ctx-a · Healthy · score 70.00");

    await user.keyboard("{End}");
    expect(document.activeElement).toHaveAttribute("aria-label", "PROXY p-good × ctx-c · Healthy · score 60.00");

    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveAttribute("aria-label", expect.stringContaining("p-good"));

    // 마지막 행에서 더 내려가도 격자 밖으로 나가지 않는다(포커스도, 미니 상세가 가리키는 칸도 그대로).
    await user.keyboard("{ArrowLeft}{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", expect.stringContaining("p-good"));
    expect(inspector()).toHaveTextContent("p-good");
  });

  it("격자 경계에서도 인식한 키는 preventDefault 한다 — 안 하면 포커스는 그대로인데 페이지가 스크롤된다", async () => {
    const user = userEvent.setup();
    render(<CellHeatmap rows={rows} />);

    const captured: { keydown: KeyboardEvent | null } = { keydown: null };
    document.addEventListener("keydown", (e) => {
      captured.keydown = e;
    });

    // 첫 탭 정지는 [0,0](p-bad 행 머리) — 위·왼쪽 경계에 이미 있다.
    await user.tab();

    await user.keyboard("{ArrowUp}");
    expect(captured.keydown?.defaultPrevented).toBe(true);

    await user.keyboard("{ArrowLeft}");
    expect(captured.keydown?.defaultPrevented).toBe(true);
  });

  it("키보드로 옮긴 칸의 상세도 미니 상세에 반영한다", async () => {
    const user = userEvent.setup();
    render(<CellHeatmap rows={rows} />);

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(within(inspector()).getByText("score").parentElement).toHaveTextContent("-90.00");
  });

  it("분포 요약이 평균·σ·단봉/이봉 판정을 함께 적는다", () => {
    render(<CellHeatmap rows={heatmapFixture} />);

    expect(screen.getByText(/이봉 — 두 무리로 갈린다/)).toBeInTheDocument();
    expect(screen.getByText("σ").parentElement).toHaveTextContent("σ");
  });

  it("셀이 적으면 판정을 보류한다고 적는다", () => {
    render(<CellHeatmap rows={rows} />);

    expect(screen.getByText(/표본 부족/)).toBeInTheDocument();
  });

  it("범례가 상태별 머리글자와 개수를 함께 보여준다", () => {
    render(<CellHeatmap rows={rows} />);

    const legend = screen.getByText("Blocked").parentElement as HTMLElement;
    expect(within(legend).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("사용 이력 없음")).toBeInTheDocument();
  });

  it("리소스가 없으면 '데이터 없음' 대신 다음 행동을 제시한다", () => {
    render(<CellHeatmap rows={[]} />);

    expect(screen.getByText("격자에 그릴 리소스가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /풀 오버뷰에서 등록 상태 확인/ })).toHaveAttribute("href", "/overview");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("리소스는 있는데 판정된 컨텍스트가 없으면 유입을 확인하라고 안내한다", () => {
    render(<CellHeatmap rows={heatmapNoCellsFixture} />);

    expect(screen.getByText("아직 판정된 컨텍스트가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /실시간 이벤트에서 유입 확인/ })).toHaveAttribute("href", "/events");
  });

  it("애니메이션·전환 유틸에는 반드시 motion-safe: 를 붙인다 — prefers-reduced-motion 존중", () => {
    const { container } = render(<CellHeatmap rows={rows} />);

    const offenders: string[] = [];
    for (const el of container.querySelectorAll<HTMLElement>("*")) {
      for (const token of el.className.toString().split(/\s+/)) {
        if (/^(animate-|transition)/.test(token)) offenders.push(token);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    render(<CellHeatmap rows={heatmapFixture} />);
    expect(await seriousViolations(document.body)).toEqual([]);
  });

  it("a11y: 빈 상태에도 critical/serious 위반이 없다", async () => {
    render(<CellHeatmap rows={[]} />);
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

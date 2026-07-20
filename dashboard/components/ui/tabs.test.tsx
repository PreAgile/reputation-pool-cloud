import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { seriousViolations } from "@/test/a11y";

function Harness() {
  return (
    <Tabs defaultValue="a">
      <TabsList aria-label="상세 탭">
        <TabsTrigger value="a">곡선</TabsTrigger>
        <TabsTrigger value="b">셀</TabsTrigger>
        <TabsTrigger value="c">타임라인</TabsTrigger>
      </TabsList>
      <TabsContent value="a">곡선 내용</TabsContent>
      <TabsContent value="b">셀 내용</TabsContent>
      <TabsContent value="c">타임라인 내용</TabsContent>
    </Tabs>
  );
}

describe("Tabs (Radix)", () => {
  it("tablist·tab·기본 활성 패널을 렌더한다", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "상세 탭" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);

    // 기본값 a: 곡선 패널만 보인다(비활성 패널은 마운트되지 않음).
    expect(screen.getByText("곡선 내용")).toBeInTheDocument();
    expect(screen.queryByText("셀 내용")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "곡선" })).toHaveAttribute("aria-selected", "true");
  });

  it("클릭으로 탭을 전환한다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "셀" }));
    expect(screen.getByText("셀 내용")).toBeInTheDocument();
    expect(screen.queryByText("곡선 내용")).not.toBeInTheDocument();
  });

  it("방향키(→)로 다음 탭을 활성화한다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "곡선" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "셀" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("셀 내용")).toBeInTheDocument();
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<Harness />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

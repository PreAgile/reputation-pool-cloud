import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangePicker, RANGE_PRESETS, type RangePreset } from "./date-range-picker";
import { seriousViolations } from "@/test/a11y";

function Harness() {
  const [range, setRange] = useState<RangePreset>(RANGE_PRESETS[0]); // 최근 24시간
  return (
    <div>
      <span data-testid="selected">{range.key}</span>
      <DateRangePicker value={range} onChange={setRange} />
    </div>
  );
}

describe("DateRangePicker (Radix Popover)", () => {
  it("현재 선택 라벨을 필 버튼에 보여준다", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /기간 선택/ })).toHaveTextContent("최근 24시간");
    expect(screen.getByTestId("selected")).toHaveTextContent("24h");
  });

  it("트리거를 열면 프리셋 3종이 뜬다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /기간 선택/ }));

    expect(await screen.findByRole("button", { name: "최근 7일" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "최근 30일" })).toBeInTheDocument();
    // 현재 선택(24시간)은 aria-pressed=true.
    expect(screen.getByRole("button", { name: "최근 24시간" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("프리셋을 고르면 onChange 로 반영되고 팝오버가 닫힌다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /기간 선택/ }));
    await user.click(await screen.findByRole("button", { name: "최근 7일" }));

    expect(screen.getByTestId("selected")).toHaveTextContent("7d");
    // 트리거 라벨도 갱신.
    expect(screen.getByRole("button", { name: /기간 선택/ })).toHaveTextContent("최근 7일");
  });

  it("a11y: 팝오버가 열린 상태에서 critical/serious 위반이 없다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /기간 선택/ }));
    await screen.findByRole("button", { name: "최근 7일" });
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

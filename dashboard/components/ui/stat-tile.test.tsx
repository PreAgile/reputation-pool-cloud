import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./stat-tile";

describe("StatTile (KPI 타일)", () => {
  it("라벨과 값을 렌더한다", () => {
    render(<StatTile label="등록" value={42} />);
    expect(screen.getByText("등록")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("tone=block이면 값에 block 의미색을 입힌다", () => {
    render(<StatTile label="Blocked" value={3} tone="block" />);
    expect(screen.getByText("3")).toHaveClass("text-block-ink");
  });

  it("accent 지름길은 accent tone과 같게 동작한다", () => {
    render(<StatTile label="셀 총계" value={5} accent />);
    expect(screen.getByText("5")).toHaveClass("text-accent");
  });

  it("delta가 양수면 ▲와 증감치를 보여준다", () => {
    render(<StatTile label="Blocked" value={3} delta={2} deltaTone="bad" />);
    // ▲ 기호와 절대값(2)이 함께 노출된다.
    expect(screen.getByLabelText("직전 대비 증가 2")).toHaveTextContent("▲");
  });

  it("delta가 음수면 ▼로 표시한다", () => {
    render(<StatTile label="Blocked" value={1} delta={-2} deltaTone="good" />);
    expect(screen.getByLabelText("직전 대비 감소 2")).toHaveTextContent("▼");
  });

  it("delta가 0이거나 없으면 증감 표기를 숨긴다", () => {
    render(<StatTile label="등록" value={5} delta={0} />);
    expect(screen.queryByLabelText(/직전 대비/)).not.toBeInTheDocument();
  });
});

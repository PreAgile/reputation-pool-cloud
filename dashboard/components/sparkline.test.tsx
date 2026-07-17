import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./sparkline";

describe("Sparkline", () => {
  it("빈 배열이면 placeholder와 '기록 없음' 라벨을 보인다", () => {
    render(<Sparkline flags={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByLabelText("최근 판정 기록 없음")).toBeInTheDocument();
  });

  it("성공/실패 개수를 접근성 라벨에 요약한다", () => {
    render(<Sparkline flags={[true, false, true, true]} />);
    // 최근 4회 중 3회 성공
    expect(screen.getByLabelText("최근 4회 중 3회 성공")).toBeInTheDocument();
  });
});

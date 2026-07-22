import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("각 상태 enum을 영어 라벨로 매핑한다", () => {
    const cases = [
      ["HEALTHY", "Healthy"],
      ["COOLING", "Cooldown"],
      ["RECOVERING", "Recovering"],
      ["BLOCKLISTED", "Blocked"],
    ] as const;
    for (const [state, label] of cases) {
      const { unmount } = render(<StatusBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

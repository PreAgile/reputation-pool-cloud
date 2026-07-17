import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("각 상태 enum을 한글 라벨로 매핑한다", () => {
    const cases = [
      ["HEALTHY", "정상"],
      ["COOLING", "냉각"],
      ["RECOVERING", "회복"],
      ["BLOCKLISTED", "차단"],
    ] as const;
    for (const [state, label] of cases) {
      const { unmount } = render(<StatusBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

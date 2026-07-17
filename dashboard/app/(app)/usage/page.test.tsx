import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { usageFixture } from "@/test/fixtures";
import UsagePage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(http.get("*/api/usage", () => HttpResponse.json(usageFixture)));
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("사용량 화면 (integration + MSW)", () => {
  it("미터 타일·차트 컨테이너·문의 CTA를 렌더한다", async () => {
    render(<UsagePage />);

    expect(await screen.findByRole("heading", { name: "사용량" })).toBeInTheDocument();

    // 미터 타일 3종.
    expect(await screen.findByText("이번 달 임대 건수")).toBeInTheDocument();
    expect(screen.getByText("등록 리소스 수")).toBeInTheDocument();
    expect(screen.getByText("최근 30일 임대 건수")).toBeInTheDocument();

    // monthLeaseTotal=1280, windowTotal=1280(400+520+360) → 두 타일에 1,280.
    expect(screen.getAllByText("1,280").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("3")).toBeInTheDocument();

    // 차트 섹션(빈 상태 문구가 아니어야 한다).
    expect(screen.getByRole("heading", { name: /일별 임대/ })).toBeInTheDocument();
    expect(screen.queryByText("아직 임대 기록이 없습니다.")).not.toBeInTheDocument();

    // 문의 CTA — mailto 링크.
    const cta = screen.getByRole("link", { name: "메일로 문의하기" });
    expect(cta).toHaveAttribute("href", "mailto:contact@example.com");
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { eventsFixture } from "@/test/fixtures";
import EventsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  http.get("*/api/events", () => HttpResponse.json(eventsFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("라이브 이벤트 화면 (integration + MSW)", () => {
  it("이벤트 행과 필터 UI를 렌더한다", async () => {
    render(<EventsPage />);

    expect(await screen.findByRole("heading", { name: "라이브 이벤트" })).toBeInTheDocument();

    // 배지·리소스 값은 표 안으로 스코프(같은 라벨이 유형 select 옵션에도 있어 중복 방지).
    const table = await screen.findByRole("table");
    expect(within(table).getByText("임대")).toBeInTheDocument();
    expect(within(table).getByText("냉각 진입")).toBeInTheDocument();
    expect(within(table).getByText("proxy-good")).toBeInTheDocument();
    expect(within(table).getByText("acct-cool")).toBeInTheDocument();

    // 필터 UI: 종류 pill + 유형 select + 검색.
    expect(screen.getByRole("button", { name: "전체 종류" })).toBeInTheDocument();
    expect(screen.getByLabelText("이벤트 유형 필터")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("리소스·컨텍스트 검색")).toBeInTheDocument();
  });

  it("종류 필터(프록시)를 누르면 목록이 좁혀진다", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);
    await screen.findByText("proxy-good");
    expect(screen.getByText("acct-cool")).toBeInTheDocument();

    // 프록시만 → PROXY(proxy-good)만 남고 ACCOUNT(acct-cool)는 사라진다.
    await user.click(screen.getByRole("button", { name: "프록시" }));
    expect(screen.getByText("proxy-good")).toBeInTheDocument();
    expect(screen.queryByText("acct-cool")).not.toBeInTheDocument();
  });

  it("일시정지 토글로 실시간 라벨이 바뀐다", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);
    await screen.findByText("proxy-good");

    const toggle = screen.getByRole("button", { name: "일시정지" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "재개" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("일시정지됨")).toBeInTheDocument();
  });
});

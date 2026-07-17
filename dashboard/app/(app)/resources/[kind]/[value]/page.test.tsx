import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { detailFixture, scoreHistoryFixture, eventsFixture } from "@/test/fixtures";
import ResourceDetailPage from "./page";

// App Router 훅 대체: 경로 파라미터(kind/value)를 고정 주입.
vi.mock("next/navigation", () => ({
  useParams: () => ({ kind: "proxy", value: "proxy-good" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const server = setupServer(
  http.get("*/api/pools/resources/proxy/proxy-good", () => HttpResponse.json(detailFixture)),
  http.get("*/api/pools/resources/proxy/proxy-good/score-history", () =>
    HttpResponse.json(scoreHistoryFixture),
  ),
  http.get("*/api/events", () => HttpResponse.json(eventsFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("리소스 상세 화면 (integration + MSW)", () => {
  it("헤더·평판 곡선·셀 표·감사 타임라인을 렌더한다", async () => {
    render(<ResourceDetailPage />);

    // 헤더: kind 배지 + value(mono h1).
    expect(await screen.findByRole("heading", { name: "proxy-good" })).toBeInTheDocument();
    expect(screen.getByText("PROXY")).toBeInTheDocument();

    // 평판 곡선 섹션(score-history 있으니 빈 상태 문구가 아니어야 한다).
    expect(screen.getByRole("heading", { name: /평판 곡선/ })).toBeInTheDocument();
    expect(screen.queryByText("샘플 아직 없음")).not.toBeInTheDocument();

    // 컨텍스트별 셀 표: us-east(정상)·eu-west(냉각) 두 행 + score 렌더.
    expect(screen.getByRole("heading", { name: "컨텍스트별 셀" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("us-east")).toBeInTheDocument();
    expect(within(table).getByText("eu-west")).toBeInTheDocument();
    expect(within(table).getByText("정상")).toBeInTheDocument();
    expect(within(table).getByText("냉각")).toBeInTheDocument();
    expect(within(table).getByText("42.000")).toBeInTheDocument();
  });

  it("감사 타임라인은 이 리소스(PROXY/proxy-good) 이벤트만 남긴다", async () => {
    render(<ResourceDetailPage />);
    await screen.findByRole("heading", { name: "proxy-good" });

    // eventsFixture 중 proxy-good 건(RESOURCE_LEASED)만 통과, acct-cool 건은 걸러진다.
    expect(await screen.findByText("RESOURCE_LEASED")).toBeInTheDocument();
    expect(screen.queryByText("RESOURCE_COOLED")).not.toBeInTheDocument();
  });
});

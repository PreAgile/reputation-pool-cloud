import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { overviewFixture } from "@/test/fixtures";
import OverviewPage from "./page";

// App Router 훅은 테스트 환경에 없으므로 대체한다(페이지 컴포넌트를 레이아웃 없이 직접 렌더).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  http.get("*/api/pools/resources", () => HttpResponse.json(overviewFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("풀 오버뷰 화면 (integration + MSW)", () => {
  it("KPI와 리소스 행을 렌더하고, 위험한 것부터 정렬한다", async () => {
    render(<OverviewPage />);

    // 제목
    expect(await screen.findByRole("heading", { name: "풀 오버뷰" })).toBeInTheDocument();

    // 데이터가 들어오면 리소스 값이 보인다.
    expect(await screen.findByText("proxy-bad")).toBeInTheDocument();
    expect(screen.getByText("proxy-good")).toBeInTheDocument();
    expect(screen.getByText("acct-cool")).toBeInTheDocument();

    // 상태 배지(BLOCKLISTED → "차단")가 최소 하나 렌더된다.
    expect(screen.getAllByText("차단").length).toBeGreaterThan(0);

    // 심각도 정렬: BLOCKLISTED(proxy-bad)가 HEALTHY(proxy-good)보다 위.
    const rows = screen.getAllByRole("link", { name: /상세 보기/ });
    const texts = rows.map((r) => r.textContent ?? "");
    const badIdx = texts.findIndex((t) => t.includes("proxy-bad"));
    const goodIdx = texts.findIndex((t) => t.includes("proxy-good"));
    expect(badIdx).toBeGreaterThanOrEqual(0);
    expect(badIdx).toBeLessThan(goodIdx);
  });

  it("로딩 중 스켈레톤을 보여주고 데이터 도착 후 감춘다", async () => {
    server.use(
      http.get("*/api/pools/resources", async () => {
        await delay(30);
        return HttpResponse.json(overviewFixture);
      }),
    );
    render(<OverviewPage />);

    // 로딩 라이브 영역(스켈레톤)이 보인다. 아직 리소스 행은 없다.
    expect(screen.getByText("불러오는 중")).toBeInTheDocument();
    expect(screen.queryByText("proxy-bad")).not.toBeInTheDocument();

    // 도착 후 스켈레톤이 사라지고 데이터가 뜬다.
    await screen.findByText("proxy-bad");
    expect(screen.queryByText("불러오는 중")).not.toBeInTheDocument();
  });
});

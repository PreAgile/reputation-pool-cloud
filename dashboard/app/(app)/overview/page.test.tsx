import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { overviewFixture } from "@/test/fixtures";
import { ToastProvider } from "@/components/ui/toast";
import OverviewPage from "./page";

// App Router 훅은 테스트 환경에 없으므로 대체한다(페이지 컴포넌트를 레이아웃 없이 직접 렌더).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const server = setupServer(
  http.get("*/api/pools/resources", () => HttpResponse.json(overviewFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("풀 오버뷰 화면 (integration + MSW)", () => {
  it("KPI와 리소스 행을 렌더하고, 위험한 것부터 정렬한다", async () => {
    render(<OverviewPage />, { wrapper: ToastProvider });

    // 제목
    expect(await screen.findByRole("heading", { name: "풀 오버뷰" })).toBeInTheDocument();

    // 데이터가 들어오면 리소스 값이 보인다.
    expect(await screen.findByText("proxy-bad")).toBeInTheDocument();
    expect(screen.getByText("proxy-good")).toBeInTheDocument();
    expect(screen.getByText("acct-cool")).toBeInTheDocument();

    // 상태 배지(BLOCKLISTED → "Blocked")가 최소 하나 렌더된다.
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);

    // 심각도 정렬: BLOCKLISTED(proxy-bad)가 HEALTHY(proxy-good)보다 위.
    // 값 셀은 상세로 가는 링크(/resources/…)다.
    const resourceLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/resources/"));
    const texts = resourceLinks.map((r) => r.textContent ?? "");
    const badIdx = texts.findIndex((t) => t.includes("proxy-bad"));
    const goodIdx = texts.findIndex((t) => t.includes("proxy-good"));
    expect(badIdx).toBeGreaterThanOrEqual(0);
    expect(badIdx).toBeLessThan(goodIdx);
  });

  it("리소스 값이 상세 페이지로 가는 링크이고, 드로어는 열리지 않는다", async () => {
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    // 값은 곧바로 상세로 가는 링크다(드로어 없음).
    const link = screen.getByRole("link", { name: "proxy-bad" });
    expect(link).toHaveAttribute("href", "/resources/proxy/proxy-bad");

    // 미리보기 드로어(dialog)는 어디에도 없다.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("로딩 중 스켈레톤을 보여주고 데이터 도착 후 감춘다", async () => {
    server.use(
      http.get("*/api/pools/resources", async () => {
        await delay(30);
        return HttpResponse.json(overviewFixture);
      }),
    );
    render(<OverviewPage />, { wrapper: ToastProvider });

    // 로딩 라이브 영역(스켈레톤)이 보인다. 아직 리소스 행은 없다.
    expect(screen.getByText("불러오는 중")).toBeInTheDocument();
    expect(screen.queryByText("proxy-bad")).not.toBeInTheDocument();

    // 도착 후 스켈레톤이 사라지고 데이터가 뜬다.
    await screen.findByText("proxy-bad");
    expect(screen.queryByText("불러오는 중")).not.toBeInTheDocument();
  });

  it("행 오버플로 메뉴에서 영구 차단하면 성공 토스트를 띄운다", async () => {
    server.use(
      http.post(
        "*/api/pools/resources/proxy/proxy-good/block",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-good");

    // 미차단 리소스(proxy-good) 행의 "⋯" 메뉴 → 영구 차단(파괴적).
    await user.click(screen.getByRole("button", { name: "proxy-good 작업 메뉴 열기" }));
    await user.click(await screen.findByRole("menuitem", { name: "영구 차단" }));

    expect(await screen.findByRole("status")).toHaveTextContent("영구 차단했습니다");
  });
});

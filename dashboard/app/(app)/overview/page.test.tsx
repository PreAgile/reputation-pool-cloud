import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { overviewFixture } from "@/test/fixtures";
import { ToastProvider } from "@/components/ui/toast";
import OverviewPage from "./page";

// App Router 훅은 테스트 환경에 없으므로 대체한다(페이지 컴포넌트를 레이아웃 없이 직접 렌더).
//
// push 를 hoisted 스파이로 빼는 이유: 이전에는 `useRouter: () => ({ push: vi.fn() })` 라 훅을 부를 때마다
// **새 함수**가 만들어져 호출을 단정할 수 없었다. 행 클릭이 상세로 가는 것이 이 화면의 확정된 동작인데
// (미리보기 드로어를 두지 않기로 했다) 그 이동을 검증할 방법이 없었다.
const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), prefetch: vi.fn() }),
}));

const server = setupServer(
  http.get("*/api/pools/resources", () => HttpResponse.json(overviewFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  pushSpy.mockClear();
});
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

  // 아래 두 개가 "행 클릭 → 상세 직행" 계약을 고정한다. 드로어를 두지 않기로 한 결정이 곧 이 동작이므로,
  // 이동 자체가 테스트로 박혀 있어야 한다 — 드로어가 조용히 사라졌던 원인이 정확히 이 층위의 테스트
  // 부재였다(컴포넌트 단위 테스트만 있어 화면에서 빠진 것을 아무도 몰랐다).

  it("행을 클릭하면 미리보기 없이 상세 페이지로 이동한다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    // 값 링크나 메뉴가 아닌 행 자체를 누른다("Blocked" 는 KPI 타일에도 있어 텍스트로 찾지 않는다).
    const row = screen.getByRole("link", { name: "proxy-bad" }).closest("tr");
    expect(row).not.toBeNull();
    await user.click(row!);

    expect(pushSpy).toHaveBeenCalledWith("/resources/proxy/proxy-bad");
    // 이동이지 미리보기가 아니다.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("행의 작업 메뉴를 열면 상세로 이동하지 않는다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-good");

    // 메뉴 td 는 stopPropagation 으로 행 클릭과 분리돼 있다 — 이게 깨지면 메뉴를 누를 때마다 화면이 튄다.
    await user.click(screen.getByRole("button", { name: "proxy-good 작업 메뉴 열기" }));
    await screen.findByRole("menuitem", { name: "영구 차단" });

    expect(pushSpy).not.toHaveBeenCalled();
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

  it("score 헤더를 두 번 누르면 내림차순으로 정렬해 높은 score를 위로 올린다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    // score 헤더 클릭 → 오름차순, 다시 클릭 → 내림차순(높은 score 먼저).
    const scoreHeader = screen.getByRole("button", { name: "score 기준 정렬" });
    await user.click(scoreHeader);
    await user.click(scoreHeader);

    const texts = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/resources/"))
      .map((r) => r.textContent ?? "");
    const goodIdx = texts.findIndex((t) => t.includes("proxy-good")); // score 42
    const badIdx = texts.findIndex((t) => t.includes("proxy-bad")); // score -80
    expect(goodIdx).toBeGreaterThanOrEqual(0);
    expect(goodIdx).toBeLessThan(badIdx);
  });

  it("라이브 인디케이터를 일시정지하면 상태 문구와 버튼이 바뀐다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    expect(screen.getByText("실시간")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "일시정지" }));

    expect(screen.getByText("일시정지됨")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재개" })).toBeInTheDocument();
  });
});

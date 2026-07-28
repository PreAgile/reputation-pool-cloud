import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  // 아래 세 개가 #52 P4(quick-drawer)를 페이지 레벨에서 고정한다. drawer.tsx 의 단위 테스트만 있으면
  // 컴포넌트는 멀쩡한데 화면에서 사라져도 CI 가 초록이다 — 실제로 그렇게 한 번 유실됐다(#69 로 들어온
  // 기능이 #72 의 라우트 이전에서 빠졌고, 컴포넌트와 그 단위 테스트만 남아 아무도 눈치채지 못했다).

  it("행을 클릭하면 리스트를 벗어나지 않고 미리보기 드로어를 연다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    // 값 링크가 아니라 행 자체를 클릭한다. "Blocked" 는 KPI 타일에도 있으므로 텍스트로 찾지 않고
    // proxy-bad 링크가 속한 <tr> 을 집어 그 행을 누른다.
    const row = screen.getByRole("link", { name: "proxy-bad" }).closest("tr");
    expect(row).not.toBeNull();
    await user.click(row!);

    const drawer = await screen.findByRole("dialog");
    expect(drawer).toBeInTheDocument();
    // 요약이 드로어 안에 있고, 상세로 가는 길은 명시적 링크로만 열려 있다.
    expect(within(drawer).getByText("최근 판정")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /전체 상세 보기/ })).toHaveAttribute(
      "href",
      "/resources/proxy/proxy-bad",
    );
    // 리스트는 그대로 남아 있다 — 맥락을 잃지 않는 것이 이 패턴의 목적이다.
    expect(screen.getByText("proxy-good")).toBeInTheDocument();
  });

  it("값 셀은 여전히 상세로 가는 링크이고, 그 클릭은 드로어를 열지 않는다", async () => {
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-bad");

    // 키보드·중간클릭·새 탭을 위해 값 셀은 실제 링크로 남아 있어야 한다.
    const link = screen.getByRole("link", { name: "proxy-bad" });
    expect(link).toHaveAttribute("href", "/resources/proxy/proxy-bad");

    // 아직 아무 행도 클릭하지 않았으므로 드로어는 닫힌 상태다.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("오버플로 메뉴를 열어도 드로어가 같이 열리지는 않는다", async () => {
    const user = userEvent.setup();
    render(<OverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("proxy-good");

    // 메뉴 td 는 stopPropagation 으로 행 클릭과 분리돼 있다.
    await user.click(screen.getByRole("button", { name: "proxy-good 작업 메뉴 열기" }));
    await screen.findByRole("menuitem", { name: "영구 차단" });

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

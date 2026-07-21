import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { detailFixture, scoreHistoryFixture, eventsFixture } from "@/test/fixtures";
import { ToastProvider } from "@/components/ui/toast";
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
  it("헤더·탭(곡선/셀/타임라인)을 렌더하고, 셀 탭에서 표를 보여준다", async () => {
    const user = userEvent.setup();
    render(<ResourceDetailPage />, { wrapper: ToastProvider });

    // 헤더: kind 배지 + value(mono h1). (PROXY 는 브레드크럼·헤더 배지 둘 다에 나오므로 존재만 확인)
    expect(await screen.findByRole("heading", { name: "proxy-good" })).toBeInTheDocument();
    expect(screen.getAllByText("PROXY").length).toBeGreaterThanOrEqual(1);

    // 탭 3종 + 기본 활성은 평판 곡선(score-history 있으니 빈 상태 문구가 아니어야 한다).
    expect(screen.getByRole("tablist", { name: "리소스 상세 보기" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "평판 곡선" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: /평판 곡선/ })).toBeInTheDocument();
    expect(screen.queryByText("샘플 아직 없음")).not.toBeInTheDocument();

    // 셀 탭으로 전환하면 us-east(정상)·eu-west(냉각) 두 행 + score 가 나온다.
    await user.click(screen.getByRole("tab", { name: "컨텍스트별 셀" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("us-east")).toBeInTheDocument();
    expect(within(table).getByText("eu-west")).toBeInTheDocument();
    expect(within(table).getByText("정상")).toBeInTheDocument();
    expect(within(table).getByText("냉각")).toBeInTheDocument();
    expect(within(table).getByText("42.000")).toBeInTheDocument();
  });

  it("감사 타임라인 탭은 이 리소스(PROXY/proxy-good) 이벤트만 남긴다", async () => {
    const user = userEvent.setup();
    render(<ResourceDetailPage />, { wrapper: ToastProvider });
    await screen.findByRole("heading", { name: "proxy-good" });

    await user.click(screen.getByRole("tab", { name: "감사 타임라인" }));

    // eventsFixture 중 proxy-good 건(RESOURCE_LEASED)만 통과, acct-cool 건은 걸러진다.
    expect(await screen.findByText("RESOURCE_LEASED")).toBeInTheDocument();
    expect(screen.queryByText("RESOURCE_COOLED")).not.toBeInTheDocument();
  });

  it("상단에 브레드크럼(풀 오버뷰 / PROXY / proxy-good)을 렌더한다", async () => {
    render(<ResourceDetailPage />, { wrapper: ToastProvider });
    await screen.findByRole("heading", { name: "proxy-good" });

    const nav = screen.getByRole("navigation", { name: "위치 경로" });
    expect(within(nav).getByRole("link", { name: "풀 오버뷰" })).toHaveAttribute("href", "/overview");
    expect(within(nav).getByText("PROXY")).toBeInTheDocument();
    expect(within(nav).getByText("proxy-good")).toHaveAttribute("aria-current", "page");
  });

  it("로딩 중 스켈레톤을 보여주고 상세 도착 후 감춘다", async () => {
    server.use(
      http.get("*/api/pools/resources/proxy/proxy-good", async () => {
        await delay(30);
        return HttpResponse.json(detailFixture);
      }),
    );
    render(<ResourceDetailPage />, { wrapper: ToastProvider });

    // 로딩 라이브 영역이 보인다(스켈레톤). h1 은 아직 없다.
    expect(screen.getByText("불러오는 중")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "proxy-good" })).not.toBeInTheDocument();

    // 도착 후 스켈레톤이 사라지고 헤더가 뜬다.
    await screen.findByRole("heading", { name: "proxy-good" });
    expect(screen.queryByText("불러오는 중")).not.toBeInTheDocument();
  });

  it("영구 차단 성공 시 성공 토스트를 띄운다", async () => {
    server.use(
      http.post(
        "*/api/pools/resources/proxy/proxy-good/block",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const user = userEvent.setup();
    render(<ResourceDetailPage />, { wrapper: ToastProvider });
    await screen.findByRole("heading", { name: "proxy-good" });

    await user.click(screen.getByRole("button", { name: "영구 차단" }));
    expect(await screen.findByRole("status")).toHaveTextContent("영구 차단했습니다");
  });

  it("차단 요청 실패 시 오류 토스트를 띄운다", async () => {
    server.use(
      http.post(
        "*/api/pools/resources/proxy/proxy-good/block",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render(<ResourceDetailPage />, { wrapper: ToastProvider });
    await screen.findByRole("heading", { name: "proxy-good" });

    await user.click(screen.getByRole("button", { name: "1시간 차단" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("요청 실패");
  });
});

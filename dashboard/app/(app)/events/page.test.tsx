import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { eventsFixture } from "@/test/fixtures";
import type { AuditEventPage } from "@/lib/types";
import EventsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  http.get("*/api/events", () => HttpResponse.json(eventsFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** 최신 페이지(커서 있음) + 과거 페이지(커서 없음, 마지막) 2단 페이지네이션 핸들러. */
function paginate() {
  const page1: AuditEventPage = {
    events: [
      {
        seq: 5,
        eventType: "RESOURCE_LEASED",
        resourceKind: "PROXY",
        resourceValue: "proxy-live",
        context: "us-east",
        occurredAt: "2026-07-18T08:33:00Z",
        until: null,
        cause: null,
      },
    ],
    nextCursor: "Y3Vyc29yLTQ", // 불투명 커서(내용 무관)
  };
  const page2 = eventsFixture; // seq 3,2 · nextCursor null (마지막)
  server.use(
    http.get("*/api/events", ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json(url.searchParams.get("cursor") ? page2 : page1);
    }),
  );
}

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

  it("nextCursor 가 없으면 '더 보기' 버튼이 없다", async () => {
    render(<EventsPage />);
    await screen.findByText("proxy-good");
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });

  it("'더 보기'로 과거를 이어 append 하고, 폴링을 멈추며 '라이브로'를 노출한다", async () => {
    const user = userEvent.setup();
    paginate();
    render(<EventsPage />);

    // 최신 페이지: proxy-live 만 보이고 과거(acct-cool)는 아직 없다.
    await screen.findByText("proxy-live");
    expect(screen.queryByText("acct-cool")).not.toBeInTheDocument();

    // 더 보기 → 과거 페이지 append(dedup, seq 정렬 유지) + 폴링 정지 표시.
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByText("acct-cool")).toBeInTheDocument();
    expect(screen.getByText("proxy-live")).toBeInTheDocument(); // 기존 항목 유지
    expect(screen.getByText("과거 보기 · 실시간 정지")).toBeInTheDocument();

    // 마지막 페이지(nextCursor=null)라 더 보기 사라지고 안내 문구 노출.
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
    expect(screen.getByText("더 이상 과거 이벤트가 없습니다.")).toBeInTheDocument();
  });

  it("'라이브로'를 누르면 최신으로 초기화하고 실시간 상태로 돌아온다", async () => {
    const user = userEvent.setup();
    paginate();
    render(<EventsPage />);

    await screen.findByText("proxy-live");
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await screen.findByText("acct-cool");

    // 라이브로 → 최신 페이지로 재조회, 과거 항목 사라지고 실시간 라벨 복귀.
    await user.click(screen.getByRole("button", { name: "라이브로" }));
    await screen.findByText(/실시간 ·/);
    expect(screen.queryByText("acct-cool")).not.toBeInTheDocument();
    expect(screen.getByText("proxy-live")).toBeInTheDocument();
  });

  // 회귀 방지(#73 리뷰): 더 보기 전환 시점에 이미 날아간 폴링 loadLatest 응답이
  // 늦게 도착해 과거 목록/커서를 최신 페이지로 되돌리면 안 된다(요청 세대 가드).
  it("더 보기 도중 늦게 도착한 폴링 응답이 과거 목록을 덮어쓰지 않는다", async () => {
    const user = userEvent.setup();
    const page1: AuditEventPage = {
      events: [
        {
          seq: 5,
          eventType: "RESOURCE_LEASED",
          resourceKind: "PROXY",
          resourceValue: "proxy-live",
          context: "us-east",
          occurredAt: "2026-07-18T08:33:00Z",
          until: null,
          cause: null,
        },
      ],
      nextCursor: "Y3Vyc29yLTQ",
    };
    let latestCalls = 0;
    let releaseStalePoll!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStalePoll = resolve;
    });
    server.use(
      http.get("*/api/events", async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("cursor")) {
          return HttpResponse.json(eventsFixture); // 더 보기 → 과거(acct-cool), 즉시
        }
        latestCalls += 1;
        if (latestCalls >= 2) await staleGate; // 2번째(폴링) 최신 응답은 풀어줄 때까지 매달림
        return HttpResponse.json(page1);
      }),
    );

    render(<EventsPage />);
    await screen.findByText("proxy-live"); // 최초 로드 완료(latestCalls=1)

    // usePoll의 visibilitychange tick으로 폴링 loadLatest를 즉시 한 번 발화 → in-flight(매달림).
    fireEvent(document, new Event("visibilitychange")); // latestCalls=2, 게이트에서 대기
    await Promise.resolve();

    // 폴링 응답 도착 전에 더 보기 → 과거 append + 과거 보기 전환.
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await screen.findByText("acct-cool");
    expect(screen.getByText("과거 보기 · 실시간 정지")).toBeInTheDocument();

    // 매달렸던 폴링 응답을 이제 풀어준다 — 가드가 없으면 목록을 최신으로 되돌렸을 것.
    releaseStalePoll();
    await new Promise((resolve) => setTimeout(resolve, 50)); // 늦은 응답이 반영을 시도할 틈

    // 과거 항목이 그대로 유지되고 과거 보기 라벨도 유지되어야 한다.
    expect(screen.getByText("acct-cool")).toBeInTheDocument();
    expect(screen.getByText("proxy-live")).toBeInTheDocument();
    expect(screen.getByText("과거 보기 · 실시간 정지")).toBeInTheDocument();
  });
});

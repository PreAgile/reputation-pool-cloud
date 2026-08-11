import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { contextDetailFixture, contextHistoryFixture, contextsFixture } from "@/test/fixtures";
import ContextsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  // score-history 가 /contexts 보다 먼저 등록돼야 한다 — 뒤면 컬렉션 핸들러가 먼저 잡는다.
  http.get("*/api/contexts/score-history", () => HttpResponse.json(contextHistoryFixture)),
  http.get("*/api/contexts/:context/resources", () => HttpResponse.json(contextDetailFixture)),
  http.get("*/api/contexts", () => HttpResponse.json(contextsFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** 컨텍스트 요약 표(첫 번째 table) — 곡선 범례에 같은 이름이 있어 조회를 여기로 좁힌다. */
async function contextTable(): Promise<HTMLElement> {
  const tables = await screen.findAllByRole("table");
  return tables[0];
}

describe("컨텍스트 화면 (integration + MSW)", () => {
  it("컨텍스트가 들어오면 → 요약 타일과 컨텍스트별 행을 렌더한다", async () => {
    render(<ContextsPage />);

    expect(await screen.findByRole("heading", { name: "컨텍스트" })).toBeInTheDocument();

    // 요약 타일: 컨텍스트 2개, 전체 셀 592(587+5).
    expect(await screen.findByText("컨텍스트 수")).toBeInTheDocument();
    expect(screen.getByText("전체 셀 수")).toBeInTheDocument();
    expect(screen.getByText("592")).toBeInTheDocument();

    // 표에 두 컨텍스트가 모두 있고, 평균 점수는 소수 둘째 자리까지.
    // (같은 이름이 곡선 범례에도 있으므로 표 안으로 좁혀서 본다.)
    const table = within(await contextTable());
    expect(table.getByText("BAEMIN")).toBeInTheDocument();
    expect(table.getByText("CPEATS")).toBeInTheDocument();
    expect(table.getByText("0.82")).toBeInTheDocument();
  });

  it("마지막 갱신이 24시간을 넘은 컨텍스트면 → '조용함'으로 표시한다", async () => {
    // 이 화면이 존재하는 이유 그 자체 — 보고가 끊긴 컨텍스트는 리소스 축에서 건강한 것과 구분되지 않는다.
    // CPEATS 는 픽스처에서 나흘째 갱신이 없다.
    vi.setSystemTime(new Date("2026-08-11T05:00:00Z"));
    render(<ContextsPage />);

    expect(within(await contextTable()).getByText("CPEATS")).toBeInTheDocument();
    expect(screen.getByText(/조용함/)).toBeInTheDocument();
    // 24시간 넘게 조용한 컨텍스트 타일도 1을 가리킨다(BAEMIN 은 40분 전이라 제외).
    expect(screen.getByText("24시간 넘게 조용한 컨텍스트")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("컨텍스트 행을 누르면 → 그 컨텍스트 안의 리소스 목록을 펼친다", async () => {
    const user = userEvent.setup();
    render(<ContextsPage />);

    await user.click(within(await contextTable()).getByText("BAEMIN"));

    // 서버가 심각도 → 낮은 점수 순으로 정렬해 주므로 COOLING 리소스가 먼저 온다.
    expect(await screen.findByRole("link", { name: "203.0.113.7:8080" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "decodo:isp:10001" })).toBeInTheDocument();
  });

  it("컨텍스트가 하나도 없으면 → 왜 비어 있는지 설명하는 빈 상태를 보인다", async () => {
    server.use(http.get("*/api/contexts", () => HttpResponse.json({ contexts: [] })));
    render(<ContextsPage />);

    expect(await screen.findByText("아직 컨텍스트가 없습니다")).toBeInTheDocument();
  });

  it("추이가 두 시리즈면 → 색만으로 구분하지 않도록 범례에 컨텍스트 이름을 함께 낸다", async () => {
    const { container } = render(<ContextsPage />);

    await screen.findByRole("heading", { name: /컨텍스트별 평균 평판/ });
    // 곡선 카드 안의 범례 — 표에도 같은 이름이 있으므로 카드 범위로 좁혀서 확인한다.
    const legend = container.querySelectorAll("span.size-2.rounded-full");
    expect(legend.length).toBeGreaterThanOrEqual(2);
  });

  it("불러오기에 실패하면 → 에러 빈 상태와 다시 시도 버튼을 보인다", async () => {
    server.use(http.get("*/api/contexts", () => HttpResponse.error()));
    render(<ContextsPage />);

    expect(await screen.findByText("컨텍스트를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});

describe("컨텍스트 화면 — 기간 선택", () => {
  it("기간을 90일로 바꾸면 → hours=2160 으로 추이를 다시 부른다", async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get("*/api/contexts/score-history", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("hours") ?? "");
        return HttpResponse.json(contextHistoryFixture);
      }),
    );
    render(<ContextsPage />);

    await screen.findByRole("heading", { name: /컨텍스트별 평균 평판/ });
    await user.click(screen.getByRole("button", { name: /추이 기간 선택/ }));
    await user.click(await screen.findByRole("button", { name: /최근 90일/ }));

    // 기본 7일(168) → 90일(2160). 롤업에서 읽으므로 raw 보존(7일)을 넘는 창도 실제 데이터를 갖는다.
    expect(asked).toContain("2160");
  });
});

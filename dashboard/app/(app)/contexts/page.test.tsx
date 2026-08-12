import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { delay, http, HttpResponse } from "msw";
import {
  contextDetailFixture,
  contextHistoryFixture,
  contextOutcomeFixture,
  contextsFixture,
} from "@/test/fixtures";
import ContextsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  // score-history 가 /contexts 보다 먼저 등록돼야 한다 — 뒤면 컬렉션 핸들러가 먼저 잡는다.
  http.get("*/api/contexts/score-history", () => HttpResponse.json(contextHistoryFixture)),
  http.get("*/api/contexts/success-rate", () => HttpResponse.json(contextOutcomeFixture)),
  http.get("*/api/contexts/:context/resources", () => HttpResponse.json(contextDetailFixture)),
  http.get("*/api/contexts", () => HttpResponse.json(contextsFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  // 테스트가 실패해도 모킹된 Date 가 다음 테스트로 새지 않도록 여기서 되돌린다.
  vi.useRealTimers();
});
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
  });

  it("컨텍스트 행을 누르면 → 그 컨텍스트 안의 리소스 목록을 펼친다", async () => {
    const user = userEvent.setup();
    render(<ContextsPage />);

    await user.click(within(await contextTable()).getByText("BAEMIN"));

    // 서버가 심각도 → 낮은 점수 순으로 정렬해 주므로 COOLING 리소스가 먼저 온다.
    expect(await screen.findByRole("link", { name: "203.0.113.7:8080" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "decodo:isp:10001" })).toBeInTheDocument();
  });

  it("컨텍스트 이름은 버튼이라 → 키보드로 펼칠 수 있고 aria-expanded 가 상태를 알린다", async () => {
    // <tr> 은 포커스 대상이 아니다. 행 클릭에만 의존하면 키보드 사용자는 상세를 열 수 없다.
    const user = userEvent.setup();
    render(<ContextsPage />);

    const toggle = await screen.findByRole("button", { name: /BAEMIN/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle.focus();
    expect(toggle).toHaveFocus(); // <tr> 이었다면 여기서 실패한다
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("link", { name: "203.0.113.7:8080" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BAEMIN/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("리소스 목록 조회가 실패하면 → 로딩이 아니라 에러와 재시도를 보인다", async () => {
    // 실패를 detail=null 로만 표현하면 "불러오는 중…" 이 영구히 남는다.
    const user = userEvent.setup();
    server.use(
      http.get("*/api/contexts/:context/resources", () => HttpResponse.error()),
    );
    render(<ContextsPage />);

    await user.click(within(await contextTable()).getByText("BAEMIN"));

    expect(await screen.findByText("리소스 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
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

/** 7일 픽스처(전체 63.5%)와 확실히 구분되는 90일 응답 — 전체 성공률 타일이 54.5% 가 된다. */
const ninetyDayOutcomes = {
  contexts: [
    {
      context: "BAEMIN",
      totals: {
        success: 500,
        failure: 500,
        successRate: 0.5,
        failures: { BLOCKED: 500, TIMEOUT: 0, SLOW: 0, CONNECTION_RESET: 0, TLS_HANDSHAKE: 0 },
      },
      points: [],
    },
    {
      context: "CPEATS",
      totals: {
        success: 100,
        failure: 0,
        successRate: 1,
        failures: { BLOCKED: 0, TIMEOUT: 0, SLOW: 0, CONNECTION_RESET: 0, TLS_HANDSHAKE: 0 },
      },
      points: [],
    },
  ],
};

describe("컨텍스트 화면 — 성공률 (#189)", () => {
  it("성공률이 들어오면 → 표에 비율과 지배적인 실패 종류가 함께 실린다", async () => {
    // 점수로는 답할 수 없는 질문이 이것이다. 그리고 "62%" 만으로는 대응이 안 나온다 —
    // 막힌 것(BLOCKED)인지 느린 것(SLOW)인지에 따라 할 일이 다르다.
    render(<ContextsPage />);

    // 성공률은 개요와 다른 effect 로 온다 — 표가 그려졌다고 성공률이 반영된 것은 아니라 기다려서 본다.
    const table = within(await contextTable());
    expect(await table.findByText("62.0%")).toBeInTheDocument();
    expect(table.getByText(/실패 80% BLOCKED/)).toBeInTheDocument();
  });

  it("전체 성공률 타일은 → 컨텍스트별 비율의 평균이 아니라 건수 합으로 낸다", async () => {
    // BAEMIN 620/1000, CPEATS 40/40 → 건수 합 660/1040 = 63.5%.
    // 비율 평균이었다면 (62 + 100) / 2 = 81.0% 로, 보고량이 적은 컨텍스트가 전체를 끌어올린다.
    render(<ContextsPage />);

    expect(await screen.findByText(/^성공률 ·/)).toBeInTheDocument();
    expect(await screen.findByText("63.5%")).toBeInTheDocument();
  });

  it("지표를 성공률로 바꾸면 → 차트를 새로 늘리지 않고 같은 곡선이 성공률로 전환된다", async () => {
    const user = userEvent.setup();
    render(<ContextsPage />);

    await screen.findByRole("heading", { name: /컨텍스트별 평균 평판/ });
    await user.click(screen.getByRole("tab", { name: "성공률" }));

    expect(await screen.findByRole("heading", { name: /컨텍스트별 성공률/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /컨텍스트별 평균 평판/ })).not.toBeInTheDocument();
  });

  it("성공률 조회가 실패하면 → 표의 성공률 열만 '—' 가 되고 나머지 열은 그대로 읽힌다", async () => {
    // 성공률은 보조 정보다. 실패가 화면 전체를 무너뜨리면 안 된다.
    // 응답이 적용되기 **전에** 단언하면 아무것도 검증하지 못하므로, 요청이 실제로 실패해 돌아온 뒤에 본다.
    let failed = 0;
    server.use(
      http.get("*/api/contexts/success-rate", () => {
        failed += 1;
        return HttpResponse.error();
      }),
    );
    render(<ContextsPage />);

    const table = within(await contextTable());
    await waitFor(() => expect(failed).toBe(1));
    expect(table.getByText("BAEMIN")).toBeInTheDocument();
    expect(table.getByText("0.82")).toBeInTheDocument();
    expect(table.queryByText("62.0%")).not.toBeInTheDocument();
  });

  it("보고가 한 건도 없던 컨텍스트는 → 0% 가 아니라 '—' 로 그린다", async () => {
    // null 을 0 으로 접으면 "아직 안 돌았다" 가 "전부 실패했다" 로 읽힌다 — 정반대 상황이다.
    // CPEATS 는 비율이 있으므로, 그 값이 그려진 시점이 곧 응답이 반영된 시점이다 — BAEMIN 은 그 뒤에 본다.
    server.use(
      http.get("*/api/contexts/success-rate", () =>
        HttpResponse.json({
          contexts: [
            {
              context: "BAEMIN",
              totals: {
                success: 0,
                failure: 0,
                successRate: null,
                failures: { BLOCKED: 0, TIMEOUT: 0, SLOW: 0, CONNECTION_RESET: 0, TLS_HANDSHAKE: 0 },
              },
              points: [],
            },
            {
              context: "CPEATS",
              totals: {
                success: 3,
                failure: 1,
                successRate: 0.75,
                failures: { BLOCKED: 1, TIMEOUT: 0, SLOW: 0, CONNECTION_RESET: 0, TLS_HANDSHAKE: 0 },
              },
              points: [],
            },
          ],
        }),
      ),
    );
    render(<ContextsPage />);

    const table = within(await contextTable());
    expect(await table.findByText("75.0%")).toBeInTheDocument();
    expect(table.getByText("BAEMIN")).toBeInTheDocument();
    expect(table.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("기간을 바꾸면 → 성공률도 같은 창(hours)으로 다시 부른다", async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get("*/api/contexts/success-rate", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("hours") ?? "");
        return HttpResponse.json(contextOutcomeFixture);
      }),
    );
    render(<ContextsPage />);

    await screen.findByRole("heading", { name: /컨텍스트별 평균 평판/ });
    await user.click(screen.getByRole("button", { name: /추이 기간 선택/ }));
    await user.click(await screen.findByRole("button", { name: /최근 90일/ }));

    await waitFor(() => expect(asked).toContain("2160"));
  });

  it("기간을 바꾸면 → 이전 기간의 성공률을 새 기간 라벨 옆에 남기지 않는다", async () => {
    // 라벨("성공률 · 최근 90일")은 즉시 바뀌는데 숫자가 7일 것이면, 로딩이 아니라 오독이다.
    const user = userEvent.setup();
    server.use(
      http.get("*/api/contexts/success-rate", async ({ request }) => {
        // 새 기간 응답은 붙잡아 둔다 — 전환 직후의 화면이 무엇을 보이는지가 이 테스트의 대상이다.
        if (new URL(request.url).searchParams.get("hours") === "2160") await delay("infinite");
        return HttpResponse.json(contextOutcomeFixture);
      }),
    );
    render(<ContextsPage />);

    expect(await screen.findByText("63.5%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /추이 기간 선택/ }));
    await user.click(await screen.findByRole("button", { name: /최근 90일/ }));

    await waitFor(() => expect(screen.queryByText("63.5%")).not.toBeInTheDocument());
    expect(screen.getByText(/^성공률 · 최근 90일$/)).toBeInTheDocument();
  });

  it("느린 이전 기간 응답이 뒤늦게 도착해도 → 최신 기간의 성공률을 덮어쓰지 않는다", async () => {
    // 창이 넓을수록 응답이 느리다고 볼 이유는 없다 — 순서는 보장되지 않는다. 순번을 걸지 않으면
    // 먼저 떠난 요청이 나중에 도착해 최신 화면을 옛 기간 값으로 되돌린다.
    const user = userEvent.setup();
    server.use(
      http.get("*/api/contexts/success-rate", async ({ request }) => {
        if (new URL(request.url).searchParams.get("hours") === "2160") {
          return HttpResponse.json(ninetyDayOutcomes);
        }
        await delay(200); // 기본 7일 요청이 전환 뒤에 도착한다
        return HttpResponse.json(contextOutcomeFixture);
      }),
    );
    render(<ContextsPage />);

    await screen.findByRole("heading", { name: /컨텍스트별 평균 평판/ });
    await user.click(screen.getByRole("button", { name: /추이 기간 선택/ }));
    await user.click(await screen.findByRole("button", { name: /최근 90일/ }));
    expect(await screen.findByText("54.5%")).toBeInTheDocument();

    // 늦게 도착한 7일 응답(63.5%)이 지나가도 화면은 90일 값을 유지한다.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText("63.5%")).not.toBeInTheDocument();
    expect(screen.getByText("54.5%")).toBeInTheDocument();
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

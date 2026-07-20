import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { overviewFixture } from "@/test/fixtures";
import { CommandPalette } from "./command-palette";
import { seriousViolations } from "@/test/a11y";

// App Router 훅 대체 — router.push 스파이를 hoisted 로 공유해 이동 단언에 쓴다.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const server = setupServer(
  http.get("*/api/pools/resources", () => HttpResponse.json(overviewFixture)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  push.mockClear();
});
afterAll(() => server.close());

/** open 상태를 자체 관리하는 하니스(컴포넌트는 controlled 라 부모가 열림을 쥔다). */
function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

describe("커맨드 팔레트 (⌘K)", () => {
  it("⌘K 로 열린다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByPlaceholderText(/리소스 값 검색/)).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByPlaceholderText(/리소스 값 검색/)).toBeInTheDocument();
  });

  it("Ctrl+K 로도 열린다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByPlaceholderText(/리소스 값 검색/)).toBeInTheDocument();
  });

  it("화면 이동 항목을 렌더하고 입력으로 필터한다", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);

    // 6개 화면 이동 항목이 보인다.
    expect(await screen.findByRole("option", { name: /풀 오버뷰/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /사용량/ })).toBeInTheDocument();

    // "이벤트" 입력 시 라이브 이벤트만 남고 나머지는 걸러진다.
    await user.type(screen.getByPlaceholderText(/리소스 값 검색/), "이벤트");
    expect(screen.getByRole("option", { name: /라이브 이벤트/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /사용량/ })).not.toBeInTheDocument();
  });

  it("↓ 로 항목을 옮기고 ↵ 로 해당 화면으로 이동한다", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    await screen.findByRole("option", { name: /풀 오버뷰/ });

    // 기본 선택은 첫 항목(풀 오버뷰). ↓ 한 번이면 라이브 이벤트가 선택된다.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/events");
  });

  it("입력 후 ↵ 로 필터된 화면으로 이동한다", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    await user.type(await screen.findByPlaceholderText(/리소스 값 검색/), "사용량");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/usage");
  });

  it("리소스 값으로 검색하면 상세로 점프한다", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    // MSW 로드 후 리소스 항목이 나타난다.
    await screen.findByRole("option", { name: /proxy-good/ });

    await user.type(screen.getByPlaceholderText(/리소스 값 검색/), "proxy-good");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/resources/proxy/proxy-good");
  });

  it("Esc 로 닫힌다", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    expect(await screen.findByPlaceholderText(/리소스 값 검색/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText(/리소스 값 검색/)).not.toBeInTheDocument();
  });

  it("a11y: 열린 상태에서 critical/serious 위반이 없다", async () => {
    render(<Harness initialOpen />);
    await screen.findByRole("option", { name: /proxy-good/ });
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

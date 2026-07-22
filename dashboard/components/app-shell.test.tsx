import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import { seriousViolations } from "@/test/a11y";

// 라우팅/인증/테마 훅 대체 — AppShell 은 usePathname, 내부 UserMenu·CommandPalette 는 나머지 훅을 쓴다.
vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

/** HealthPill 의 fetch("/actuator/health") 를 기본 UP 로 스텁(실네트워크 차단). 개별 테스트가 재정의. */
function stubHealth(status: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status }) })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  stubHealth("UP");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderShell() {
  return render(
    <AppShell>
      <p>본문</p>
    </AppShell>,
  );
}

describe("AppShell — 사이드바 접힘", () => {
  it("기본은 펼침이고 5개 내비 링크와 라벨을 보인다", () => {
    renderShell();
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).getByRole("link", { name: "풀 오버뷰" })).toBeInTheDocument();
    // 접기 토글은 펼침(aria-expanded=true) 상태.
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("토글로 접고 펼치며 localStorage 에 상태를 저장한다", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(window.localStorage.getItem("rp_sidebar_collapsed")).toBe("1");
    const expand = screen.getByRole("button", { name: "사이드바 펼치기" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(window.localStorage.getItem("rp_sidebar_collapsed")).toBe("0");
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("localStorage 에 접힘이 저장돼 있으면 접힌 채로 복원한다", () => {
    window.localStorage.setItem("rp_sidebar_collapsed", "1");
    renderShell();
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("접힌 상태에서 내비 항목에 포커스하면 툴팁으로 라벨을 노출한다", async () => {
    window.localStorage.setItem("rp_sidebar_collapsed", "1");
    const user = userEvent.setup();
    renderShell();

    await user.tab(); // 첫 포커스 가능 요소(첫 내비 링크)
    // Radix Tooltip 은 키보드 포커스 시 라벨을 role=tooltip 으로 노출한다.
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("풀 오버뷰");
  });
});

describe("AppShell — 상단바", () => {
  it("검색 버튼을 누르면 커맨드 팔레트가 열린다", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByPlaceholderText(/리소스 값 검색/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "명령 팔레트 열기" }));
    expect(await screen.findByPlaceholderText(/리소스 값 검색/)).toBeInTheDocument();
  });

  it("상단바에 유저 메뉴 트리거가 있다", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "계정 메뉴 열기" })).toBeInTheDocument();
  });

  it("a11y: 펼침 상태에서 critical/serious 위반이 없다", async () => {
    renderShell();
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

describe("AppShell — 시스템 상태 pill", () => {
  it("헬스가 UP 이면 정상 상태를 보인다", async () => {
    renderShell();
    expect(await screen.findByText("시스템 정상")).toBeInTheDocument();
  });

  it("헬스가 UP 이 아니면 이상 상태를 보인다", async () => {
    stubHealth("DOWN");
    renderShell();
    expect(await screen.findByText("시스템 이상")).toBeInTheDocument();
  });

  it("헬스 조회에 실패하면 확인 불가 상태를 보인다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));
    renderShell();
    expect(await screen.findByText("상태 확인 불가")).toBeInTheDocument();
  });
});

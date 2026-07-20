import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./user-menu";
import { seriousViolations } from "@/test/a11y";

// 인증·테마 훅을 스파이로 대체 — 실제 로그아웃(window.location 이동)·테마 저장을 피하고 호출만 검증.
const { logout, setTheme } = vi.hoisted(() => ({ logout: vi.fn(), setTheme: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme }) }));

afterEach(() => {
  logout.mockClear();
  setTheme.mockClear();
});

describe("유저 메뉴 (상단바 드롭다운)", () => {
  it("트리거 클릭으로 테마·로그아웃 항목을 연다", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "계정 메뉴 열기" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /다크 모드/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();
  });

  it("로그아웃 항목이 logout 을 호출한다", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    await user.click(screen.getByRole("button", { name: "계정 메뉴 열기" }));
    await user.click(await screen.findByRole("menuitem", { name: "로그아웃" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("테마 항목이 setTheme 를 호출하고 메뉴를 닫지 않는다", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    await user.click(screen.getByRole("button", { name: "계정 메뉴 열기" }));
    await user.click(await screen.findByRole("menuitem", { name: /다크 모드/ }));

    // 현재 라이트 → 다크로 전환 요청.
    expect(setTheme).toHaveBeenCalledWith("dark");
    // preventDefault 로 메뉴는 열린 채 유지된다(연속 전환 편의).
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("a11y: 메뉴가 열린 상태에서 critical/serious 위반이 없다", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "계정 메뉴 열기" }));
    await screen.findByRole("menu");
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

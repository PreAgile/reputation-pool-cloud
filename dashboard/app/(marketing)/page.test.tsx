import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import MarketingPage from "./page";

// next-themes 훅(ThemeToggle)만 대체. 랜딩은 라우팅 훅을 쓰지 않는다(Link 만 사용).
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

describe("랜딩 페이지 (#16)", () => {
  it("헤드라인·서브카피·핵심 섹션 제목을 렌더한다", () => {
    render(<MarketingPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: /The reputation API for proxy & account pools\./ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stop hand-rolling cooldowns/)).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /Reputation, cooling, and isolation — solved\./ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Built for real automation infrastructure\./ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Three calls\. The engine does the rest\./ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Up and running in five minutes\./ })).toBeInTheDocument();
  });

  it("주요 CTA — Get started(#contact) · Read the docs(#docs) 를 제공한다", () => {
    render(<MarketingPage />);

    // "Get started" 는 nav·hero 여러 곳 → 모두 #contact 로 스크롤.
    const starts = screen.getAllByRole("link", { name: "Get started" });
    expect(starts.length).toBeGreaterThan(0);
    starts.forEach((a) => expect(a).toHaveAttribute("href", "#contact"));

    expect(screen.getByRole("link", { name: "Read the docs" })).toHaveAttribute("href", "#docs");
  });

  it("결제 없음 — Email us CTA 가 mailto(digle117@gmail.com) 로 연결된다", () => {
    render(<MarketingPage />);

    const email = screen.getByRole("link", { name: "Email us" });
    const href = email.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:digle117@gmail.com")).toBe(true);
    expect(href).toContain("subject=reputation-pool%20access");

    // 프라이싱 섹션은 이 슬라이스의 스코프가 아니다.
    expect(screen.queryByRole("heading", { name: /pricing/i })).not.toBeInTheDocument();
  });

  it("히어로 코드 스니펫과 기능행 실제 스크린샷을 노출한다", () => {
    render(<MarketingPage />);

    expect(screen.getAllByText(/acquire/).length).toBeGreaterThan(0);
    // 3개 기능행 스크린샷이 실제 캡처 <img> 로 들어간다.
    const overview = screen.getByRole("img", { name: /pool overview/i });
    expect(overview).toHaveAttribute("src", "/marketing/overview-dark.png");
    expect(screen.getByRole("img", { name: /per-context reputation curve/i })).toHaveAttribute(
      "src",
      "/marketing/detail-dark.png",
    );
    expect(screen.getByRole("img", { name: /live event stream/i })).toHaveAttribute(
      "src",
      "/marketing/events-dark.png",
    );
  });

  it("GitHub 링크가 공개 엔진 레포를 가리킨다", () => {
    render(<MarketingPage />);
    const gh = screen.getAllByRole("link", { name: /GitHub/ });
    expect(gh.some((a) => a.getAttribute("href") === "https://github.com/PreAgile/reputation-pool")).toBe(true);
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<MarketingPage />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

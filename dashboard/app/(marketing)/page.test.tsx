import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import MarketingPage, { metadata } from "./page";

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
      screen.getByRole("heading", { name: /Bad resources step aside — you just use the healthy ones\./ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Built for real automation infrastructure\./ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Three calls\. The engine does the rest\./ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Up and running in five minutes\./ })).toBeInTheDocument();
  });

  it("주요 CTA — Get started(/#contact) · Read the docs(/#docs) 를 제공한다", () => {
    render(<MarketingPage />);

    // "Get started" 는 nav·hero 여러 곳 → 모두 /#contact 로 스크롤(하위 경로에서도 홈 섹션 도달하도록 `/` 프리픽스).
    const starts = screen.getAllByRole("link", { name: "Get started" });
    expect(starts.length).toBeGreaterThan(0);
    starts.forEach((a) => expect(a).toHaveAttribute("href", "/#contact"));

    expect(screen.getByRole("link", { name: "Read the docs" })).toHaveAttribute("href", "/#docs");
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

  it("히어로 코드 스니펫과 기능행 스크린샷(영어·테마별 2장)을 노출한다", () => {
    render(<MarketingPage />);

    expect(screen.getAllByText(/acquire/).length).toBeGreaterThan(0);
    // 각 기능행은 라이트/다크 캡처 <img> 2장을 CSS 로 스왑한다. 기본 로케일(en)이라 소스는 *-en-*.
    const srcOf = (name: RegExp) =>
      screen.getAllByRole("img", { name }).map((el) => el.getAttribute("src"));
    expect(srcOf(/pool overview/i)).toEqual(
      expect.arrayContaining(["/marketing/overview-en-light.png", "/marketing/overview-en-dark.png"]),
    );
    expect(srcOf(/per-context reputation curve/i)).toEqual(
      expect.arrayContaining(["/marketing/detail-en-light.png", "/marketing/detail-en-dark.png"]),
    );
    expect(srcOf(/live event stream/i)).toEqual(
      expect.arrayContaining(["/marketing/events-en-light.png", "/marketing/events-en-dark.png"]),
    );
  });

  it("언어 스위처가 한국어(/ko)로 연결된다", () => {
    render(<MarketingPage />);

    // 스위처는 드롭다운 — 열기 전엔 메뉴가 DOM 에 없다.
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko");
    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/");
  });

  it("GitHub 링크가 공개 엔진 레포를 가리킨다", () => {
    render(<MarketingPage />);
    const gh = screen.getAllByRole("link", { name: /GitHub/ });
    expect(gh.some((a) => a.getAttribute("href") === "https://github.com/PreAgile/reputation-pool")).toBe(true);
  });

  it("모바일: 햄버거 토글로 접이식 nav 를 열고 닫는다", () => {
    render(<MarketingPage />);

    // 기본은 닫힘 — 모바일 nav 는 DOM 에 없다(닫힌 aria-controls 참조 회피).
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    // 데스크톱에서 숨겨지는 섹션 링크가 모바일 메뉴에서 홈 섹션(`/#…`)으로 노출된다.
    expect(within(mobileNav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "/#features");
    expect(within(mobileNav).getByRole("link", { name: "GitHub" })).toBeInTheDocument();
    // 이 단계에선 Sign in 을 노출하지 않는다.
    expect(within(mobileNav).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  // #110: `/` 는 미들웨어가 한국어 선호 방문자를 `/ko` 로 보낸다. 중립 `Accept-Language` 로 오는
  // 크롤러는 `/` 에 남지만, 두 언어가 각각 색인되려면 hreflang 이 양쪽을 가리켜야 한다.
  it("SEO: canonical 은 / 이고 hreflang 이 en·ko·x-default 를 모두 가리킨다", () => {
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.alternates?.languages).toEqual({ en: "/", ko: "/ko", "x-default": "/" });
  });

  // 위 canonical·hreflang 은 모두 상대경로 — 절대 URL 로 렌더될 때 쓰이는 오리진이 metadataBase 다.
  // 기본값이 DNS 없는 도메인(reputationpool.io)이던 동안 구글은 canonical 을 따라 존재하지 않는 호스트로
  // 갔고 색인이 0건이었다. 그 버그의 직접 회귀 테스트다.
  it("SEO: metadataBase 가 실제 서비스 오리진(app.poolroost.com)이다", () => {
    expect(metadata.metadataBase?.origin).toBe("https://app.poolroost.com");
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<MarketingPage />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

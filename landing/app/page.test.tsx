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

  it("주요 CTA — Get started(/#contact) · Read the docs(/docs) 를 제공한다", () => {
    render(<MarketingPage />);

    // "Get started" 는 nav·hero 여러 곳 → 모두 /#contact 로 스크롤(하위 경로에서도 홈 섹션 도달하도록 `/` 프리픽스).
    const starts = screen.getAllByRole("link", { name: "Get started" });
    expect(starts.length).toBeGreaterThan(0);
    starts.forEach((a) => expect(a).toHaveAttribute("href", "/#contact"));

    // #121: 문서 CTA 는 더 이상 같은 페이지의 `#docs` 앵커가 아니라 전용 docs 사이트다.
    expect(screen.getByRole("link", { name: "Read the docs" })).toHaveAttribute("href", "/docs");
  });

  // #121: nav 의 Docs 링크와 랜딩 docs 카드가 모두 실제 문서 라우트로 들어간다(이전엔 `#docs` 앵커와
  // GitHub 레포뿐이었다). 엔진 레포 링크는 신뢰 신호로 남긴다.
  it("Docs 배선: nav 링크와 docs 카드가 /docs 하위 실제 페이지를 가리킨다", () => {
    render(<MarketingPage />);

    // nav 의 Docs(데스크톱). 로케일 프리픽스 없음 — 문서는 영어 전용.
    expect(screen.getAllByRole("link", { name: "Docs" })[0]).toHaveAttribute("href", "/docs");

    expect(screen.getByRole("link", { name: /Quickstart/ })).toHaveAttribute("href", "/docs/quickstart");
    expect(screen.getByRole("link", { name: /API reference/ })).toHaveAttribute("href", "/docs/api");
    expect(screen.getByRole("link", { name: /Concepts/ })).toHaveAttribute("href", "/docs/concepts");

    expect(screen.getByRole("link", { name: /Read the code on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/PreAgile/reputation-pool",
    );
  });

  // #120: 트러스트 바가 영어에서 줄바꿈되며 구분선이 어긋났다. 레이아웃(구분선 위치)은 실브라우저
  // 스냅샷(visual/trust-strip.spec.ts)이 잡고, 여기서는 배지 4개가 제목·서브까지 빠짐없이 렌더되는지
  // — 격자로 옮기는 과정에서 항목이 유실되지 않았는지 — 를 단정한다.
  it("트러스트 바: 배지 4개가 제목과 서브카피를 모두 렌더한다", () => {
    render(<MarketingPage />);

    const heading = screen.getByText("Trust comes from the engine, not logos");
    // "Audit trail" 같은 라벨은 Capabilities 카드에도 나온다 — 트러스트 섹션 안으로 범위를 좁힌다.
    const strip = heading.closest("section");
    expect(strip).not.toBeNull();
    const inStrip = within(strip as HTMLElement);

    const badges: [string, string][] = [
      ["Open source", "the whole engine, on GitHub"],
      ["Lincheck", "concurrency proven correct"],
      ["Mutation-tested", "tests that catch real bugs"],
      ["Audit trail", "every decision on record"],
    ];
    badges.forEach(([title, sub]) => {
      expect(inStrip.getByText(title)).toBeInTheDocument();
      expect(inStrip.getByText(sub)).toBeInTheDocument();
    });
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

  // 스위처는 드롭다운이 아니라 항상 보이는 두 링크다(#143 리뷰) — 열기 전에는 링크가 DOM 에 없어서
  // JS 를 끈 사람과 크롤러에게는 한국어 표면이 아예 존재하지 않았다. **클릭하지 않고** 확인한다.
  it("언어 스위처가 상호작용 없이 한국어(/ko) 링크를 노출한다", () => {
    render(<MarketingPage />);

    const switcher = screen.getByRole("navigation", { name: "Language" });
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko");
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("href", "/");
    // 현재 로케일은 색이 아니라 속성으로 알린다.
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
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
  it("SEO: metadataBase 가 랜딩 오리진(poolroost.com)이다", () => {
    expect(metadata.metadataBase?.origin).toBe("https://poolroost.com");
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<MarketingPage />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

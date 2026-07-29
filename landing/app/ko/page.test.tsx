import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import MarketingPageKo, { metadata } from "./page";

// next-themes 훅(ThemeToggle)만 대체. 랜딩은 라우팅 훅을 쓰지 않는다(Link 만 사용).
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

describe("랜딩 페이지 한국어 (/ko, #16)", () => {
  it("한국어 헤드라인·핵심 섹션 제목을 렌더한다", () => {
    render(<MarketingPageKo />);

    expect(
      screen.getByRole("heading", { level: 1, name: /프록시·계정 풀을 위한 평판 API\./ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/쿨다운, 차단 목록, 리스 로직을 직접 짜지 마세요\./)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /나쁜 리소스는 잠시 빼두고, 좋은 것만 골라 씁니다\./ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /실제 자동화 인프라를 위해 만들어졌습니다\./ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /세 번의 호출\. 나머지는 엔진이 합니다\./ })).toBeInTheDocument();
  });

  it("CTA 해시가 /ko 프리픽스를 갖고 스크린샷은 한국어(*-ko-*)다", () => {
    render(<MarketingPageKo />);

    // "시작하기" 는 nav·hero 여러 곳 → 모두 /ko#contact.
    screen.getAllByRole("link", { name: "시작하기" }).forEach((a) => expect(a).toHaveAttribute("href", "/ko#contact"));
    // #121: docs 는 영어 전용 전용 사이트다 — `/ko` 랜딩에서도 로케일 프리픽스 없이 `/docs` 로 간다.
    expect(screen.getByRole("link", { name: "문서 보기" })).toHaveAttribute("href", "/docs");
    expect(screen.getAllByRole("link", { name: "문서" })[0]).toHaveAttribute("href", "/docs");

    const srcOf = (name: RegExp) => screen.getAllByRole("img", { name }).map((el) => el.getAttribute("src"));
    expect(srcOf(/풀 오버뷰/)).toEqual(
      expect.arrayContaining(["/marketing/overview-ko-light.png", "/marketing/overview-ko-dark.png"]),
    );
  });

  it("Email us(이메일 보내기) CTA 가 mailto 로 연결된다", () => {
    render(<MarketingPageKo />);
    const email = screen.getByRole("link", { name: "이메일 보내기" });
    expect((email.getAttribute("href") ?? "").startsWith("mailto:digle117@gmail.com")).toBe(true);
  });

  it("언어 스위처가 영어(/)로 되돌아간다", () => {
    render(<MarketingPageKo />);
    fireEvent.click(screen.getByRole("button", { name: "언어" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/");
    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko");
  });

  // #110: 자동 판별로 `/` 에서 넘어와도 한국어의 정본 URL 은 `/ko` 다 — 그래야 한국어 페이지가
  // 영어 `/` 로 흡수되지 않고 따로 색인된다.
  it("SEO: canonical 은 /ko 이고 hreflang 이 en·ko·x-default 를 모두 가리킨다", () => {
    expect(metadata.alternates?.canonical).toBe("/ko");
    expect(metadata.alternates?.languages).toEqual({ en: "/", ko: "/ko", "x-default": "/" });
  });

  // 상대 canonical 이 절대 URL 로 펴질 때의 오리진. 기본값이 DNS 없는 도메인이던 탓에 색인이 0건이었다 —
  // 영어 랜딩과 같은 단일 출처(lib/site.ts)를 쓰는지 양쪽에서 각각 잠근다.
  it("SEO: metadataBase 가 랜딩 오리진(poolroost.com)이다", () => {
    expect(metadata.metadataBase?.origin).toBe("https://poolroost.com");
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<MarketingPageKo />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { LanguageSwitcher } from "./language-switcher";
import { seriousViolations } from "@/test/a11y";
import { LOCALE_COOKIE } from "@/lib/locale";

/**
 * 이 컴포넌트에는 계약이 셋 있고, 셋 다 조용히 깨질 수 있다.
 *
 * 1. **링크가 상호작용 없이 존재한다.** 직전 구현은 드롭다운이라 목록이 `open` 일 때만 렌더됐고,
 *    그래서 내보낸 정적 HTML 에 다른 언어 링크가 0 건이었다 — JS 를 끈 사람과 크롤러에게는 한국어
 *    문서가 존재하지 않는 것과 같았다. 아래 첫 묶음이 그 회귀를 막는다(아무것도 클릭하지 않는다).
 * 2. **목적지가 같은 페이지의 다른 언어다.** `/docs/api` 에서 한국어를 고르면 랜딩이 아니라
 *    `/ko/docs/api` 여야 한다.
 * 3. **쿠키를 이동 전에 심는다.** 미들웨어(#110)가 쿠키를 1순위로 보므로, 쿠키가 없으면 `/ko` 에서
 *    English 를 골라 `/` 로 가는 순간 한국 IP 방문자가 다시 `/ko` 로 되돌려진다. 링크는 평범한
 *    `<a href>` 이고 쿠키는 그 위의 점진적 향상이므로 둘을 각각 검증한다.
 */
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("LanguageSwitcher: 항상 보이는 두 로케일 링크", () => {
  beforeEach(() => {
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
    pathname.current = "/";
  });

  function renderSwitcher(current: "en" | "ko") {
    render(<LanguageSwitcher current={current} label="Language" />);
    return screen.getByRole("navigation", { name: "Language" });
  }

  describe("상호작용 없이 렌더되는 것들", () => {
    it("아무것도 누르지 않아도 → 두 언어 링크가 모두 DOM 에 있다 (JS 없이도 이동할 수 있다)", () => {
      const nav = renderSwitcher("en");

      expect(within(nav).getAllByRole("link")).toHaveLength(2);
      expect(within(nav).getByRole("link", { name: "English" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "한국어" })).toBeInTheDocument();
    });

    it("여는 버튼이 없다 → 링크가 클릭 뒤에 나타나는 구조가 아니다(드롭다운 회귀 차단)", () => {
      renderSwitcher("en");

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("각 링크가 실제 href 를 갖는다 → 크롤러도 언어 간 링크를 따라갈 수 있다", () => {
      const nav = renderSwitcher("en");

      within(nav)
        .getAllByRole("link")
        .forEach((a) => expect(a.getAttribute("href")).toMatch(/^\//));
    });

    it("각 링크에 hrefLang 이 붙는다 → 브라우저·크롤러가 목적지 언어를 안다", () => {
      const nav = renderSwitcher("en");

      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("hreflang", "en");
      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("hreflang", "ko");
    });
  });

  describe("현재 언어 표시", () => {
    it("영어 페이지면 → English 만 aria-current 다 (색이 아니라 속성으로 알린다)", () => {
      const nav = renderSwitcher("en");

      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
      expect(within(nav).getByRole("link", { name: "한국어" })).not.toHaveAttribute("aria-current");
    });

    it("한국어 페이지면 → 한국어 쪽만 aria-current 다", () => {
      const nav = renderSwitcher("ko");

      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("aria-current", "true");
      expect(within(nav).getByRole("link", { name: "English" })).not.toHaveAttribute("aria-current");
    });

    it("현재 언어 표시가 정확히 하나다 → 두 개가 동시에 활성으로 읽히지 않는다", () => {
      const nav = renderSwitcher("ko");

      const current = within(nav)
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "true");
      expect(current).toHaveLength(1);
    });
  });

  describe("목적지", () => {
    it("영어 랜딩에 있으면 → 각 링크가 해당 로케일 랜딩 경로를 가리킨다", () => {
      const nav = renderSwitcher("en");

      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("href", "/");
      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko");
    });

    it("한국어 랜딩에 있으면 → English 가 / 를 가리킨다", () => {
      pathname.current = "/ko";
      const nav = renderSwitcher("ko");

      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("href", "/");
      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko");
    });

    it("영어 docs 하위 페이지에 있으면 → 한국어 링크가 같은 페이지의 /ko/docs/... 다", () => {
      pathname.current = "/docs/api";
      const nav = renderSwitcher("en");

      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/docs/api");
      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("href", "/docs/api");
    });

    it("한국어 docs 하위 페이지에 있으면 → English 링크가 같은 페이지의 /docs/... 다 (랜딩으로 가지 않는다)", () => {
      pathname.current = "/ko/docs/api";
      const nav = renderSwitcher("ko");

      expect(within(nav).getByRole("link", { name: "English" })).toHaveAttribute("href", "/docs/api");
      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/docs/api");
    });

    it("docs 루트에 있으면 → 반대 언어의 docs 루트로 간다 (문서를 벗어나지 않는다)", () => {
      pathname.current = "/docs";
      const nav = renderSwitcher("en");

      expect(within(nav).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/docs");
    });
  });

  describe("쿠키(점진적 향상)", () => {
    it("한국어 랜딩에서 English 를 누르면 → rp_locale=en 쿠키가 남는다 (/ 가 다시 /ko 로 튕기지 않는다)", () => {
      pathname.current = "/ko";
      const nav = renderSwitcher("ko");

      fireEvent.click(within(nav).getByRole("link", { name: "English" }));

      expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
    });

    it("영어 랜딩에서 한국어를 누르면 → rp_locale=ko 쿠키가 남는다 (브라우저가 영어여도 한국어가 유지된다)", () => {
      const nav = renderSwitcher("en");

      fireEvent.click(within(nav).getByRole("link", { name: "한국어" }));

      expect(document.cookie).toContain(`${LOCALE_COOKIE}=ko`);
    });

    it("렌더만 하면 → 쿠키를 심지 않는다 (누르지 않은 것은 선택이 아니다)", () => {
      renderSwitcher("en");

      expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=en`);
      expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=ko`);
    });

    it("docs 에서 언어를 골라도 → 쿠키는 그대로 심는다 (다음 방문의 랜딩 판별에 반영된다)", () => {
      pathname.current = "/docs/faq";
      const nav = renderSwitcher("en");

      fireEvent.click(within(nav).getByRole("link", { name: "한국어" }));

      expect(document.cookie).toContain(`${LOCALE_COOKIE}=ko`);
    });
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<LanguageSwitcher current="en" label="Language" />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

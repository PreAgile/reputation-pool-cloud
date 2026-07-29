import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { LanguageSwitcher } from "./language-switcher";
import { LOCALE_COOKIE } from "@/lib/locale";

/**
 * 자동 판별(#110)이 사용자의 선택과 싸우지 않게 만드는 장치가 여기 있다: 스위처가 **이동 전에**
 * `rp_locale` 쿠키를 심고, 미들웨어는 그 쿠키를 1순위로 본다. 쿠키가 심기지 않으면 `/ko` 에서 English 를
 * 골라 `/` 로 가는 순간 미들웨어가 다시 `/ko` 로 튕겨 무한히 되돌아온다 — 그래서 "쿠키를 심는다"가
 * 스타일이 아니라 계약이다.
 *
 * 두 번째 계약은 목적지다 (#143): 스위처는 **같은 페이지의 다른 언어**로 가야 한다. 랜딩 두 장뿐일 때는
 * `/`·`/ko` 고정이 곧 같은 페이지였지만, 한국어 docs 가 생긴 뒤에는 `/docs/api` 에서 한국어를 고르면
 * 문서를 잃고 랜딩으로 떨어졌다. 목적지는 `usePathname()` 에서 계산하므로 여기서 그 훅을 대체한다.
 */
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("LanguageSwitcher: 사용자가 고른 언어를 기억시키고 같은 페이지로 옮긴다", () => {
  beforeEach(() => {
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
    pathname.current = "/";
  });

  function openMenu(current: "en" | "ko") {
    render(<LanguageSwitcher current={current} label="Language" />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    return screen.getByRole("menu");
  }

  it("한국어 랜딩에서 English 를 고르면 → rp_locale=en 쿠키가 남는다 (/ 가 다시 /ko 로 튕기지 않는다)", () => {
    pathname.current = "/ko";
    const menu = openMenu("ko");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "English" }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
  });

  it("영어 랜딩에서 한국어를 고르면 → rp_locale=ko 쿠키가 남는다 (브라우저가 영어여도 한국어가 유지된다)", () => {
    const menu = openMenu("en");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "한국어" }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=ko`);
  });

  it("메뉴를 열기만 하면 → 쿠키를 심지 않는다 (선택하지 않은 것은 선택이 아니다)", () => {
    openMenu("en");

    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=en`);
    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=ko`);
  });

  it("랜딩에 있으면 → 각 항목이 해당 로케일 랜딩 경로를 가리킨다 (JS 없이도, 크롤러도 이동할 수 있다)", () => {
    const menu = openMenu("en");

    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/");
    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko");
  });

  it("영어 docs 하위 페이지에 있으면 → 한국어 항목이 같은 페이지의 /ko/docs/... 를 가리킨다", () => {
    pathname.current = "/docs/api";
    const menu = openMenu("en");

    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko/docs/api");
    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/docs/api");
  });

  it("한국어 docs 하위 페이지에 있으면 → English 항목이 같은 페이지의 /docs/... 를 가리킨다(랜딩으로 가지 않는다)", () => {
    pathname.current = "/ko/docs/api";
    const menu = openMenu("ko");

    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/docs/api");
    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko/docs/api");
  });

  it("docs 루트에 있으면 → 반대 언어의 docs 루트로 간다(문서를 벗어나지 않는다)", () => {
    pathname.current = "/docs";
    const menu = openMenu("en");

    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko/docs");
  });

  it("docs 에서 언어를 골라도 → 쿠키는 그대로 심는다(다음 방문의 랜딩 판별에 그 선택이 반영된다)", () => {
    pathname.current = "/docs/faq";
    const menu = openMenu("en");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "한국어" }));

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=ko`);
  });
});

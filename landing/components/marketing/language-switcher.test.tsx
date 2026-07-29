import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { LanguageSwitcher } from "./language-switcher";
import { LOCALE_COOKIE } from "@/lib/locale";

/**
 * 자동 판별(#110)이 사용자의 선택과 싸우지 않게 만드는 장치가 여기 있다: 스위처가 **이동 전에**
 * `rp_locale` 쿠키를 심고, 미들웨어는 그 쿠키를 1순위로 본다. 쿠키가 심기지 않으면 `/ko` 에서 English 를
 * 골라 `/` 로 가는 순간 미들웨어가 다시 `/ko` 로 튕겨 무한히 되돌아온다 — 그래서 "쿠키를 심는다"가
 * 스타일이 아니라 계약이다.
 */
describe("LanguageSwitcher: 사용자가 고른 언어를 기억시킨다", () => {
  beforeEach(() => {
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
  });

  function openMenu(current: "en" | "ko") {
    render(<LanguageSwitcher current={current} label="Language" />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    return screen.getByRole("menu");
  }

  it("한국어 랜딩에서 English 를 고르면 → rp_locale=en 쿠키가 남는다 (/ 가 다시 /ko 로 튕기지 않는다)", () => {
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

  it("각 항목은 여전히 해당 로케일 랜딩 경로를 가리킨다 → JS 없이도(그리고 크롤러도) 이동할 수 있다", () => {
    const menu = openMenu("en");

    expect(within(menu).getByRole("menuitem", { name: "English" })).toHaveAttribute("href", "/");
    expect(within(menu).getByRole("menuitem", { name: "한국어" })).toHaveAttribute("href", "/ko");
  });
});

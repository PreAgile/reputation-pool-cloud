import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import { LOCALE_COOKIE } from "@/lib/locale";
import NotFound from "./not-found";

/**
 * 404 는 "오타를 친 방문자" 가 보는 화면이라, 여기서 언어가 어긋나면 그 사람이 사이트에서 겪는 유일한
 * 인상이 어긋난 채로 끝난다. 그래서 검증의 초점은 모양이 아니라 **랜딩과 같은 로케일 정책을 쓰는가** 다
 * (`lib/locale.ts` 의 우선순위: 쿠키 > Accept-Language > CF-IPCountry > 영어).
 */
const requestCookies = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (requestCookies.has(n) ? { value: requestCookies.get(n) } : undefined) }),
  headers: async () => ({ get: (n: string) => requestHeaders.get(n) ?? null }),
}));

async function renderNotFound() {
  render(await NotFound());
}

describe("404 페이지 (#134)", () => {
  beforeEach(() => {
    requestCookies.clear();
    requestHeaders.clear();
  });

  it("아무 신호도 없으면 → 영어 404 와 영어 랜딩(/) 링크가 나온다", async () => {
    await renderNotFound();

    expect(screen.getByRole("heading", { level: 1, name: "This page doesn’t exist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  it("브라우저가 한국어를 선호하면 → 한국어 404 와 한국어 랜딩(/ko) 링크가 나온다", async () => {
    requestHeaders.set("accept-language", "ko-KR,ko;q=0.9,en-US;q=0.8");

    await renderNotFound();

    expect(screen.getByRole("heading", { level: 1, name: "찾는 페이지가 없습니다" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/ko");
  });

  it("스위처로 고른 언어(쿠키)가 있으면 → 브라우저 선호를 이긴다 (랜딩과 같은 우선순위)", async () => {
    requestCookies.set(LOCALE_COOKIE, "en");
    requestHeaders.set("accept-language", "ko-KR,ko;q=0.9");

    await renderNotFound();

    expect(screen.getByRole("heading", { level: 1, name: "This page doesn’t exist" })).toBeInTheDocument();
  });

  it("돌아갈 길을 두 개 준다 → 랜딩과 콘솔 (Next 기본 404 에는 링크가 하나도 없었다)", async () => {
    await renderNotFound();

    expect(screen.getByRole("link", { name: "Go home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open console" })).toHaveAttribute("href", "/overview");
  });

  it("색인 대상이 아니다 → noindex meta 를 함께 렌더한다 (특수 파일이라 metadata export 를 못 쓴다)", async () => {
    render(await NotFound());

    // React 19 가 <meta> 를 <head> 로 끌어올린다 — 컨테이너가 아니라 document.head 에서 찾아야 한다.
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });

  it("axe 로 critical/serious 위반이 없다", async () => {
    const { container } = render(await NotFound());

    expect(await seriousViolations(container)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import sitemap from "./sitemap";

describe("사이트맵 (#16)", () => {
  it("두 언어 랜딩(/ 와 /ko)을 모두 제출한다", () => {
    const urls = sitemap().map((e) => e.url);

    expect(urls).toEqual(["https://app.poolroost.com", "https://app.poolroost.com/ko"]);
  });

  // 회귀 가드: 기본 오리진이 DNS 없는 도메인(reputationpool.io)이던 탓에 색인이 0건이었다. 상대경로도
  // 안 된다 — 사이트맵의 <loc> 는 절대 URL 이어야 크롤러가 받아들인다.
  it("모든 URL 이 실제 서비스 오리진(app.poolroost.com)의 절대 URL 이다", () => {
    for (const entry of sitemap()) {
      expect(new URL(entry.url).origin).toBe("https://app.poolroost.com");
    }
  });

  // `/` 는 한국어 선호 방문자를 `/ko` 로 307 리다이렉트한다(#110). 두 언어가 각각 색인되려면 사이트맵의
  // 두 엔트리 모두가 서로를 언어 대안으로 가리켜야 한다.
  it("두 엔트리 모두 en·ko hreflang 대안을 절대 URL 로 달고 있다", () => {
    const languages = { en: "https://app.poolroost.com", ko: "https://app.poolroost.com/ko" };

    for (const entry of sitemap()) {
      expect(entry.alternates?.languages).toEqual(languages);
    }
  });
});

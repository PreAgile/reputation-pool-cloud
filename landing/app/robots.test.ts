import { describe, it, expect } from "vitest";
import robots from "./robots";

/** rules 는 단일 객체도 배열도 될 수 있는 타입 — 테스트에선 항상 배열로 다룬다. */
const rules = () => {
  const r = robots().rules;
  return Array.isArray(r) ? r : [r];
};
const disallowed = () =>
  rules().flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));

describe("robots.txt (#16)", () => {
  it("사이트맵 위치를 랜딩 오리진의 절대 URL 로 알린다", () => {
    // Cloudflare 관리형 robots.txt 는 `Sitemap:` 줄이 없었다 — 오리진이 직접 내려줘야 한다.
    expect(robots().sitemap).toBe("https://poolroost.com/sitemap.xml");
  });

  it("크롤러 전체에 / 를 허용하고 API·actuator 만 차단한다", () => {
    const all = rules().filter((rule) => rule.userAgent === "*");

    expect(all.length).toBe(1);
    expect(all[0].allow).toBe("/");
    expect(disallowed()).toEqual(expect.arrayContaining(["/api/", "/actuator/"]));
  });

  // 이 테스트가 이 파일의 핵심이다: 비공개 화면은 `X-Robots-Tag: noindex`(next.config.ts)로 빼는데,
  // 크롤러가 그 헤더를 읽으려면 URL 을 가져올 수 있어야 한다. robots.txt 로 같이 막으면 헤더를 못 읽어
  // "차단됐지만 색인됨" 으로 남는다. 선의의 "보안 강화" 리팩터가 이 불변식을 깨지 못하게 잠근다.
  it("noindex 로 처리하는 앱·로그인·프리뷰 경로는 차단 목록에 없다 (헤더를 읽히게 남겨둔다)", () => {
    const list = disallowed();

    for (const path of ["/login", "/overview", "/usage", "/keys", "/events", "/admin", "/resources", "/preview"]) {
      expect(list.some((entry) => entry.startsWith(path))).toBe(false);
    }
  });
});

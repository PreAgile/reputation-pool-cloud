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
  it("사이트맵을 알리지 않는다 → 이 호스트에는 색인할 공개 화면이 없고 /sitemap.xml 은 404 다", () => {
    // 랜딩·문서가 apex 랜딩으로 옮겨가며 `app/sitemap.ts` 도 함께 삭제됐다(#15). `Sitemap:` 줄만 남기면
    // 크롤러가 404 를 계속 긁는다. 사이트맵은 이제 `landing/app/sitemap.ts` 가 apex 기준으로 낸다.
    expect(robots().sitemap).toBeUndefined();
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

  // 호스트 이전(#15) 중에는 이게 위 불변식보다 더 비싸다: 옛 랜딩·문서 URL 은 apex 로 301 하는데,
  // 크롤러가 그 301 을 읽으려면 옛 URL 을 가져올 수 있어야 한다. `Disallow: /` 를 넣으면 리다이렉트가
  // 영원히 읽히지 않고 `app.poolroost.com` 의 옛 URL 이 색인에 굳는다.
  it("사이트 전체를 막지 않는다 → 이전 중인 옛 URL 의 301 을 크롤러가 볼 수 있어야 한다", () => {
    expect(disallowed()).not.toContain("/");
    expect(rules().every((rule) => rule.allow === "/")).toBe(true);
  });
});

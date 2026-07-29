import { describe, it, expect } from "vitest";
import sitemap from "./sitemap";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";

/**
 * 오리진은 리터럴로 적는다. `SITE_URL` 을 import 해서 비교하면 자기 자신과 비교하는 셈이라 값이 바뀌어도
 * 통과한다. 계층 분리(#15)로 랜딩이 `app.` 에서 apex 로 옮겨졌는데, 이 리터럴이 그 이동을 강제로
 * 인지하게 만든다.
 */
const ORIGIN = "https://poolroost.com";

describe("사이트맵 (#16)", () => {
  it("두 언어 랜딩(/ 와 /ko)을 모두 제출한다", () => {
    const urls = sitemap().map((e) => e.url);

    expect(urls).toContain(ORIGIN);
    expect(urls).toContain(`${ORIGIN}/ko`);
  });

  // #130 이 docs 6 페이지를 넣으면서 사이트맵을 갱신하지 않아 색인 대상에서 통째로 빠져 있었다.
  // 이제 매니페스트에서 파생시키므로 페이지가 늘면 자동으로 따라온다 — 이 테스트는 그 연결이 끊기는
  // 것을 막는다.
  it("docs 매니페스트의 모든 페이지가 사이트맵에 들어 있다", () => {
    const urls = sitemap().map((e) => e.url);

    expect(DOCS_PAGES.length).toBeGreaterThan(0);
    for (const page of DOCS_PAGES) {
      expect(urls).toContain(`${ORIGIN}${docsHref(page.slug)}`);
    }
  });

  // 회귀 가드: 기본 오리진이 DNS 없는 도메인(reputationpool.io)이던 탓에 색인이 0건이었다. 상대경로도
  // 안 된다 — 사이트맵의 <loc> 는 절대 URL 이어야 크롤러가 받아들인다.
  it("모든 URL 이 랜딩 오리진(poolroost.com)의 절대 URL 이다", () => {
    for (const entry of sitemap()) {
      expect(new URL(entry.url).origin).toBe(ORIGIN);
    }
  });

  // `/` 는 한국어 선호 방문자를 `/ko` 로 307 리다이렉트한다(#110). 두 언어가 각각 색인되려면 사이트맵의
  // 두 엔트리 모두가 서로를 언어 대안으로 가리켜야 한다.
  it("두 랜딩 엔트리 모두 en·ko hreflang 대안을 절대 URL 로 달고 있다", () => {
    const languages = { en: ORIGIN, ko: `${ORIGIN}/ko` };
    const landings = sitemap().filter((e) => e.url === ORIGIN || e.url === `${ORIGIN}/ko`);

    expect(landings).toHaveLength(2);
    for (const entry of landings) {
      expect(entry.alternates?.languages).toEqual(languages);
    }
  });

  // docs 는 영어 한 벌뿐이라 대체 언어가 없다. 없는 번역을 hreflang 으로 알리면 크롤러가 404 를 만난다.
  it("docs 엔트리에는 hreflang 대안을 달지 않는다", () => {
    const docs = sitemap().filter((e) => e.url.startsWith(`${ORIGIN}/docs`));

    expect(docs.length).toBeGreaterThan(0);
    for (const entry of docs) {
      expect(entry.alternates).toBeUndefined();
    }
  });
});

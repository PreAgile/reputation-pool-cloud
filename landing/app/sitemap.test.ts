import { describe, it, expect } from "vitest";
import sitemap from "./sitemap";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";
import { LOCALES } from "@/lib/locale";

/**
 * 오리진은 리터럴로 적는다. `SITE_URL` 을 import 해서 비교하면 자기 자신과 비교하는 셈이라 값이 바뀌어도
 * 통과한다. 계층 분리(#15)로 랜딩이 `app.` 에서 apex 로 옮겨졌는데, 이 리터럴이 그 이동을 강제로
 * 인지하게 만든다.
 */
const ORIGIN = "https://poolroost.com";

describe("사이트맵 (#16, 한국어 docs #143)", () => {
  it("두 언어 랜딩(/ 와 /ko)을 모두 제출한다", () => {
    const urls = sitemap().map((e) => e.url);

    expect(urls).toContain(ORIGIN);
    expect(urls).toContain(`${ORIGIN}/ko`);
  });

  // #130 이 docs 6 페이지를 넣으면서 사이트맵을 갱신하지 않아 색인 대상에서 통째로 빠져 있었다.
  // 이제 매니페스트에서 파생시키므로 페이지가 늘면 자동으로 따라온다 — 이 테스트는 그 연결이 끊기는
  // 것을 막는다.
  it("docs 매니페스트의 모든 페이지가 두 로케일 URL 로 사이트맵에 들어 있다", () => {
    const urls = sitemap().map((e) => e.url);

    expect(DOCS_PAGES.length).toBeGreaterThan(0);
    for (const page of DOCS_PAGES) {
      for (const locale of LOCALES) {
        expect(urls).toContain(`${ORIGIN}${docsHref(page.slug, locale)}`);
      }
    }
  });

  it("한국어 docs URL 이 /ko/docs 아래에 있고 페이지 수만큼 존재한다", () => {
    const koDocs = sitemap().filter((e) => e.url.startsWith(`${ORIGIN}/ko/docs`));

    expect(koDocs).toHaveLength(DOCS_PAGES.length);
    expect(koDocs.map((e) => e.url)).toContain(`${ORIGIN}/ko/docs`);
  });

  // 회귀 가드: 기본 오리진이 DNS 없는 도메인(reputationpool.io)이던 탓에 색인이 0건이었다. 상대경로도
  // 안 된다 — 사이트맵의 <loc> 는 절대 URL 이어야 크롤러가 받아들인다.
  it("모든 URL 이 랜딩 오리진(poolroost.com)의 절대 URL 이다", () => {
    for (const entry of sitemap()) {
      expect(new URL(entry.url).origin).toBe(ORIGIN);
    }
  });

  it("URL 이 중복되지 않는다 → 같은 문서를 두 번 제출하지 않는다", () => {
    const urls = sitemap().map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
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

  // #121 시점에는 docs 가 영어 한 벌뿐이라 대안이 없어 hreflang 을 일부러 비워 뒀다. 그 전제가 #143 으로
  // 깨졌고, docs 는 `/` 와 달리 자동 로케일 리다이렉트가 없으므로 hreflang 이 두 언어를 잇는 유일한
  // 신호다 — 비어 있으면 구글이 두 언어를 중복으로 보고 한쪽을 버린다.
  it("docs 엔트리는 슬러그마다 같은 en·ko hreflang 쌍을 달고 있다", () => {
    for (const page of DOCS_PAGES) {
      const expected = {
        en: `${ORIGIN}${docsHref(page.slug, "en")}`,
        ko: `${ORIGIN}${docsHref(page.slug, "ko")}`,
      };
      const pair = sitemap().filter((e) => Object.values(expected).includes(e.url));

      expect(pair).toHaveLength(2);
      for (const entry of pair) {
        expect(entry.alternates?.languages).toEqual(expected);
      }
    }
  });

  it("hreflang 이 자기 자신을 포함한다 → 각 URL 이 자기 언어판으로도 되돌아온다", () => {
    const docs = sitemap().filter((e) => e.url.includes("/docs"));

    expect(docs.length).toBeGreaterThan(0);
    for (const entry of docs) {
      expect(Object.values(entry.alternates?.languages ?? {})).toContain(entry.url);
    }
  });

  it("한국어 docs 우선순위가 영어보다 낮다 → 랜딩(1.0/0.9)과 같은 규칙을 따른다", () => {
    const en = sitemap().find((e) => e.url === `${ORIGIN}/docs`);
    const ko = sitemap().find((e) => e.url === `${ORIGIN}/ko/docs`);

    expect(en?.priority).toBeGreaterThan(ko!.priority!);
  });
});

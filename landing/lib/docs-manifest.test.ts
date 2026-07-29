import { describe, it, expect } from "vitest";
import {
  DOCS_PAGES,
  DOCS_ROOT,
  DOCS_SECTION_LABEL,
  docsAlternates,
  docsHref,
  docsMetadata,
  docsNeighbours,
  docsPage,
  docsSections,
} from "./docs-manifest";
import { LOCALES } from "./locale";

describe("docs 매니페스트 (#121, 로케일 확장 #143)", () => {
  it("슬러그가 전부 유일하다 → 두 페이지가 같은 URL 을 주장하지 않는다", () => {
    const slugs = DOCS_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("루트(빈 슬러그) 페이지가 정확히 하나이고 배열의 첫 항목이다 → /docs 진입점이 하나로 정해진다", () => {
    expect(DOCS_PAGES.filter((p) => p.slug === "")).toHaveLength(1);
    expect(DOCS_PAGES[0].slug).toBe("");
  });

  it("모든 페이지가 두 로케일의 제목·요약을 갖는다 → 한 언어만 배선된 페이지가 남지 않는다", () => {
    DOCS_PAGES.forEach((page) => {
      LOCALES.forEach((locale) => {
        expect(page.title[locale].trim().length).toBeGreaterThan(0);
        expect(page.summary[locale].trim().length).toBeGreaterThan(0);
      });
    });
  });

  it("한국어 제목·요약이 영어와 실제로 다르다 → 번역을 잊고 영어를 복사해 두지 않았다", () => {
    DOCS_PAGES.forEach((page) => {
      expect(page.title.ko).not.toBe(page.title.en);
      expect(page.summary.ko).not.toBe(page.summary.en);
    });
  });

  describe("로케일별 URL", () => {
    it("영어는 프리픽스가 없고 → /docs, /docs/<slug> 다", () => {
      expect(docsHref("", "en")).toBe(DOCS_ROOT.en);
      expect(docsHref("quickstart", "en")).toBe("/docs/quickstart");
    });

    it("한국어는 /ko 아래로 → /ko/docs, /ko/docs/<slug> 다", () => {
      expect(docsHref("", "ko")).toBe(DOCS_ROOT.ko);
      expect(docsHref("quickstart", "ko")).toBe("/ko/docs/quickstart");
    });

    it("로케일을 생략하면 → 기본 로케일(영어) URL 이다(조용히 다른 언어로 새지 않는다)", () => {
      expect(docsHref("api")).toBe(docsHref("api", "en"));
    });

    it("모든 페이지의 두 로케일 URL 이 서로 다르고 전부 유일하다 → 두 언어가 같은 URL 을 다투지 않는다", () => {
      const urls = DOCS_PAGES.flatMap((p) => LOCALES.map((l) => docsHref(p.slug, l)));
      expect(urls).toHaveLength(DOCS_PAGES.length * LOCALES.length);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it("한 슬러그의 alternates 는 → en·ko 와 영어를 가리키는 x-default 다", () => {
      expect(docsAlternates("concepts")).toEqual({
        en: "/docs/concepts",
        ko: "/ko/docs/concepts",
        "x-default": "/docs/concepts",
      });
    });
  });

  it("매니페스트에 있는 슬러그면 → 그 페이지를, 없는 슬러그면 → undefined 를 돌려준다", () => {
    expect(docsPage("concepts")?.title.en).toBe("Concepts");
    expect(docsPage("concepts")?.title.ko).toBe("핵심 개념");
    expect(docsPage("nope")).toBeUndefined();
  });

  describe("prev/next 경계", () => {
    it("첫 페이지면 → prev 가 없고 next 는 두 번째 페이지다", () => {
      const { prev, next } = docsNeighbours(DOCS_PAGES[0].slug);
      expect(prev).toBeUndefined();
      expect(next).toEqual(DOCS_PAGES[1]);
    });

    it("마지막 페이지면 → next 가 없고 prev 는 직전 페이지다(문서가 처음으로 순환하지 않는다)", () => {
      const last = DOCS_PAGES[DOCS_PAGES.length - 1];
      const { prev, next } = docsNeighbours(last.slug);
      expect(next).toBeUndefined();
      expect(prev).toEqual(DOCS_PAGES[DOCS_PAGES.length - 2]);
    });

    it("가운데 페이지면 → 양쪽이 매니페스트 순서와 일치한다", () => {
      const { prev, next } = docsNeighbours(DOCS_PAGES[2].slug);
      expect(prev).toEqual(DOCS_PAGES[1]);
      expect(next).toEqual(DOCS_PAGES[3]);
    });

    it("매니페스트에 없는 슬러그면 → 양쪽 모두 undefined(엉뚱한 페이지로 이어 주지 않는다)", () => {
      expect(docsNeighbours("nope")).toEqual({});
    });

    it("이웃은 로케일과 무관하다 → 링크를 만드는 쪽이 로케일을 붙이므로 언어를 넘어가지 않는다", () => {
      const { next } = docsNeighbours("");
      expect(docsHref(next!.slug, "ko").startsWith(DOCS_ROOT.ko)).toBe(true);
      expect(docsHref(next!.slug, "en").startsWith(DOCS_ROOT.en)).toBe(true);
    });
  });

  describe("사이드바 그룹", () => {
    it("섹션으로 묶어도 → 페이지 순서는 매니페스트 순서 그대로다", () => {
      LOCALES.forEach((locale) => {
        const flattened = docsSections(locale).flatMap((group) => group.pages);
        expect(flattened).toEqual(DOCS_PAGES);
      });
    });

    it("같은 섹션이 두 그룹으로 쪼개지지 않는다 → 매니페스트에서 섹션이 붙어 있다", () => {
      const sections = docsSections("en").map((group) => group.section);
      expect(new Set(sections).size).toBe(sections.length);
    });

    it("섹션 식별자는 로케일과 무관하고 → 라벨만 로케일에 따라 바뀐다", () => {
      const en = docsSections("en");
      const ko = docsSections("ko");
      expect(ko.map((g) => g.section)).toEqual(en.map((g) => g.section));
      expect(en.map((g) => g.label)).toEqual(en.map((g) => DOCS_SECTION_LABEL[g.section].en));
      expect(ko.map((g) => g.label)).toEqual(ko.map((g) => DOCS_SECTION_LABEL[g.section].ko));
      expect(ko[0].label).not.toBe(en[0].label);
    });
  });

  describe("페이지 metadata", () => {
    it("영어 페이지 metadata 는 → 영어 제목·설명과 /docs canonical 을 매니페스트에서 파생한다", () => {
      const meta = docsMetadata("quickstart", "en");
      expect(meta.title).toContain("Quickstart");
      expect(meta.description).toBe(docsPage("quickstart")?.summary.en);
      expect(meta.alternates.canonical).toBe("/docs/quickstart");
    });

    it("한국어 페이지 metadata 는 → 한국어 제목·설명과 /ko/docs canonical 을 갖는다", () => {
      const meta = docsMetadata("quickstart", "ko");
      expect(meta.title).toContain("퀵스타트");
      expect(meta.description).toBe(docsPage("quickstart")?.summary.ko);
      expect(meta.alternates.canonical).toBe("/ko/docs/quickstart");
    });

    it("두 로케일 모두 → 같은 hreflang 쌍(en·ko·x-default)을 알린다(한쪽만 색인되지 않게)", () => {
      const expected = docsAlternates("api");
      LOCALES.forEach((locale) => {
        expect(docsMetadata("api", locale).alternates.languages).toEqual(expected);
      });
    });

    it("metadataBase 는 설정하지 않는다 → 사이트 절대 URL 소유는 #118 의 lib/site.ts 다", () => {
      expect(Object.keys(docsMetadata("", "en"))).toEqual(["title", "description", "alternates"]);
      expect(Object.keys(docsMetadata("", "ko"))).toEqual(["title", "description", "alternates"]);
    });

    it("매니페스트에 없는 슬러그로 metadata 를 만들면 → 조용히 넘어가지 않고 던진다", () => {
      expect(() => docsMetadata("nope", "en")).toThrow(/unknown docs slug/);
      expect(() => docsMetadata("nope", "ko")).toThrow(/unknown docs slug/);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  DOCS_PAGES,
  DOCS_ROOT,
  docsHref,
  docsMetadata,
  docsNeighbours,
  docsPage,
  docsSections,
} from "./docs-manifest";

describe("docs 매니페스트 (#121)", () => {
  it("슬러그가 전부 유일하다 → 두 페이지가 같은 URL 을 주장하지 않는다", () => {
    const slugs = DOCS_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("루트(빈 슬러그) 페이지가 정확히 하나이고 배열의 첫 항목이다 → /docs 진입점이 하나로 정해진다", () => {
    expect(DOCS_PAGES.filter((p) => p.slug === "")).toHaveLength(1);
    expect(DOCS_PAGES[0].slug).toBe("");
  });

  it("모든 페이지가 제목·요약을 갖는다 → 사이드바 라벨과 meta description 이 비어 있지 않다", () => {
    DOCS_PAGES.forEach((page) => {
      expect(page.title.trim().length).toBeGreaterThan(0);
      expect(page.summary.trim().length).toBeGreaterThan(0);
    });
  });

  it("루트 슬러그면 → href 가 /docs, 그 외에는 → /docs/<slug>", () => {
    expect(docsHref("")).toBe(DOCS_ROOT);
    expect(docsHref("quickstart")).toBe("/docs/quickstart");
  });

  it("매니페스트에 있는 슬러그면 → 그 페이지를, 없는 슬러그면 → undefined 를 돌려준다", () => {
    expect(docsPage("concepts")?.title).toBe("Concepts");
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
  });

  describe("사이드바 그룹", () => {
    it("섹션으로 묶어도 → 페이지 순서는 매니페스트 순서 그대로다", () => {
      const flattened = docsSections().flatMap((group) => group.pages);
      expect(flattened).toEqual(DOCS_PAGES);
    });

    it("같은 섹션이 두 그룹으로 쪼개지지 않는다 → 매니페스트에서 섹션이 붙어 있다", () => {
      const sections = docsSections().map((group) => group.section);
      expect(new Set(sections).size).toBe(sections.length);
    });
  });

  describe("페이지 metadata", () => {
    it("페이지 metadata 는 → 제목·설명·상대 canonical 을 매니페스트에서 파생한다", () => {
      const meta = docsMetadata("quickstart");
      expect(meta.title).toContain("Quickstart");
      expect(meta.description).toBe(docsPage("quickstart")?.summary);
      expect(meta.alternates.canonical).toBe("/docs/quickstart");
    });

    it("metadataBase 는 설정하지 않는다 → 사이트 절대 URL 소유는 #118 의 lib/site.ts 다", () => {
      expect(Object.keys(docsMetadata(""))).toEqual(["title", "description", "alternates"]);
    });

    it("매니페스트에 없는 슬러그로 metadata 를 만들면 → 조용히 넘어가지 않고 던진다", () => {
      expect(() => docsMetadata("nope")).toThrow(/unknown docs slug/);
    });
  });
});

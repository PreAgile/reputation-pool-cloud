import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Metadata } from "next";
import { DOCS_PAGES, docsAlternates, docsHref, docsPage } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import DocsIntroPage, { metadata as introMeta } from "./page";
import DocsQuickstartPage, { metadata as quickstartMeta } from "./quickstart/page";
import DocsConceptsPage, { metadata as conceptsMeta } from "./concepts/page";
import DocsAuthenticationPage, { metadata as authMeta } from "./authentication/page";
import DocsApiPage, { metadata as apiMeta } from "./api/page";
import DocsFaqPage, { metadata as faqMeta } from "./faq/page";

/**
 * 매니페스트의 여섯 페이지가 실제로 존재하고 렌더되는지 한 곳에서 확인한다 — 매니페스트에 항목을
 * 추가하고 페이지를 만들지 않으면(또는 그 반대) 사이드바가 404 로 이어지는데, 그건 배포 전에 잡혀야 한다.
 *
 * 한국어 라우트에는 같은 구조의 `app/ko/docs/pages.test.tsx` 가 있다. 두 파일이 각각 자기 로케일의
 * 1:1 대응을 잠그므로, 한 언어에만 페이지를 추가하면 반대쪽에서 실패한다 (#143).
 */
const ROUTES: { slug: string; Page: () => React.ReactElement; metadata: Metadata }[] = [
  { slug: "", Page: DocsIntroPage, metadata: introMeta },
  { slug: "quickstart", Page: DocsQuickstartPage, metadata: quickstartMeta },
  { slug: "concepts", Page: DocsConceptsPage, metadata: conceptsMeta },
  { slug: "authentication", Page: DocsAuthenticationPage, metadata: authMeta },
  { slug: "api", Page: DocsApiPage, metadata: apiMeta },
  { slug: "faq", Page: DocsFaqPage, metadata: faqMeta },
];

describe("영어 docs 페이지 여섯 개 (#121)", () => {
  it("매니페스트 항목과 실제 라우트가 1:1 로 대응한다 → 사이드바 링크가 빈 곳을 가리키지 않는다", () => {
    expect(ROUTES.map((r) => r.slug)).toEqual(DOCS_PAGES.map((p) => p.slug));
  });

  ROUTES.forEach(({ slug, Page, metadata }) => {
    const expected = docsPage(slug)!;

    it(`${docsHref(slug, "en")} → h1 과 리드가 매니페스트의 영어 제목·요약과 일치한다`, () => {
      render(<Page />);
      expect(screen.getByRole("heading", { level: 1, name: expected.title.en })).toBeInTheDocument();
      expect(screen.getByText(expected.summary.en)).toBeInTheDocument();
    });

    it(`${docsHref(slug, "en")} → canonical 이 영어 경로이고 metadataBase 를 설정하지 않는다`, () => {
      expect(metadata.alternates?.canonical).toBe(docsHref(slug, "en"));
      expect(metadata.description).toBe(expected.summary.en);
      expect(metadata.metadataBase).toBeUndefined();
    });

    // #121 시점에는 영어 한 벌뿐이라 hreflang 이 없었다. 한국어 문서가 생긴 뒤에는 두 언어가 각각
    // 색인되어야 하므로, 영어 페이지도 한국어 대안을 알려야 한다(#143).
    it(`${docsHref(slug, "en")} → hreflang 이 en·ko·x-default 를 모두 가리킨다`, () => {
      expect(metadata.alternates?.languages).toEqual(docsAlternates(slug));
    });

    it(`${docsHref(slug, "en")} → a11y: critical/serious 위반이 없다`, async () => {
      const { container } = render(<Page />);
      expect(await seriousViolations(container)).toEqual([]);
    });
  });
});

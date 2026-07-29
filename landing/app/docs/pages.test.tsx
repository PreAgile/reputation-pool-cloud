import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Metadata } from "next";
import { DOCS_PAGES, docsHref, docsPage } from "@/lib/docs-manifest";
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
 */
const ROUTES: { slug: string; Page: () => React.ReactElement; metadata: Metadata }[] = [
  { slug: "", Page: DocsIntroPage, metadata: introMeta },
  { slug: "quickstart", Page: DocsQuickstartPage, metadata: quickstartMeta },
  { slug: "concepts", Page: DocsConceptsPage, metadata: conceptsMeta },
  { slug: "authentication", Page: DocsAuthenticationPage, metadata: authMeta },
  { slug: "api", Page: DocsApiPage, metadata: apiMeta },
  { slug: "faq", Page: DocsFaqPage, metadata: faqMeta },
];

describe("docs 페이지 여섯 개 (#121)", () => {
  it("매니페스트 항목과 실제 라우트가 1:1 로 대응한다 → 사이드바 링크가 빈 곳을 가리키지 않는다", () => {
    expect(ROUTES.map((r) => r.slug)).toEqual(DOCS_PAGES.map((p) => p.slug));
  });

  ROUTES.forEach(({ slug, Page, metadata }) => {
    const expected = docsPage(slug)!;

    it(`${docsHref(slug)} → h1 과 리드가 매니페스트의 제목·요약과 일치한다`, () => {
      render(<Page />);
      expect(screen.getByRole("heading", { level: 1, name: expected.title })).toBeInTheDocument();
      expect(screen.getByText(expected.summary)).toBeInTheDocument();
    });

    it(`${docsHref(slug)} → metadata 가 상대 canonical 을 갖고 metadataBase 를 설정하지 않는다`, () => {
      expect(metadata.alternates?.canonical).toBe(docsHref(slug));
      expect(metadata.description).toBe(expected.summary);
      expect(metadata.metadataBase).toBeUndefined();
    });

    it(`${docsHref(slug)} → a11y: critical/serious 위반이 없다`, async () => {
      const { container } = render(<Page />);
      expect(await seriousViolations(container)).toEqual([]);
    });
  });
});

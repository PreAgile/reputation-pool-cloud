import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Metadata } from "next";
import { DOCS_PAGES, docsAlternates, docsHref, docsPage } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import DocsIntroPageKo, { metadata as introMeta } from "./page";
import DocsQuickstartPageKo, { metadata as quickstartMeta } from "./quickstart/page";
import DocsConceptsPageKo, { metadata as conceptsMeta } from "./concepts/page";
import DocsAuthenticationPageKo, { metadata as authMeta } from "./authentication/page";
import DocsApiPageKo, { metadata as apiMeta } from "./api/page";
import DocsFaqPageKo, { metadata as faqMeta } from "./faq/page";

/**
 * 한국어 docs 여섯 페이지 (#143). 영어 쪽 `app/docs/pages.test.tsx` 와 짝이다 — 두 파일이 각각 자기
 * 로케일의 매니페스트 대응을 잠그므로, 한 언어에만 페이지를 추가하면 반대쪽에서 실패한다.
 */
const ROUTES: { slug: string; Page: () => React.ReactElement; metadata: Metadata }[] = [
  { slug: "", Page: DocsIntroPageKo, metadata: introMeta },
  { slug: "quickstart", Page: DocsQuickstartPageKo, metadata: quickstartMeta },
  { slug: "concepts", Page: DocsConceptsPageKo, metadata: conceptsMeta },
  { slug: "authentication", Page: DocsAuthenticationPageKo, metadata: authMeta },
  { slug: "api", Page: DocsApiPageKo, metadata: apiMeta },
  { slug: "faq", Page: DocsFaqPageKo, metadata: faqMeta },
];

describe("한국어 docs 페이지 여섯 개 (#143)", () => {
  it("매니페스트 항목과 한국어 라우트가 1:1 로 대응한다 → 스위처가 없는 페이지를 가리키지 않는다", () => {
    expect(ROUTES.map((r) => r.slug)).toEqual(DOCS_PAGES.map((p) => p.slug));
  });

  ROUTES.forEach(({ slug, Page, metadata }) => {
    const expected = docsPage(slug)!;

    it(`${docsHref(slug, "ko")} → h1 과 리드가 매니페스트의 한국어 제목·요약과 일치한다`, () => {
      render(<Page />);
      expect(screen.getByRole("heading", { level: 1, name: expected.title.ko })).toBeInTheDocument();
      expect(screen.getByText(expected.summary.ko)).toBeInTheDocument();
    });

    it(`${docsHref(slug, "ko")} → canonical 이 /ko/docs 경로이고 metadataBase 를 설정하지 않는다`, () => {
      expect(metadata.alternates?.canonical).toBe(docsHref(slug, "ko"));
      expect(metadata.description).toBe(expected.summary.ko);
      expect(metadata.metadataBase).toBeUndefined();
    });

    it(`${docsHref(slug, "ko")} → hreflang 이 en·ko·x-default(영어)를 가리킨다`, () => {
      expect(metadata.alternates?.languages).toEqual(docsAlternates(slug));
    });

    // 문서 안의 내부 링크가 영어로 새면 독자가 문서 중간에서 언어를 잃는다. `DocsLink` 가 슬러그+로케일로
    // URL 을 만들므로 구조적으로 막혀 있지만, 페이지가 직접 `<a href>` 를 적을 수는 있으므로 확인한다.
    it(`${docsHref(slug, "ko")} → 내부 docs 링크가 모두 /ko/docs 아래에 머문다`, () => {
      const { container } = render(<Page />);
      const internal = [...container.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")!);
      expect(internal.length).toBeGreaterThan(0);
      internal
        .filter((href) => href.includes("/docs"))
        .forEach((href) => expect(href.startsWith("/ko/docs")).toBe(true));
    });

    it(`${docsHref(slug, "ko")} → a11y: critical/serious 위반이 없다`, async () => {
      const { container } = render(<Page />);
      expect(await seriousViolations(container)).toEqual([]);
    });
  });

  it("한국어 소개 페이지가 → 코드 식별자는 영어로 두고 산문만 한국어다", () => {
    const { container } = render(<DocsIntroPageKo />);
    // 도메인 타입·RPC 이름은 번역하지 않는다 — 콘솔과 응답에 그 문자열이 그대로 나온다.
    expect(within(container).getAllByText("Register").length).toBeGreaterThan(0);
    expect(within(container).getAllByText("x-api-key").length).toBeGreaterThan(0);
    expect(within(container).getAllByText("ReputationAdvisor").length).toBeGreaterThan(0);
    // 산문은 한국어다.
    expect(container.textContent).toContain("호스티드 평판");
  });

  it("한국어 퀵스타트가 → 영어판과 같은 TypeScript 예제 문자열을 쓴다(코드를 복제하지 않는다)", async () => {
    const { TYPESCRIPT_WORKER_EXAMPLE } = await import("@/app/docs/quickstart/typescript-example");
    const { container } = render(<DocsQuickstartPageKo />);
    expect(container.textContent).toContain(TYPESCRIPT_WORKER_EXAMPLE);
  });
});

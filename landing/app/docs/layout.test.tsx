import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DOCS_PAGES, docsAlternates, docsHref } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import DocsLayout from "./layout";
import DocsIntroPage, { metadata } from "./page";

// 마케팅 셸(ThemeToggle)과 사이드바·스위처(usePathname)가 쓰는 훅만 대체한다.
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs" }));

/** 레이아웃 + 소개 페이지를 실제 조합대로 렌더한다(사이드바·본문·prev/next·푸터). */
function renderDocs() {
  return render(
    <DocsLayout>
      <DocsIntroPage />
    </DocsLayout>,
  );
}

describe("영어 docs 셸 + Introduction (#121)", () => {
  it("마케팅 nav·사이드바·푸터를 상속한 채 문서 본문을 렌더한다", () => {
    renderDocs();

    // 마케팅 셸: 랜딩과 같은 nav(Primary)와 Get started CTA.
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Get started" }).length).toBeGreaterThan(0);

    // 사이드바: 매니페스트 전 페이지 + 현재 페이지 강조.
    const sidebar = screen.getByRole("navigation", { name: "Docs" });
    expect(within(sidebar).getAllByRole("link")).toHaveLength(DOCS_PAGES.length);
    expect(within(sidebar).getByRole("link", { name: "Introduction" })).toHaveAttribute("aria-current", "page");

    // 본문: h1 은 매니페스트 제목, 하위 섹션 헤딩이 함께 나온다.
    expect(screen.getByRole("heading", { level: 1, name: "Introduction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hosted API vs the open-source engine" })).toBeInTheDocument();
  });

  it("첫 페이지이므로 → 하단 페이저에 Previous 가 없고 Next 만 Quickstart 로 간다", () => {
    renderDocs();

    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).queryByText(/Previous/)).not.toBeInTheDocument();
    expect(within(pager).getByRole("link")).toHaveAttribute("href", docsHref("quickstart", "en"));
  });

  it("본문이 나머지 문서와 엔진 레포로 이어진다 → GitHub 링크는 신뢰 신호로 남는다", () => {
    renderDocs();

    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("link", { name: /Quickstart/ })[0]).toHaveAttribute(
      "href",
      "/docs/quickstart",
    );
    expect(within(main).getAllByRole("link", { name: /Concepts/ })[0]).toHaveAttribute("href", "/docs/concepts");
    expect(within(main).getByRole("link", { name: /PreAgile\/reputation-pool/ })).toHaveAttribute(
      "href",
      "https://github.com/PreAgile/reputation-pool",
    );
  });

  // 영어 문서의 nav Docs 링크는 로케일 프리픽스가 없는 `/docs` 다 — 로케일을 유지한다는 규칙의 영어 쪽 결과.
  it("nav 의 Docs 링크가 영어 docs 루트를 가리킨다", () => {
    renderDocs();
    expect(screen.getAllByRole("link", { name: "Docs" })[0]).toHaveAttribute("href", "/docs");
  });

  // 사이트 절대 URL 의 단일 출처는 `lib/site.ts`(#118) 다. docs 페이지는 자기 오리진을 다시 선언하지 않고
  // 상대 canonical 만 두므로, 절대 URL 은 상위 metadataBase 한 곳에서 결정된다.
  it("SEO: canonical 이 상대 경로 /docs 이고 metadataBase 를 설정하지 않는다", () => {
    expect(metadata.alternates?.canonical).toBe("/docs");
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.title).toContain("Introduction");
  });

  it("SEO: hreflang 이 한국어 대안(/ko/docs)을 함께 알린다", () => {
    expect(metadata.alternates?.languages).toEqual(docsAlternates(""));
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = renderDocs();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

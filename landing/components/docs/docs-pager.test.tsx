import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";
import { LOCALES } from "@/lib/locale";
import { DocsPager } from "./docs-pager";

const FIRST = DOCS_PAGES[0];
const LAST = DOCS_PAGES[DOCS_PAGES.length - 1];

/** 로케일별 페이저 nav 의 접근 가능한 이름 — 컴포넌트와 같은 값을 테스트에서도 명시한다. */
const NAV_NAME = { en: "Pagination", ko: "문서 페이지 이동" } as const;

describe("DocsPager: 매니페스트 순서를 따르는 본문 하단 prev/next (#121, 로케일 #143)", () => {
  it("첫 페이지면 → Previous 가 없고 Next 만 두 번째 페이지로 간다", () => {
    render(<DocsPager slug={FIRST.slug} locale="en" />);

    const nav = screen.getByRole("navigation", { name: NAV_NAME.en });
    expect(within(nav).queryByText(/Previous/)).not.toBeInTheDocument();
    const next = within(nav).getByRole("link");
    expect(next).toHaveAttribute("href", docsHref(DOCS_PAGES[1].slug, "en"));
    expect(next).toHaveTextContent(DOCS_PAGES[1].title.en);
  });

  it("마지막 페이지면 → Next 가 없고 Previous 만 직전 페이지로 간다", () => {
    render(<DocsPager slug={LAST.slug} locale="en" />);

    const nav = screen.getByRole("navigation", { name: NAV_NAME.en });
    expect(within(nav).queryByText(/Next/)).not.toBeInTheDocument();
    const prev = within(nav).getByRole("link");
    expect(prev).toHaveAttribute("href", docsHref(DOCS_PAGES[DOCS_PAGES.length - 2].slug, "en"));
    expect(prev).toHaveTextContent(DOCS_PAGES[DOCS_PAGES.length - 2].title.en);
  });

  it("가운데 페이지면 → 양쪽 링크가 매니페스트의 앞·뒤 페이지를 가리킨다", () => {
    render(<DocsPager slug={DOCS_PAGES[2].slug} locale="en" />);

    const nav = screen.getByRole("navigation", { name: NAV_NAME.en });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([docsHref(DOCS_PAGES[1].slug, "en"), docsHref(DOCS_PAGES[3].slug, "en")]);
  });

  it("매니페스트에 없는 슬러그면 → 아무것도 렌더하지 않는다(빈 페이저를 남기지 않는다)", () => {
    render(<DocsPager slug="nope" locale="en" />);
    expect(screen.queryByRole("navigation", { name: NAV_NAME.en })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: NAV_NAME.ko })).not.toBeInTheDocument();
  });

  describe("한국어 로케일", () => {
    it("첫 페이지면 → 이전이 없고 다음만 두 번째 한국어 페이지로 간다", () => {
      render(<DocsPager slug={FIRST.slug} locale="ko" />);

      const nav = screen.getByRole("navigation", { name: NAV_NAME.ko });
      expect(within(nav).queryByText(/이전/)).not.toBeInTheDocument();
      const next = within(nav).getByRole("link");
      expect(next).toHaveAttribute("href", docsHref(DOCS_PAGES[1].slug, "ko"));
      expect(next).toHaveTextContent(DOCS_PAGES[1].title.ko);
    });

    it("마지막 페이지면 → 다음이 없고 이전만 직전 한국어 페이지로 간다", () => {
      render(<DocsPager slug={LAST.slug} locale="ko" />);

      const nav = screen.getByRole("navigation", { name: NAV_NAME.ko });
      expect(within(nav).queryByText(/다음/)).not.toBeInTheDocument();
      const prev = within(nav).getByRole("link");
      expect(prev).toHaveAttribute("href", docsHref(DOCS_PAGES[DOCS_PAGES.length - 2].slug, "ko"));
      expect(prev).toHaveTextContent(DOCS_PAGES[DOCS_PAGES.length - 2].title.ko);
    });
  });

  // 이 페이저의 계약에서 가장 중요한 한 가지: 순서대로 읽다가 언어가 바뀌면 안 된다.
  it("어느 로케일이든 → prev/next 가 그 로케일 루트를 벗어나지 않는다(en↔ko 를 교차 링크하지 않는다)", () => {
    const roots = { en: "/docs", ko: "/ko/docs" };
    LOCALES.forEach((locale) => {
      DOCS_PAGES.forEach((page) => {
        const { unmount } = render(<DocsPager slug={page.slug} locale={locale} />);
        const nav = screen.getByRole("navigation", { name: NAV_NAME[locale] });
        within(nav)
          .getAllByRole("link")
          .forEach((a) => {
            const href = a.getAttribute("href")!;
            expect(href.startsWith(roots[locale])).toBe(true);
            // `/docs` 는 `/ko/docs` 의 접두사가 아니지만 그 역은 아니므로, 한국어 페이저가 영어 링크를
            // 들고 있는 경우를 따로 못 박는다.
            if (locale === "ko") expect(href.startsWith("/ko/")).toBe(true);
            else expect(href.startsWith("/ko/")).toBe(false);
          });
        unmount();
      });
    });
  });
});

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";
import { DocsPager } from "./docs-pager";

const FIRST = DOCS_PAGES[0];
const LAST = DOCS_PAGES[DOCS_PAGES.length - 1];

describe("DocsPager: 매니페스트 순서를 따르는 본문 하단 prev/next (#121)", () => {
  it("첫 페이지면 → Previous 가 없고 Next 만 두 번째 페이지로 간다", () => {
    render(<DocsPager slug={FIRST.slug} />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).queryByText(/Previous/)).not.toBeInTheDocument();
    const next = within(nav).getByRole("link");
    expect(next).toHaveAttribute("href", docsHref(DOCS_PAGES[1].slug));
    expect(next).toHaveTextContent(DOCS_PAGES[1].title);
  });

  it("마지막 페이지면 → Next 가 없고 Previous 만 직전 페이지로 간다", () => {
    render(<DocsPager slug={LAST.slug} />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).queryByText(/Next/)).not.toBeInTheDocument();
    const prev = within(nav).getByRole("link");
    expect(prev).toHaveAttribute("href", docsHref(DOCS_PAGES[DOCS_PAGES.length - 2].slug));
    expect(prev).toHaveTextContent(DOCS_PAGES[DOCS_PAGES.length - 2].title);
  });

  it("가운데 페이지면 → 양쪽 링크가 매니페스트의 앞·뒤 페이지를 가리킨다", () => {
    render(<DocsPager slug={DOCS_PAGES[2].slug} />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([docsHref(DOCS_PAGES[1].slug), docsHref(DOCS_PAGES[3].slug)]);
  });

  it("매니페스트에 없는 슬러그면 → 아무것도 렌더하지 않는다(빈 페이저를 남기지 않는다)", () => {
    render(<DocsPager slug="nope" />);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });
});

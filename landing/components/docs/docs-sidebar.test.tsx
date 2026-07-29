import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { DOCS_PAGES, docsHref, docsSections } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import { DocsSidebar } from "./docs-sidebar";

// 사이드바는 현재 페이지를 usePathname 으로 판별한다(AppShell 과 같은 방식).
const pathname = vi.hoisted(() => ({ current: "/docs" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("DocsSidebar: 매니페스트에서 파생된 docs 사이드바 (#121, 로케일 #143)", () => {
  it("매니페스트의 모든 페이지를 → 섹션 제목과 함께 순서대로 렌더한다", () => {
    pathname.current = "/docs";
    render(<DocsSidebar locale="en" label="Docs" />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    docsSections("en").forEach((group) => {
      expect(within(nav).getByText(group.label)).toBeInTheDocument();
    });

    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(DOCS_PAGES.map((p) => docsHref(p.slug, "en")));
    expect(links.map((a) => a.textContent)).toEqual(DOCS_PAGES.map((p) => p.title.en));
  });

  it("현재 경로가 어떤 페이지면 → 그 링크만 aria-current=page 로 표시된다", () => {
    pathname.current = "/docs/concepts";
    render(<DocsSidebar locale="en" label="Docs" />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Concepts");
  });

  it("루트(/docs)에 있으면 → Introduction 만 활성이고 하위 페이지는 활성이 아니다(접두사 일치로 새지 않는다)", () => {
    pathname.current = "/docs";
    render(<DocsSidebar locale="en" label="Docs" />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    expect(within(nav).getByRole("link", { name: "Introduction" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Quickstart" })).not.toHaveAttribute("aria-current");
  });

  it("모바일 토글을 누르면 → 목록이 열리고 다시 누르면 닫힌다(목록 DOM 은 한 벌뿐이다)", () => {
    pathname.current = "/docs";
    render(<DocsSidebar locale="en" label="Docs" />);

    const toggle = screen.getByRole("button", { name: "Docs" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // 데스크톱/모바일 목록을 따로 렌더하지 않으므로 링크가 페이지 수만큼만 존재한다.
    expect(screen.getAllByRole("link")).toHaveLength(DOCS_PAGES.length);
  });

  describe("한국어 로케일", () => {
    it("모든 링크가 /ko/docs 아래에 머문다 → 사이드바 클릭 한 번에 언어가 바뀌지 않는다", () => {
      pathname.current = "/ko/docs";
      render(<DocsSidebar locale="ko" label="문서" />);

      const nav = screen.getByRole("navigation", { name: "문서" });
      const hrefs = within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(DOCS_PAGES.map((p) => docsHref(p.slug, "ko")));
      hrefs.forEach((href) => expect(href!.startsWith("/ko/docs")).toBe(true));
    });

    it("라벨과 섹션 제목이 한국어다 → 사이드바가 본문과 같은 언어로 읽힌다", () => {
      pathname.current = "/ko/docs";
      render(<DocsSidebar locale="ko" label="문서" />);

      const nav = screen.getByRole("navigation", { name: "문서" });
      expect(within(nav).getByText("시작하기")).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "퀵스타트" })).toBeInTheDocument();
    });

    it("한국어 하위 페이지에 있으면 → 그 한국어 링크만 활성이다", () => {
      pathname.current = "/ko/docs/concepts";
      render(<DocsSidebar locale="ko" label="문서" />);

      const nav = screen.getByRole("navigation", { name: "문서" });
      const current = within(nav)
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page");
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent("핵심 개념");
    });

    it("a11y: critical/serious 위반이 없다", async () => {
      pathname.current = "/ko/docs";
      const { container } = render(<DocsSidebar locale="ko" label="문서" />);
      expect(await seriousViolations(container)).toEqual([]);
    });
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    pathname.current = "/docs";
    const { container } = render(<DocsSidebar locale="en" label="Docs" />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

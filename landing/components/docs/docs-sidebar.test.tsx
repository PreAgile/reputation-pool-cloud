import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { DOCS_PAGES, docsHref, docsSections } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import { DocsSidebar } from "./docs-sidebar";

// 사이드바는 현재 페이지를 usePathname 으로 판별한다(AppShell 과 같은 방식).
const pathname = vi.hoisted(() => ({ current: "/docs" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("DocsSidebar: 매니페스트에서 파생된 docs 사이드바 (#121)", () => {
  it("매니페스트의 모든 페이지를 → 섹션 제목과 함께 순서대로 렌더한다", () => {
    pathname.current = "/docs";
    render(<DocsSidebar />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    docsSections().forEach((group) => {
      expect(within(nav).getByText(group.section)).toBeInTheDocument();
    });

    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(DOCS_PAGES.map((p) => docsHref(p.slug)));
    expect(links.map((a) => a.textContent)).toEqual(DOCS_PAGES.map((p) => p.title));
  });

  it("현재 경로가 어떤 페이지면 → 그 링크만 aria-current=page 로 표시된다", () => {
    pathname.current = "/docs/concepts";
    render(<DocsSidebar />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Concepts");
  });

  it("루트(/docs)에 있으면 → Introduction 만 활성이고 하위 페이지는 활성이 아니다(접두사 일치로 새지 않는다)", () => {
    pathname.current = "/docs";
    render(<DocsSidebar />);

    const nav = screen.getByRole("navigation", { name: "Docs" });
    expect(within(nav).getByRole("link", { name: "Introduction" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Quickstart" })).not.toHaveAttribute("aria-current");
  });

  it("모바일 토글을 누르면 → 목록이 열리고 다시 누르면 닫힌다(목록 DOM 은 한 벌뿐이다)", () => {
    pathname.current = "/docs";
    render(<DocsSidebar />);

    const toggle = screen.getByRole("button", { name: "Docs" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // 데스크톱/모바일 목록을 따로 렌더하지 않으므로 링크가 페이지 수만큼만 존재한다.
    expect(screen.getAllByRole("link")).toHaveLength(DOCS_PAGES.length);
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    pathname.current = "/docs";
    const { container } = render(<DocsSidebar />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DOCS_PAGES, docsAlternates, docsHref } from "@/lib/docs-manifest";
import { seriousViolations } from "@/test/a11y";
import DocsLayoutKo from "./layout";
import DocsIntroPageKo, { metadata } from "./page";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ko/docs" }));

/** 한국어 레이아웃 + 한국어 소개 페이지를 실제 조합대로 렌더한다. */
function renderDocsKo() {
  return render(
    <DocsLayoutKo>
      <DocsIntroPageKo />
    </DocsLayoutKo>,
  );
}

describe("한국어 docs 셸 + 소개 (#143)", () => {
  it("영어 셸과 같은 구조(nav·사이드바·푸터)를 한국어 사전으로 렌더한다", () => {
    renderDocsKo();

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "시작하기" }).length).toBeGreaterThan(0);

    const sidebar = screen.getByRole("navigation", { name: "문서" });
    expect(within(sidebar).getAllByRole("link")).toHaveLength(DOCS_PAGES.length);
    expect(within(sidebar).getByRole("link", { name: "소개" })).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("heading", { level: 1, name: "소개" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "호스티드 API 와 오픈소스 엔진" })).toBeInTheDocument();
  });

  it("셸의 lang 이 ko 다 → 스크린리더가 첫 화면부터 한국어로 읽는다", () => {
    const { container } = renderDocsKo();
    expect(container.querySelector("[lang='ko']")).not.toBeNull();
  });

  it("nav 의 문서 링크가 /ko/docs 를 가리킨다 → 한국어 방문자가 영어 문서로 떨어지지 않는다", () => {
    renderDocsKo();
    screen
      .getAllByRole("link", { name: "문서" })
      .forEach((a) => expect(a).toHaveAttribute("href", "/ko/docs"));
  });

  it("첫 페이지이므로 → 페이저에 이전이 없고 다음만 한국어 퀵스타트로 간다", () => {
    renderDocsKo();

    const pager = screen.getByRole("navigation", { name: "문서 페이지 이동" });
    expect(within(pager).queryByText(/이전/)).not.toBeInTheDocument();
    expect(within(pager).getByRole("link")).toHaveAttribute("href", docsHref("quickstart", "ko"));
  });

  // 이 PR 의 사용자 관점 종료 기준: 한국어 문서 위에서 **누르지 않아도** 영어로 건너갈 링크가 보인다.
  it("언어 스위처가 상호작용 없이 → 랜딩이 아니라 같은 문서의 영어판(/docs)을 가리킨다", () => {
    renderDocsKo();

    const switcher = screen.getByRole("navigation", { name: "언어" });
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("href", "/docs");
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/docs");
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("aria-current", "true");
  });

  it("SEO: canonical 이 /ko/docs 이고 hreflang 이 en·ko·x-default 를 가리킨다", () => {
    expect(metadata.alternates?.canonical).toBe("/ko/docs");
    expect(metadata.alternates?.languages).toEqual(docsAlternates(""));
    expect(metadata.metadataBase).toBeUndefined();
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = renderDocsKo();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

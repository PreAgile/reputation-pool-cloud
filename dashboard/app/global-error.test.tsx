import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "./global-error";

/**
 * `global-error` 는 루트 레이아웃이 깨졌을 때만 렌더된다. 그래서 두 가지가 계약이다.
 *   1. **자체 `<html>`/`<body>` 를 그린다** — 대체하는 대상이 루트 레이아웃이므로, 안 그리면 문서
 *      구조가 성립하지 않는다.
 *   2. **앱의 CSS 에 의존하지 않는다** — `globals.css` 는 그 깨진 레이아웃이 import 한다. Tailwind
 *      클래스를 쓰면 스타일 없는 흰 화면이 될 수 있어, 자기 자신이 들고 있는 `<style>` 만 쓴다.
 *      이 두 번째 항목이 눈에 안 보이는 회귀라 테스트로 못 박는다.
 *
 * 문서 구조는 `renderToStaticMarkup` 으로 본다. React 19 는 클라이언트 렌더에서 `<html>`·`<body>` 를
 * 실제 문서의 것과 합쳐 버려 jsdom 컨테이너에는 남지 않는다 — 마크업을 직접 보면 그 구현 세부에
 * 흔들리지 않고, 이 화면이 실제로 서버 렌더되는 경로와도 같다.
 */
describe("치명적 에러 화면 (#134)", () => {
  const reset = vi.fn();
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset.mockClear();
    // 컴포넌트가 원본 에러를 브라우저 콘솔에 남긴다 — 테스트 출력이 그것으로 덮이지 않게 가린다.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    document.documentElement.lang = "ko";
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const error = Object.assign(new Error("루트 레이아웃 붕괴"), { digest: "aa11bb22" });

  it("루트 레이아웃을 대체하므로 → 자체 <html lang> 과 <body> 를 렌더한다", () => {
    const markup = renderToStaticMarkup(<GlobalError error={error} reset={reset} />);

    expect(markup).toMatch(/^<html lang="ko">/);
    expect(markup).toContain("<body>");
  });

  it("앱 CSS 가 없다고 가정한다 → 스타일을 자체 <style> 로 들고 오고 Tailwind 클래스에 기대지 않는다", () => {
    const markup = renderToStaticMarkup(<GlobalError error={error} reset={reset} />);

    expect(markup).toContain("prefers-color-scheme: dark");
    // 앱 CSS 에서만 정의되는 유틸(bg-bg·text-ink 등)이 섞여 들어오면 흰 화면 회귀의 씨앗이 된다.
    expect(markup).not.toMatch(/class="[^"]*\b(bg-bg|bg-surface|text-ink|text-muted)\b/);
  });

  it("새로 불러오기를 누르면 → reset() 이 호출된다 (여기서 할 수 있는 유일한 복구)", () => {
    render(<GlobalError error={error} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "새로 불러오기" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("digest 가 있으면 → 오류 식별자를 남긴다 (문의할 때 서버 로그를 찾을 유일한 단서)", () => {
    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByText(/오류 식별자: aa11bb22/)).toBeInTheDocument();
  });
});

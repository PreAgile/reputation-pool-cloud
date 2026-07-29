import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import RouteError from "./error";

/**
 * 런타임 에러 경계에서 중요한 것은 두 가지다.
 *   1. **되돌아갈 수 있는가** — `reset()` 이 실제로 불려야 세그먼트만 다시 렌더돼 하던 일이 유지된다.
 *   2. **서버 에러 내용을 흘리지 않는가** — 프로덕션에서 `error.message` 는 이미 가려지지만, 화면이
 *      그것을 표시하도록 만들어 두면 개발 빌드나 클라이언트 에러에서는 그대로 노출된다. 사용자에게
 *      주는 것은 서버 로그를 가리키는 `digest` 하나뿐이어야 한다.
 */
describe("런타임 에러 화면 (#134)", () => {
  const reset = vi.fn();
  // 컴포넌트가 원본 에러를 브라우저 콘솔에 남긴다 — 테스트 출력이 그것으로 덮이지 않게 가린다.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset.mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    document.documentElement.lang = "ko";
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function boom(digest?: string) {
    return Object.assign(new Error("DB 커넥션 풀 고갈: jdbc:postgresql://db:5432/app"), { digest });
  }

  it("다시 시도를 누르면 → reset() 이 호출된다 (전체 새로고침 없이 세그먼트만 복구)", () => {
    render(<RouteError error={boom()} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("digest 가 있으면 → 오류 식별자만 보여주고 에러 메시지는 화면에 남기지 않는다", () => {
    render(<RouteError error={boom("9f2c41ab")} reset={reset} />);

    expect(screen.getByText(/오류 식별자: 9f2c41ab/)).toBeInTheDocument();
    expect(screen.queryByText(/jdbc:postgresql/)).not.toBeInTheDocument();
  });

  it("digest 가 없으면(클라이언트 에러) → 식별자 줄을 아예 그리지 않는다", () => {
    render(<RouteError error={boom()} reset={reset} />);

    expect(screen.queryByText(/오류 식별자/)).not.toBeInTheDocument();
  });

  it("원본 에러는 브라우저 콘솔로 보낸다 → 화면에서 가린 정보를 개발자가 F12 로 볼 수 있다", () => {
    const error = boom("9f2c41ab");

    render(<RouteError error={error} reset={reset} />);

    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("영어 랜딩에서 터진 에러면(<html lang=\"en\">) → 영어 문구로 나온다", () => {
    document.documentElement.lang = "en";

    render(<RouteError error={boom()} reset={reset} />);

    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t load this screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("색인 대상이 아니다 → noindex meta 를 함께 렌더한다 (에러 화면은 200 으로 나갈 수 있다)", () => {
    render(<RouteError error={boom()} reset={reset} />);

    // React 19 가 <meta> 를 <head> 로 끌어올린다 — 컨테이너가 아니라 document.head 에서 찾아야 한다.
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });

  it("axe 로 critical/serious 위반이 없다", async () => {
    const { container } = render(<RouteError error={boom("9f2c41ab")} reset={reset} />);

    expect(await seriousViolations(container)).toEqual([]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import { LOG_STARTED_ON } from "@/lib/incidents";
import { statusAlternates } from "@/lib/status";
import StatusRouteKo, { metadata } from "./page";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ko/status" }));

/**
 * 영어 라우트에 있는 단정을 한국어에서도 그대로 건다 (#143 의 docs 와 같은 방식). 이 화면의 값어치는
 * "모르는 것을 모른다고 말하는 것"에 있어서, 한쪽 언어에서만 고지가 빠지면 그 언어 독자는 수동 로그를
 * 자동 관측으로 오해한다.
 */
describe("한국어 상태 페이지 (#145)", () => {
  it("마케팅 셸을 상속한 채 한국어 상태 본문을 렌더한다", () => {
    render(<StatusRouteKo />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "서비스 상태" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "업타임" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "사고 로그" })).toBeInTheDocument();
  });

  it("로그가 비어 있으면 → '정상'이라 말하지 않고 '기록된 사고 없음'으로 표시한다", () => {
    render(<StatusRouteKo />);

    expect(screen.getByText("진행 중으로 기록된 사고가 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/아무도 열린 사고를 적지 않았다/)).toBeInTheDocument();
  });

  it("자동 관측이 없으므로 → 가용률 퍼센트를 한 개도 렌더하지 않는다", () => {
    const { container } = render(<StatusRouteKo />);

    expect(container.textContent).not.toMatch(/\d\s*%/);
    expect(screen.getByText(/가용률 수치가 없습니다/)).toBeInTheDocument();
  });

  it("업타임 섹션이 → 왜 아직 숫자가 없고 무엇이 그 자리에 들어올지 밝힌다", () => {
    render(<StatusRouteKo />);

    // 널리 쓰이는 제품 이름은 번역하지 않는다 — 두 로케일에서 같은 표기를 쓴다.
    expect(screen.getByText(/Prometheus/)).toBeInTheDocument();
    expect(screen.getByText(/UptimeRobot/)).toBeInTheDocument();
    expect(screen.getByText(/Cloudflare Worker/)).toBeInTheDocument();
  });

  it("사고 로그가 → 비어 있다는 사실과 기록 시작일을 함께 보여준다", () => {
    render(<StatusRouteKo />);

    expect(screen.getByText("기록된 사고가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("기록 시작")).toBeInTheDocument();
    expect(screen.getByText(LOG_STARTED_ON)).toBeInTheDocument();
  });

  it("푸터에서 한국어 상태 페이지로 링크한다 → 스위처를 누르지 않아도 로케일을 유지한다", () => {
    render(<StatusRouteKo />);

    expect(screen.getByRole("link", { name: "상태" })).toHaveAttribute("href", "/ko/status");
  });

  it("언어 스위처가 상호작용 없이 → 같은 페이지의 영어판(/status) 링크를 노출한다", () => {
    render(<StatusRouteKo />);

    const switcher = screen.getByRole("navigation", { name: "언어" });
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("href", "/status");
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/status");
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("aria-current", "true");
  });

  it("SEO: canonical 이 /ko/status 이고 hreflang 이 영어판과 같은 표를 쓴다", () => {
    expect(metadata.alternates?.canonical).toBe("/ko/status");
    expect(metadata.alternates?.languages).toEqual(statusAlternates());
    expect(metadata.metadataBase).toBeUndefined();
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<StatusRouteKo />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

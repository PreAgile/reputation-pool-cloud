import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import { LOG_STARTED_ON } from "@/lib/incidents";
import { statusAlternates } from "@/lib/status";
import StatusRoute, { metadata } from "./page";

// 마케팅 셸(ThemeToggle)과 언어 스위처(usePathname)가 쓰는 훅만 대체한다.
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/status" }));

describe("영어 상태 페이지 (#145)", () => {
  it("마케팅 셸을 상속한 채 상태 본문을 렌더한다", () => {
    render(<StatusRoute />);

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Service status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Uptime" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Incident log" })).toBeInTheDocument();
  });

  // 사고 로그가 비어 있다는 것은 "서비스가 정상"이 아니라 "아무도 열린 사고를 적지 않았다"이다.
  // 문구가 그 이상을 말하기 시작하면 이 페이지는 없느니만 못해진다.
  it("로그가 비어 있으면 → '정상'이라 말하지 않고 '기록된 사고 없음'으로 표시한다", () => {
    render(<StatusRoute />);

    expect(screen.getByText("No incident is currently recorded")).toBeInTheDocument();
    expect(screen.getByText(/nobody has recorded an open incident/i)).toBeInTheDocument();
    expect(screen.queryByText(/all systems (are )?operational/i)).not.toBeInTheDocument();
  });

  // 이번 슬라이스에는 외부 관측이 없다. 관측하지 않은 가용률은 측정이 아니라 주장이므로 화면 어디에도
  // 퍼센트가 있으면 안 된다 — 이 단정이 "그럴듯한 숫자를 채워 넣는" 실수를 막는다.
  it("자동 관측이 없으므로 → 가용률 퍼센트를 한 개도 렌더하지 않는다", () => {
    const { container } = render(<StatusRoute />);

    expect(container.textContent).not.toMatch(/\d\s*%/);
    expect(screen.getByText(/no uptime percentage here/i)).toBeInTheDocument();
  });

  // 데이터 출처 결정을 페이지가 직접 밝힌다(#145 의 표). Prometheus 를 탈락시킨 이유와 그 자리에
  // 무엇이 들어올지가 적혀 있어야, 빈 업타임 섹션이 방치가 아니라 결정으로 읽힌다.
  it("업타임 섹션이 → 왜 아직 숫자가 없고 무엇이 그 자리에 들어올지 밝힌다", () => {
    render(<StatusRoute />);

    expect(screen.getByText(/Prometheus metrics/)).toBeInTheDocument();
    expect(screen.getByText(/UptimeRobot/)).toBeInTheDocument();
  });

  it("사고 로그가 → 비어 있다는 사실과 기록 시작일을 함께 보여준다", () => {
    render(<StatusRoute />);

    expect(screen.getByText("No incident has been recorded.")).toBeInTheDocument();
    expect(screen.getByText("Recording since")).toBeInTheDocument();
    expect(screen.getByText(LOG_STARTED_ON)).toBeInTheDocument();
  });

  it("로그에 없는 문제를 알릴 경로(mailto)를 준다", () => {
    render(<StatusRoute />);

    const email = screen.getByRole("link", { name: "Email us" });
    expect(email.getAttribute("href") ?? "").toMatch(/^mailto:digle117@gmail.com/);
  });

  // 상태 페이지는 랜딩·docs 어느 화면에서 막혔든 같은 자리에서 찾을 수 있어야 한다 — 두 표면이
  // 공유하는 유일한 영역이 푸터다.
  it("푸터에서 상태 페이지로 링크한다", () => {
    render(<StatusRoute />);

    expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
  });

  it("언어 스위처가 상호작용 없이 → 같은 페이지의 한국어판(/ko/status) 링크를 노출한다", () => {
    render(<StatusRoute />);

    const switcher = screen.getByRole("navigation", { name: "Language" });
    expect(within(switcher).getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/status");
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("href", "/status");
    expect(within(switcher).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
  });

  it("SEO: canonical 이 상대 경로 /status 이고 metadataBase 를 설정하지 않는다", () => {
    expect(metadata.alternates?.canonical).toBe("/status");
    expect(metadata.metadataBase).toBeUndefined();
  });

  // `/status` 는 `/` 와 달리 로케일 자동 리다이렉트를 받지 않는다(미들웨어는 루트에서만 판별한다).
  // 두 언어판이 각각 색인되는 경로는 hreflang 과 사이트맵뿐이다.
  it("SEO: hreflang 이 en·ko·x-default 를 모두 가리킨다", () => {
    expect(metadata.alternates?.languages).toEqual(statusAlternates());
    expect(statusAlternates()).toEqual({ en: "/status", ko: "/ko/status", "x-default": "/status" });
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<StatusRoute />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

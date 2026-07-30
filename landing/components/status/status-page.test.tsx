import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { seriousViolations } from "@/test/a11y";
import type { Incident } from "@/lib/incidents";
import { StatusPage } from "./status-page";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/status" }));

/**
 * 실제 로그는 비어 있다(지어낸 사고를 넣지 않는다). 그래서 "사고가 있을 때 화면이 어떻게 되는가" 는
 * 픽스처를 넘겨 확인한다 — 첫 사고를 기입하는 날 렌더 경로를 처음 실행해 보는 상황을 피한다.
 */
const RESOLVED: Incident = {
  id: "2026-08-01-grpc-timeout",
  severity: "degraded",
  startedAt: "2026-08-01T09:12:00Z",
  resolvedAt: "2026-08-01T10:47:00Z",
  title: { en: "Elevated gRPC latency", ko: "gRPC 지연 상승" },
  narrative: { en: "Acquire calls were slow.", ko: "확보 호출이 느렸습니다." },
};

const ONGOING: Incident = {
  id: "2026-08-05-api-down",
  severity: "outage",
  startedAt: "2026-08-05T02:00:00Z",
  resolvedAt: null,
  title: { en: "Control plane unreachable", ko: "컨트롤 플레인 접속 불가" },
  narrative: { en: "REST endpoints time out.", ko: "REST 엔드포인트가 타임아웃됩니다." },
};

describe("상태 페이지 본문: 사고가 기록된 화면 (#145)", () => {
  it("사고를 최신순으로 세우고 → 심각도·진행 여부를 색이 아니라 텍스트로도 알린다", () => {
    render(<StatusPage locale="en" incidents={[RESOLVED, ONGOING]} />);

    const entries = screen.getAllByRole("listitem").filter((li) => li.id.startsWith("incident-"));
    expect(entries.map((li) => li.id)).toEqual([`incident-${ONGOING.id}`, `incident-${RESOLVED.id}`]);

    expect(within(entries[0]).getByText("Outage")).toBeInTheDocument();
    expect(within(entries[0]).getByText("Ongoing")).toBeInTheDocument();
    expect(within(entries[1]).getByText("Degraded")).toBeInTheDocument();
    expect(within(entries[1]).getByText("Resolved")).toBeInTheDocument();
  });

  it("해소된 사고는 종료 시각과 지속 시간을, 진행 중인 사고는 발생 시각만 보여준다", () => {
    render(<StatusPage locale="en" incidents={[RESOLVED, ONGOING]} />);

    const resolved = document.getElementById(`incident-${RESOLVED.id}`)!;
    expect(within(resolved).getByText("2026-08-01 09:12 UTC")).toBeInTheDocument();
    expect(within(resolved).getByText("2026-08-01 10:47 UTC")).toBeInTheDocument();
    expect(within(resolved).getByText("1h 35m")).toBeInTheDocument();

    // 진행 중 사고의 길이는 "지금"에 달렸고 이 HTML 은 빌드 시점에 굳는다 — 적으면 멈춘 값이 사실인 척한다.
    const ongoing = document.getElementById(`incident-${ONGOING.id}`)!;
    expect(within(ongoing).queryByText("Duration")).not.toBeInTheDocument();
    expect(within(ongoing).queryByText("Ended")).not.toBeInTheDocument();
  });

  it("진행 중 사고가 있으면 → 머리의 현재 상태가 그 심각도를 따른다", () => {
    render(<StatusPage locale="en" incidents={[RESOLVED, ONGOING]} />);

    expect(screen.getByText("An outage is in progress")).toBeInTheDocument();
    expect(screen.queryByText("No incident is currently recorded")).not.toBeInTheDocument();
  });

  it("로케일에 맞는 제목·경과 서술을 고른다 → 언어가 섞이지 않는다", () => {
    render(<StatusPage locale="ko" incidents={[ONGOING]} />);

    expect(screen.getByText("컨트롤 플레인 접속 불가")).toBeInTheDocument();
    expect(screen.getByText("REST 엔드포인트가 타임아웃됩니다.")).toBeInTheDocument();
    expect(screen.queryByText("Control plane unreachable")).not.toBeInTheDocument();
  });

  it("사고가 기록된 화면에서도 a11y: critical/serious 위반이 없다", async () => {
    const { container } = render(<StatusPage locale="en" incidents={[RESOLVED, ONGOING]} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

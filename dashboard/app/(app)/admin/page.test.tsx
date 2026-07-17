import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tenantsFixture } from "@/test/fixtures";
import AdminPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const server = setupServer(
  http.get("*/api/tenants", () => HttpResponse.json(tenantsFixture)),
  // admin 은 api() 래퍼 대신 same-origin fetch("/actuator/health") 로 직접 조회한다.
  http.get("*/actuator/health", () => HttpResponse.json({ status: "UP" })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("관리자 화면 (integration + MSW)", () => {
  it("테넌트 목록과 헬스 배지를 렌더한다", async () => {
    render(<AdminPage />);

    expect(await screen.findByRole("heading", { name: "관리자" })).toBeInTheDocument();

    // 테넌트 3건.
    const table = screen.getByRole("table");
    expect(await within(table).findByText("Acme Corp")).toBeInTheDocument();
    expect(within(table).getByText("기본 테넌트")).toBeInTheDocument();
    expect(within(table).getByText("Old Co")).toBeInTheDocument();

    // 상태 배지(ACTIVE 2 + SUSPENDED 1).
    expect(within(table).getAllByText("ACTIVE").length).toBe(2);
    expect(within(table).getByText("SUSPENDED")).toBeInTheDocument();

    // 헬스 배지 UP.
    expect(await screen.findByText("UP")).toBeInTheDocument();
  });

  it("테넌트를 최신 생성순으로 정렬한다", async () => {
    render(<AdminPage />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Acme Corp");

    const idCells = within(table)
      .getAllByRole("cell")
      .map((c) => c.textContent ?? "");
    // acme(07-17) > default(07-10) > old-co(07-01)
    const acme = idCells.findIndex((t) => t === "acme");
    const def = idCells.findIndex((t) => t === "default");
    const old = idCells.findIndex((t) => t === "old-co");
    expect(acme).toBeGreaterThanOrEqual(0);
    expect(acme).toBeLessThan(def);
    expect(def).toBeLessThan(old);
  });
});

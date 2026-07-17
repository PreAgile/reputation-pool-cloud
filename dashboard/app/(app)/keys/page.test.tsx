import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { apiKeysFixture } from "@/test/fixtures";
import KeysPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** tenant 클레임이 든 가짜 JWT(서명 검증 없음 — getTenantId 는 payload 디코드만 한다). */
function fakeJwt(tenant: string): string {
  const payload = btoa(JSON.stringify({ sub: "admin", tenant }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

const server = setupServer(
  http.get("*/api/tenants/default/api-keys", () => HttpResponse.json(apiKeysFixture)),
  http.post("*/api/tenants/default/api-keys", () =>
    HttpResponse.json({
      id: "key-new",
      rawToken: "rp_live_SECRET_RAW_TOKEN",
      label: null,
      prefix: "rp_live_zz",
      createdAt: "2026-07-18T09:00:00Z",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => localStorage.setItem("rp_admin_token", fakeJwt("default")));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

describe("API 키 화면 (integration + MSW)", () => {
  it("테넌트 JWT를 디코드해 키 목록을 렌더한다", async () => {
    render(<KeysPage />);

    expect(await screen.findByRole("heading", { name: "API 키 관리" })).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("프로덕션 수집기")).toBeInTheDocument();
    expect(within(table).getByText("(라벨 없음)")).toBeInTheDocument();
    expect(within(table).getByText("구 스테이징")).toBeInTheDocument();

    // 상태 배지: 활성 2 + 폐기됨 1.
    expect(within(table).getAllByText("활성").length).toBe(2);
    expect(within(table).getByText("폐기됨")).toBeInTheDocument();

    // 테넌트 정보 없음 폴백이 아니어야 한다.
    expect(screen.queryByText("테넌트 정보를 확인할 수 없습니다.")).not.toBeInTheDocument();
  });

  it("키를 발급하면 rawToken이 1회 노출된다", async () => {
    const user = userEvent.setup();
    render(<KeysPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "새 키 발급" }));
    await user.click(screen.getByRole("button", { name: "발급" }));

    expect(await screen.findByText("키가 발급되었습니다")).toBeInTheDocument();
    expect(screen.getByText(/지금만 볼 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText("rp_live_SECRET_RAW_TOKEN")).toBeInTheDocument();
  });

  it("tenant 클레임이 없으면 폴백 안내를 보여준다", async () => {
    localStorage.setItem("rp_admin_token", "header.payload.sig"); // 디코드 실패 → null
    render(<KeysPage />);
    expect(await screen.findByText("테넌트 정보를 확인할 수 없습니다.")).toBeInTheDocument();
  });
});

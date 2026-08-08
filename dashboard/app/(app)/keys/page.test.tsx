import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { apiKeysFixture } from "@/test/fixtures";
import { ToastProvider } from "@/components/ui/toast";
import KeysPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * tenant·scope 클레임이 든 가짜 JWT(서명 검증 없음 — 디코드만 한다).
 * scope 는 실제 로그인이 항상 실어 보내는 값이며, 이 화면의 발급·폐기 UI 는 admin 스코프에서만 보인다
 * (열람 전용 세션에서는 감춰진다). 그래서 어드민 세션을 흉내 내는 이 픽스처도 scope=admin 을 갖는다.
 */
function fakeJwt(tenant: string, scope = "admin"): string {
  const payload = btoa(JSON.stringify({ sub: "admin", tenant, scope }))
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
    render(<KeysPage />, { wrapper: ToastProvider });

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
    render(<KeysPage />, { wrapper: ToastProvider });
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "새 키 발급" }));
    await user.click(screen.getByRole("button", { name: "발급" }));

    expect(await screen.findByText("키가 발급되었습니다")).toBeInTheDocument();
    expect(screen.getByText(/지금만 볼 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByText("rp_live_SECRET_RAW_TOKEN")).toBeInTheDocument();
  });

  it("오버플로 메뉴에서 키를 폐기하면 성공 토스트를 띄운다", async () => {
    server.use(
      http.delete(
        "*/api/tenants/default/api-keys/key-active-new",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const user = userEvent.setup();
    render(<KeysPage />, { wrapper: ToastProvider });
    await screen.findByRole("table");

    // 활성 키(프로덕션 수집기) 행의 "⋯" 메뉴 → 키 폐기(파괴적).
    await user.click(screen.getByRole("button", { name: "프로덕션 수집기 작업 메뉴 열기" }));
    await user.click(await screen.findByRole("menuitem", { name: "키 폐기" }));

    expect(await screen.findByRole("status")).toHaveTextContent("키를 폐기했습니다");
  });

  it("열람 전용(viewer) 세션이면 키 목록은 보이되 발급·폐기 UI가 사라진다", async () => {
    // 공개된 데모 계정으로 로그인한 상태. 백엔드가 GET 외 메서드를 403으로 막으므로, 화면도 눌러야
    // 실패할 컨트롤을 내놓지 않아야 한다 — 데이터는 그대로 다 보인다.
    localStorage.setItem("rp_admin_token", fakeJwt("default", "viewer"));
    render(<KeysPage />, { wrapper: ToastProvider });

    const table = await screen.findByRole("table");
    expect(within(table).getByText("프로덕션 수집기")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "새 키 발급" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "프로덕션 수집기 작업 메뉴 열기" }),
    ).not.toBeInTheDocument();
  });

  it("열람 전용 세션에서 키가 하나도 없으면 빈 목록 CTA도 나오지 않는다", async () => {
    // 빈 목록의 EmptyState 는 헤더 CTA 와 별개 경로라, 헤더만 막으면 여기로 폼이 열린다.
    server.use(http.get("*/api/tenants/default/api-keys", () => HttpResponse.json([])));
    localStorage.setItem("rp_admin_token", fakeJwt("default", "viewer"));
    render(<KeysPage />, { wrapper: ToastProvider });

    expect(await screen.findByText("발급된 API 키가 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "새 키 발급" })).not.toBeInTheDocument();
  });

  it("tenant 클레임이 없으면 폴백 안내를 보여준다", async () => {
    localStorage.setItem("rp_admin_token", "header.payload.sig"); // 디코드 실패 → null
    render(<KeysPage />, { wrapper: ToastProvider });
    expect(await screen.findByText("테넌트 정보를 확인할 수 없습니다.")).toBeInTheDocument();
  });
});

import { test, expect, type Page } from "@playwright/test";

/** 관리자 로그인 → 오버뷰. 입력은 autocomplete 속성으로 안정적으로 지목한다(라벨 미연결이라). */
async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill("admin1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("로그인 후 6개 화면을 내비게이션한다", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "풀 오버뷰" })).toBeVisible();

  const nav: Array<[string, string]> = [
    ["라이브 이벤트", "라이브 이벤트"],
    ["API 키", "API 키 관리"],
    ["사용량", "사용량"],
    ["관리자", "관리자"],
  ];
  for (const [navLabel, heading] of nav) {
    await page.getByRole("link", { name: navLabel }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("API 키를 발급하면 원문이 1회 노출되고, 폐기하면 폐기됨으로 바뀐다", async ({ page }) => {
  await login(page);
  await page.goto("/keys");

  await page.getByRole("button", { name: "새 키 발급" }).click();
  await page.getByRole("button", { name: "발급" }).click();

  // 발급 직후 rawToken 노출 박스 + 1회 경고.
  await expect(page.getByText("키가 발급되었습니다")).toBeVisible();
  await expect(page.getByText(/지금만 볼 수 있습니다/)).toBeVisible();
  await page.getByRole("button", { name: "닫기" }).click();

  // 첫 활성 키 폐기(인라인 확인).
  await page.getByRole("button", { name: "폐기", exact: true }).first().click();
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByText("폐기됨").first()).toBeVisible();
});

test("리소스를 수동 차단하면 상세에 BLOCKLISTED 상태와 차단 해제 버튼이 뜬다", async ({ page }) => {
  // e2e 전용 리소스를 API로 차단해 결정론 확보(라이브 생성기와 무관).
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem("rp_admin_token"));
  const res = "e2e-blk";
  await page.request.post(`/api/pools/resources/proxy/${res}/block?permanent=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  await page.goto(`/resources/proxy/${res}`);
  // 차단 배지("차단") + 영구 차단 표기 + 해제 버튼.
  await expect(page.getByText("영구 차단")).toBeVisible();
  await expect(page.getByRole("button", { name: "차단 해제" })).toBeVisible();

  // 정리: 셀 없는 리소스는 해제 시 스냅샷에서 사라지므로 UI 대신 API로 해제(unblock 계약은 ControlPlaneIT가 검증).
  await page.request.delete(`/api/pools/resources/proxy/${res}/block`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});

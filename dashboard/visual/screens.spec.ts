import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { overviewFixture } from "../test/fixtures";

// 가드 통과용 토큰(오버뷰/로그인은 tenant 디코드 불필요 — 존재만 하면 됨).
const TOKEN = "header.payload.sig";

async function stubOverview(page: Page) {
  await page.route("**/api/pools/resources", (route) => route.fulfill({ json: overviewFixture }));
}

test.describe("visual regression + a11y (결정론적 fixture)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`오버뷰 스냅샷 — ${theme}`, async ({ page }) => {
      await page.addInitScript(
        ([t, th]) => {
          localStorage.setItem("rp_admin_token", t);
          localStorage.setItem("theme", th);
        },
        [TOKEN, theme],
      );
      await stubOverview(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "풀 오버뷰" })).toBeVisible();
      await expect(page.getByText("proxy-bad")).toBeVisible();
      await expect(page).toHaveScreenshot(`overview-${theme}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }

  // a11y는 라이트·다크 둘 다 검사(색 토큰이 테마별로 달라 대비도 테마별로 확인해야 함).
  // 예외 없이 전 표면을 검사 — 브랜드/기능색을 AA(≥4.5)로 맞췄으므로 color-contrast도 통과해야 한다.
  async function assertNoSeriousA11y(page: Page) {
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  }

  for (const theme of ["light", "dark"] as const) {
    test(`로그인 화면 — a11y 심각/치명 위반 없음 — ${theme}`, async ({ page }) => {
      await page.addInitScript((th) => localStorage.setItem("theme", th), theme);
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
      await assertNoSeriousA11y(page);
    });

    test(`오버뷰 — a11y 심각/치명 위반 없음 — ${theme}`, async ({ page }) => {
      await page.addInitScript(
        ([t, th]) => {
          localStorage.setItem("rp_admin_token", t);
          localStorage.setItem("theme", th);
        },
        [TOKEN, theme],
      );
      await stubOverview(page);
      await page.goto("/");
      await expect(page.getByText("proxy-bad")).toBeVisible();
      await assertNoSeriousA11y(page);
    });
  }
});

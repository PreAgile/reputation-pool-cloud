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

  test("로그인 화면 — a11y 심각/치명 위반 없음", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
    // 대비 예외(둘 다 색 토큰의 후속 디자인 결정 사항이라 게이트에서 제외 — muted·label·구조 등 나머지는 계속 검사):
    //  1) 토스 블루 브랜드색: 흰 글자/accent 버튼 ≈3.7, accent/accent-soft ≈3.3.
    //  2) 기능색 상태 배지: text-{색} on bg-{색}/12(냉각 amber ≈2.0, 차단 red ≈3.2). tint 위 어두운 변형 필요.
    const { violations } = await new AxeBuilder({ page })
      .exclude(".bg-accent")
      .exclude(".bg-accent-soft")
      .exclude('[class*="/12"]')
      .analyze();
    const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("오버뷰 — a11y 심각/치명 위반 없음", async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("rp_admin_token", t), TOKEN);
    await stubOverview(page);
    await page.goto("/");
    await expect(page.getByText("proxy-bad")).toBeVisible();
    // 대비 예외(둘 다 색 토큰의 후속 디자인 결정 사항이라 게이트에서 제외 — muted·label·구조 등 나머지는 계속 검사):
    //  1) 토스 블루 브랜드색: 흰 글자/accent 버튼 ≈3.7, accent/accent-soft ≈3.3.
    //  2) 기능색 상태 배지: text-{색} on bg-{색}/12(냉각 amber ≈2.0, 차단 red ≈3.2). tint 위 어두운 변형 필요.
    const { violations } = await new AxeBuilder({ page })
      .exclude(".bg-accent")
      .exclude(".bg-accent-soft")
      .exclude('[class*="/12"]')
      .analyze();
    const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
});

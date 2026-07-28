import { test, expect } from "@playwright/test";

/**
 * 랜딩 언어 자동 판별 (#110) — 실브라우저에서 수용 기준을 그대로 확인한다.
 *
 * 단위 테스트(`middleware.test.ts`)는 미들웨어의 응답만 본다. 여기서만 확인되는 것이 두 가지다:
 *   1. 스위처 클릭이 **이동 전에** 쿠키를 심는지 (client 내비 타이밍은 jsdom 으로 재현되지 않는다)
 *   2. 그래서 `/` → `/ko` 자동 이동과 스위처의 되돌리기가 **루프를 만들지 않는지**
 *
 * 이 스펙은 백엔드가 필요 없다(마케팅 랜딩은 정적). `e2e` 프로젝트의 기본 locale 은 `ko-KR` 이므로
 * 영어 케이스만 `test.use({ locale: "en-US" })` 로 덮는다.
 */

const KO_HEADING = /프록시·계정 풀을 위한 평판 API\./;
const EN_HEADING = /The reputation API for proxy & account pools\./;

test.describe("한국어 선호 브라우저(ko-KR)", () => {
  test("/ 로 처음 들어오면 → /ko 로 이동해 한국어 랜딩을 본다", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/ko$/);
    await expect(page.getByRole("heading", { level: 1, name: KO_HEADING })).toBeVisible();
  });

  test("스위처로 English 를 고르면 → / 에 머물고, 다시 / 를 열어도 영어다 (리다이렉트 루프 없음)", async ({
    page,
  }) => {
    await page.goto("/ko");
    await page.getByRole("button", { name: "언어" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();

    // 브라우저 설정은 여전히 ko-KR 이지만 사용자의 선택이 이긴다 — /ko 로 튕겨 돌아오지 않아야 한다.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: EN_HEADING })).toBeVisible();

    // 새 요청(내비게이션 캐시가 아닌 실제 왕복)에서도 유지되는지 — 여기서 루프가 드러난다.
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: EN_HEADING })).toBeVisible();
  });
});

test.describe("영어 선호 브라우저(en-US)", () => {
  test.use({ locale: "en-US" });

  test("/ 로 들어오면 → 이동 없이 영어 랜딩을 본다", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: EN_HEADING })).toBeVisible();
  });

  test("스위처로 한국어를 고르면 → 그 뒤 / 로 들어와도 한국어가 유지된다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Language" }).click();
    await page.getByRole("menuitem", { name: "한국어" }).click();
    await expect(page).toHaveURL(/\/ko$/);

    // 브라우저는 영어를 선호하지만 고른 언어가 이긴다.
    await page.goto("/");
    await expect(page).toHaveURL(/\/ko$/);
    await expect(page.getByRole("heading", { level: 1, name: KO_HEADING })).toBeVisible();
  });
});

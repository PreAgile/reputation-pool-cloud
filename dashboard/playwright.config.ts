import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright — 트로피의 e2e·visual·a11y 층(실브라우저).
 *   - e2e: seed된 실백엔드(dev :3000, /api→:8083) 위에서 로그인·화면·mutation 계약 검증.
 *   - visual: /api를 fixtures로 route-stub하고 스크린샷 회귀(디자인 깨짐) + axe 접근성.
 * 전제: 대시보드(:3000)와 백엔드(:8083)가 떠 있어야 한다(로컬 dev 또는 docker compose).
 * baseURL은 E2E_BASE_URL로 재정의(예: Caddy 한 오리진 :8080).
 */
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "e2e", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "visual", testMatch: "visual/**/*.spec.ts", use: { ...devices["Desktop Chrome"] } },
  ],
});

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
    // locale 을 명시하는 이유: 로그인 화면만 다국어이고(`app/login/locale.ts`) 브라우저의
    // Accept-Language 로 언어를 고르는데 기본이 **영어**다. 로그인 이후 콘솔은 한국어 전용이라
    // 두 스펙 모두 한글 라벨(로그인·풀 오버뷰·라이브 이벤트…)을 전제한다. locale 을 지정하지 않으면
    // 러너의 기본값에 좌우된다 — CI 의 Chromium 은 en-US 를 보내므로 로그인 버튼이 "Sign in" 으로
    // 렌더되고 `getByRole("button", { name: "로그인" })` 이 30초 타임아웃으로 죽는다(실제로 e2e 6개가
    // 전부 그렇게 실패했다). 스펙의 암묵적 가정을 설정으로 끌어올려 러너와 무관하게 결정적으로 만든다.
    //
    // shots 프로젝트에는 일부러 넣지 않는다 — 마케팅 스크린샷(#16)은 영어 기준이다.
    { name: "e2e", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], locale: "ko-KR" } },
    { name: "visual", testMatch: "visual/**/*.spec.ts", use: { ...devices["Desktop Chrome"], locale: "ko-KR" } },
    // tablet: 좁은 뷰포트에서 레이아웃이 깨지지 않는지 (#52 의 남은 항목).
    //
    // **스크린샷 비교가 아니라 불변식 단정이다.** 새 뷰포트에 베이스라인을 뜨면 화면이 바뀔 때마다
    // 두 벌을 갱신해야 하고, 정작 "태블릿에서 깨졌다" 는 픽셀 diff 로는 원인이 안 읽힌다. 대신
    // "페이지가 가로로 밀리지 않는다" 처럼 요구사항 자체를 단정한다 — 깨지면 무엇이 깨졌는지 바로 나온다.
    //
    // 768×1024 = 세로 태블릿. 사이드바(펼침 240px)를 뺀 본문이 가장 좁아지는 구간이라 여기서
    // 통과하면 그 위 폭은 자연히 통과한다.
    {
      name: "tablet",
      testMatch: "visual/**/*.responsive.spec.ts",
      use: { ...devices["Desktop Chrome"], locale: "ko-KR", viewport: { width: 768, height: 1024 } },
    },
    // shots: 마케팅 랜딩(#16)용 실제 대시보드 스크린샷을 `../landing/public/marketing/` 에 저장(비교 아님).
    // 찍는 대상은 이 앱의 화면이고 쓰는 쪽은 랜딩 앱이다 — 사본이 하나만 있도록 출력만 넘긴다(#15).
    // 레티나(deviceScaleFactor=2) · 모션 감소 · 넓은 뷰포트로 결정론적 캡처.
    {
      name: "shots",
      testMatch: "scripts/marketing-shots.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 2,
      },
    },
  ],
});

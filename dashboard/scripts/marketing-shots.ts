/**
 * 마케팅 스크린샷 캡처 (#16) — 랜딩 기능 3행에 넣을 PNG 를 저장한다.
 *
 * ## 캡처는 대시보드에, 산출물은 랜딩에 (#15)
 * 랜딩·문서는 별개 앱(`landing/`, Cloudflare Pages)으로 분리됐지만 이 스크립트는 대시보드에 남는다 —
 * 찍는 대상이 **실제 대시보드 화면**(`/overview`·`/resources/*`·`/events`)과 이 앱의 영어 목업
 * (`/preview/*`)이기 때문이다. 랜딩에서는 이 화면들을 렌더할 수 없다.
 *
 * 반면 PNG 를 **쓰는** 쪽은 랜딩뿐이다. 그래서 출력만 `../landing/public/marketing/` 으로 보낸다.
 * 두 앱에 같은 12장을 각각 두면(한동안 실제로 그랬다) 재캡처 때 한쪽만 갱신돼 랜딩이 옛 스크린샷을
 * 서빙하는데, 그게 조용히 오래 간다. 레포에 사본은 하나뿐이어야 하고, 그 하나는 랜딩이 서빙하는 것이다.
 *
 * 로케일 일치 + 테마 연동으로 총 12장:
 *   - KO: 실제 한국어 대시보드(/overview·/resources·/events) 를 route-stub 위에서 렌더 → `*-ko-{light,dark}.png`
 *   - EN: 영어 목업(/preview/*, 프로덕션 비노출) 을 렌더 → `*-en-{light,dark}.png`
 * 랜딩의 BrowserFrame 이 현재 테마에 맞는 라이트/다크 샷을 CSS 로 스왑한다.
 *
 * 이것은 시각 회귀(visual)가 아니라 "결과물 저장"이다(page.screenshot). 백엔드 불필요(KO 는 fixture 로 /api stub,
 * EN 목업은 fixture 를 직접 렌더). 결정론: deviceScaleFactor=2 · reducedMotion=reduce · animations=disabled.
 *
 *   실행: dev 서버(:3000)를 띄운 뒤  →  npx playwright test --project=shots
 */
import { test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  marketingOverviewFixture,
  marketingDetailFixture,
  marketingScoreHistoryFixture,
  marketingEventsFixture,
} from "../test/marketing-fixtures";

// Playwright 는 설정 파일이 있는 `dashboard/` 를 cwd 로 돈다 — 산출물은 형제 디렉터리인 랜딩 앱으로 나간다.
const OUT_DIR = path.join(process.cwd(), "..", "landing", "public", "marketing");
const TOKEN = "header.payload.sig"; // 값 존재만으로 대시보드 인증 가드 통과.
type Theme = "light" | "dark";

async function seed(page: Page, theme: Theme) {
  await page.addInitScript(
    ({ t, th }) => {
      localStorage.setItem("rp_admin_token", t);
      localStorage.setItem("theme", th);
      localStorage.setItem("rp_sidebar_collapsed", "0"); // 사이드바 펼친 채 캡처.
    },
    { t: TOKEN, th: theme },
  );
}

async function stubOverview(page: Page) {
  await page.route("**/api/pools/resources", (r) => r.fulfill({ json: marketingOverviewFixture }));
}
async function stubDetail(page: Page) {
  await page.route("**/api/pools/resources/proxy/proxy-kr-seoul-01/score-history*", (r) =>
    r.fulfill({ json: marketingScoreHistoryFixture }),
  );
  await page.route("**/api/pools/resources/proxy/proxy-kr-seoul-01", (r) =>
    r.fulfill({ json: marketingDetailFixture }),
  );
  await page.route("**/api/events*", (r) => r.fulfill({ json: marketingEventsFixture }));
}
async function stubEvents(page: Page) {
  await page.route("**/api/events*", (r) => r.fulfill({ json: marketingEventsFixture }));
}

async function capture(page: Page, file: string) {
  // dev 서버의 Next 개발 도구 배지는 마케팅 샷에 노출되면 안 되므로 숨긴다.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: path.join(OUT_DIR, file), animations: "disabled" });
}

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const theme of ["light", "dark"] as Theme[]) {
  /* ── KO: 실제 한국어 대시보드 ── */
  test(`overview ko ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await stubOverview(page);
    await page.goto("/overview");
    await page.getByRole("heading", { name: "풀 오버뷰" }).waitFor();
    await page.getByText("proxy-kr-seoul-08").waitFor();
    await capture(page, `overview-ko-${theme}.png`);
  });

  test(`detail ko ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await stubDetail(page);
    await page.goto("/resources/proxy/proxy-kr-seoul-01");
    await page.getByRole("heading", { name: "proxy-kr-seoul-01" }).waitFor();
    await page.locator("svg.recharts-surface").first().waitFor();
    await capture(page, `detail-ko-${theme}.png`);
  });

  test(`events ko ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await stubEvents(page);
    await page.goto("/events");
    await page.getByRole("heading", { name: "라이브 이벤트" }).waitFor();
    await page.getByRole("table").waitFor();
    await capture(page, `events-ko-${theme}.png`);
  });

  /* ── EN: 영어 목업(preview) ── */
  test(`overview en ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await page.goto("/preview/overview");
    await page.getByRole("heading", { name: "Pool overview" }).waitFor();
    await page.getByText("proxy-kr-seoul-08").waitFor();
    await capture(page, `overview-en-${theme}.png`);
  });

  test(`detail en ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await page.goto("/preview/detail");
    await page.getByRole("heading", { name: "proxy-kr-seoul-01" }).waitFor();
    await page.getByRole("img", { name: "Per-context reputation curve" }).waitFor();
    await capture(page, `detail-en-${theme}.png`);
  });

  test(`events en ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await page.goto("/preview/events");
    await page.getByRole("heading", { name: "Live events" }).waitFor();
    await page.getByRole("table").waitFor();
    await capture(page, `events-en-${theme}.png`);
  });
}

/**
 * 마케팅 스크린샷 캡처 (#16) — 실제 대시보드 화면을 route-stub 위에서 렌더해 PNG 로 저장한다.
 *
 * 이것은 시각 회귀(visual)가 아니라 "결과물 저장"이다: toHaveScreenshot 비교가 아니라
 * page.screenshot 으로 public/marketing/*.png 를 만든다. 백엔드는 필요 없다(fixture 로 /api 를 stub).
 *
 *   실행: dev 서버(:3000)를 띄운 뒤  →  npx playwright test --project=shots
 *
 * 결정론: deviceScaleFactor=2(레티나) · reducedMotion=reduce · animations=disabled.
 * screens.spec.ts 의 seed()/stub 패턴을 그대로 재사용하되, 데이터는 marketing-fixtures 로 풍성하게.
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

const OUT_DIR = path.join(process.cwd(), "public", "marketing");

// 가드 통과용 토큰(값 존재만으로 인증 통과 — 대시보드 화면 공통).
const TOKEN = "header.payload.sig";

async function seed(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ({ t, th }) => {
      localStorage.setItem("rp_admin_token", t);
      localStorage.setItem("theme", th);
      // 사이드바는 항상 펼친 상태로 캡처.
      localStorage.setItem("rp_sidebar_collapsed", "0");
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
  // dev 서버의 Next 개발 도구 배지(nextjs-portal)는 마케팅 샷에 노출되면 안 되므로 숨긴다.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: path.join(OUT_DIR, file), animations: "disabled" });
}

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

// 랜딩 기능 3행은 모두 다크 스크린샷을 브라우저 프레임에 넣는다(라이트/다크 페이지 모두에서 프리미엄하게 보임).
test("overview — dark (기능행 1)", async ({ page }) => {
  await seed(page, "dark");
  await stubOverview(page);
  await page.goto("/overview");
  await page.getByRole("heading", { name: "풀 오버뷰" }).waitFor();
  await page.getByText("proxy-kr-seoul-08").waitFor();
  await capture(page, "overview-dark.png");
});

test("detail — dark (기능행 2: 컨텍스트별 평판 곡선)", async ({ page }) => {
  await seed(page, "dark");
  await stubDetail(page);
  await page.goto("/resources/proxy/proxy-kr-seoul-01");
  await page.getByRole("heading", { name: "proxy-kr-seoul-01" }).waitFor();
  // recharts 곡선이 그려질 때까지 대기(애니메이션은 코드에서 이미 off).
  await page.locator("svg.recharts-surface").first().waitFor();
  await capture(page, "detail-dark.png");
});

test("events — dark (기능행 3: 라이브 이벤트 스트림)", async ({ page }) => {
  await seed(page, "dark");
  await stubEvents(page);
  await page.goto("/events");
  await page.getByRole("heading", { name: "라이브 이벤트" }).waitFor();
  await page.getByRole("table").waitFor();
  await capture(page, "events-dark.png");
});

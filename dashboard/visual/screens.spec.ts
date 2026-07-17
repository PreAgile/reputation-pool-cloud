import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  overviewFixture,
  detailFixture,
  scoreHistoryFixture,
  eventsFixture,
  usageFixture,
  tenantsFixture,
  apiKeysFixture,
} from "../test/fixtures";

// 가드 통과용 토큰. 대부분은 존재만 하면 되고(오버뷰/상세/이벤트/사용량/관리자),
// 키 화면만 tenant 클레임을 디코드하므로 tenant=default 가 든 payload 를 넣는다.
const TOKEN = "header.payload.sig";
const TENANT_TOKEN = `header.${Buffer.from(
  JSON.stringify({ sub: "admin", tenant: "default" }),
).toString("base64url")}.sig`;

async function seed(page: Page, token: string | null, theme: string) {
  await page.addInitScript(
    ({ t, th }) => {
      if (t) localStorage.setItem("rp_admin_token", t);
      localStorage.setItem("theme", th);
    },
    { t: token, th: theme },
  );
}

// ── 화면별 route-stub(결정론적 fixture로 /api·/actuator 를 고정) ──────────────
async function stubOverview(page: Page) {
  await page.route("**/api/pools/resources", (r) => r.fulfill({ json: overviewFixture }));
}
async function stubDetail(page: Page) {
  await page.route("**/api/pools/resources/proxy/proxy-good/score-history*", (r) =>
    r.fulfill({ json: scoreHistoryFixture }),
  );
  await page.route("**/api/pools/resources/proxy/proxy-good", (r) =>
    r.fulfill({ json: detailFixture }),
  );
  await page.route("**/api/events*", (r) => r.fulfill({ json: eventsFixture }));
}
async function stubEvents(page: Page) {
  await page.route("**/api/events*", (r) => r.fulfill({ json: eventsFixture }));
}
async function stubUsage(page: Page) {
  await page.route("**/api/usage", (r) => r.fulfill({ json: usageFixture }));
}
async function stubAdmin(page: Page) {
  await page.route("**/api/tenants", (r) => r.fulfill({ json: tenantsFixture }));
  await page.route("**/actuator/health", (r) => r.fulfill({ json: { status: "UP" } }));
}
async function stubKeys(page: Page) {
  await page.route("**/api/tenants/default/api-keys", (r) => r.fulfill({ json: apiKeysFixture }));
}

interface ScreenSpec {
  name: string;
  path: string;
  token: string | null;
  stub: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const SCREENS: ScreenSpec[] = [
  {
    name: "login",
    path: "/login",
    token: null,
    stub: async () => {},
    ready: async (page) => {
      await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
    },
  },
  {
    name: "overview",
    path: "/",
    token: TOKEN,
    stub: stubOverview,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "풀 오버뷰" })).toBeVisible();
      await expect(page.getByText("proxy-bad")).toBeVisible();
    },
  },
  {
    name: "detail",
    path: "/resources/proxy/proxy-good",
    token: TOKEN,
    stub: stubDetail,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "proxy-good" })).toBeVisible();
      await expect(page.getByText("컨텍스트별 셀")).toBeVisible();
    },
  },
  {
    name: "events",
    path: "/events",
    token: TOKEN,
    stub: stubEvents,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "라이브 이벤트" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "usage",
    path: "/usage",
    token: TOKEN,
    stub: stubUsage,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "사용량" })).toBeVisible();
      await expect(page.getByText("이번 달 임대 건수")).toBeVisible();
    },
  },
  {
    name: "admin",
    path: "/admin",
    token: TOKEN,
    stub: stubAdmin,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "관리자" })).toBeVisible();
      await expect(page.getByText("Acme Corp")).toBeVisible();
    },
  },
  {
    name: "keys",
    path: "/keys",
    token: TENANT_TOKEN,
    stub: stubKeys,
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "API 키 관리" })).toBeVisible();
      await expect(page.getByText("프로덕션 수집기")).toBeVisible();
    },
  },
];

// a11y: 라이트·다크 둘 다 검사(색 토큰이 테마별로 달라 대비도 테마별 확인).
// 예외 없이 전 표면 검사 — 브랜드/기능색을 AA(≥4.5)로 맞췄으므로 color-contrast 도 통과해야 한다.
async function assertNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(
    serious,
    JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length }))),
  ).toEqual([]);
}

test.describe("visual regression + a11y (결정론적 fixture)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const theme of ["light", "dark"] as const) {
    for (const s of SCREENS) {
      test(`${s.name} 스냅샷 — ${theme}`, async ({ page }) => {
        await seed(page, s.token, theme);
        await s.stub(page);
        await page.goto(s.path);
        await s.ready(page);
        await expect(page).toHaveScreenshot(`${s.name}-${theme}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });

      test(`${s.name} — a11y 심각/치명 위반 없음 — ${theme}`, async ({ page }) => {
        await seed(page, s.token, theme);
        await s.stub(page);
        await page.goto(s.path);
        await s.ready(page);
        await assertNoSeriousA11y(page);
      });
    }
  }
});

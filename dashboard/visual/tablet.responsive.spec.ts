import { test, expect, type Page } from "@playwright/test";
import {
  overviewFixture,
  detailFixture,
  scoreHistoryFixture,
  eventsFixture,
  usageFixture,
  tenantsFixture,
  apiKeysFixture,
} from "../test/fixtures";

/**
 * 좁은 뷰포트(세로 태블릿 768×1024)에서 콘솔 레이아웃이 깨지지 않는지 (#52 의 남은 항목).
 *
 * <b>왜 스크린샷이 아니라 불변식인가.</b> `screens.spec.ts` 는 이미 데스크톱 폭에서 픽셀 회귀를 잡는다.
 * 같은 화면을 좁은 폭에서 또 찍으면 베이스라인이 두 벌이 되어 디자인이 바뀔 때마다 둘 다 갱신해야 하고,
 * 정작 "태블릿에서 깨졌다" 는 픽셀 diff 로는 원인이 안 읽힌다. 여기서는 요구사항 자체를 단정한다 —
 * 실패하면 무엇이 왜 깨졌는지가 메시지에 그대로 나온다.
 *
 * <b>왜 768 인가.</b> 사이드바가 펼쳐진 상태(240px)를 빼면 본문이 가장 좁아지는 실사용 구간이다.
 * 사이드바 폭은 뷰포트가 아니라 사용자 선호(localStorage `rp_sidebar_collapsed`)로만 정해지므로
 * — `app-shell.tsx` 에 뷰포트 기반 브레이크포인트가 없다 — 좁은 화면에서도 기본값은 펼침이다.
 * 그 최악 조건에서 통과하면 더 넓은 폭은 자연히 통과한다.
 */

const TOKEN = "header.payload.sig";
const TENANT_TOKEN = `header.${Buffer.from(JSON.stringify({ sub: "admin", tenant: "default" })).toString(
  "base64url",
)}.sig`;

async function seed(page: Page, token: string | null) {
  await page.addInitScript(
    ({ t }) => {
      if (t) localStorage.setItem("rp_admin_token", t);
      localStorage.setItem("theme", "light");
    },
    { t: token },
  );
}

interface Screen {
  name: string;
  path: string;
  token: string | null;
  stub: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "로그인",
    path: "/login",
    token: null,
    stub: async () => {},
    ready: async (page) => {
      await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
    },
  },
  {
    name: "풀 오버뷰",
    path: "/overview",
    token: TOKEN,
    stub: async (page) => {
      await page.route("**/api/pools/resources", (r) => r.fulfill({ json: overviewFixture }));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "풀 오버뷰" })).toBeVisible();
    },
  },
  {
    name: "리소스 상세",
    path: "/resources/proxy/proxy-good",
    token: TOKEN,
    stub: async (page) => {
      await page.route("**/api/pools/resources/proxy/proxy-good/score-history*", (r) =>
        r.fulfill({ json: scoreHistoryFixture }),
      );
      await page.route("**/api/pools/resources/proxy/proxy-good", (r) => r.fulfill({ json: detailFixture }));
      await page.route("**/api/events*", (r) => r.fulfill({ json: eventsFixture }));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "proxy-good" })).toBeVisible();
    },
  },
  {
    name: "라이브 이벤트",
    path: "/events",
    token: TOKEN,
    stub: async (page) => {
      await page.route("**/api/events*", (r) => r.fulfill({ json: eventsFixture }));
    },
    ready: async (page) => {
      await expect(page.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "사용량",
    path: "/usage",
    token: TOKEN,
    stub: async (page) => {
      await page.route("**/api/usage", (r) => r.fulfill({ json: usageFixture }));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: /사용량/ })).toBeVisible();
    },
  },
  {
    name: "관리자",
    path: "/admin",
    token: TOKEN,
    stub: async (page) => {
      await page.route("**/api/tenants", (r) => r.fulfill({ json: tenantsFixture }));
      await page.route("**/actuator/health", (r) => r.fulfill({ json: { status: "UP" } }));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: /관리/ })).toBeVisible();
    },
  },
  {
    name: "API 키",
    path: "/keys",
    token: TENANT_TOKEN,
    stub: async (page) => {
      await page.route("**/api/tenants/default/api-keys", (r) => r.fulfill({ json: apiKeysFixture }));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: /키/ })).toBeVisible();
    },
  },
];

async function open(page: Page, screen: Screen) {
  await seed(page, screen.token);
  await screen.stub(page);
  await page.goto(screen.path);
  await screen.ready(page);
}

test.describe("태블릿 폭(768) 레이아웃", () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: 페이지가 가로로 밀리지 않는다 → 넓은 표·차트가 자기 컨테이너 안에서 스크롤되어야 한다`, async ({
      page,
    }) => {
      await open(page, screen);

      // 문서 전체가 뷰포트보다 넓으면 사용자가 화면을 좌우로 밀어야 한다 — 콘솔에서 가장 흔한
      // 반응형 결함이다. 넓은 표는 자기 래퍼 안에서만 스크롤되어야 한다.
      // 1px 은 소수점 반올림 여유.
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });

      expect(
        overflow.scrollWidth,
        `문서가 뷰포트보다 ${overflow.scrollWidth - overflow.clientWidth}px 넓다 — 가로 스크롤이 생긴다`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  test("사이드바가 본문을 밀어내지 않는다 → 좁은 폭에서도 본문이 읽을 수 있는 너비를 갖는다", async ({ page }) => {
    await open(page, SCREENS[1]); // 풀 오버뷰

    const main = page.locator("main").first();
    const width = await main.evaluate((el) => el.getBoundingClientRect().width);

    // 768 - 사이드바 240 = 528. 여기서 더 줄어들면 본문이 사이드바에 눌린 것이다.
    expect(width, `본문 폭이 ${Math.round(width)}px 다`).toBeGreaterThan(480);
  });

  test("사이드바를 접으면 → 본문이 그만큼 넓어진다 (좁은 폭에서의 탈출구가 실제로 동작한다)", async ({ page }) => {
    await open(page, SCREENS[1]);

    const main = page.locator("main").first();
    const before = await main.evaluate((el) => el.getBoundingClientRect().width);

    await page.getByRole("button", { name: "사이드바 접기" }).click();
    await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();

    // 폭에 `transition-[width] var(--motion-slow)`(240ms)가 걸려 있어 클릭 직후 값은 전이 중간값이다
    // (처음 이렇게 짰다가 176px 대신 64px 을 읽고 실패했다). 고정 sleep 대신 값이 목표에 도달할
    // 때까지 재시도한다 — 전이 시간이 바뀌어도 테스트가 따라간다.
    await expect
      .poll(async () => (await main.evaluate((el) => el.getBoundingClientRect().width)) - before, {
        message: "사이드바를 접었는데 본문이 넓어지지 않는다",
      })
      // 240px → 64px 이므로 176px 이 목표. 서브픽셀 여유를 두고 150 으로 단정한다.
      .toBeGreaterThan(150);
  });

  test("주 내비게이션이 좁은 폭에서도 전부 닿는다 → 링크가 잘려 사라지지 않는다", async ({ page }) => {
    await open(page, SCREENS[1]);

    const nav = page.locator("aside nav");
    const links = nav.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(links.nth(i)).toBeVisible();
    }
  });
});

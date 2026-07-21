import { test, expect, type Page } from "@playwright/test";

/** 관리자 로그인 → 오버뷰. 입력은 autocomplete 속성으로 안정적으로 지목한다(라벨 미연결이라). */
async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill("admin1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/overview$/);
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
  // 발급 성공 토스트의 "알림 닫기" 버튼과 구분해 노출 박스의 "닫기"만 정확히 지목한다.
  await page.getByRole("button", { name: "닫기", exact: true }).click();

  // 첫 활성 키 폐기(오버플로 메뉴 → 키 폐기).
  await page.getByRole("button", { name: /작업 메뉴 열기/ }).first().click();
  await page.getByRole("menuitem", { name: "키 폐기" }).click();
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

test("라이브 이벤트: 목록·종류 필터·일시정지 토글이 동작한다", async ({ page }) => {
  await login(page);
  await page.goto("/events");

  await expect(page.getByRole("heading", { name: "라이브 이벤트" })).toBeVisible();
  // 데이터 유무와 무관하게 표(빈 상태 행 포함)는 항상 렌더된다 — 구조적 단언.
  await expect(page.getByRole("table")).toBeVisible();

  // 종류 필터(프록시)로 좁힌 뒤 유형 select 로도 조작 — 클라이언트 필터라 라이브 값과 무관.
  await page.getByRole("button", { name: "프록시" }).click();
  await page.getByLabel("이벤트 유형 필터").selectOption("RESOURCE_LEASED");

  // 일시정지 → 재개 토글로 실시간 라벨이 바뀐다.
  await page.getByRole("button", { name: "일시정지" }).click();
  await expect(page.getByRole("button", { name: "재개" })).toBeVisible();
  await expect(page.getByText("일시정지됨")).toBeVisible();
});

test("사용량: 미터 타일과 문의 CTA(mailto)가 보인다", async ({ page }) => {
  await login(page);
  await page.goto("/usage");

  await expect(page.getByRole("heading", { name: "사용량" })).toBeVisible();
  await expect(page.getByText("이번 달 임대 건수")).toBeVisible();
  await expect(page.getByText("등록 리소스 수")).toBeVisible();

  const cta = page.getByRole("link", { name: "메일로 문의하기" });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", /^mailto:/);
});

test("관리자: 고유 id 테넌트를 생성하면 목록에 나타난다", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "관리자" })).toBeVisible();

  // 부작용 최소화 — 매 실행 고유 id(라이브 데이터/타 테스트와 충돌 없이 목록 반영만 확인).
  const id = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  await page.getByRole("button", { name: "새 테넌트" }).click();
  await page.getByPlaceholder("예: acme", { exact: true }).fill(id);
  await page.getByPlaceholder("예: Acme Corp", { exact: true }).fill(`E2E ${id}`);
  await page.getByRole("button", { name: "생성" }).click();

  // 생성 후 목록 새로고침 → id 셀이 나타난다.
  await expect(page.getByText(id, { exact: true })).toBeVisible();
});

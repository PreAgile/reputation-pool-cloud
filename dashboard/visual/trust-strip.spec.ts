import { test, expect, type Page } from "@playwright/test";

/**
 * 랜딩 트러스트 바 시각 회귀 (#120).
 *
 * 이 바는 **영어에서만** 깨졌다: `Audit trail` 이 한 줄에 못 들어가 둘째 줄로 넘어가고, 그 항목이
 * index 기반 `border-l` 을 들고 가서 줄 맨 앞에 세로선이 떠 있었다. 한국어는 라벨이 짧아 4개가 우연히
 * 한 줄에 들어가 멀쩡했다 — 그래서 로케일 하나만 찍는 스냅샷으로는 이 버그를 다시 놓친다.
 *
 * 그래서 두 로케일 × 두 폭(데스크톱·모바일)을 모두 고정한다. 폭을 둘 다 찍는 이유는 이 바가 폭에 따라
 * 열 수를 바꾸기 때문이다(2열 ↔ 4열): 구분선이 "줄의 첫 칸"에서 빠지는지는 열 수가 바뀌는 순간에만
 * 확인할 수 있다. 백엔드는 필요 없다 — 랜딩은 정적이라 `/api` 스텁이 없다.
 *
 * `screens.spec.ts` 와 달리 페이지 전체가 아니라 **트러스트 섹션 요소만** 찍는다. 랜딩 전체를 찍으면
 * 히어로·스크린샷·푸터의 무관한 변경이 이 스냅샷을 깨뜨려, 정작 구분선 회귀가 노이즈에 묻힌다.
 */

interface LocaleCase {
  /** 스냅샷 파일명 접두. */
  name: string;
  /** 랜딩 경로. `/` 는 미들웨어(#110)가 ko 선호 방문자를 `/ko` 로 보내므로 브라우저 로케일과 짝을 맞춘다. */
  path: string;
  /** 브라우저 `Accept-Language` — visual 프로젝트 기본값(ko-KR)을 케이스별로 덮어쓴다. */
  browserLocale: string;
  /** 섹션을 특정하는 트러스트 헤딩(사전의 `trust.heading`). */
  heading: string;
}

const LOCALES: LocaleCase[] = [
  { name: "en", path: "/", browserLocale: "en-US", heading: "Trust comes from the engine, not logos" },
  { name: "ko", path: "/ko", browserLocale: "ko-KR", heading: "신뢰는 로고가 아니라 엔진에서 나옵니다" },
];

/** 데스크톱(4열) · 모바일(2열) — 열 수가 바뀌는 두 지점. */
const WIDTHS = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
];

async function seedTheme(page: Page, theme: string) {
  await page.addInitScript((th) => localStorage.setItem("theme", th), theme);
}

for (const locale of LOCALES) {
  test.describe(`트러스트 바 — ${locale.name}`, () => {
    test.use({ locale: locale.browserLocale });

    for (const width of WIDTHS) {
      for (const theme of ["light", "dark"] as const) {
        test(`구분선·정렬 스냅샷 — ${width.name}/${theme}`, async ({ page }) => {
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.setViewportSize(width.viewport);
          await seedTheme(page, theme);
          await page.goto(locale.path);

          const strip = page.locator("section").filter({ hasText: locale.heading });
          await expect(strip).toBeVisible();
          // 배지 4개가 모두 렌더된 뒤에 찍는다(폰트 로딩 중 스냅샷을 피한다).
          await expect(strip.locator("svg")).toHaveCount(4);

          await expect(strip).toHaveScreenshot(`trust-${locale.name}-${width.name}-${theme}.png`, {
            animations: "disabled",
          });
        });
      }
    }
  });
}

import { axe } from "jest-axe";

/**
 * axe 를 돌려 critical/serious 위반만 추린다(문서 §a11y 게이트와 동일 기준).
 * jsdom 은 레이아웃을 계산하지 않아 color-contrast 는 자동 skip 되므로,
 * 색 대비는 Playwright(visual) 층에서 실브라우저로 검사한다.
 */
export async function seriousViolations(container: Element | Document) {
  const { violations } = await axe(container);
  return violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

import { describe, it, expect } from "vitest";
import robots from "./robots";

describe("robots.txt (#15 계층 분리 이후)", () => {
  it("크롤링을 허용한다 → 크롤러가 응답을 읽어야 X-Robots-Tag: noindex 가 전달된다", () => {
    const [rule] = [robots().rules].flat();

    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
  });

  it("Disallow 를 선언하지 않는다 → 막으면 noindex 를 못 읽어 색인이 그대로 남는다", () => {
    const [rule] = [robots().rules].flat();

    expect(rule.disallow).toBeUndefined();
  });

  it("sitemap 을 알리지 않는다 → 색인시킬 페이지는 랜딩(apex)에 있다", () => {
    expect(robots().sitemap).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import robots from "./robots";

describe("robots.txt (#15 계층 분리 이후)", () => {
  it("콘솔 호스트 전체를 색인에서 제외한다 → 보호 화면이 soft-404 로 잡히지 않는다", () => {
    const [rule] = [robots().rules].flat();

    expect(rule.userAgent).toBe("*");
    expect(rule.disallow).toBe("/");
    expect(rule.allow).toBeUndefined();
  });

  it("sitemap 을 알리지 않는다 → 색인시킬 페이지는 랜딩(apex)에 있다", () => {
    expect(robots().sitemap).toBeUndefined();
  });
});

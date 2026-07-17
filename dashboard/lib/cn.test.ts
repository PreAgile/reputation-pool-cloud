import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("falsy 값을 걸러내고 합친다", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("상충하는 tailwind 유틸을 last-wins로 정규화한다(tailwind-merge)", () => {
    // 조건부로 px-4를 덧붙이면 px-2는 사라져야 한다(소스 순서 의존 제거).
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("상충 없는 클래스는 모두 보존한다", () => {
    expect(cn("text-ink", "font-bold")).toBe("text-ink font-bold");
  });
});

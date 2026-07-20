import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("장식이라 aria-hidden 이고, 맥동·모션감소 클래스와 전달 className 을 갖는다", () => {
    const { container } = render(<Skeleton className="h-6 w-20" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("motion-reduce:animate-none");
    expect(el.className).toContain("h-6");
    expect(el.className).toContain("w-20");
  });
});

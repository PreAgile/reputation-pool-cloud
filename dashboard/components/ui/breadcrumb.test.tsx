import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "./breadcrumb";

describe("Breadcrumb", () => {
  const items = [
    { label: "풀 오버뷰", href: "/" },
    { label: "PROXY" },
    { label: "proxy-good" },
  ];

  it("nav(aria-label)·링크·현재 위치(aria-current)를 렌더한다", () => {
    render(<Breadcrumb items={items} />);

    expect(screen.getByRole("navigation", { name: "위치 경로" })).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "풀 오버뷰" });
    expect(link).toHaveAttribute("href", "/");

    const current = screen.getByText("proxy-good");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("href 없는 중간 조각은 링크가 아니다", () => {
    render(<Breadcrumb items={items} />);
    expect(screen.queryByRole("link", { name: "PROXY" })).not.toBeInTheDocument();
    expect(screen.getByText("PROXY")).toBeInTheDocument();
  });
});

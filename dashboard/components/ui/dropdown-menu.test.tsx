import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuIconTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import { seriousViolations } from "@/test/a11y";

function Harness({ onRevoke = vi.fn() }: { onRevoke?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuIconTrigger label="키 작업 메뉴 열기" />
      <DropdownMenuContent>
        <DropdownMenuItem>라벨 수정</DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={onRevoke}>
          키 폐기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu (Radix)", () => {
  it("트리거 클릭으로 role=menu 와 항목을 연다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "키 작업 메뉴 열기" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "라벨 수정" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "키 폐기" })).toBeInTheDocument();
  });

  it("항목 선택 시 콜백을 호출하고 메뉴를 닫는다", async () => {
    const onRevoke = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRevoke={onRevoke} />);

    await user.click(screen.getByRole("button", { name: "키 작업 메뉴 열기" }));
    await user.click(await screen.findByRole("menuitem", { name: "키 폐기" }));

    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Escape 로 메뉴를 닫는다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "키 작업 메뉴 열기" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a11y: 메뉴가 열린 상태에서 critical/serious 위반이 없다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "키 작업 메뉴 열기" }));
    await screen.findByRole("menu");
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

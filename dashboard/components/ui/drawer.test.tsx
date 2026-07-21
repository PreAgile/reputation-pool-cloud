import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "./drawer";
import { seriousViolations } from "@/test/a11y";

function Harness({ onOpenChange = vi.fn() }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Drawer
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          onOpenChange(o);
        }}
        title="proxy-1"
        description="프록시"
      >
        <p>상세 요약</p>
      </Drawer>
    </>
  );
}

describe("Drawer (Radix Dialog 우측 시트)", () => {
  it("열기 전에는 dialog 가 없고, 트리거 후 제목·내용과 함께 열린다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "열기" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("proxy-1")).toBeInTheDocument();
    expect(screen.getByText("상세 요약")).toBeInTheDocument();
  });

  it("닫기 버튼을 누르면 onOpenChange(false) 로 닫힌다", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "열기" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "미리보기 닫기" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Esc 로도 닫힌다", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "열기" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("열린 상태에서 심각한 a11y 위반이 없다", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "열기" }));
    await screen.findByRole("dialog");

    expect(await seriousViolations(container.ownerDocument.body)).toEqual([]);
  });
});

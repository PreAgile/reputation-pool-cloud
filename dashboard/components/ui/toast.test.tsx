import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast, TOAST_DURATION_MS } from "./toast";

/** useToast 훅을 두드릴 트리거 버튼. */
function Harness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("성공했습니다")}>성공</button>
      <button onClick={() => toast.error("실패했습니다")}>실패</button>
    </>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());

  it("성공 토스트를 role=status(aria-live polite)로 띄운다", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "성공" }));
    const t = screen.getByRole("status");
    expect(t).toHaveTextContent("성공했습니다");
    expect(t).toHaveAttribute("aria-live", "polite");
  });

  it("오류 토스트를 role=alert(aria-live assertive)로 띄운다", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "실패" }));
    const t = screen.getByRole("alert");
    expect(t).toHaveTextContent("실패했습니다");
    expect(t).toHaveAttribute("aria-live", "assertive");
  });

  it("자동 소멸 타이머가 지나면 사라진다", () => {
    vi.useFakeTimers();
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "성공" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("닫기 버튼으로 수동으로 닫는다", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "성공" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("여러 개를 동시에 스택한다", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "성공" }));
    fireEvent.click(screen.getByRole("button", { name: "실패" }));
    expect(screen.getByRole("status")).toHaveTextContent("성공했습니다");
    expect(screen.getByRole("alert")).toHaveTextContent("실패했습니다");
  });

  it("Provider 밖에서 useToast 를 쓰면 명확히 실패한다", () => {
    // 콘솔 에러 소음 억제.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

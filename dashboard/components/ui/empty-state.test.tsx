import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./empty-state";
import { seriousViolations } from "@/test/a11y";

describe("EmptyState — 빈/에러 상태 블록", () => {
  it("제목과 설명을 렌더한다", () => {
    render(<EmptyState title="발급된 API 키가 없습니다" description="첫 키를 발급해 보세요." />);
    expect(screen.getByText("발급된 API 키가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("첫 키를 발급해 보세요.")).toBeInTheDocument();
  });

  it("tone=error 면 role=alert 로 노출한다", () => {
    render(<EmptyState tone="error" title="불러오지 못했습니다" description="네트워크 오류" />);
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
  });

  it("action 을 주면 버튼을 노출하고 클릭 시 콜백을 호출한다", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EmptyState title="비어 있음" action={{ label: "다시 시도", onClick }} />);

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("action 이 없으면 버튼을 렌더하지 않는다", () => {
    render(<EmptyState title="비어 있음" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a11y: critical/serious 위반이 없다", async () => {
    render(
      <EmptyState
        tone="error"
        title="불러오지 못했습니다"
        description="네트워크 오류"
        action={{ label: "다시 시도", onClick: vi.fn() }}
      />,
    );
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { BrowserFrame } from "./browser-frame";
import { seriousViolations } from "@/test/a11y";

/**
 * 라이트박스의 키보드 계약 (#140).
 *
 * PR #139 리뷰에서 나온 지적을 잠근다 — 모달이 열려도 Tab 이 배경으로 새고, 닫아도 포커스가 "확대"
 * 버튼으로 돌아오지 않았다. 키보드만 쓰는 사용자는 닫은 뒤 자기 위치를 잃고, 스크린리더 사용자는
 * 읽지 말아야 할 배경을 훑게 된다.
 *
 * `fireEvent` 를 쓰는 이유: 이 레포는 `@testing-library/user-event` 를 의존성에 두지 않는다
 * (`app/page.test.tsx` 도 `fireEvent`). 랜딩에 라이브러리를 안 들이겠다는 판단으로 Radix Dialog 대신
 * 트랩을 직접 구현했으므로, 테스트 쪽에서만 의존성을 늘리는 것도 앞뒤가 맞지 않는다.
 *
 * jsdom 은 Tab 으로 포커스를 실제로 옮기지 않으므로, Tab 테스트가 확인하는 것은 **트랩 핸들러가
 * 되감아 주는지**다 — 되감지 않으면 브라우저에서 포커스가 배경으로 나간다.
 */
describe("BrowserFrame", () => {
  const props = {
    srcLight: "/shot-light.png",
    srcDark: "/shot-dark.png",
    alt: "대시보드 스크린샷",
    enlargeLabel: "스크린샷 확대",
    closeLabel: "닫기",
  };

  const openDialog = () => {
    const { container } = render(<BrowserFrame {...props} />);
    const trigger = screen.getByRole("button", { name: props.enlargeLabel });
    fireEvent.click(trigger);
    return { container, trigger, dialog: screen.getByRole("dialog") };
  };

  it("처음에는 라이트박스가 닫혀 있다", () => {
    render(<BrowserFrame {...props} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("확대를 누르면 → 라이트박스가 열리고 포커스가 닫기 버튼으로 간다", () => {
    const { dialog } = openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: props.closeLabel })).toHaveFocus();
  });

  it("열려 있는 동안 Tab 을 눌러도 → 포커스가 모달 밖으로 나가지 않는다", () => {
    const { dialog } = openDialog();
    const close = within(dialog).getByRole("button", { name: props.closeLabel });

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(close).toHaveFocus();

    // 되감기도 마찬가지 — 첫 요소에서 Shift+Tab 이 배경으로 넘어가면 안 된다.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(close).toHaveFocus();
  });

  it("포커스가 어쩌다 모달 밖에 있어도 → 다음 Tab 이 모달 안으로 되감는다", () => {
    const { trigger, dialog } = openDialog();
    // 배경으로 새어 나간 상태를 강제로 만든다(브라우저에서 프로그래매틱 focus 로 생길 수 있다).
    trigger.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Escape 로 닫으면 → 포커스가 원래 확대 버튼으로 돌아온다", () => {
    const { trigger } = openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("닫기 버튼으로 닫아도 → 포커스가 확대 버튼으로 돌아온다", () => {
    const { trigger, dialog } = openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: props.closeLabel }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("배경을 클릭해 닫아도 → 포커스가 확대 버튼으로 돌아온다", () => {
    const { trigger, dialog } = openDialog();

    fireEvent.click(dialog);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("열려 있는 동안 배경은 inert 가 되고 → 닫으면 원래대로 돌아온다", () => {
    const { dialog } = openDialog();

    // 다이얼로그는 body 로 포털되므로 "배경" 은 body 의 나머지 직계 자식이다.
    // jsdom 은 inert 의 포커스 차단을 흉내내지 않으므로 속성 자체를 단정한다 — 실제 키보드 차단은
    // 위의 Tab 테스트가 JS 트랩으로 따로 확인한다.
    const background = Array.from(document.body.children).filter((el) => el !== dialog);
    expect(background.length).toBeGreaterThan(0);
    expect(background.every((el) => el.hasAttribute("inert"))).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(background.some((el) => el.hasAttribute("inert"))).toBe(false);
  });

  it("닫으면 body 스크롤 잠금이 풀린다", () => {
    openDialog();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("a11y: 닫힌 상태와 열린 상태 모두 critical/serious 위반이 없다", async () => {
    const { container } = render(<BrowserFrame {...props} />);
    expect(await seriousViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: props.enlargeLabel }));

    // 포털이라 container 밖에 있다 — body 전체를 검사한다(axe 는 Element 만 받는다).
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});

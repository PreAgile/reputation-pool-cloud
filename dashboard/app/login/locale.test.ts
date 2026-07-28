import { describe, it, expect } from "vitest";
import { pickLoginLocale } from "./locale";

/**
 * 로그인 화면의 언어 선택은 이 순수 함수 하나에 달려 있는데 테스트가 없었다 — 그래서 "기본이 영어"라는
 * 계약이 어디에도 고정돼 있지 않았고, Playwright 가 locale 을 지정하지 않은 채 en-US 를 보내면서 e2e
 * 6개가 전부 로그인 버튼을 못 찾아 죽었다. 그 계약을 여기서 명세로 박는다.
 *
 * 핵심은 "한국어를 **더** 선호할 때만 ko" 라는 점이다. 단순히 목록에 ko 가 있으면 ko 로 가는 것이 아니라
 * q 가중치를 비교하므로, 그 비교가 실제로 일어나는지까지 본다.
 */
describe("pickLoginLocale: Accept-Language 로 로그인 화면 언어 고르기", () => {
  it("헤더가 없으면 → 영어다 (기본값)", () => {
    expect(pickLoginLocale(null)).toBe("en");
    expect(pickLoginLocale(undefined)).toBe("en");
    expect(pickLoginLocale("")).toBe("en");
  });

  it("CI 브라우저처럼 en-US 만 보내면 → 영어다 (e2e 가 한글 라벨을 찾다 죽었던 바로 그 경우)", () => {
    expect(pickLoginLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("Playwright 가 locale: ko-KR 로 보내면 → 한국어다 (이 값이 e2e 를 살린다)", () => {
    expect(pickLoginLocale("ko-KR")).toBe("ko");
  });

  it("한국어를 더 선호하면 → 한국어다", () => {
    expect(pickLoginLocale("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("ko");
  });

  it("영어를 더 선호하면 → 목록에 한국어가 있어도 영어다 (존재 여부가 아니라 가중치로 정한다)", () => {
    expect(pickLoginLocale("en-US,en;q=0.9,ko;q=0.5")).toBe("en");
  });

  it("가중치가 같으면 → 영어다 (동점은 기본값으로 기운다)", () => {
    expect(pickLoginLocale("ko;q=0.8,en;q=0.8")).toBe("en");
  });

  it("아는 언어가 하나도 없으면 → 영어다", () => {
    expect(pickLoginLocale("fr-FR,de;q=0.8")).toBe("en");
  });

  it("q 값이 깨져 있어도 → 예외 없이 기본 가중치로 판단한다", () => {
    expect(pickLoginLocale("ko;q=not-a-number")).toBe("ko");
  });
});

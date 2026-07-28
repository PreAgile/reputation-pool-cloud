import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_VARY,
  isLocale,
  pickLocaleFromAcceptLanguage,
  pickLocaleFromCountry,
  resolveLocale,
} from "./locale";

/**
 * 로그인 화면의 언어 선택은 이 순수 함수 하나에 달려 있는데 테스트가 없었다 — 그래서 "기본이 영어"라는
 * 계약이 어디에도 고정돼 있지 않았고, Playwright 가 locale 을 지정하지 않은 채 en-US 를 보내면서 e2e
 * 6개가 전부 로그인 버튼을 못 찾아 죽었다. 그 계약을 여기서 명세로 박는다.
 *
 * 핵심은 "한국어를 **더** 선호할 때만 ko" 라는 점이다. 단순히 목록에 ko 가 있으면 ko 로 가는 것이 아니라
 * q 가중치를 비교하므로, 그 비교가 실제로 일어나는지까지 본다.
 *
 * (#110) 함수는 `pickLoginLocale` 에서 `pickLocaleFromAcceptLanguage` 로 승격됐지만 계약은 그대로다 —
 * 랜딩도 같은 판별을 쓰므로 이 8케이스가 두 화면의 공용 계약이 되었다.
 */
describe("pickLocaleFromAcceptLanguage: Accept-Language 로 화면 언어 고르기", () => {
  it("헤더가 없으면 → 영어다 (기본값)", () => {
    expect(pickLocaleFromAcceptLanguage(null)).toBe("en");
    expect(pickLocaleFromAcceptLanguage(undefined)).toBe("en");
    expect(pickLocaleFromAcceptLanguage("")).toBe("en");
  });

  it("CI 브라우저처럼 en-US 만 보내면 → 영어다 (e2e 가 한글 라벨을 찾다 죽었던 바로 그 경우)", () => {
    expect(pickLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("Playwright 가 locale: ko-KR 로 보내면 → 한국어다 (이 값이 e2e 를 살린다)", () => {
    expect(pickLocaleFromAcceptLanguage("ko-KR")).toBe("ko");
  });

  it("한국어를 더 선호하면 → 한국어다", () => {
    expect(pickLocaleFromAcceptLanguage("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("ko");
  });

  it("영어를 더 선호하면 → 목록에 한국어가 있어도 영어다 (존재 여부가 아니라 가중치로 정한다)", () => {
    expect(pickLocaleFromAcceptLanguage("en-US,en;q=0.9,ko;q=0.5")).toBe("en");
  });

  it("가중치가 같으면 → 영어다 (동점은 기본값으로 기운다)", () => {
    expect(pickLocaleFromAcceptLanguage("ko;q=0.8,en;q=0.8")).toBe("en");
  });

  it("아는 언어가 하나도 없으면 → 영어다", () => {
    expect(pickLocaleFromAcceptLanguage("fr-FR,de;q=0.8")).toBe("en");
  });

  it("q 값이 깨져 있어도 → 예외 없이 기본 가중치로 판단한다", () => {
    expect(pickLocaleFromAcceptLanguage("ko;q=not-a-number")).toBe("ko");
  });

  it("한국어를 q=0 으로 명시 거부하면 → 영어다 (q=0 은 '받지 않겠다'는 뜻이다)", () => {
    expect(pickLocaleFromAcceptLanguage("ko;q=0")).toBe("en");
  });
});

describe("pickLocaleFromCountry: CF-IPCountry 국가코드로 보조 판별", () => {
  it("한국(KR)이면 → 한국어다", () => {
    expect(pickLocaleFromCountry("KR")).toBe("ko");
    expect(pickLocaleFromCountry("kr")).toBe("ko");
  });

  it("다른 나라면 → 판단을 보류한다(null) — '미국이면 영어'라고 단정하지 않는다", () => {
    expect(pickLocaleFromCountry("US")).toBeNull();
    expect(pickLocaleFromCountry("JP")).toBeNull();
  });

  it("헤더가 없거나 불명(XX)·Tor(T1)이면 → 판단을 보류한다(null)", () => {
    expect(pickLocaleFromCountry(null)).toBeNull();
    expect(pickLocaleFromCountry(undefined)).toBeNull();
    expect(pickLocaleFromCountry("")).toBeNull();
    expect(pickLocaleFromCountry("XX")).toBeNull();
    expect(pickLocaleFromCountry("T1")).toBeNull();
  });
});

/**
 * 이 기능의 대표적 실패 방식은 "자동 판별이 사용자의 선택과 매번 싸우는 것"이다. 그래서 우선순위가
 * 곧 스펙이다 — 쿠키(사용자가 직접 고름) > Accept-Language > CF-IPCountry > 기본 영어.
 * `source` 까지 단정하는 이유: 결과가 우연히 같아서 통과하는 테스트를 만들지 않기 위해서다
 * (예: 쿠키 ko + 헤더 ko 는 어느 신호가 이겼는지 결과만으로는 구분되지 않는다).
 */
describe("resolveLocale: 신호 우선순위 — 사용자의 명시적 선택이 언제나 이긴다", () => {
  it("쿠키에 en 이 있으면 → 브라우저가 한국어를 선호하고 IP 도 KR 이어도 영어다", () => {
    expect(resolveLocale({ cookie: "en", acceptLanguage: "ko-KR,ko;q=0.9", country: "KR" })).toEqual({
      locale: "en",
      source: "cookie",
    });
  });

  it("쿠키에 ko 가 있으면 → 브라우저가 영어만 보내도 한국어다", () => {
    expect(resolveLocale({ cookie: "ko", acceptLanguage: "en-US,en;q=0.9", country: "US" })).toEqual({
      locale: "ko",
      source: "cookie",
    });
  });

  it("쿠키 값이 지원하지 않는 값(ja·빈값)이면 → 무시하고 헤더로 판별한다", () => {
    expect(resolveLocale({ cookie: "ja", acceptLanguage: "ko-KR" })).toEqual({
      locale: "ko",
      source: "accept-language",
    });
    expect(resolveLocale({ cookie: "", acceptLanguage: "en-US" })).toEqual({
      locale: "en",
      source: "accept-language",
    });
  });

  it("쿠키가 없고 헤더가 한국어를 선호하면 → 한국어다 (IP 국가는 보지 않는다)", () => {
    expect(resolveLocale({ acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8", country: "US" })).toEqual({
      locale: "ko",
      source: "accept-language",
    });
  });

  it("헤더가 영어를 선호하면 → IP 가 KR 이어도 영어다 (브라우저 설정이 국가보다 정확하다)", () => {
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9", country: "KR" })).toEqual({
      locale: "en",
      source: "accept-language",
    });
  });

  it("헤더가 모르는 언어뿐이고 IP 가 KR 이면 → 국가 신호로 한국어다", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,de;q=0.8", country: "KR" })).toEqual({
      locale: "ko",
      source: "country",
    });
  });

  it("헤더가 없고 IP 가 KR 이면 → 국가 신호로 한국어다 (헤더 없는 클라이언트 보조)", () => {
    expect(resolveLocale({ country: "KR" })).toEqual({ locale: "ko", source: "country" });
  });

  it("아무 신호도 없으면 → 안전한 기본값 영어다 (중립 헤더로 오는 크롤러가 여기로 온다)", () => {
    expect(resolveLocale({})).toEqual({ locale: "en", source: "default" });
    expect(resolveLocale({ acceptLanguage: null, country: null, cookie: null })).toEqual({
      locale: "en",
      source: "default",
    });
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("locale 유틸 부속 계약", () => {
  it("isLocale 은 지원 로케일만 통과시킨다 → 쿠키 값 검증에 쓸 수 있다", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("ja")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("Vary 값에 판별 입력 3개가 모두 들어 있다 → 캐시가 언어를 섞지 않는다", () => {
    expect(LOCALE_VARY).toContain("Accept-Language");
    expect(LOCALE_VARY).toContain("Cookie");
    expect(LOCALE_VARY).toContain("CF-IPCountry");
  });
});

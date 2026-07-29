import { describe, it, expect } from "vitest";
import { localePathFor, LOCALE_PATH } from "./locale";

/**
 * `localePathFor` 는 언어 스위처의 목적지를 정하는 계산이다 (#143). 여기가 틀리면 스위처가 사용자를
 * 다른 문서로 데려가거나(문맥 상실) 없는 URL 로 보낸다(404) — 둘 다 조용히 나쁘다.
 */
describe("localePathFor: 지금 경로의 다른 언어판 URL", () => {
  it("랜딩 루트면 → 각 로케일의 랜딩 경로다", () => {
    expect(localePathFor("/", "en")).toBe(LOCALE_PATH.en);
    expect(localePathFor("/", "ko")).toBe(LOCALE_PATH.ko);
  });

  it("한국어 랜딩이면 → 영어는 / 로, 한국어는 그대로 /ko 다", () => {
    expect(localePathFor("/ko", "en")).toBe("/");
    expect(localePathFor("/ko", "ko")).toBe("/ko");
  });

  it("영어 docs 하위 페이지면 → 같은 슬러그의 한국어 페이지를 가리킨다(랜딩으로 튕기지 않는다)", () => {
    expect(localePathFor("/docs/api", "ko")).toBe("/ko/docs/api");
    expect(localePathFor("/docs/api", "en")).toBe("/docs/api");
  });

  it("한국어 docs 하위 페이지면 → 같은 슬러그의 영어 페이지를 가리킨다", () => {
    expect(localePathFor("/ko/docs/api", "en")).toBe("/docs/api");
    expect(localePathFor("/ko/docs/api", "ko")).toBe("/ko/docs/api");
  });

  it("docs 루트면 → 두 로케일의 docs 루트로 이어진다(문서를 벗어나지 않는다)", () => {
    expect(localePathFor("/docs", "ko")).toBe("/ko/docs");
    expect(localePathFor("/ko/docs", "en")).toBe("/docs");
  });

  it("뒤 슬래시가 붙어 들어와도 → trailingSlash:false 규칙과 같은 형태를 돌려준다", () => {
    expect(localePathFor("/ko/docs/faq/", "en")).toBe("/docs/faq");
    expect(localePathFor("/docs/faq/", "ko")).toBe("/ko/docs/faq");
    expect(localePathFor("/ko/", "en")).toBe("/");
  });

  it("/korean 처럼 /ko 로 시작하는 다른 경로는 → 프리픽스로 오인하지 않는다", () => {
    expect(localePathFor("/korean", "en")).toBe("/korean");
    expect(localePathFor("/korean", "ko")).toBe("/ko/korean");
  });
});

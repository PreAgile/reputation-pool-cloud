import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "./middleware";

/**
 * 미들웨어는 순수 판별(`lib/locale.ts`)과 달리 **응답 자체**가 계약이다 — 어디로 보내는지(Location),
 * 그리고 중간 캐시에 무엇을 알리는지(`Vary`)까지가 스펙이다. 그래서 유틸 테스트로 대체할 수 없고
 * 실제 응답 헤더를 읽어 단정한다.
 *
 * `Vary` 를 굳이 응답에서 확인하는 이유: 판별을 붙이면서 `Vary` 를 빼면 Caddy/Cloudflare 가 한 언어로
 * 만든 응답을 다른 언어 방문자에게 준다 — 자동 판별이 틀리는 것보다 나쁜, 캐시에 박히는 버그다.
 */
function request(
  path: string,
  { acceptLanguage, country, cookie }: { acceptLanguage?: string; country?: string; cookie?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);
  if (country) headers.set("cf-ipcountry", country);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "https://app.poolroost.com"), { headers });
}

describe("랜딩 로케일 미들웨어(#110): / 로 들어온 방문자를 신호대로 보낸다", () => {
  it("한국어 선호 브라우저로 / 에 들어오면 → /ko 로 보낸다 (한국어 랜딩을 본다)", () => {
    const res = middleware(request("/", { acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8" }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ko");
  });

  it("영어 선호 브라우저로 / 에 들어오면 → 리다이렉트 없이 그 자리에서 영어 랜딩을 렌더한다", () => {
    const res = middleware(request("/", { acceptLanguage: "en-US,en;q=0.9" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("스위처로 영어를 골라 쿠키가 있으면 → 브라우저가 한국어를 선호해도 / 에 머문다 (리다이렉트 루프 차단)", () => {
    const res = middleware(
      request("/", { acceptLanguage: "ko-KR,ko;q=0.9", country: "KR", cookie: "rp_locale=en" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("스위처로 한국어를 골라 쿠키가 있으면 → 브라우저가 영어를 선호해도 /ko 로 보낸다", () => {
    const res = middleware(request("/", { acceptLanguage: "en-US,en;q=0.9", cookie: "rp_locale=ko" }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ko");
  });

  it("헤더가 모르는 언어뿐이고 CF-IPCountry 가 KR 이면 → /ko 로 보낸다 (국가는 보조 신호)", () => {
    const res = middleware(request("/", { acceptLanguage: "fr-FR,de;q=0.8", country: "KR" }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ko");
  });

  it("아무 신호도 없는 크롤러가 / 에 들어오면 → 영어 랜딩을 그 자리에서 렌더한다 (한 언어만 색인되지 않게)", () => {
    const res = middleware(request("/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("영구 리다이렉트를 쓰지 않는다 → 브라우저가 판별 결과를 영구 기억해 되돌리기를 막지 않는다", () => {
    const res = middleware(request("/", { acceptLanguage: "ko-KR" }));

    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(308);
  });
});

describe("랜딩 로케일 미들웨어(#110): 캐시가 언어를 섞지 않게 알린다", () => {
  it("영어로 렌더되는 / 응답에 → Vary 로 판별 입력 3개(Accept-Language·Cookie·CF-IPCountry)를 알린다", () => {
    const vary = middleware(request("/", { acceptLanguage: "en-US" })).headers.get("Vary");

    expect(vary).toBeTruthy();
    expect(vary).toContain("Accept-Language");
    expect(vary).toContain("Cookie");
    expect(vary).toContain("CF-IPCountry");
  });

  it("/ko 로 보내는 리다이렉트 응답에도 → 같은 Vary 가 붙는다 (리다이렉트 자체가 캐시되면 더 나쁘다)", () => {
    const res = middleware(request("/", { acceptLanguage: "ko-KR" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("Vary")).toContain("Accept-Language");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("판별된 응답은 공유 캐시에 담기지 않는다 → Cloudflare 가 Accept-Encoding 외 Vary 를 무시해도 안전하다", () => {
    for (const acceptLanguage of ["en-US", "ko-KR"]) {
      const cacheControl = middleware(request("/", { acceptLanguage })).headers.get("Cache-Control");
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("private");
    }
  });

  it("로그인 화면도 같은 신호로 언어가 갈리므로 → /login 응답에 Vary 가 붙는다 (리다이렉트는 하지 않는다)", () => {
    const res = middleware(request("/login", { acceptLanguage: "ko-KR" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("Vary")).toContain("Accept-Language");
  });
});

describe("랜딩 로케일 미들웨어(#110): 실행 범위", () => {
  it("로케일이 응답을 바꾸는 경로에만 걸린다 → / 와 /login 뿐이고 /ko 는 손대지 않는다", () => {
    expect(config.matcher).toEqual(["/", "/login"]);
    // `/ko` 가 매처에 있으면 쿠키에 따라 /ko → / 되돌림을 넣고 싶어지고, 그게 루프의 재료가 된다.
    expect(config.matcher).not.toContain("/ko");
  });
});

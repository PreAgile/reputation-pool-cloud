import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";

/**
 * 언어 판별 미들웨어(#110 → #15 이식). 판별 **규칙** 자체는 `lib/locale.ts` 의 테스트가 지키고,
 * 여기서는 그 규칙이 HTTP 응답으로 옳게 번역되는지만 본다 — 리다이렉트 상태 코드, 목적지, 그리고
 * 캐시 헤더. 마지막 것이 빠지면 공유 캐시가 한 방문자의 언어를 다음 방문자에게 준다.
 */

function makeRequest(
  path: string,
  init: { cookie?: string; acceptLanguage?: string; country?: string; cfCountry?: string } = {},
) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.acceptLanguage) headers.set("accept-language", init.acceptLanguage);
  if (init.country) headers.set("cf-ipcountry", init.country);
  const request = new Request(`https://poolroost.com${path}`, { headers }) as Request & {
    cf?: { country?: string };
  };
  if (init.cfCountry) request.cf = { country: init.cfCountry };
  return request;
}

function makeContext(request: ReturnType<typeof makeRequest>) {
  const next = vi.fn(async () => new Response("<html>en</html>", { status: 200 }));
  return { context: { request, next }, next };
}

describe("랜딩 언어 판별 미들웨어", () => {
  it("루트에서 한국어로 판별되면 → /ko 로 307 을 보낸다", async () => {
    const { context } = makeContext(makeRequest("/", { acceptLanguage: "ko-KR,ko;q=0.9" }));
    const response = await onRequest(context);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/ko");
  });

  it("영구 리다이렉트(308)를 쓰지 않는다 → 스위처로 영어를 골라도 되돌릴 수 있어야 한다", async () => {
    const { context } = makeContext(makeRequest("/", { acceptLanguage: "ko" }));
    const response = await onRequest(context);

    expect(response.status).not.toBe(308);
    expect(response.status).toBe(307);
  });

  it("쿠키로 영어를 골라 뒀으면 → 한국어 브라우저여도 리다이렉트하지 않는다", async () => {
    const { context, next } = makeContext(
      makeRequest("/", { cookie: "rp_locale=en", acceptLanguage: "ko-KR,ko;q=0.9" }),
    );
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("Cloudflare 가 준 국가(request.cf)로도 판별한다 → 헤더가 없어도 동작한다", async () => {
    const { context } = makeContext(makeRequest("/", { cfCountry: "KR" }));
    const response = await onRequest(context);

    expect(response.status).toBe(307);
  });

  it("브라우저가 한국어를 명시적으로 거부하면(q=0) → 한국 IP 여도 영어를 준다", async () => {
    const { context, next } = makeContext(
      makeRequest("/", { acceptLanguage: "ko;q=0,en", cfCountry: "KR" }),
    );
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("/ko 는 건드리지 않는다 → 명시적 URL 이 쿠키에 밀려 되돌아가면 링크가 깨진다", async () => {
    const { context, next } = makeContext(makeRequest("/ko", { cookie: "rp_locale=en" }));
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("루트가 아닌 경로는 그대로 통과시킨다", async () => {
    const { context, next } = makeContext(makeRequest("/docs", { acceptLanguage: "ko" }));
    await onRequest(context);

    expect(next).toHaveBeenCalled();
  });

  it("리다이렉트 응답에 Vary 와 no-store 를 단다 → 공유 캐시가 남의 언어를 재사용하지 못하게", async () => {
    const { context } = makeContext(makeRequest("/", { acceptLanguage: "ko" }));
    const response = await onRequest(context);

    expect(response.headers.get("vary")).toContain("Accept-Language");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("영어로 통과시킨 응답에도 Vary 를 단다 → 판별에 쓰인 입력을 캐시에 알린다", async () => {
    const { context } = makeContext(makeRequest("/", { acceptLanguage: "en-US" }));
    const response = await onRequest(context);

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toContain("Accept-Language");
    expect(await response.text()).toBe("<html>en</html>");
  });
});

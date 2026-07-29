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

  // #143 의 결정: 한국어 docs 가 생겼어도 docs 는 자동 판별에서 제외한다. 공유된 딥링크는 보낸 사람이
  // 본 언어로 열려야 하기 때문이다. 언어 전환은 스위처가, 색인은 hreflang·사이트맵이 담당한다.
  it("한국어 브라우저가 영어 docs 딥링크를 열면 → /ko/docs 로 돌리지 않고 그대로 준다", async () => {
    const { context, next } = makeContext(
      makeRequest("/docs/api", { acceptLanguage: "ko-KR,ko;q=0.9", cfCountry: "KR" }),
    );
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("영어 쿠키를 가진 방문자가 한국어 docs 링크를 열면 → /docs 로 튕기지 않는다", async () => {
    const { context, next } = makeContext(makeRequest("/ko/docs/api", { cookie: "rp_locale=en" }));
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("/en 은 존재하지 않으므로 → 정본인 / 로 301 을 보낸다", async () => {
    const { context, next } = makeContext(makeRequest("/en"));
    const response = await onRequest(context);

    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
    // 정적 자산을 꺼내오지 않고 리다이렉트로 끝난다.
    expect(next).not.toHaveBeenCalled();
  });

  it("/en/ (뒤 슬래시)도 같이 / 로 보낸다", async () => {
    const { context } = makeContext(makeRequest("/en/"));
    const response = await onRequest(context);

    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("/en 리다이렉트는 유입 파라미터를 잃지 않는다", async () => {
    const { context } = makeContext(makeRequest("/en?utm_source=hn&ref=x"));
    const response = await onRequest(context);

    expect(new URL(response.headers.get("location") ?? "").search).toBe("?utm_source=hn&ref=x");
  });

  it("/en 은 로케일 판별과 무관하게 301 이다 → URL 규칙이라 방문자에 따라 갈리지 않는다", async () => {
    const korean = makeContext(makeRequest("/en", { acceptLanguage: "ko-KR,ko;q=0.9", cfCountry: "KR" }));
    const english = makeContext(makeRequest("/en", { acceptLanguage: "en-US" }));

    const a = await onRequest(korean.context);
    const b = await onRequest(english.context);

    expect(a.status).toBe(301);
    expect(b.status).toBe(301);
    expect(new URL(a.headers.get("location") ?? "").pathname).toBe("/");
    expect(new URL(b.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("/enterprise 처럼 /en 으로 시작하는 다른 경로는 건드리지 않는다", async () => {
    const { context, next } = makeContext(makeRequest("/enterprise"));
    const response = await onRequest(context);

    expect(next).toHaveBeenCalled();
    expect(response.status).toBe(200);
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

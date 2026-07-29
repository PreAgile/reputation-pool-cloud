import { describe, it, expect } from "vitest";
import { middleware, config } from "./middleware";

/**
 * 미들웨어는 순수 판별(`lib/locale.ts`)과 달리 **응답 자체**가 계약이다 — 중간 캐시에 무엇을 알리는지
 * (`Vary`·`Cache-Control`)까지가 스펙이다. 그래서 유틸 테스트로 대체할 수 없고 실제 응답 헤더를 읽어 단정한다.
 *
 * `/` → `/ko` 로케일 리다이렉트에 대한 단정은 여기 없다. 랜딩이 별개 앱(`landing/`, apex)으로 분리되면서
 * 그 규칙은 `landing/functions/_middleware.ts` 로 옮겨갔고(그쪽 테스트가 검증한다), 이 앱의 `/` 는
 * `next.config.ts` 의 301 이 미들웨어보다 먼저 잡는다(#15/#16).
 */

describe("로그인 미들웨어(#110/#15): 언어에 따라 갈리는 응답을 캐시가 섞지 않게 알린다", () => {
  it("로그인 화면은 신호에 따라 언어가 갈리므로 → Vary 로 판별 입력 3개(Accept-Language·Cookie·CF-IPCountry)를 알린다", () => {
    const vary = middleware().headers.get("Vary");

    expect(vary).toBeTruthy();
    expect(vary).toContain("Accept-Language");
    expect(vary).toContain("Cookie");
    expect(vary).toContain("CF-IPCountry");
  });

  it("판별된 응답은 공유 캐시에 담기지 않는다 → Cloudflare 가 Accept-Encoding 외 Vary 를 무시해도 안전하다", () => {
    const cacheControl = middleware().headers.get("Cache-Control");

    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
  });

  it("리다이렉트는 하지 않는다 → 로그인 화면은 그 자리에서 렌더된다", () => {
    const res = middleware();

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("로그인 미들웨어(#110/#15): 실행 범위", () => {
  it("로케일이 응답을 바꾸는 경로에만 걸린다 → /login 뿐이다", () => {
    expect(config.matcher).toEqual(["/login"]);
  });

  // `/` 가 매처에 있으면 next.config.ts 의 apex 301 뒤에 죽은 코드를 다시 들여놓게 되고, `/ko` 가 있으면
  // 이 앱에 없는 랜딩 경로를 다루려 들게 된다. 이전(#15)이 끝난 상태를 잠근다.
  it("이 앱에 없는 랜딩 경로는 매처에 없다 → / 와 /ko 는 대시보드의 관심사가 아니다", () => {
    expect(config.matcher).not.toContain("/");
    expect(config.matcher).not.toContain("/ko");
  });
});

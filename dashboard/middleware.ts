import { NextResponse } from "next/server";
import { LOCALE_VARY } from "@/lib/locale";

/**
 * 로그인 화면의 캐시 보호 — 이 미들웨어가 하는 일은 그것뿐이다.
 *
 * `/login` 은 이 앱에 남은 유일한 다국어 화면이다(`app/login/page.tsx` 가 `resolveLocale()` 로 쿠키 →
 * `Accept-Language` → `CF-IPCountry` 를 보고 언어를 고른다). 즉 **같은 URL 이 요청 헤더에 따라 다른
 * 본문**을 낸다. 알리지 않으면 중간 캐시(Caddy·Cloudflare)가 한 언어로 만든 응답을 다른 언어 방문자에게
 * 준다 — 판별이 조금 틀리는 것보다 나쁜, 캐시에 박히는 버그다. 두 겹으로 막는다.
 *
 *   1. `Cache-Control: private, no-store` — 판별된 HTML 을 공유 캐시에 아예 담지 못하게 한다. 이게
 *      실질적인 보증이다(Cloudflare 는 `Accept-Encoding` 외의 `Vary` 를 무시하므로 `Vary` 만으로는
 *      엣지 혼선을 막을 수 없다).
 *   2. `Vary: Accept-Language, Cookie, CF-IPCountry` — 무엇에 따라 응답이 갈리는지 명시.
 *
 * ## 여기에 랜딩 로케일 리다이렉트가 없는 이유 (#110 → #15)
 * 예전에는 `/` 로 들어온 방문자를 신호대로 `/ko` 로 307 하는 규칙이 이 파일에 있었다. 랜딩·문서가
 * 별개 앱(`landing/`, apex `poolroost.com`)으로 분리되면서 그 규칙은 **[`landing/functions/_middleware.ts`]**
 * (Cloudflare Pages Functions)로 옮겨갔다 — Pages 는 `request.cf.country` 를 직접 주므로 오히려 그쪽이
 * 정확하다. 이 앱의 `/` 는 이제 `next.config.ts` 의 `redirects()` 가 apex 로 301 하고, 그 리다이렉트는
 * 미들웨어보다 **먼저** 실행되므로 여기서 `/` 를 볼 일이 아예 없다. 그래서 매처에서도 뺐다.
 *
 * **주의(실측):** Next 15.5 는 app-router 페이지 **200** 응답의 `Vary` 를 자신의 RSC 값
 * (`rsc, next-router-state-tree, …`)으로 덮어쓴다. middleware 로 넣어도 `next.config.ts` 의
 * `headers()` 로 넣어도 사라진다(`Cache-Control` 은 남는다). 그래서 클라이언트까지 도달하는 `Vary` 는
 * 리버스 프록시에서 붙인다 — 레포 루트 `Caddyfile`·`Caddyfile.prod` 의 `(locale_vary)` 스니펫.
 * 여기서도 계속 붙이는 이유는 Caddy 없이 대시보드 컨테이너를 직접 노출하는 경로에서도 최소한의 신호가
 * 남아야 하기 때문이다. 두 겹이 겹치면 `Vary` 필드가 중복 출력되는데, `Vary` 는 목록 헤더라 중복은
 * 합쳐져 해석되므로 무해하다.
 */
export function middleware(): NextResponse {
  const response = NextResponse.next();
  response.headers.set("Vary", LOCALE_VARY);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // 로케일이 응답을 바꾸는 경로만. 이 앱에는 `/login` 하나뿐이다(`/` 는 next.config.ts 의 301 이 먼저 잡는다).
  matcher: ["/login"],
};

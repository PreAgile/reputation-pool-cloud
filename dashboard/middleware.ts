import { NextResponse, type NextRequest } from "next/server";
import {
  COUNTRY_HEADER,
  LOCALE_COOKIE,
  LOCALE_PATH,
  LOCALE_VARY,
  resolveLocale,
} from "@/lib/locale";

/**
 * 랜딩 언어 자동 판별 (#110).
 *
 * `/` 로 들어온 방문자의 신호(쿠키 → `Accept-Language` → `CF-IPCountry`)를 보고 한국어를 선호하면
 * `/ko` 로 보낸다. 그 외에는 `/` 를 그대로 영어로 렌더한다.
 *
 * ## 왜 리다이렉트인가(그 자리에서 rewrite 하지 않는 이유)
 * 같은 URL 이 방문자에 따라 다른 언어를 담으면 색인·공유·캐시가 전부 모호해진다. 언어별로 URL 이
 * 하나씩 있는 편이 낫고, 두 랜딩은 이미 `alternates.languages`(hreflang)+`canonical` 로 각각 색인
 * 가능하게 되어 있다. 중립 `Accept-Language` 를 보내는 크롤러는 판별 결과가 기본값(en)이라 `/` 에
 * 그대로 남으므로 "무조건 리다이렉트해서 한 언어만 색인된다"는 문제도 생기지 않는다.
 *
 * ## `/ko` 는 건드리지 않는다
 * 명시적 URL 은 그 자체가 명시적 선택이다. `/ko` 를 쿠키에 따라 `/` 로 되돌리면 공유된 링크가 깨지고
 * 리다이렉트가 서로를 되돌리는 루프의 재료가 된다. 그래서 이 미들웨어의 리다이렉트는 `/` → `/ko`
 * **한 방향뿐**이고, 되돌리기는 쿠키가 담당한다.
 *
 * ## 리다이렉트 루프 방지
 * `/ko` 의 스위처에서 English 를 고르면 이동 **전에** `rp_locale=en` 쿠키가 심긴다(스위처 참고).
 * 쿠키가 1순위이므로 `/` 는 다시 `/ko` 로 튕기지 않는다. 프리페치된 응답이 쿠키 없이 만들어진 리다이렉트일
 * 수 있어 스위처 링크는 프리페치를 끈다.
 *
 * ## 캐시 오염
 * `/` 와 `/login` 은 요청 헤더에 따라 본문이 달라진다. 알리지 않으면 중간 캐시(Caddy·Cloudflare)가
 * 한 언어 응답을 다른 언어 방문자에게 준다 — 자동 판별이 조금 틀리는 것보다 나쁘다. 두 겹으로 막는다.
 *
 *   1. `Cache-Control: private, no-store` — 판별된 HTML 을 공유 캐시에 아예 담지 못하게 한다. 이게
 *      실질적인 보증이다(Cloudflare 는 `Accept-Encoding` 외의 `Vary` 를 무시하므로 `Vary` 만으로는
 *      엣지 혼선을 막을 수 없다). 언어가 URL 로 고정된 `/ko` 는 매처 밖이라 그대로 캐시된다.
 *   2. `Vary: Accept-Language, Cookie, CF-IPCountry` — 무엇에 따라 응답이 갈리는지 명시.
 *
 * **주의(실측):** Next 15.5 는 app-router 페이지 **200** 응답의 `Vary` 를 자신의 RSC 값
 * (`rsc, next-router-state-tree, …`)으로 덮어쓴다. middleware 로 넣어도 `next.config.ts` 의
 * `headers()` 로 넣어도 사라진다(`Cache-Control` 은 남는다). 그래서 클라이언트까지 도달하는 `Vary` 는
 * 리버스 프록시에서 붙인다 — 레포 루트 `Caddyfile`·`Caddyfile.prod` 의 `(locale_vary)` 스니펫.
 * 여기서도 계속 붙이는 이유는 (a) 307 리다이렉트 응답에는 이 값이 그대로 남고, (b) Caddy 없이 대시보드
 * 컨테이너를 직접 노출하는 경로에서도 최소한의 신호가 남아야 하기 때문이다. 두 겹이 겹치면 `Vary` 필드가
 * 중복 출력되는데, `Vary` 는 목록 헤더라 중복은 합쳐져 해석되므로 무해하다.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const { locale } = resolveLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get("accept-language"),
    country: request.headers.get(COUNTRY_HEADER),
  });

  // `/` 에서 한국어로 판별되면 한국어 랜딩으로 보낸다. 307(임시)인 이유: 판별 결과는 요청 헤더·쿠키에
  // 따라 바뀌므로 브라우저가 영구 기억해서는 안 된다(308 은 스위처로 영어를 골라도 되돌릴 수 없게 만든다).
  if (pathname === "/" && locale !== "en") {
    return withLocaleCacheHeaders(
      NextResponse.redirect(new URL(LOCALE_PATH[locale], request.url), 307),
    );
  }

  return withLocaleCacheHeaders(NextResponse.next());
}

/**
 * 로케일 판별에 쓰인 입력을 `Vary` 로 알리고, 판별된 응답이 공유 캐시에 담기지 않게 한다.
 * (`Vary` 가 200 응답에서 Next 에 덮이는 문제와 그 보완은 파일 상단 주석 참고.)
 */
function withLocaleCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set("Vary", LOCALE_VARY);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // 로케일이 응답을 바꾸는 경로만. `/ko` 는 언어가 URL 로 고정돼 있어 판별도 `Vary` 도 필요 없다.
  matcher: ["/", "/login"],
};

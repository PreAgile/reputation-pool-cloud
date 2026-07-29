/**
 * 랜딩 언어 자동 판별 — Cloudflare Pages Functions 판 (#110 을 #15 계층 분리에 맞춰 이식).
 *
 * ## 왜 여기로 옮겼나
 * 원본은 Next 의 `middleware.ts` 였는데, 정적 내보내기(`output: "export"`)에는 미들웨어가 없다.
 * 요청마다 판단하는 로직이므로 어딘가에서는 요청을 받아야 하고, Pages 에서 그 자리가 이 파일이다.
 * `functions/_middleware.ts` 는 이 프로젝트로 들어오는 **모든** 요청 앞에서 실행된다.
 *
 * ## 오히려 정확해진 것
 * Next 판은 `CF-IPCountry` **헤더**를 읽었다. Cloudflare 안에서는 `request.cf.country` 를 직접 받으므로
 * 헤더가 없거나 조작된 경우를 걱정할 필요가 없다. 헤더는 폴백으로만 남긴다 — 로컬 `wrangler pages dev`
 * 에는 `request.cf` 가 없어서 그때도 손으로 시험할 수 있어야 한다.
 *
 * ## 판별 규칙은 그대로다
 * `lib/locale.ts` 의 `resolveLocale` 을 그대로 재사용한다(쿠키 → Accept-Language → 국가 → 기본값).
 * 규칙을 여기 다시 적으면 두 곳이 갈라진다 — 이식은 **입력을 얻는 방법**만 바꾸는 일이어야 한다.
 */
import { COUNTRY_HEADER, LOCALE_COOKIE, LOCALE_PATH, LOCALE_VARY, resolveLocale } from "../lib/locale";

/** Pages Functions 의 컨텍스트 중 이 파일이 쓰는 부분만. 런타임 전체 타입을 끌어오지 않는다. */
interface MiddlewareContext {
  request: Request & { cf?: { country?: string } };
  next: () => Promise<Response>;
}

/** `Cookie` 헤더에서 값 하나를 꺼낸다. 쿠키 파서를 의존성으로 들이기엔 쓰임이 이 한 줄이다. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);

  // 판별이 응답을 바꾸는 경로는 `/` 하나뿐이다. `/ko` 는 언어가 URL 로 고정돼 있으므로 건드리지 않는다 —
  // 명시적 URL 을 쿠키에 따라 되돌리면 공유된 링크가 깨지고 리다이렉트 루프의 재료가 된다.
  const isRoot = url.pathname === "/" || url.pathname === "";
  if (!isRoot) return next();

  const { locale } = resolveLocale({
    cookie: readCookie(request.headers.get("cookie"), LOCALE_COOKIE),
    acceptLanguage: request.headers.get("accept-language"),
    // `request.cf` 가 없는 환경(로컬 wrangler)에서는 헤더로 떨어진다.
    country: request.cf?.country ?? request.headers.get(COUNTRY_HEADER),
  });

  // 307(임시)인 이유: 판별 결과는 요청 헤더·쿠키에 따라 바뀌므로 브라우저가 영구 기억해서는 안 된다.
  // 308 이면 스위처로 영어를 골라도 되돌릴 수 없다.
  if (locale !== "en") {
    const target = new URL(LOCALE_PATH[locale], url);
    // 쿼리를 옮겨 싣는다. `new URL(path, base)` 는 base 의 검색 문자열을 버리므로 그냥 두면
    // `/?utm_source=…` 로 들어온 한국어 방문자에게서 유입 파라미터가 통째로 사라진다.
    target.search = url.search;
    return new Response(null, {
      status: 307,
      headers: {
        Location: target.toString(),
        Vary: LOCALE_VARY,
        // 판별된 응답이 공유 캐시에 담기면 다음 방문자가 남의 언어를 받는다.
        "Cache-Control": "private, no-store",
      },
    });
  }

  // 영어로 판별된 경우엔 정적 `/` 를 그대로 내보내되, 어떤 입력으로 갈렸는지 캐시에 알린다.
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("Vary", LOCALE_VARY);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

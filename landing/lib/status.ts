/**
 * 상태 페이지(#145)의 **라우트 단일 출처**.
 *
 * 사고 데이터는 `lib/incidents.ts` 에 있고, 여기에는 URL 만 있다. 갈라 두는 이유는 바뀌는 이유가
 * 다르기 때문이다 — 사고는 자주 늘고 경로는 거의 바뀌지 않는다.
 *
 * 사이트맵·hreflang·푸터 링크·언어 스위처가 모두 이 계산을 쓴다. docs 가 `DOCS_ROOT` 를 한 곳에 둔
 * 것과 같은 이유이고, 실제로 #130 은 라우트를 추가하면서 사이트맵을 잊어 색인에서 통째로 빠졌다.
 */
import { DEFAULT_LOCALE, localePathFor, type Locale } from "@/lib/locale";

/**
 * 로케일 프리픽스가 없는 정본 경로. 로케일별 URL 은 반드시 `statusHref()` 로 만든다 —
 * `/ko` + `/status` 를 손으로 이어 붙이는 코드가 두 곳만 생겨도 한쪽이 뒤처진다.
 */
export const STATUS_PATH = "/status";

/**
 * 로케일별 상태 페이지 URL. 프리픽스 산술은 `localePathFor()` 가 이미 하고 있으므로 다시 만들지
 * 않는다 — 그 함수는 "프리픽스를 뺀 경로가 두 로케일에 모두 존재한다"를 전제하는데, 이 라우트는
 * `app/status`·`app/ko/status` 두 벌을 함께 만들었으므로 전제를 만족한다.
 */
export function statusHref(locale: Locale = DEFAULT_LOCALE): string {
  return localePathFor(STATUS_PATH, locale);
}

/**
 * 두 언어판을 서로의 대안으로 알리는 hreflang 표. `x-default` 는 "어느 언어도 맞지 않는 크롤러의
 * 기본 URL"이므로 기본 로케일을 가리킨다(docs 와 같은 규칙).
 *
 * 상태 페이지는 `/` 와 달리 자동 로케일 리다이렉트를 받지 않는다(`functions/_middleware.ts` 는
 * 루트에서만 판별한다). 그래서 두 언어가 각각 색인되는 경로는 사이트맵과 이 hreflang 뿐이다.
 */
export function statusAlternates(): Record<Locale | "x-default", string> {
  return {
    en: statusHref("en"),
    ko: statusHref("ko"),
    "x-default": statusHref(DEFAULT_LOCALE),
  };
}

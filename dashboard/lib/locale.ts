/**
 * 로케일 판별 공용 유틸 (#110).
 *
 * 원래 `app/login/locale.ts` 의 `pickLoginLocale()` 이 로그인 화면 전용으로 `Accept-Language` 를
 * 파싱하고 있었는데, 랜딩(`/`·`/ko`)은 스위처를 사람이 누르는 것뿐이라 같은 서비스 안에서 한 화면은
 * 자동, 한 화면은 수동으로 동작이 갈렸다. 그 파싱을 재구현하지 않고 여기로 **승격**해서 랜딩·로그인이
 * 하나의 정책을 공유하게 한다.
 *
 * 신호 우선순위(높은 것이 이긴다):
 *   1. 사용자의 명시적 선택 — 언어 스위처가 남긴 쿠키(`rp_locale`). **항상 자동 판별을 이긴다.**
 *      이 우선순위가 곧 리다이렉트 루프 방지 장치다: `/` → `/ko` 자동 이동과 스위처의 `/ko` → `/`
 *      되돌리기가 싸우지 않는 이유는, 스위처가 이동 전에 쿠키를 먼저 심어 자동 판별을 무력화하기 때문이다.
 *   2. `Accept-Language` 헤더 — q 가중치를 비교한다(존재 여부가 아니다).
 *   3. IP 기반 국가 — Cloudflare 가 붙여 주는 `CF-IPCountry`(GeoIP DB 의존성 없음). VPN·프록시·해외
 *      체류자에서 틀리고 이 제품 고객은 프록시를 쓰는 사람들이라 **보조 신호로만** 쓴다.
 *   4. 아무 신호도 없으면 안전한 기본값 = 영어.
 */

/** 지원 로케일. 기본은 영어(en); 한국어를 더 선호한다는 신호가 있을 때만 ko. */
export type Locale = "en" | "ko";

/** 신호가 없거나 모르는 언어일 때의 기본값. 로그인·랜딩이 같은 값을 쓴다. */
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: Locale[] = ["en", "ko"];

/** 로케일별 랜딩 경로. 스위처·hreflang·미들웨어 리다이렉트가 공용으로 쓴다. */
export const LOCALE_PATH: Record<Locale, string> = { en: "/", ko: "/ko" };

/** 사용자의 명시적 선택을 기억하는 쿠키 이름. */
export const LOCALE_COOKIE = "rp_locale";

/** 쿠키 유효기간(1년). 한 번 고른 언어는 브라우저 설정과 무관하게 유지된다. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 로케일 판별 응답에 반드시 붙는 `Vary`.
 *
 * 이게 없으면 Caddy/Cloudflare 같은 중간 캐시가 **한 언어로 만든 응답을 다른 언어 방문자에게** 준다 —
 * 자동 판별이 조금 틀리는 것보다 훨씬 나쁘다(틀린 언어가 캐시에 박힌다). 판별에 쓰는 세 입력을 모두 적는다.
 */
export const LOCALE_VARY = "Accept-Language, Cookie, CF-IPCountry";

/** 국가 신호를 담는 Cloudflare 헤더 이름. */
export const COUNTRY_HEADER = "cf-ipcountry";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ko";
}

/**
 * `Accept-Language`(예: `ko-KR,ko;q=0.9,en-US;q=0.8`)에서 로케일을 고른다.
 * q 값을 비교해 **한국어가 영어보다 명확히 우선일 때만** ko, 동점이면 기본값(en) 쪽으로 기운다.
 *
 * 아는 언어(ko·en)가 하나도 없거나 헤더가 비었으면 `null` — "판단할 근거가 없다"와 "영어를 선호한다"를
 * 구분해야 국가(`CF-IPCountry`) 폴백을 그 자리에만 끼울 수 있다.
 */
function matchAcceptLanguage(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  let ko = -1;
  let en = -1;
  for (const part of acceptLanguage.split(",")) {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    const weight = Number.isFinite(q) ? q : 1;
    // q=0 은 "이 언어는 받지 않겠다"는 뜻이므로 신호로 세지 않는다(있는 것으로 세면 `ko;q=0` 이
    // 한국어 선호로 뒤집힌다).
    if (weight <= 0) continue;
    if (tag === "ko" || tag.startsWith("ko-")) ko = Math.max(ko, weight);
    else if (tag === "en" || tag.startsWith("en-")) en = Math.max(en, weight);
  }
  if (ko < 0 && en < 0) return null;
  return ko > en ? "ko" : "en";
}

/**
 * `Accept-Language` 만으로 로케일을 고른다(모르면 기본 영어).
 * 승격 전 `pickLoginLocale()` 과 계약이 동일하다 — 기존 8케이스 단위테스트가 그대로 이 함수를 검증한다.
 */
export function pickLocaleFromAcceptLanguage(acceptLanguage: string | null | undefined): Locale {
  return matchAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * `CF-IPCountry` 국가코드에서 로케일을 고른다. 한국(KR)만 ko 로 보고 나머지는 `null`(판단 보류) —
 * "미국이면 영어"처럼 단정하지 않는다. 헤더가 없거나 `XX`(불명)·`T1`(Tor)이면 당연히 `null`.
 */
export function pickLocaleFromCountry(country: string | null | undefined): Locale | null {
  return country?.trim().toUpperCase() === "KR" ? "ko" : null;
}

/**
 * 사용자의 선택을 담는 `Set-Cookie`/`document.cookie` 값을 만든다.
 *
 * `HttpOnly` 를 쓰지 않는다 — 이 쿠키는 **브라우저에서** 스위처가 심어야 하고(그래야 이동 전에
 * 동기적으로 반영된다) 비밀값이 아니다. `SameSite=Lax` 로 크로스사이트 요청에는 실리지 않게 한다.
 */
export function localeCookie(locale: Locale, secure: boolean): string {
  const attrs = [`${LOCALE_COOKIE}=${locale}`, "Path=/", `Max-Age=${LOCALE_COOKIE_MAX_AGE}`, "SameSite=Lax"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/**
 * 브라우저에서 사용자의 언어 선택을 기억시킨다. 스위처가 **이동 전에** 호출해야 한다 —
 * 그래야 `/ko` → `/` 요청에 쿠키가 실려 미들웨어가 다시 `/ko` 로 튕기지 않는다(루프 차단).
 */
export function rememberLocale(locale: Locale): void {
  document.cookie = localeCookie(locale, window.location.protocol === "https:");
}

/** 어떤 신호가 로케일을 정했는지 — 디버깅·테스트 가시성용. */
export type LocaleSource = "cookie" | "accept-language" | "country" | "default";

export interface LocaleSignals {
  /** 스위처가 남긴 쿠키 값(사용자의 명시적 선택). */
  cookie?: string | null;
  acceptLanguage?: string | null;
  /** `CF-IPCountry` 값. */
  country?: string | null;
}

/**
 * 세 신호를 우선순위대로 적용해 로케일을 정한다. 사용자의 명시적 선택(쿠키)이 언제나 1순위다.
 */
export function resolveLocale(signals: LocaleSignals): { locale: Locale; source: LocaleSource } {
  const { cookie, acceptLanguage, country } = signals;

  // 1순위: 사용자가 직접 고른 값. 자동 판별이 사용자의 선택과 매번 싸우는 것이 이 기능의 대표적 실패
  // 방식이므로 여기서 즉시 끝낸다.
  if (isLocale(cookie)) return { locale: cookie, source: "cookie" };

  const fromHeader = matchAcceptLanguage(acceptLanguage);
  if (fromHeader) return { locale: fromHeader, source: "accept-language" };

  const fromCountry = pickLocaleFromCountry(country);
  if (fromCountry) return { locale: fromCountry, source: "country" };

  return { locale: DEFAULT_LOCALE, source: "default" };
}

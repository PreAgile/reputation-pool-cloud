import { cookies, headers } from "next/headers";
import { LoginForm } from "./login-form";
import { COUNTRY_HEADER, LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

/**
 * 서버 컴포넌트: 로그인 화면 기본 언어를 고른다. 랜딩(#110)과 **같은** 정책을 쓴다 —
 * 랜딩 스위처로 고른 언어(쿠키) → `Accept-Language` → `CF-IPCountry` → 기본 영어.
 * 화면의 언어 토글로 즉시 바꿀 수도 있다(이 화면 안에서만 유효한 일시적 전환).
 *
 * 응답이 이 세 신호에 따라 달라지므로 `Vary`·`Cache-Control` 은 미들웨어(`middleware.ts`)가 붙인다.
 */
export default async function LoginPage() {
  const [headerBag, cookieBag] = await Promise.all([headers(), cookies()]);
  const { locale } = resolveLocale({
    cookie: cookieBag.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerBag.get("accept-language"),
    country: headerBag.get(COUNTRY_HEADER),
  });
  return <LoginForm initialLocale={locale} />;
}

import { headers } from "next/headers";
import { LoginForm } from "./login-form";
import { pickLoginLocale } from "./locale";

/**
 * 서버 컴포넌트: 브라우저의 `Accept-Language` 헤더로 로그인 화면 기본 언어를 고른다(기본 영어,
 * 한국어를 명확히 선호할 때만 한국어). 사용자는 화면의 언어 토글로 즉시 바꿀 수 있다.
 */
export default async function LoginPage() {
  const locale = pickLoginLocale((await headers()).get("accept-language"));
  return <LoginForm initialLocale={locale} />;
}

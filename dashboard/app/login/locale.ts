import type { Locale } from "@/lib/locale";

/**
 * 로그인 화면 사전. 로케일 판별 자체는 `lib/locale.ts` 로 승격됐다(#110) — 여기에 있던
 * `pickLoginLocale()` 은 랜딩과 정책을 공유해야 해서 `pickLocaleFromAcceptLanguage()` /
 * `resolveLocale()` 로 옮겼다. 이 파일은 문자열만 갖는다.
 */
interface LoginDict {
  title: string;
  subtitle: string;
  username: string;
  password: string;
  submit: string;
  submitting: string;
  showPassword: string;
  hidePassword: string;
  errBadCredentials: string;
  errThrottled: string;
  errNetwork: string;
  languageLabel: string;
}

export const LOGIN_I18N: Record<Locale, LoginDict> = {
  en: {
    title: "reputation·pool console",
    subtitle: "Admin sign-in",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    showPassword: "Show password",
    hidePassword: "Hide password",
    errBadCredentials: "Incorrect username or password.",
    errThrottled: "Too many attempts — please try again in a moment.",
    errNetwork: "Sign-in failed. Check the server connection.",
    languageLabel: "Language",
  },
  ko: {
    title: "reputation·pool 콘솔",
    subtitle: "관리자 로그인",
    username: "아이디",
    password: "비밀번호",
    submit: "로그인",
    submitting: "확인 중…",
    showPassword: "비밀번호 표시",
    hidePassword: "비밀번호 숨기기",
    errBadCredentials: "아이디 또는 비밀번호가 올바르지 않습니다.",
    errThrottled: "로그인 시도가 많아 잠시 제한되었습니다. 잠시 후 다시 시도하세요.",
    errNetwork: "로그인에 실패했습니다. 서버 연결을 확인하세요.",
    languageLabel: "언어",
  },
};

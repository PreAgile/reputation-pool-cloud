/** 로그인 화면 로케일. 기본은 영어(en); 브라우저가 한국어를 더 선호할 때만 ko. */
export type LoginLocale = "en" | "ko";

/**
 * `Accept-Language` 헤더(예: `ko-KR,ko;q=0.9,en-US;q=0.8`)를 파싱해 로케일을 고른다.
 * q 값(사용 우선순위)을 비교해 **한국어가 영어보다 명확히 우선일 때만** ko, 그 외에는 기본 en.
 */
export function pickLoginLocale(acceptLanguage: string | null | undefined): LoginLocale {
  if (!acceptLanguage) return "en";
  let ko = 0;
  let en = 0;
  for (const part of acceptLanguage.split(",")) {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    const weight = Number.isFinite(q) ? q : 1;
    if (tag === "ko" || tag.startsWith("ko-")) ko = Math.max(ko, weight);
    else if (tag === "en" || tag.startsWith("en-")) en = Math.max(en, weight);
  }
  return ko > en ? "ko" : "en";
}

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

export const LOGIN_I18N: Record<LoginLocale, LoginDict> = {
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

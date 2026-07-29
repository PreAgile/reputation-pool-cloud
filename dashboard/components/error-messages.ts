import { isLocale, type Locale } from "@/lib/locale";

/**
 * 에러 화면 문구 (#134). 404·런타임 에러·루트 레이아웃 붕괴 세 화면이 공유한다.
 *
 * 랜딩 쪽 마케팅 사전에 얹지 않은 이유: 그건 애초에 다른 앱이고(#15 로 `landing/` 으로 분리됐다),
 * 랜딩 섹션 구조에 맞춰진 큰 서버 컴포넌트 전용 타입이다(ReactNode 를 담는다). 에러 문구는
 * `global-error.tsx` 처럼 **루트 레이아웃 밖**에서도 읽혀야 하므로, 의존이 적은 평범한 문자열 사전으로
 * 대시보드 안에 따로 둔다.
 *
 * 톤 규칙: "고장났다" 가 아니라 "지금은 안 되지만 곧 된다, 데이터는 무사하다". 사용자가 자기 잘못이라고
 * 느끼게 하지 않고, 다음에 할 행동을 하나만 제시한다.
 */
export type ErrorMessages = {
  notFound: { title: string; description: string };
  runtime: { title: string; description: string };
  /** 루트 레이아웃까지 깨진 경우 — 앱을 통째로 다시 불러오는 것 말고 할 수 있는 게 없다. */
  fatal: { title: string; description: string };
  actions: { home: string; console: string; retry: string; reload: string };
  /** 문의 시 첨부할 오류 식별자(Next 가 서버 에러에 붙이는 digest) 라벨. */
  digest: string;
};

const ko: ErrorMessages = {
  notFound: {
    title: "찾는 페이지가 없습니다",
    description: "주소가 바뀌었거나 삭제된 페이지입니다. 홈에서 다시 시작해 주세요.",
  },
  runtime: {
    title: "화면을 불러오지 못했습니다",
    description: "일시적인 문제일 수 있습니다. 다시 시도하면 대부분 그대로 이어집니다.",
  },
  fatal: {
    title: "콘솔을 표시하지 못했습니다",
    description: "페이지를 새로 불러오면 복구됩니다. 반복되면 오류 식별자와 함께 알려 주세요.",
  },
  actions: { home: "홈으로", console: "콘솔 열기", retry: "다시 시도", reload: "새로 불러오기" },
  digest: "오류 식별자",
};

const en: ErrorMessages = {
  notFound: {
    title: "This page doesn’t exist",
    description: "The address may have changed or the page was removed. Start again from the home page.",
  },
  runtime: {
    title: "We couldn’t load this screen",
    description: "This is often temporary — trying again usually picks up right where you left off.",
  },
  fatal: {
    title: "We couldn’t render the console",
    description: "Reloading the page should fix it. If it keeps happening, send us the error id below.",
  },
  actions: { home: "Go home", console: "Open console", retry: "Try again", reload: "Reload" },
  digest: "Error id",
};

const MESSAGES: Record<Locale, ErrorMessages> = { en, ko };

export function getErrorMessages(locale: Locale): ErrorMessages {
  return MESSAGES[locale];
}

/**
 * 에러 경계가 서버에서 렌더될 때의 언어. `app/layout.tsx` 가 `<html lang="ko">` 로 고정한 값과 같아야
 * 한다 — 다르면 하이드레이션 시점에 문구만 언어가 바뀌어 깜빡인다. 랜딩 기본값(en)이 아닌 이유는
 * 로그인 뒤 콘솔이 한국어이기 때문이고, 그 판단의 단일 출처가 루트 레이아웃이다.
 */
const SSR_FALLBACK_LOCALE: Locale = "ko";

/**
 * 클라이언트에서 현재 로케일을 읽는다 — `<html lang>` 이 유일하게 믿을 수 있는 단서다.
 *
 * 루트 레이아웃이 `lang="ko"` 로 고정돼 있고 영어 랜딩만 `HtmlLang` 으로 en 으로 바꾼다(#110). 즉
 * 이 속성은 "지금 사용자가 보고 있던 언어" 와 이미 일치한다 — 쿠키·`Accept-Language` 를 다시 파싱하면
 * 같은 판정을 두 번 하는 셈이고, 두 결과가 갈리면 에러 화면만 다른 언어로 뜬다.
 *
 * 에러 경계는 대부분 브라우저에서 렌더되지만 `global-error` 는 서버 렌더 경로가 있어 `document` 유무를
 * 확인한다.
 */
export function localeFromDocument(): Locale {
  if (typeof document === "undefined") return SSR_FALLBACK_LOCALE;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : SSR_FALLBACK_LOCALE;
}

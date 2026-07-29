import type { ReactNode } from "react";
import type { Locale } from "@/lib/locale";

/**
 * 랜딩(#16) 다국어 사전 타입. 기본 로케일은 영어(`/`), 한국어는 `/ko`.
 * i18n 은 **마케팅 랜딩에만** 적용된다(로그인 뒤 대시보드는 한국어 유지).
 *
 * 번역 대상은 "사용자 노출 문자열"뿐이다. 아이콘 JSX·href·이미지 경로·코드 스니펫·주소줄 URL 등
 * **비번역 구조**는 사전에 넣지 않고 컴포넌트 상수로 두고 index 로 결합한다.
 * body 처럼 인라인 `<code>` 강조가 섞인 값은 ReactNode 로 둔다(서버 컴포넌트에서만 소비).
 */
// 로케일 자체(타입·목록·경로)는 `lib/locale.ts` 가 단일 출처다(#110) — 미들웨어·로그인도 같은 값을
// 쓰므로 마케팅 사전에서 다시 선언하지 않고 그대로 내보낸다.
export type { Locale } from "@/lib/locale";
export { LOCALES, LOCALE_PATH } from "@/lib/locale";

/** 스위처에 노출할 사람이 읽는 언어명. */
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", ko: "한국어" };

export type Dict = {
  meta: { title: string; description: string };

  /** 접근성 라벨(아이콘·다이얼로그 등 텍스트 없는 UI). */
  a11y: { enlarge: string; closeDialog: string; toggleTheme: string };

  /** marketing-nav(client) 로 넘어가는 슬라이스 — 반드시 평범한 문자열만(직렬화 안전). */
  nav: {
    links: { features: string; how: string; docs: string };
    getStarted: string;
    github: string;
    openSource: string;
    home: string;
    menuOpen: string;
    menuClose: string;
    language: string;
  };

  hero: {
    badge: string;
    title: string;
    bodyLead: string;
    bodyBold: string;
    bodyTail: string;
    ctaPrimary: string;
    ctaSecondary: string;
    footnote: string;
  };

  trust: {
    heading: string;
    /** 4개 — 아이콘 배열과 index 로 정렬. */
    items: { title: string; sub: string }[];
  };

  features: {
    label: string;
    heading: string;
    /** 3개 — reversed/img/url 구조와 index 로 정렬. */
    items: { kicker: string; title: string; body: ReactNode; alt: string }[];
  };

  caps: {
    label: string;
    heading: string;
    intro: string;
    /** 6개 — 아이콘 배열과 index 로 정렬. */
    items: { title: string; body: ReactNode }[];
  };

  steps: {
    label: string;
    heading: string;
    intro: string;
    /** 3개 — n/code 스니펫과 index 로 정렬. */
    items: { title: string; body: string }[];
  };

  docs: {
    label: string;
    heading: string;
    intro: string;
    /** 3개 — href 구조와 index 로 정렬. */
    items: { tag: string; title: string; body: string; go: string }[];
    /**
     * 카드 아래 한 줄 — 엔진 레포로 가는 링크(#121). docs 사이트가 생겨도 이 링크는 남긴다:
     * "판단 로직을 직접 읽을 수 있다"는 것이 이 제품의 진짜 신뢰 신호다.
     */
    engineNote: string;
    engineCta: string;
  };

  contact: {
    label: string;
    heading: string;
    body: string;
    cta: string;
    orWrite: string;
  };

  footer: {
    /** 3개 컬럼 — href/external 구조와 index 로 정렬. */
    columns: { heading: string; links: string[] }[];
    /** 하단 저작권 접미(브랜드명은 컴포넌트에서 결합). */
    rights: string;
  };
};

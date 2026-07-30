import type { ReactNode } from "react";
import type { IncidentSeverity } from "@/lib/incidents";
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

/** docs 섹션 카드 한 장. 목적지 슬러그는 비번역 구조라 사전에 없다(`DOCS_CARD_SLUGS` 참고). */
type DocsCard = { tag: string; title: string; body: string; go: string };

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
    /**
     * docs 카드 3장 — `landing-sections.tsx` 의 `DOCS_CARD_SLUGS` 와 **index 로 결합**한다.
     * 그래서 개수가 스타일이 아니라 계약이다: 배열로 두면 사전에 카드를 하나 더 넣는 순간 슬러그가
     * `undefined` 가 되어 `/docs/undefined` 로 가는 링크가 조용히 생긴다. 튜플로 못 박아 두면 en·ko
     * 사전과 슬러그 목록 중 하나만 늘어난 상태에서 컴파일이 깨진다.
     */
    items: readonly [DocsCard, DocsCard, DocsCard];
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

  /**
   * 상태 페이지(#145). docs 처럼 로케일별 페이지를 복제하지 않고 **사전에 둔다** — 짧은 UI 문구
   * 스무 개 남짓이라 사전 한 벌이 더 읽기 쉽고, 무엇보다 이 화면은 문장 하나하나가 "무엇을 아직
   * 모르는지"를 정직하게 말하는 역할이라 두 언어가 갈리면 안 된다. `Record` 타입이 한쪽만 고치는
   * 것을 컴파일 단계에서 막는다.
   *
   * 사고 **데이터**(제목·경과 서술·시각)는 여기 없다. 그건 `lib/incidents.ts` 가 단일 출처다 —
   * 화면 문구와 사고 기록은 바뀌는 이유가 다르다.
   */
  status: {
    meta: { title: string; description: string };
    heading: string;
    lead: string;

    /** 머리의 현재 상태 배너. */
    state: {
      label: string;
      /** 진행 중 사고가 **기록되지 않았을** 때. "정상"이라고 말하지 않는다(근거가 없다). */
      none: string;
      degraded: string;
      outage: string;
      /** 이 표시가 자동 관측이 아니라 수동 로그에서 나온다는 고지. */
      derivedFrom: string;
    };

    /** 업타임 — 숫자가 없는 이유와 앞으로의 경로를 적는다. 빈 약속("곧 제공") 대신 근거를 쓴다. */
    uptime: { heading: string; absent: string; rejected: string; next: string };

    log: {
      heading: string;
      /** 로그가 비어 있을 때. */
      empty: string;
      /** 빈 로그가 "사고가 없었다"로 읽히지 않게 하는 범위 설명. */
      scope: string;
      /** `LOG_STARTED_ON` 앞에 붙는 라벨. 날짜는 데이터에서 온다. */
      sinceLabel: string;
      ongoing: string;
      resolved: string;
      startedLabel: string;
      endedLabel: string;
      durationLabel: string;
      /** 심각도 라벨 — 색만으로 구분하지 않기 위해 항상 텍스트로 함께 낸다. */
      severity: Record<IncidentSeverity, string>;
    };

    /** 왜 이 페이지가 앱 서버가 아니라 Pages 에 있는지. */
    independence: { heading: string; body: string };

    /** 로그에 없는 문제를 알리는 경로(mailto). */
    report: { heading: string; body: string; cta: string };
  };

  footer: {
    /** 3개 컬럼 — href/external 구조와 index 로 정렬. */
    columns: { heading: string; links: string[] }[];
    /** 하단 저작권 접미(브랜드명은 컴포넌트에서 결합). */
    rights: string;
  };
};

/**
 * 고객용 docs 사이트의 정보구조 단일 출처 (#121, 로케일 확장 #143).
 *
 * 사이드바(섹션 + 페이지 목록), 본문 하단 prev/next, sitemap, 그리고 `<html lang>` 후처리
 * (`scripts/postexport-lang.mjs` 가 sitemap 을 통해 간접적으로) 이 **모두 이 배열 하나**를 읽는다.
 * 페이지를 추가할 때 고칠 곳이 한 곳이어야 목록·순서·링크가 서로 어긋나지 않는다 — 여러 곳에 따로
 * 적으면 반드시 갈린다.
 *
 * 배열의 **순서가 곧 문서의 읽는 순서**다. prev/next 는 이 순서를 그대로 따르고, 사이드바는 순서를
 * 유지한 채 `section` 으로만 묶는다(정렬하지 않는다). 그래서 같은 섹션의 페이지들은 배열에서 붙어
 * 있어야 한다 — `docsSections()` 는 그 전제를 지키는 입력에 대해서만 의미 있는 그룹을 만든다.
 *
 * ## sitemap
 * `app/sitemap.ts` 가 `DOCS_PAGES` 를 두 로케일로 map 해서 URL 과 hreflang 쌍을 만든다. sitemap 이
 * 자기 목록을 따로 들고 있으면 페이지를 추가할 때 한쪽만 고치는 사고가 나므로(실제로 #130 이 그랬다)
 * IA 원본은 계속 이 파일 하나다.
 *
 * ## 언어: 사전이 아니라 로케일별 페이지 (#143)
 * 랜딩은 `components/marketing/i18n/{en,ko}.tsx` 사전 방식이지만 **docs 는 그 방식을 쓰지 않는다.**
 * 랜딩은 짧은 문구 30여 개이고 docs 는 장문 2,000여 줄이다 — 장문을 key-value 사전에 넣으면 읽을 수
 * 없는 덩어리가 되고 편집 단위가 "페이지"에서 "키"로 바뀐다. 그래서 프로즈는 `app/docs/**`(en)와
 * `app/ko/docs/**`(ko)로 복제하고, **구조(IA·레이아웃·사이드바·pager·매니페스트)는 단일 출처로 남긴다.**
 *
 * 여기 있는 `title`·`summary` 는 프로즈가 아니라 **구조에 속하는 문자열**이다(사이드바 라벨, prev/next
 * 라벨, `<title>`, `meta description` 이 같은 값을 써야 갈리지 않는다). 그래서 사전처럼 로케일별
 * 레코드로 두고 페이지는 자기 로케일 값만 꺼내 쓴다.
 */
import { DEFAULT_LOCALE, LOCALE_PATH, type Locale } from "@/lib/locale";

/** 로케일별 문자열. 로케일을 추가하면 여기서 컴파일이 깨져 빠진 번역이 드러난다. */
export type Localised = Record<Locale, string>;

/**
 * 사이드바에서 페이지를 묶는 그룹. **식별자이고 라벨이 아니다** — 라벨은 로케일마다 다르므로
 * `DOCS_SECTION_LABEL` 이 따로 들고 있다. 배열에 등장하는 순서대로 렌더된다.
 */
export type DocsSection = "getting-started" | "reference" | "help";

/** 섹션 식별자의 사람이 읽는 이름. */
export const DOCS_SECTION_LABEL: Record<DocsSection, Localised> = {
  "getting-started": { en: "Getting started", ko: "시작하기" },
  reference: { en: "Reference", ko: "레퍼런스" },
  help: { en: "Help", ko: "도움말" },
};

export interface DocsPage {
  /**
   * docs 루트 아래의 경로 세그먼트. 루트(Introduction)는 빈 문자열이다 — URL 은 `docsHref()` 로만
   * 만든다(문자열을 손으로 이어 붙이면 루트의 빈 세그먼트에서 `/docs/` 가 된다).
   *
   * 슬러그는 **로케일과 무관하게 같다.** 번역된 슬러그(`/ko/docs/시작하기`)를 쓰지 않는 이유: 스위처가
   * 같은 페이지의 다른 언어로 가려면 두 URL 이 한 슬러그로 이어져야 하고, 슬러그가 갈리면 그 매핑을
   * 따로 관리해야 한다.
   */
  slug: string;
  /** 사이드바·prev/next·`<title>` 에 쓰는 페이지 이름. */
  title: Localised;
  /** 한 줄 요약 — 페이지 머리의 리드 문장과 `<meta name="description">` 에 함께 쓴다. */
  summary: Localised;
  section: DocsSection;
}

/**
 * 로케일별 docs 루트 경로. 영어는 기본 로케일이라 프리픽스가 없고(`/docs`), 한국어만 `/ko` 아래로
 * 들어간다 — 랜딩(`/` · `/ko`)과 같은 규칙이므로 `LOCALE_PATH` 에서 파생시킨다.
 */
export const DOCS_ROOT: Record<Locale, string> = {
  en: "/docs",
  ko: `${LOCALE_PATH.ko}/docs`,
};

/**
 * 문서 IA. 읽는 순서대로, 섹션별로 붙여서 적는다.
 *
 * 순서의 근거: 처음 온 사람은 "이게 뭔지(Introduction) → 일단 돌려보고(Quickstart) → 왜 그렇게
 * 동작하는지(Concepts)" 순으로 읽는다. 그 뒤가 필요할 때 찾아 보는 레퍼런스(Authentication, API)이고,
 * 마지막이 운영상의 질문(FAQ)이다.
 */
export const DOCS_PAGES: DocsPage[] = [
  {
    slug: "",
    title: { en: "Introduction", ko: "소개" },
    summary: {
      en: "What the hosted reputation API does, when to reach for it, and how it splits from the open-source engine underneath.",
      ko: "호스티드 평판 API 가 무엇을 해 주는지, 언제 쓸 만한지, 그리고 밑에 있는 오픈소스 엔진과 어디서 갈리는지.",
    },
    section: "getting-started",
  },
  {
    slug: "quickstart",
    title: { en: "Quickstart", ko: "퀵스타트" },
    summary: {
      en: "Issue an API key, register a resource, acquire the healthiest one for a context, and report what happened — the full round trip.",
      ko: "API 키를 발급하고, 리소스를 등록하고, 컨텍스트에 가장 건강한 리소스를 확보하고, 결과를 보고하기까지 — 한 바퀴 전체.",
    },
    section: "getting-started",
  },
  {
    slug: "concepts",
    title: { en: "Concepts", ko: "핵심 개념" },
    summary: {
      en: "Resources, contexts, and the per-context reputation cell: how score, cooldown, recovery, and the blocklist fit together.",
      ko: "리소스와 컨텍스트, 그리고 컨텍스트별 평판 셀 — 점수·쿨다운·복귀·차단 목록이 어떻게 맞물리는지.",
    },
    section: "getting-started",
  },
  {
    slug: "authentication",
    title: { en: "Authentication", ko: "인증" },
    summary: {
      en: "API keys for the gRPC data plane, admin JWTs for the REST control plane — issuing, storage, rotation, and revocation.",
      ko: "gRPC 데이터플레인은 API 키, REST 컨트롤플레인은 관리자 JWT — 발급·저장·교체·폐기까지.",
    },
    section: "reference",
  },
  {
    slug: "api",
    title: { en: "REST API reference", ko: "REST API 레퍼런스" },
    summary: {
      en: "Every control-plane endpoint: method, path, parameters, request and response bodies, and the errors each one returns.",
      ko: "컨트롤플레인의 모든 엔드포인트 — 메서드·경로·파라미터·요청과 응답 본문, 그리고 각각이 돌려주는 에러.",
    },
    section: "reference",
  },
  {
    slug: "faq",
    title: { en: "FAQ", ko: "자주 묻는 질문" },
    summary: {
      en: "Limits, retention windows, self-hosting versus the hosted API, and where to file an engine bug versus a hosting bug.",
      ko: "한도와 보존 기간, 자체 호스팅과 호스티드 API 의 차이, 그리고 엔진 버그와 호스팅 버그를 각각 어디에 알리는지.",
    },
    section: "help",
  },
];

/**
 * 슬러그의 실제 URL. 로케일 루트(`/docs` · `/ko/docs`) 아래에 슬러그를 붙인다.
 *
 * 로케일 인자를 **기본값 없이 요구하지 않는 이유**: 이 함수를 부르는 곳 대부분이 "지금 이 페이지의
 * 로케일"을 이미 들고 있어 그대로 넘기면 된다. 다만 기본값을 두면 `docsHref(slug)` 가 조용히 영어를
 * 가리키게 되므로, 기본값은 사이트의 기본 로케일과 같은 값 하나로 못 박아 둔다.
 */
export function docsHref(slug: string, locale: Locale = DEFAULT_LOCALE): string {
  const root = DOCS_ROOT[locale];
  return slug === "" ? root : `${root}/${slug}`;
}

/**
 * 한 슬러그의 모든 로케일 URL — canonical/hreflang 과 sitemap 이 같은 계산을 두 번 하지 않게.
 * `x-default` 는 "어느 언어도 맞지 않는 크롤러의 기본 URL"이므로 기본 로케일(영어)을 가리킨다.
 */
export function docsAlternates(slug: string): Record<Locale | "x-default", string> {
  return {
    en: docsHref(slug, "en"),
    ko: docsHref(slug, "ko"),
    "x-default": docsHref(slug, DEFAULT_LOCALE),
  };
}

/** 슬러그에 해당하는 페이지. 매니페스트에 없으면 `undefined`. */
export function docsPage(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find((page) => page.slug === slug);
}

/**
 * 매니페스트 순서상 앞/뒤 페이지. 첫 페이지의 `prev` 와 마지막 페이지의 `next` 는 `undefined` 다 —
 * 문서를 순환시키지 않는다(마지막에서 처음으로 되돌아가면 "끝"이라는 신호가 사라진다).
 * 슬러그가 매니페스트에 없으면 양쪽 모두 `undefined`.
 *
 * 이웃은 로케일과 무관하다(슬러그가 로케일과 무관하므로). 링크를 만드는 쪽에서 자기 로케일을 붙이므로
 * prev/next 가 언어를 넘어가는 일은 구조적으로 생기지 않는다.
 */
export function docsNeighbours(slug: string): { prev?: DocsPage; next?: DocsPage } {
  const index = DOCS_PAGES.findIndex((page) => page.slug === slug);
  if (index < 0) return {};
  return { prev: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}

/** `<title>` 접미 — 탭 여러 개를 띄웠을 때 어느 페이지인지 구분되게. */
const TITLE_SUFFIX: Localised = {
  en: "reputation·pool docs",
  ko: "reputation·pool 문서",
};

/**
 * 페이지 `metadata`. 제목·설명이 매니페스트에서 나오므로 사이드바 라벨과 검색 결과 제목이 갈리지 않는다.
 *
 * `metadataBase` 는 **여기서 설정하지 않는다** — 사이트 절대 URL 의 단일 출처는 `lib/site.ts`(#118)이고,
 * docs 페이지가 각자 오리진을 다시 선언하면 한쪽만 고치는 사고가 난다. canonical 을 상대 경로로 두면
 * Next 가 상위의 `metadataBase` 와 합성하므로 절대 URL 은 그쪽 한 곳에서 결정된다.
 *
 * `languages`(hreflang)는 #121 시점에는 없었다 — 영어 한 벌뿐이라 알릴 대안이 없었기 때문이다. 한국어
 * 문서가 생긴 지금은 두 언어가 각각 색인돼야 하므로 두 URL 을 서로의 대안으로 알린다(#143).
 */
export function docsMetadata(
  slug: string,
  locale: Locale,
): {
  title: string;
  description: string;
  alternates: { canonical: string; languages: Record<Locale | "x-default", string> };
} {
  const page = docsPage(slug);
  if (page == null) {
    throw new Error(`unknown docs slug: "${slug}" (add it to DOCS_PAGES first)`);
  }
  return {
    title: `${page.title[locale]} — ${TITLE_SUFFIX[locale]}`,
    description: page.summary[locale],
    alternates: { canonical: docsHref(slug, locale), languages: docsAlternates(slug) },
  };
}

/**
 * 사이드바용 그룹. 배열 순서를 유지한 채 인접한 같은 `section` 끼리 묶고, 섹션 라벨을 로케일에 맞춰
 * 함께 돌려준다(호출자가 라벨 테이블을 다시 뒤지지 않게).
 */
export function docsSections(
  locale: Locale,
): { section: DocsSection; label: string; pages: DocsPage[] }[] {
  const groups: { section: DocsSection; label: string; pages: DocsPage[] }[] = [];
  for (const page of DOCS_PAGES) {
    const last = groups[groups.length - 1];
    if (last?.section === page.section) last.pages.push(page);
    else groups.push({ section: page.section, label: DOCS_SECTION_LABEL[page.section][locale], pages: [page] });
  }
  return groups;
}

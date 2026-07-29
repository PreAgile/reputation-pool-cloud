/**
 * 고객용 docs 사이트(`/docs`)의 정보구조 단일 출처 (#121).
 *
 * 사이드바(섹션 + 페이지 목록), 본문 하단 prev/next, 그리고 나중에 sitemap 이 **모두 이 배열 하나**를
 * 읽는다. 페이지를 추가할 때 고칠 곳이 한 곳이어야 목록·순서·링크가 서로 어긋나지 않는다 — 세 곳에
 * 따로 적으면 반드시 갈린다.
 *
 * 배열의 **순서가 곧 문서의 읽는 순서**다. prev/next 는 이 순서를 그대로 따르고, 사이드바는 순서를
 * 유지한 채 `section` 으로만 묶는다(정렬하지 않는다). 그래서 같은 섹션의 페이지들은 배열에서 붙어
 * 있어야 한다 — `docsSections()` 는 그 전제를 지키는 입력에 대해서만 의미 있는 그룹을 만든다.
 *
 * ## sitemap (#118 과의 관계)
 * SEO 슬라이스(PR #118)가 `app/sitemap.ts`·`app/robots.ts`·`lib/site.ts` 를 들여왔고, 이 작업이
 * 진행되는 동안 main 에 머지됐다. 이 PR 은 그 파일들을 **의도적으로 건드리지 않는다** — 애초에 충돌을
 * 피하기 위한 분리였고, docs 를 sitemap 에 넣는 배선은 별도 후속으로 남긴다.
 *
 * 후속 배선은 `app/sitemap.ts` 에서 아래 `DOCS_PAGES` 를 map 하는 것으로 끝난다
 * (`docsHref(slug)` → `${SITE_URL}${href}`). 그때도 IA 원본은 계속 이 파일 하나다 — sitemap 이 자기
 * 목록을 따로 들고 있으면 페이지를 추가할 때 한쪽만 고치는 사고가 난다.
 *
 * 언어: 이 PR 의 docs 는 **영어 전용**이다(랜딩 기본 로케일이 영어, 엔진 레포가 영어, 개발자 API 문서는
 * 관례적으로 영어). 그래서 여기 title/summary 도 영어이며 `ko` 사전에 배선하지 않는다. 한국어 docs 는
 * 후속 과제다.
 */

/** 사이드바에서 페이지를 묶는 그룹. 배열에 등장하는 순서대로 렌더된다. */
export type DocsSection = "Getting started" | "Reference" | "Help";

export interface DocsPage {
  /**
   * `/docs` 아래의 경로 세그먼트. 루트(Introduction)는 빈 문자열이다 — URL 은 `docsHref()` 로만
   * 만든다(문자열을 손으로 이어 붙이면 루트의 빈 세그먼트에서 `/docs/` 가 된다).
   */
  slug: string;
  /** 사이드바·prev/next·`<title>` 에 쓰는 페이지 이름. */
  title: string;
  /** 한 줄 요약 — 페이지 머리의 리드 문장과 `<meta name="description">` 에 함께 쓴다. */
  summary: string;
  section: DocsSection;
}

/** docs 사이트 루트 경로. */
export const DOCS_ROOT = "/docs";

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
    title: "Introduction",
    summary:
      "What the hosted reputation API does, when to reach for it, and how it splits from the open-source engine underneath.",
    section: "Getting started",
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    summary:
      "Issue an API key, register a resource, acquire the healthiest one for a context, and report what happened — the full round trip.",
    section: "Getting started",
  },
  {
    slug: "concepts",
    title: "Concepts",
    summary:
      "Resources, contexts, and the per-context reputation cell: how score, cooldown, recovery, and the blocklist fit together.",
    section: "Getting started",
  },
  {
    slug: "authentication",
    title: "Authentication",
    summary:
      "API keys for the gRPC data plane, admin JWTs for the REST control plane — issuing, storage, rotation, and revocation.",
    section: "Reference",
  },
  {
    slug: "api",
    title: "REST API reference",
    summary:
      "Every control-plane endpoint: method, path, parameters, request and response bodies, and the errors each one returns.",
    section: "Reference",
  },
  {
    slug: "faq",
    title: "FAQ",
    summary:
      "Limits, retention windows, self-hosting versus the hosted API, and where to file an engine bug versus a hosting bug.",
    section: "Help",
  },
];

/** 슬러그의 실제 URL. 루트는 `/docs`, 나머지는 `/docs/<slug>`. */
export function docsHref(slug: string): string {
  return slug === "" ? DOCS_ROOT : `${DOCS_ROOT}/${slug}`;
}

/** 슬러그에 해당하는 페이지. 매니페스트에 없으면 `undefined`. */
export function docsPage(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find((page) => page.slug === slug);
}

/**
 * 매니페스트 순서상 앞/뒤 페이지. 첫 페이지의 `prev` 와 마지막 페이지의 `next` 는 `undefined` 다 —
 * 문서를 순환시키지 않는다(마지막에서 처음으로 되돌아가면 "끝"이라는 신호가 사라진다).
 * 슬러그가 매니페스트에 없으면 양쪽 모두 `undefined`.
 */
export function docsNeighbours(slug: string): { prev?: DocsPage; next?: DocsPage } {
  const index = DOCS_PAGES.findIndex((page) => page.slug === slug);
  if (index < 0) return {};
  return { prev: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}

/** `<title>` 접미 — 탭 여러 개를 띄웠을 때 어느 페이지인지 구분되게. */
const TITLE_SUFFIX = "reputation·pool docs";

/**
 * 페이지 `metadata`. 제목·설명이 매니페스트에서 나오므로 사이드바 라벨과 검색 결과 제목이 갈리지 않는다.
 *
 * `metadataBase` 는 **여기서 설정하지 않는다** — 사이트 절대 URL 의 단일 출처는 `lib/site.ts`(#118)이고,
 * docs 페이지가 각자 오리진을 다시 선언하면 한쪽만 고치는 사고가 난다. canonical 을 상대 경로로 두면
 * Next 가 상위의 `metadataBase` 와 합성하므로 절대 URL 은 그쪽 한 곳에서 결정된다.
 */
export function docsMetadata(slug: string): {
  title: string;
  description: string;
  alternates: { canonical: string };
} {
  const page = docsPage(slug);
  if (page == null) {
    throw new Error(`unknown docs slug: "${slug}" (add it to DOCS_PAGES first)`);
  }
  return {
    title: `${page.title} — ${TITLE_SUFFIX}`,
    description: page.summary,
    alternates: { canonical: docsHref(slug) },
  };
}

/** 사이드바용 그룹. 배열 순서를 유지한 채 인접한 같은 `section` 끼리 묶는다. */
export function docsSections(): { section: DocsSection; pages: DocsPage[] }[] {
  const groups: { section: DocsSection; pages: DocsPage[] }[] = [];
  for (const page of DOCS_PAGES) {
    const last = groups[groups.length - 1];
    if (last?.section === page.section) last.pages.push(page);
    else groups.push({ section: page.section, pages: [page] });
  }
  return groups;
}

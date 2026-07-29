import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";

/**
 * 정적 내보내기(`output: "export"`)에서는 라우트 핸들러가 기본적으로 동적으로 취급되어 빌드가
 * 멈춘다 — 서버가 없으니 요청 시점에 생성할 방법이 없기 때문이다. 이 파일의 출력은 빌드 시점에
 * 완전히 결정되므로 정적으로 못 박는다.
 */
export const dynamic = "force-static";


/**
 * `/sitemap.xml` — 두 언어 랜딩을 명시적으로 제출한다. 라우트 그룹 `(marketing)` 안이 아니라 `app/` 루트에
 * 있어야 `/sitemap.xml` 로 서빙된다.
 *
 * 이 사이트에 사이트맵이 특히 필요한 이유: `/` 는 미들웨어가 한국어 선호 방문자를 `/ko` 로 307 리다이렉트한다
 * (#110). 크롤링 경로가 로케일에 따라 갈리므로 두 URL 이 링크만으로 안정적으로 발견되지 않는다. 사이트맵이
 * 양쪽을 직접 알려주고, hreflang alternates 로 둘이 같은 문서의 언어 변형임을 함께 넘긴다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { en: SITE_URL, ko: `${SITE_URL}/ko` };
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ko`, changeFrequency: "weekly", priority: 0.9, alternates: { languages } },
    // docs 는 매니페스트에서 파생시킨다. 목록을 여기 손으로 적으면 페이지를 추가할 때마다 두 곳을
    // 고쳐야 하고, 실제로 #130 이 docs 6 페이지를 넣으면서 sitemap 을 잊어 색인 대상에서 빠져 있었다.
    // hreflang 을 달지 않는 이유: docs 는 영어 한 벌뿐이라 대체 언어가 없다.
    ...DOCS_PAGES.map((page) => ({
      url: `${SITE_URL}${docsHref(page.slug)}`,
      changeFrequency: "monthly" as const,
      // 랜딩(1.0/0.9)보다 낮게 두되 Introduction 을 하위 페이지보다 앞세운다.
      priority: page.slug === "" ? 0.8 : 0.7,
    })),
  ];
}

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

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
  ];
}

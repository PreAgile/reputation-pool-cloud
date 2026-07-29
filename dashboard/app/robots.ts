import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * `/robots.txt` — 지금까지 이 경로는 Cloudflare 의 관리형 robots.txt(주석만, `Sitemap:` 줄 없음)가 서빙했다.
 * 오리진이 직접 내려주면 사이트맵 위치를 크롤러에 알릴 수 있다.
 *
 * disallow 는 `/api/`·`/actuator/` 로만 유지한다. `/login`·`/overview`·`/preview/*` 같은 비공개 화면을 여기에
 * 넣고 싶어지지만 **넣으면 안 된다**: 그 경로들은 `X-Robots-Tag: noindex`(next.config.ts 의 headers())로
 * 색인에서 빼는데, 크롤러가 noindex 를 보려면 먼저 그 URL 을 가져올 수 있어야 한다. robots.txt 로 막으면
 * 헤더를 읽지 못해 "차단됐지만 색인됨" 상태로 남는다. 둘 중 하나만 골라야 하고, 우리는 noindex 를 골랐다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/actuator/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

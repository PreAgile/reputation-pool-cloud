import type { MetadataRoute } from "next";

/**
 * `/robots.txt` — 지금까지 이 경로는 Cloudflare 의 관리형 robots.txt(주석만, `Sitemap:` 줄 없음)가 서빙했다.
 * 오리진이 직접 내려줘야 크롤 규칙을 우리가 쥔다.
 *
 * `Sitemap:` 줄은 없다. 사이트맵을 낼 공개 화면이 이 호스트에 더 이상 없기 때문이다 — 랜딩·문서는 apex
 * 랜딩(`landing/app/sitemap.ts`)으로 옮겨갔고 `app/sitemap.ts` 는 함께 삭제됐다(#15/#16). 줄만 남기면
 * 크롤러가 404 인 `/sitemap.xml` 을 계속 긁는다.
 *
 * disallow 는 `/api/`·`/actuator/` 로만 유지한다. 비공개 화면을 여기에 넣고 싶어지지만 **넣으면 안 된다**.
 * 이유가 이제 두 겹이다.
 *
 *   1. `/login`·`/overview`·`/preview/*` 는 `X-Robots-Tag: noindex`(next.config.ts 의 headers())로
 *      색인에서 빼는데, 크롤러가 noindex 를 보려면 먼저 그 URL 을 가져올 수 있어야 한다. robots.txt 로
 *      막으면 헤더를 읽지 못해 "차단됐지만 색인됨" 상태로 남는다. 둘 중 하나만 골라야 하고, 우리는
 *      noindex 를 골랐다.
 *   2. **호스트 이전 중이라 `Disallow: /` 는 특히 금지다.** 옛 랜딩·문서 URL(`/`·`/ko`·`/docs*`)은 이제
 *      apex 로 301 하는데(next.config.ts 의 redirects()), 크롤러가 그 301 을 *보려면* 옛 URL 을 가져올 수
 *      있어야 한다. 여기서 막으면 리다이렉트가 영원히 읽히지 않고 옛 URL 이 색인에 그대로 굳는다 —
 *      "마케팅 화면이 없어졌으니 전부 막자" 가 정확히 그 사고다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/actuator/"] }],
  };
}

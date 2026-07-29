import type { MetadataRoute } from "next";

/**
 * 이 호스트(`app.` — 콘솔)는 **통째로 색인 대상이 아니다.** 그런데 그것을 `Disallow` 로 막지 않는다.
 *
 * ## `Disallow` 는 색인을 지우지 못한다
 * `Disallow` 는 "색인하지 마라"가 아니라 **"가져가지 마라"** 다. 크롤러가 응답을 가져가지 못하면
 * `X-Robots-Tag: noindex`(`next.config.ts` 의 `headers()`)도 **읽지 못한다.** 그래서 이미 발견된 URL 은
 * 색인에서 빠지는 대신 "robots.txt 에 의해 차단됨" 상태로 검색 결과에 남는다 — 제목만 있고 내용 없는
 * 스니펫으로. 링크가 어디선가 하나라도 걸리면 새 URL 도 같은 방식으로 들어온다.
 *
 * 즉 **막는 것과 지우는 것은 반대 방향**이다. 지우려면 크롤러가 들어와서 `noindex` 를 읽어야 한다.
 *
 * ## 그래서 계약은 "크롤링 허용 + 전 경로 noindex"
 * 크롤러가 들어오는 비용(보호 화면 몇 개를 읽어 간다)은 `noindex` 가 곧바로 상쇄한다 — `noindex` 를
 * 읽은 페이지는 색인되지 않으므로 soft-404 로 잡힐 일도 없다. 반대로 `Disallow` 는 그 비용을 아끼는
 * 대신 "검색 결과에서 뺀다"는 목적 자체를 달성하지 못한다.
 *
 * 이 파일을 지우지 않고 남기는 이유: `/robots.txt` 가 404 여도 결과는 같지만(허용), 그러면 다음 사람이
 * "콘솔이 색인되면 안 되는데 robots.txt 가 없네" 하고 `Disallow: /` 를 다시 넣는다. 명시적 허용과 이
 * 주석이 그것을 막는 장치다.
 *
 * sitemap 은 알리지 않는다 — 색인시킬 페이지가 있는 쪽(랜딩, apex)이 자기 sitemap 을 갖는다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
  };
}

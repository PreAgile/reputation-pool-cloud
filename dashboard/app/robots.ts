import type { MetadataRoute } from "next";

/**
 * 이 호스트(`app.` — 콘솔)는 **통째로 색인 대상이 아니다.**
 *
 * 계층 분리(#15) 전에는 여기에 랜딩이 함께 있어서 `/`·`/ko` 만 허용하고 나머지를 막는 형태였다. 이제
 * 랜딩·문서는 apex(Cloudflare Pages)로 나갔고 여기 남은 것은 로그인과 인증이 필요한 화면뿐이다.
 *
 * 크롤러에게 남길 것이 없을 뿐 아니라, **남기면 해롭다**: 보호 화면은 비로그인 크롤러에게 빈 껍데기로
 * 렌더되므로 soft-404 로 잡혀 도메인 평가가 깎인다.
 *
 * sitemap 을 여기서 알리지 않는다 — 색인시킬 페이지가 있는 쪽(랜딩)이 자기 sitemap 을 갖는다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}

import type { NextConfig } from "next";

/**
 * 랜딩·문서(#15/#16) — **정적 내보내기**.
 *
 * ## 왜 앱과 분리된 빌드인가
 * 랜딩·문서는 누구에게나 같은 HTML 이고 DB 도 로그인도 필요 없다. 그런데 지금까지는 대시보드와 같은
 * Next 앱 안에 라우트로 얹혀 있어 **앱 서버가 죽으면 제품 소개 페이지까지 같이 죽었다.** 이슈 #15 가
 * 요구한 계층 분리가 이것이다 — "면접관이 링크를 클릭하는 시점을 고를 수 없으므로" 상시 표면은 앱
 * 서버의 수명과 분리돼야 한다.
 *
 * `output: "export"` 는 서버 없이 서빙되는 HTML/CSS/JS 묶음(`out/`)을 만든다. 그것을 Cloudflare Pages
 * 에 올리면 전 세계 엣지에서 서빙되고, 앱 서버는 이 트래픽을 아예 받지 않는다.
 *
 * ## export 모드가 가져오는 제약
 * - **`middleware.ts` 가 동작하지 않는다.** 언어 자동 판별(#110)은 `functions/_middleware.ts`
 *   (Cloudflare Pages Functions)로 옮겼다. 오히려 그쪽이 정확하다 — CF 는 `request.cf.country` 를
 *   직접 준다.
 * - **`next/image` 최적화 서버가 없다.** `unoptimized` 로 원본을 그대로 내보낸다. 랜딩 스크린샷은
 *   빌드 시점에 확정된 PNG 라 런타임 리사이즈가 필요 없다.
 * - 서버 액션·라우트 핸들러를 쓸 수 없다. 이 앱에는 애초에 없다(폼 제출도 없다).
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  /**
   * `trailingSlash` 는 기본값(false)을 그대로 둔다.
   *
   * `true` 로 두면 `/ko` 로 들어온 요청을 Pages 가 `/ko/` 로 한 번 더 리다이렉트한다. 언어 판별
   * 미들웨어가 이미 `/` → `/ko` 로 307 을 보내므로 방문자는 **리다이렉트를 두 번** 타게 되고,
   * `LOCALE_PATH`(`/ko`)·sitemap·canonical 이 전부 슬래시 없는 형태라 그것들과도 어긋난다.
   * 대시보드도 기본값이므로 두 앱의 URL 규칙이 같아진다.
   */
};

export default nextConfig;

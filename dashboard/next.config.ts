import type { NextConfig } from "next";
// tsconfig 의 path alias(`@/`)는 Next 앱 번들에만 적용된다 — 이 파일은 Node 가 직접 로드하므로 상대 경로로 가져온다.
import { LANDING_ORIGIN } from "./lib/site";

/**
 * dev에서 브라우저가 대시보드와 같은 오리진(localhost:3000)으로 `/api/*`·`/actuator/*`를 부르면 Next가
 * 백엔드(Spring, 8083)로 프록시한다. 브라우저 입장에선 same-origin이라 CORS가 필요 없다. prod에서는
 * Caddy(#15)가 dashboard·/api·/actuator를 한 오리진 뒤로 묶으므로 이 rewrite는 dev 편의용이다.
 * 백엔드 주소는 BACKEND_ORIGIN 환경변수로 재정의 가능(기본 localhost:8083).
 *
 * `output: "standalone"` — prod Docker 이미지가 최소 런타임(.next/standalone)만 담도록. Caddy 뒤에서
 * `next start` 대신 standalone server.js로 뜬다.
 */
const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8083";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      // 화면6 헬스 카드가 쓰는 actuator health(public). prod에선 Caddy가 /actuator를 app으로 보낸다.
      { source: "/actuator/:path*", destination: `${backend}/actuator/:path*` },
    ];
  },
  /**
   * 마케팅 표면 이전 (#15/#16) — 옛 랜딩·문서 URL 을 apex 랜딩(`landing/`, Cloudflare Pages)으로 넘긴다.
   *
   * 이 화면들은 이제 이 앱에 존재하지 않는다. 그런데 `app.poolroost.com/`·`/ko`·`/docs*` 는 이미 외부에
   * 링크돼 있고 Search Console 에도 그 호스트로 제출돼 있다 — 그냥 지우면 전부 404 가 되고 그동안 쌓인
   * 링크 지분이 버려진다. 영구 리다이렉트는 크롤러에게 "이 URL 의 정본은 저쪽"이라고 알려 지분을
   * apex 로 합치게 한다.
   *
   * `permanent: true` 가 내리는 상태코드는 **308**이다(301 이 아니다 — Next 의 규약이고 라우트
   * 매니페스트에 그대로 구워진다). 검색엔진은 308 을 301 과 동일하게 canonical 이전 신호로 처리하고,
   * 308 은 메서드를 보존한다는 점에서 HTTP 상으로도 더 정확하다. 굳이 문자 그대로 301 이 필요하면
   * `permanent` 대신 `statusCode: 301` 로 바꾸면 된다.
   *
   * `/` 도 예외가 아니다 — `/login` 으로 보내고 싶어지지만, 색인·공유된 것은 랜딩으로서의 `/` 였다.
   * 앱 진입점은 `/login`·`/overview` 로 각자 URL 을 갖고 있다.
   *
   * 대상 오리진은 `lib/site.ts` 의 `LANDING_ORIGIN` 하나에서만 나온다(리터럴을 흩뿌리면 도메인이 바뀔 때
   * 한쪽만 고치는 사고가 난다). 빌드 시점에 라우트 매니페스트로 구워지므로 build arg 로 주입해야 한다.
   *
   * `middleware.ts` 보다 **먼저** 실행된다 — 그래서 `/` 의 로케일 판별은 여기서 끝나고, 언어 판별은
   * 랜딩 쪽 `landing/functions/_middleware.ts` 가 apex 에서 담당한다.
   */
  async redirects() {
    return [
      { source: "/", destination: LANDING_ORIGIN, permanent: true },
      { source: "/ko", destination: `${LANDING_ORIGIN}/ko`, permanent: true },
      // `/en` 은 대시보드에 있던 적이 없다(404). 랜딩도 같은 규칙으로 정본 `/` 로 보낸다(#141) — 두 호스트
      // 에서 같은 오타 URL 이 같은 곳으로 가야 크롤러가 후보에서 지운다.
      { source: "/en", destination: LANDING_ORIGIN, permanent: true },
      { source: "/docs", destination: `${LANDING_ORIGIN}/docs`, permanent: true },
      { source: "/docs/:path*", destination: `${LANDING_ORIGIN}/docs/:path*`, permanent: true },
    ];
  },
  /**
   * 공개 검색 대상이 아닌 화면을 색인에서 뺀다. 이 앱에는 이제 색인 대상 공개 화면이 없다 — 랜딩(`/`·`/ko`)
   * 과 문서는 apex 랜딩(`landing/`)으로 옮겨갔고 여기 남은 것은 앱 화면과 프리뷰 목업뿐이다.
   *
   * `export const metadata = { robots: ... }` 가 아니라 응답 헤더인 이유:
   * - 보호 영역 layout(`app/(app)/layout.tsx`)은 `"use client"` 라 metadata 를 export 할 수 없다.
   * - 그 화면들은 비로그인 크롤러에게 빈 껍데기(`return null`)로 렌더된다 → 내용 없는 페이지가 색인되면
   *   soft-404 로 잡혀 사이트 전체 평가가 깎인다.
   * - `/preview/*` 는 스크린샷 캡처용 목업이라 중복 콘텐츠다. prod 에선 이미 `notFound()` 로 404 지만
   *   (page.tsx 의 NODE_ENV 가드) 그 가드가 사라져도 색인되지 않게 헤더를 함께 둔다.
   *
   * robots.txt 로 막지 않고 noindex 를 쓰는 이유는 app/robots.ts 주석 참고(막으면 헤더를 못 읽는다).
   */
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      "/login",
      "/overview",
      "/usage",
      "/keys",
      "/events",
      "/admin",
      "/resources/:kind/:value",
      "/preview/:path*",
    ].map((source) => ({ source, headers: noindex }));
  },
};

export default nextConfig;

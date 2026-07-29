import type { NextConfig } from "next";

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
   * 공개 검색 대상이 아닌 화면을 색인에서 뺀다. 랜딩(`/`·`/ko`)만 색인되어야 한다.
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

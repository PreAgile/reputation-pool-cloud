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
   * **이 호스트 전체**를 색인에서 뺀다. 계층 분리(#15) 후 `app.` 에 공개 검색 대상은 하나도 없다 —
   * 랜딩·문서는 apex(Cloudflare Pages)로 나갔고 여기 남은 것은 로그인과 인증이 필요한 화면뿐이다.
   *
   * `export const metadata = { robots: ... }` 가 아니라 응답 헤더인 이유:
   * - 보호 영역 layout(`app/(app)/layout.tsx`)은 `"use client"` 라 metadata 를 export 할 수 없다.
   * - 그 화면들은 비로그인 크롤러에게 빈 껍데기(`return null`)로 렌더된다 → 내용 없는 페이지가 색인되면
   *   soft-404 로 잡혀 도메인 평가가 깎인다.
   * - 404·307 같은 비-200 응답에도 붙는다. metadata 로는 그 응답들을 덮을 수 없다.
   *
   * 경로를 열거하지 않고 `/:path*` 하나로 거는 이유: 예전에는 화면 목록을 손으로 적었는데, 그러면 새
   * 라우트가 생길 때마다 목록에 추가하는 것을 잊는 만큼 조용히 구멍이 난다. 색인 누락은 배포 직후에
   * 보이지 않고 몇 주 뒤 검색 결과로 나타나므로 되돌리는 비용이 크다. 여기서는 **전부 막고 예외를
   * 두지 않는 쪽**이 안전하다 — 이 호스트에 색인시킬 것이 생긴다면 그건 랜딩(apex)으로 가야 할 것이다.
   *
   * robots.txt 의 `Disallow` 로 막지 않고 `noindex` 를 쓰는 이유는 `app/robots.ts` 주석 참고 — 막으면
   * 크롤러가 이 헤더를 아예 읽지 못해 이미 색인된 URL 을 빼지 못한다.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;

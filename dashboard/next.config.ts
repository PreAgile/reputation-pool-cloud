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
};

export default nextConfig;

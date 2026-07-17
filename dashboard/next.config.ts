import type { NextConfig } from "next";

/**
 * dev에서 브라우저가 대시보드와 같은 오리진(localhost:3000)으로 `/api/*`를 부르면 Next가 백엔드
 * 컨트롤 플레인(Spring, 8083)으로 프록시한다. 브라우저 입장에선 same-origin이라 CORS가 필요 없다.
 * prod에서는 Caddy(#15)가 app./api. 를 같은 오리진 뒤로 묶으므로 이 rewrite는 dev 편의용.
 * 백엔드 주소는 BACKEND_ORIGIN 환경변수로 재정의 가능(기본 localhost:8083).
 */
const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8083";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;

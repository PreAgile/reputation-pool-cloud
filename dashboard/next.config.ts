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
   * 이 화면들은 이제 이 앱에 존재하지 않는다. 그런데 `app.poolroost.com/ko`·`/docs*` 는 이미 외부에
   * 링크돼 있고 Search Console 에도 그 호스트로 제출돼 있다 — 그냥 지우면 전부 404 가 되고 그동안 쌓인
   * 링크 지분이 버려진다. 영구 리다이렉트는 크롤러에게 "이 URL 의 정본은 저쪽"이라고 알려 지분을
   * apex 로 합치게 한다. (`/` 는 예외다 — 아래 별도 항목.)
   *
   * `permanent: true` 가 내리는 상태코드는 **308**이다(301 이 아니다 — Next 의 규약이고 라우트
   * 매니페스트에 그대로 구워진다). 검색엔진은 308 을 301 과 동일하게 canonical 이전 신호로 처리하고,
   * 308 은 메서드를 보존한다는 점에서 HTTP 상으로도 더 정확하다. 굳이 문자 그대로 301 이 필요하면
   * `permanent` 대신 `statusCode: 301` 로 바꾸면 된다.
   *
   * 대상 오리진은 `lib/site.ts` 의 `LANDING_ORIGIN` 하나에서만 나온다(리터럴을 흩뿌리면 도메인이 바뀔 때
   * 한쪽만 고치는 사고가 난다). 빌드 시점에 라우트 매니페스트로 구워지므로 build arg 로 주입해야 한다.
   *
   * `middleware.ts` 보다 **먼저** 실행된다 — 그래서 `/ko` 의 로케일 판별은 여기서 끝나고, 언어 판별은
   * 랜딩 쪽 `landing/functions/_middleware.ts` 가 apex 에서 담당한다.
   *
   * ## `/` 만 apex 로 보내지 않는다 — 콘솔 진입점이다
   * 직전 판단(#142)은 `/` 도 apex 로 308 이었다. 근거는 "색인·공유된 것은 랜딩으로서의 `/` 였으니 링크
   * 지분을 apex 로 합친다" 였다. 되돌리는 이유가 셋이다.
   *
   *   1. **지킬 지분이 실측상 없다.** `site:app.poolroost.com` 이 0건이다 — 합칠 색인이 애초에 없다.
   *   2. **제품이 외부 판매에서 내부 적용으로 바뀌었다**(#13 not planned). `app.` 을 여는 사람은 사실상
   *      우리다. 콘솔을 찾아 온 사람을 제품 소개 페이지로 튕기는 것은 퇴보다.
   *   3. **308 은 브라우저가 영구 캐시한다.** 한 번 나가면 북마크한 사람은 서버에 묻지도 않고 튕기고,
   *      되돌리려면 각자 브라우저 캐시를 지워야 한다. 되돌릴 수 없는 결정을 지분 0 인 상태로 내릴
   *      이유가 없다. (이 308 은 아직 배포된 적이 없어 지금이 비용 0 인 시점이다.)
   *
   * 그래서 `/` 는 `/overview` 로 보낸다. **`/login` 이 아닌 이유**는 이미 로그인한 사용자를 로그인
   * 화면에 다시 세우지 않기 위해서다 — 토큰이 없으면 보호 레이아웃(`app/(app)/layout.tsx`)이 `/login`
   * 으로 넘긴다.
   *
   * **`permanent: false`(307)인 것이 핵심이다.** 위 3번이 그대로 이 리다이렉트에도 적용된다. `/` 가
   * 어디로 가야 하는지는 제품 판단이라 또 바뀔 수 있고, 영구로 내보내면 그때 되돌릴 방법이 없다.
   * 나머지 넷은 "화면이 실제로 다른 호스트로 이사했다"는 사실이라 영구가 맞다.
   */
  async redirects() {
    return [
      { source: "/", destination: "/overview", permanent: false },
      { source: "/ko", destination: `${LANDING_ORIGIN}/ko`, permanent: true },
      // `/en` 은 대시보드에 있던 적이 없다(404). 랜딩도 같은 규칙으로 정본 `/` 로 보낸다(#141) — 두 호스트
      // 에서 같은 오타 URL 이 같은 곳으로 가야 크롤러가 후보에서 지운다.
      { source: "/en", destination: LANDING_ORIGIN, permanent: true },
      { source: "/docs", destination: `${LANDING_ORIGIN}/docs`, permanent: true },
      { source: "/docs/:path*", destination: `${LANDING_ORIGIN}/docs/:path*`, permanent: true },
    ];
  },
  /**
   * 이 앱에는 색인 대상 공개 화면이 없다 — 랜딩(`/`·`/ko`)과 문서는 apex 랜딩(`landing/`)으로 옮겨갔고
   * 여기 남은 것은 앱 화면과 프리뷰 목업뿐이다. 그래서 **한 경로만 빼고 전부** `noindex` 다.
   *
   * `export const metadata = { robots: ... }` 가 아니라 응답 헤더인 이유:
   * - 보호 영역 layout(`app/(app)/layout.tsx`)은 `"use client"` 라 metadata 를 export 할 수 없다.
   * - 그 화면들은 비로그인 크롤러에게 빈 껍데기(`return null`)로 렌더된다 → 내용 없는 페이지가 색인되면
   *   soft-404 로 잡혀 사이트 전체 평가가 깎인다.
   * - `/preview/*` 는 스크린샷 캡처용 목업이라 중복 콘텐츠다. prod 에선 이미 `notFound()` 로 404 지만
   *   (page.tsx 의 NODE_ENV 가드) 그 가드가 사라져도 색인되지 않게 헤더를 함께 둔다.
   * - 404 처럼 페이지가 아닌 응답에도 붙는다. `metadata` 로는 그 응답을 덮을 수 없다.
   *
   * ## 왜 경로 목록이 아니라 `/:path*` 인가
   * 예전에는 화면 이름을 손으로 열거했다. 그러면 라우트가 늘 때마다 목록에 추가하는 것을 잊는 만큼
   * 구멍이 나는데, 그 구멍은 배포 직후가 아니라 몇 주 뒤 검색 결과로만 드러나고 되돌리는 데 또 몇 주가
   * 걸린다. 열거를 지우고 **기본값을 "전부 막음"** 으로 뒤집는다.
   *
   * ## 이전 중인 옛 URL 의 308 에는 붙지 않는다 (그래야 한다)
   * `/ko`·`/en`·`/docs*` 의 apex 308 은 "옛 URL 의 정본은 저쪽" 이라고 알려 **링크 지분을 apex 로
   * 합치라**는 신호다. 같은 응답에 `noindex` 가 함께 오면 크롤러는 합치는 대신 옛 URL 을 그냥 버릴 수
   * 있어 두 신호가 서로를 무효화한다. 다행히 Next 는 `redirects()` 를 `headers()` 보다 먼저 적용하고
   * 리다이렉트에서 라우팅을 끝내므로 308 응답에는 이 헤더가 붙지 않는다(standalone 빌드로 실측).
   * 즉 `/:path*` 로 넓게 걸어도 이전 신호를 망치지 않는다 — **다만 그 순서에 기대고 있다는 것을 알고
   * 있어야 한다.** 옛 URL 을 `redirects()` 밖(미들웨어·페이지)에서 처리하도록 바꾸면 그때는 그 경로를
   * 여기서 빼야 한다.
   *
   * robots.txt 로 막지 않고 noindex 를 쓰는 이유는 app/robots.ts 주석 참고(막으면 헤더를 못 읽는다).
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

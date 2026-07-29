/**
 * 사이트의 정본 오리진 — 랜딩 `metadataBase`(canonical·hreflang·OG 절대 URL 해석)와 robots/sitemap 이
 * 모두 이 한 값을 쓴다. 두 랜딩 페이지가 각자 상수를 들고 있으면 한쪽만 고치는 사고가 나므로 단일 출처로 둔다.
 *
 * `NEXT_PUBLIC_*` 는 **빌드 시점에 정적 산출물로 인라인**된다. 마케팅 페이지는 프리렌더되므로 컨테이너에
 * 런타임 환경변수를 넣어도 이미 구워진 canonical 은 바뀌지 않는다 — 반드시 Docker build arg 로 넘겨야 한다
 * (dashboard/Dockerfile 의 `ARG NEXT_PUBLIC_SITE_URL`, release.yml 의 `build-args`).
 *
 * 기본값이 왜 중요한가: 직전 기본값은 `https://reputationpool.io` 였고 그 도메인은 DNS 레코드 자체가 없다.
 * prod 에서 `NEXT_PUBLIC_SITE_URL` 가 설정된 적이 없어 이 폴백이 그대로 나갔고, 구글은 canonical 을 따라
 * 존재하지 않는 호스트로 갔다가 색인을 포기했다(색인 0건). 실제 서비스 호스트는 `app.poolroost.com` 이다
 * (apex `poolroost.com` 은 아직 DNS 가 없다).
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.poolroost.com";

/** 스킴 없는 호스트. 랜딩 스크린샷 위 가짜 주소줄처럼 "보여주기용 URL" 에 쓴다. */
export const SITE_HOST = new URL(SITE_URL).host;

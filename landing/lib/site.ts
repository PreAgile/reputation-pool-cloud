/**
 * 사이트의 정본 오리진 — 랜딩 `metadataBase`(canonical·hreflang·OG 절대 URL 해석)와 robots/sitemap 이
 * 모두 이 한 값을 쓴다. 두 랜딩 페이지가 각자 상수를 들고 있으면 한쪽만 고치는 사고가 나므로 단일 출처로 둔다.
 *
 * 이 앱은 **apex(`poolroost.com`)** 에 배포된다 — 대시보드가 있는 `app.` 이 아니다(#15 계층 분리).
 * 값이 틀리면 canonical·hreflang·OG·sitemap 이 전부 잘못된 호스트를 가리켜 **조용히 색인이 안 된다**
 * (실제로 DNS 조차 없는 도메인이 기본값이던 시기가 있었다 — #118).
 *
 * 빌드타임 변수다. Next 가 정적 프리렌더 시점에 인라인하므로 배포 호스트의 환경변수로는 바꿀 수 없고,
 * Pages 프로젝트의 빌드 환경변수로 준다.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://poolroost.com";

/** 스킴 없는 호스트. 랜딩 스크린샷 위 가짜 주소줄처럼 "보여주기용 URL" 에 쓴다. */
export const SITE_HOST = new URL(SITE_URL).host;

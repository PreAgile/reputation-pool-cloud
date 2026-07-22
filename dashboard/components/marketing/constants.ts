/**
 * 랜딩(#16) 정적 상수 — 외부 링크·연락처·GitHub 지표를 한 곳에 모은다.
 *
 * 결제/프라이싱은 이 슬라이스의 스코프가 아니다(#10). 접근은 "Email us" 문의(mailto)로만 받는다.
 */

/** 공개 OSS 엔진 레포. 랜딩의 GitHub 링크·신뢰 신호가 모두 여기를 가리킨다. */
export const GITHUB_REPO_URL = "https://github.com/PreAgile/reputation-pool";

/**
 * GitHub 스타 배지에 쓰는 정적 값. 지금은 플레이스홀더이며, 후속 슬라이스에서 빌드타임에
 * GitHub API 로 주입하도록 교체한다. null 이면 배지에 숫자를 감추고 마크·라벨만 노출.
 */
export const GITHUB_STARS: number | null = null;

/** 문의 이메일 — 셀프서브 가입 대신 팀별 수동 온보딩(결제 없음). */
export const CONTACT_EMAIL = "digle117@gmail.com";

/** "Email us" CTA 의 mailto — 제목·본문 프리필(확정 시안과 동일). */
export const CONTACT_MAILTO =
  `mailto:${CONTACT_EMAIL}` +
  "?subject=reputation-pool%20access" +
  "&body=Hi%2C%20I%27d%20like%20access.%20Our%20use%20case%3A%20";

/**
 * 랜딩·문서가 사는 곳. **이 앱이 아니다.**
 *
 * 계층 분리(#15)로 랜딩은 Cloudflare Pages(apex `poolroost.com`)로 나갔고, 이 앱은 콘솔(`app.` 서브
 * 도메인)만 담당한다. 그래서 여기 남은 용도는 하나뿐이다 — **바깥으로 나가는 링크**(404 화면의
 * "홈으로", 오리진 다운 화면의 CTA).
 *
 * 절대 URL 이어야 하는 이유: 이 앱은 `app.poolroost.com` 에서 서빙되므로 `/` 같은 상대 경로는 랜딩이
 * 아니라 자기 자신을 가리킨다. 앱이 죽어 404·502 가 뜨는 상황이라면 그 링크는 **살아 있는 곳**을
 * 가리켜야 의미가 있다.
 */
export const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "https://poolroost.com";

/** 스킴 없는 호스트. 화면에 주소를 문자로 보여줄 때 쓴다. */
export const LANDING_HOST = new URL(LANDING_URL).host;

/**
 * 랜딩 사이트의 오리진 — 이 파일이 대시보드에 남아 있는 이유는 **이전 대상 주소**이기 때문이다.
 *
 * #15 의 계층 분리로 랜딩(`/`·`/ko`)과 문서(`/docs*`)는 별개 앱(`landing/`, Cloudflare Pages, apex
 * `poolroost.com`)으로 옮겨갔다. 대시보드에는 그 화면이 더 이상 없고, 대신 `next.config.ts` 의
 * `redirects()` 가 옛 URL 을 여기로 301 로 넘긴다. 즉 이 값은 "우리 오리진"이 아니라 "남의 오리진"이다
 * — 대시보드 자신의 canonical·metadataBase 는 이제 어디에서도 필요하지 않다(랜딩 쪽 단일 출처는
 * `landing/lib/site.ts` 이고 #118 의 죽은 도메인 사고 기록도 그쪽으로 갔다).
 *
 * `NEXT_PUBLIC_*` 는 **빌드 시점에 인라인**된다. 리다이렉트 규칙은 `next build` 가 라우트 매니페스트로
 * 구워내므로 컨테이너에 런타임 환경변수를 넣어도 이미 구워진 Location 은 바뀌지 않는다 — 반드시 Docker
 * build arg 로 넘겨야 한다(dashboard/Dockerfile 의 `ARG NEXT_PUBLIC_LANDING_URL`, release.yml 의
 * `build-args`).
 *
 * 기본값이 왜 중요한가: 값이 틀리면 옛 랜딩 URL 이 존재하지 않는 호스트로 301 되고, 그건 404 보다 나쁘다
 * (크롤러가 링크 지분을 죽은 주소로 옮긴다). 스킴 포함 절대 오리진이어야 하고 뒤에 슬래시가 없어야 한다.
 */
export const LANDING_ORIGIN = process.env.NEXT_PUBLIC_LANDING_URL ?? "https://poolroost.com";

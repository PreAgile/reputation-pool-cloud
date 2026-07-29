import { redirect } from "next/navigation";

/**
 * 콘솔의 진입점.
 *
 * 계층 분리(#15) 전에는 여기가 랜딩이었다. 랜딩이 apex(Cloudflare Pages)로 나간 지금 `app.` 의 루트는
 * **콘솔로 들어가는 문**이어야 한다 — 이 서브도메인을 치는 사람은 제품 소개가 아니라 대시보드를 찾는다.
 *
 * `/login` 이 아니라 `/overview` 로 보내는 이유: 이미 로그인한 사용자를 로그인 화면에 다시 세우지 않기
 * 위해서다. 토큰이 없으면 보호 레이아웃(`app/(app)/layout.tsx`)이 `/login` 으로 넘긴다.
 *
 * 서버 리다이렉트(307)라 크롤러도 여기서 멈추지 않는다. 어차피 robots 가 이 호스트 전체를 막는다.
 */
export default function ConsoleEntry() {
  redirect("/overview");
}

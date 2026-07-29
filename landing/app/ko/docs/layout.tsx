import { DocsShell } from "@/components/docs/docs-shell";

/**
 * 한국어 docs 라우트(`/ko/docs/**`)의 셸. 영어 라우트와 **같은** 셸 컴포넌트에 로케일만 다르게 넘긴다 —
 * 레이아웃 구조를 두 벌 두면 사이드바 폭·푸터·간격이 언젠가 한쪽만 바뀐다 (#143).
 */
export default function DocsLayoutKo({ children }: { children: React.ReactNode }) {
  return <DocsShell locale="ko">{children}</DocsShell>;
}

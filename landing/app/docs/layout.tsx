import { DocsShell } from "@/components/docs/docs-shell";

/**
 * 영어 docs 라우트의 셸. 구조는 `components/docs/docs-shell.tsx` 한 곳에 있고 여기서는 로케일만
 * 고정한다 — 한국어 라우트(`app/ko/docs/layout.tsx`)가 같은 셸을 쓰므로 둘이 갈릴 여지가 없다 (#143).
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell locale="en">{children}</DocsShell>;
}

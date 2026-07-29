"use client";

import { ThemeProvider } from "next-themes";

/**
 * 랜딩에 필요한 컨텍스트는 테마 하나뿐이다.
 *
 * 대시보드의 `Providers` 는 여기에 더해 인증(`AuthProvider`)과 토스트(`ToastProvider`)를 건다. 랜딩에는
 * 로그인도 없고 사용자 액션의 결과를 알릴 일도 없으므로 가져오지 않는다 — 정적 페이지에 인증 컨텍스트를
 * 얹으면 번들만 커지고 하이드레이션할 이유가 늘어난다.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}

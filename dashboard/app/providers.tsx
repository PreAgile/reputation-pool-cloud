"use client";

import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/lib/auth";

/** 라이트/다크(next-themes, class 전략) + 인증 컨텍스트를 앱 전체에 건다. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}

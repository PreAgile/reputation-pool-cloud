import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { pretendard } from "./fonts";

export const metadata: Metadata = {
  title: "reputation-pool 콘솔",
  description: "reputation-pool cloud 운영 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

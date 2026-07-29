import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { pretendard } from "./fonts";
import { SITE_URL } from "@/lib/site";

/**
 * `metadataBase` 를 여기서 한 번 세운다. 각 페이지의 `canonical`·`alternates`·OG 이미지가 상대 경로로
 * 적혀 있어도 절대 URL 로 확장되며, 값이 틀리면 **조용히** 잘못된 호스트가 색인된다(실제로 DNS 조차 없는
 * 도메인이 기본값이던 시기가 있었다 — #118).
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "reputation-pool",
  description: "리소스 평판 관리 엔진 — 차단·냉각을 결정론적으로 다루는 오픈소스 코어 위의 호스티드 SaaS",
};

/**
 * `lang` 은 여기서 고정하지 않는다. 랜딩은 `/`(en)과 `/ko` 두 문서가 각각 존재하고, 각 페이지가
 * `HtmlLang` 으로 자기 언어를 선언한다 — 루트에 하나를 박으면 한쪽이 늘 틀린 값을 갖는다.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pretendard.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

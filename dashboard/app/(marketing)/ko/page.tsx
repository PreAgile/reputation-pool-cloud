import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
import { HtmlLang } from "@/components/html-lang";
import { getDict } from "@/components/marketing/i18n";

const dict = getDict("ko");

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://reputationpool.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: dict.meta.title,
  description: dict.meta.description,
  alternates: { canonical: "/ko", languages: { en: "/", ko: "/ko" } },
  openGraph: {
    type: "website",
    title: dict.meta.title,
    description: dict.meta.description,
    images: ["/marketing/overview-ko-dark.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: dict.meta.title,
    description: dict.meta.description,
    images: ["/marketing/overview-ko-dark.png"],
  },
};

/**
 * 한국어 랜딩(`/ko`). / 에서 client 내비로 넘어와도 `<html lang>` 이 en 으로 남지 않도록 ko 로 보정.
 * 스크린샷은 실제 한국어 대시보드 캡처(로케일 일치)를 쓴다.
 */
export default function MarketingPageKo() {
  return (
    <>
      <HtmlLang lang="ko" />
      <Landing locale="ko" />
    </>
  );
}

import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
import { HtmlLang } from "@/components/html-lang";
import { getDict } from "@/components/marketing/i18n";

const dict = getDict("en");

// 도메인은 후속(#15) 확정 전까지 env(NEXT_PUBLIC_SITE_URL) 또는 임시값. OG/Twitter 이미지 절대경로 해석용.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://reputationpool.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: dict.meta.title,
  description: dict.meta.description,
  // 이중언어 SEO 시그널 — 기본 영어(/) + 한국어(/ko).
  alternates: { canonical: "/", languages: { en: "/", ko: "/ko" } },
  openGraph: {
    type: "website",
    title: dict.meta.title,
    description: dict.meta.description,
    images: ["/marketing/overview-en-dark.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: dict.meta.title,
    description: dict.meta.description,
    images: ["/marketing/overview-en-dark.png"],
  },
};

/**
 * 영어 랜딩(기본 로케일, `/`). 루트 layout 의 토큰/테마를 상속한다. i18n 은 마케팅에만 적용되고
 * 로그인 뒤 대시보드는 한국어(/overview)로 유지된다. 루트 `<html lang="ko">` 를 영어로 보정.
 */
export default function MarketingPage() {
  return (
    <>
      <HtmlLang lang="en" />
      <Landing locale="en" />
    </>
  );
}

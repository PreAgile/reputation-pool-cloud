import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
import { HtmlLang } from "@/components/html-lang";
import { getDict } from "@/components/marketing/i18n";
import { SITE_URL } from "@/lib/site";

const dict = getDict("ko");

export const metadata: Metadata = {
  // 오리진은 영어 랜딩과 같은 단일 출처(lib/site.ts)를 쓴다 — 한쪽만 고쳐 hreflang 이 갈라지는 사고를 막는다.
  metadataBase: new URL(SITE_URL),
  title: dict.meta.title,
  description: dict.meta.description,
  // canonical 은 `/ko` — 자동 판별로 `/` 에서 넘어왔더라도 이 URL 이 한국어의 정본이다(#110).
  alternates: { canonical: "/ko", languages: { en: "/", ko: "/ko", "x-default": "/" } },
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

import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
import { HtmlLang } from "@/components/html-lang";
import { getDict } from "@/components/marketing/i18n";
import { SITE_URL } from "@/lib/site";

const dict = getDict("en");

export const metadata: Metadata = {
  // canonical·hreflang·OG 의 절대 URL 은 모두 이 오리진 위에서 해석된다 — 값이 틀리면(과거: DNS 없는 도메인)
  // 색인 자체가 안 된다. 단일 출처는 lib/site.ts, 배포 시 주입 경로는 Dockerfile 의 build arg.
  metadataBase: new URL(SITE_URL),
  title: dict.meta.title,
  description: dict.meta.description,
  // 이중언어 SEO 시그널 — 기본 영어(/) + 한국어(/ko).
  // `x-default` 는 "어느 언어도 맞지 않는 방문자/크롤러의 기본 URL"이다(#110). 자동 판별(middleware)이
  // 붙어도 중립 `Accept-Language` 를 보내는 크롤러는 `/` 에 그대로 남으므로 두 언어가 각각 색인된다.
  alternates: { canonical: "/", languages: { en: "/", ko: "/ko", "x-default": "/" } },
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

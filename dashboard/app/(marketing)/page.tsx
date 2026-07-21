import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import {
  Hero,
  TrustSignals,
  Features,
  Capabilities,
  HowItWorks,
  Docs,
  Contact,
  Footer,
} from "@/components/marketing/landing-sections";

export const metadata: Metadata = {
  title: "reputation·pool — The reputation API for proxy & account pools",
  description:
    "Stop hand-rolling cooldowns, blocklists, and lease logic. Acquire the healthiest resource and report the outcome — a verified open-source engine heals the pool for you.",
};

/**
 * 랜딩(#16 슬라이스 1) — 인증 밖 public 페이지(`(marketing)` 라우트 그룹). 루트 layout 의 토큰/테마를 상속한다.
 * 대시보드 오버뷰는 /overview 로 이전했고(랜딩이 `/` 를 차지), 로그인 후 /overview 로 진입한다.
 * 섹션: nav → hero → trust → features(실제 스크린샷) → capabilities → how it works → docs → contact → footer.
 */
export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />
      <main>
        <Hero />
        <TrustSignals />
        <Features />
        <Capabilities />
        <HowItWorks />
        <Docs />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}

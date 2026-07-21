import { MarketingNav } from "./marketing-nav";
import {
  Hero,
  TrustSignals,
  Features,
  Capabilities,
  HowItWorks,
  Docs,
  Contact,
  Footer,
} from "./landing-sections";
import { getDict, type Locale } from "./i18n";

/**
 * 랜딩 조립(로케일 공용). `/`(en)·`/ko`(ko) 페이지가 이 컴포넌트를 locale 만 바꿔 렌더한다.
 * 최상위에서 사전을 한 번 읽어 nav(client)·각 섹션(server)으로 주입한다.
 * 섹션: nav → hero → trust → features(실제 스크린샷) → capabilities → how it works → docs → contact → footer.
 */
export function Landing({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav nav={dict.nav} locale={locale} />
      <main>
        <Hero dict={dict} locale={locale} />
        <TrustSignals dict={dict} locale={locale} />
        <Features dict={dict} locale={locale} />
        <Capabilities dict={dict} locale={locale} />
        <HowItWorks dict={dict} locale={locale} />
        <Docs dict={dict} locale={locale} />
        <Contact dict={dict} locale={locale} />
      </main>
      <Footer dict={dict} locale={locale} />
    </div>
  );
}

import { HtmlLang } from "@/components/html-lang";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { Footer } from "@/components/marketing/landing-sections";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { getDict } from "@/components/marketing/i18n";

/**
 * docs 셸 (#121) — `(marketing)` 라우트 그룹 안에 있으므로 랜딩과 같은 토큰·테마·폰트를 그대로 쓰고
 * 공개 크롤링 대상으로 남는다. `(app)` 하위는 인증 게이트 + noindex 라 문서가 살 수 없다.
 *
 * 이 문서는 **영어 전용**이다(#121 의 결정): 랜딩 기본 로케일이 영어이고, 엔진 레포와 문서가 인용하는
 * 식별자·페이로드·에러 문구가 전부 영어이며, 개발자 API 문서는 관례적으로 영어다. 그래서 nav·footer 도
 * `en` 사전으로 렌더하고 `ko` 사전에 docs 를 배선하지 않는다 — `/ko` 랜딩에서도 Docs 링크는 여기로 온다.
 * 루트 layout 의 `<html lang="ko">` 는 랜딩과 같은 방식으로 `HtmlLang` 이 보정한다.
 *
 * 레이아웃: lg 이상에서 [사이드바 220px | 본문] 2단, lg 미만에서는 사이드바가 접히고 본문이 전체 폭을
 * 쓴다. 본문 컬럼은 `min-w-0` 이라 넓은 코드 블록·표가 자기 컨테이너 안에서 스크롤되고 페이지 전체를
 * 좌우로 밀지 않는다.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const dict = getDict("en");
  return (
    <div lang="en" className="flex min-h-screen flex-col bg-bg">
      <HtmlLang lang="en" />
      <MarketingNav nav={dict.nav} a11y={dict.a11y} locale="en" />
      <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-8 px-6 py-9 lg:flex-row lg:gap-12 lg:py-12">
        <DocsSidebar label={dict.nav.links.docs} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Footer dict={dict} locale="en" />
    </div>
  );
}

import { HtmlLang } from "@/components/html-lang";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { Footer } from "@/components/marketing/landing-sections";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { getDict } from "@/components/marketing/i18n";
import type { Locale } from "@/lib/locale";

/**
 * docs 셸 (#121, 로케일 확장 #143) — 랜딩과 같은 토큰·테마·폰트를 그대로 쓰고 공개 크롤링 대상으로
 * 남는다.
 *
 * ## 왜 컴포넌트이고 레이아웃 파일이 아닌가
 * 라우트가 둘(`app/docs`·`app/ko/docs`)이므로 App Router 규칙상 `layout.tsx` 도 둘이어야 한다. 그런데
 * **레이아웃 구조가 두 벌 있으면 반드시 갈린다** — 사이드바 폭을 한쪽에서만 바꾸거나 푸터를 한쪽에서만
 * 빼먹는다. 그래서 구조는 여기 한 곳에 두고 두 `layout.tsx` 는 로케일만 넘기는 세 줄짜리 껍데기로
 * 남긴다. 문서 IA 를 매니페스트 하나로 모은 것과 같은 이유다.
 *
 * ## 로케일이 셸에서 하는 일
 * nav·푸터 사전, 사이드바 링크의 로케일, 그리고 `<html lang>` 을 정한다. 정적 내보내기에는 요청 시점이
 * 없어 `<html>` 은 루트 레이아웃 한 곳에서만 렌더되므로, 한국어 라우트의 `lang` 은 하이드레이션 후
 * `HtmlLang` 이, 초기 HTML 은 `scripts/postexport-lang.mjs` 가 보정한다(랜딩과 같은 장치).
 *
 * 레이아웃: lg 이상에서 [사이드바 220px | 본문] 2단, lg 미만에서는 사이드바가 접히고 본문이 전체 폭을
 * 쓴다. 본문 컬럼은 `min-w-0` 이라 넓은 코드 블록·표가 자기 컨테이너 안에서 스크롤되고 페이지 전체를
 * 좌우로 밀지 않는다.
 */
export function DocsShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const dict = getDict(locale);
  return (
    <div lang={locale} className="flex min-h-screen flex-col bg-bg">
      <HtmlLang lang={locale} />
      <MarketingNav nav={dict.nav} a11y={dict.a11y} locale={locale} />
      <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-8 px-6 py-9 lg:flex-row lg:gap-12 lg:py-12">
        <DocsSidebar locale={locale} label={dict.nav.links.docs} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Footer dict={dict} locale={locale} />
    </div>
  );
}

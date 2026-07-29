import Link from "next/link";
import { cookies, headers } from "next/headers";
import { ErrorScreen } from "@/components/error-screen";
import { getErrorMessages } from "@/components/error-messages";
import { buttonClass } from "@/components/ui/button";
import { HtmlLang } from "@/components/html-lang";
import { COUNTRY_HEADER, LOCALE_COOKIE, LOCALE_PATH, resolveLocale } from "@/lib/locale";

/**
 * 404 (#134). 지금까지 오타 하나면 Next 기본 화면(`404: This page could not be found.`, 검정 배경,
 * 영어 고정, 돌아갈 링크 없음)이 나왔다.
 *
 * ## 로케일
 * 랜딩과 **같은 정책**(`lib/locale.ts` 의 `resolveLocale`)을 쓴다: 쿠키 → `Accept-Language` →
 * `CF-IPCountry` → 기본 영어. 404 에만 별도 규칙을 두면 "언어 스위처로 한국어를 고른 사람이 오타를
 * 치면 영어 404" 같은 어긋남이 생긴다.
 *
 * 미들웨어(`middleware.ts`)는 매처가 `/`·`/login` 뿐이라 여기까지 오지 않는다. 그래서 판별을 이 페이지가
 * 직접 한다 — 미들웨어 매처를 전 경로로 넓히면 모든 정적 자산 요청까지 미들웨어를 통과하게 되므로
 * 404 하나 때문에 치를 대가가 아니다.
 *
 * `headers()`/`cookies()` 를 읽으므로 이 화면은 동적 렌더된다(빌드 타임 프리렌더 대상에서 빠진다).
 * 404 는 트래픽이 거의 없는 경로라 그 비용이 문제되지 않는다.
 *
 * ## 색인
 * 응답 상태가 404 라 크롤러는 이미 색인하지 않지만, `ErrorScreen` 이 `noindex` meta 도 함께 건다
 * (특수 파일이라 `metadata` export 를 쓸 수 없다).
 */
export default async function NotFound() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const { locale } = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
    country: headerStore.get(COUNTRY_HEADER),
  });
  const messages = getErrorMessages(locale);

  return (
    <>
      {/* 루트 레이아웃은 `lang="ko"` 고정이라, 영어로 판별된 404 는 랜딩과 같은 방식으로 보정한다. */}
      <HtmlLang lang={locale} />
      <ErrorScreen
        locale={locale}
        code="404"
        title={messages.notFound.title}
        description={messages.notFound.description}
        actions={
          <>
            <Link href={LOCALE_PATH[locale]} className={buttonClass("primary")}>
              {messages.actions.home}
            </Link>
            <Link href="/overview" className={buttonClass("ghost")}>
              {messages.actions.console}
            </Link>
          </>
        }
      />
    </>
  );
}

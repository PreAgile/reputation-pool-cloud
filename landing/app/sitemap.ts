import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { DOCS_PAGES, docsHref } from "@/lib/docs-manifest";
import { LOCALES, type Locale } from "@/lib/locale";
import { statusHref } from "@/lib/status";

/**
 * 정적 내보내기(`output: "export"`)에서는 라우트 핸들러가 기본적으로 동적으로 취급되어 빌드가
 * 멈춘다 — 서버가 없으니 요청 시점에 생성할 방법이 없기 때문이다. 이 파일의 출력은 빌드 시점에
 * 완전히 결정되므로 정적으로 못 박는다.
 */
export const dynamic = "force-static";


/**
 * `/sitemap.xml` — 두 언어의 랜딩과 docs 를 명시적으로 제출한다. 라우트 그룹 안이 아니라 `app/` 루트에
 * 있어야 `/sitemap.xml` 로 서빙된다.
 *
 * 이 사이트에 사이트맵이 특히 필요한 이유: `/` 는 미들웨어가 한국어 선호 방문자를 `/ko` 로 307 리다이렉트한다
 * (#110). 크롤링 경로가 로케일에 따라 갈리므로 두 URL 이 링크만으로 안정적으로 발견되지 않는다. 사이트맵이
 * 양쪽을 직접 알려주고, hreflang alternates 로 둘이 같은 문서의 언어 변형임을 함께 넘긴다.
 *
 * docs 는 그 위에 이유가 하나 더 있다: `/docs` 는 **자동 로케일 판별을 하지 않는다**(#143 의 결정,
 * `functions/_middleware.ts` 참고). 리다이렉트가 크롤러를 다른 언어로 데려가 주지 않으므로, 두 언어가
 * 각각 색인되는 유일한 경로가 사이트맵과 hreflang 이다.
 *
 * 이 파일에는 부수적으로 **후처리 스크립트와의 계약**이 하나 더 걸려 있다: `scripts/postexport-lang.mjs`
 * 가 `<html lang>` 을 보정해야 하는 한국어 문서 목록을 여기 출력에서 읽는다. 라우트를 늘리면서 이곳을
 * 잊으면 스크립트가 그 사실을 빌드 실패로 알린다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { en: SITE_URL, ko: `${SITE_URL}/ko` };
  // 상태 페이지(#145)의 두 언어 URL — 서로의 대안이다. docs 와 마찬가지로 `/status` 는 로케일 자동
  // 판별 대상이 아니므로(미들웨어는 루트에서만 판별한다) 두 언어가 각각 색인되는 경로는 이 쌍뿐이다.
  const statusLanguages = Object.fromEntries(
    LOCALES.map((locale) => [locale, `${SITE_URL}${statusHref(locale)}`]),
  ) as Record<Locale, string>;
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ko`, changeFrequency: "weekly", priority: 0.9, alternates: { languages } },
    // 상태 페이지는 랜딩·docs 보다 낮은 우선순위로 둔다 — 검색으로 처음 만나는 문서가 아니라 이미
    // 제품을 아는 사람이 문제가 생겼을 때 찾는 화면이다. 다만 그때 **찾을 수 있어야** 하므로 색인은
    // 시킨다. `changeFrequency` 는 실제 갱신 주기대로 적는다(사고를 손으로 기입할 때만 바뀐다).
    ...LOCALES.map((locale) => ({
      url: `${SITE_URL}${statusHref(locale)}`,
      changeFrequency: "weekly" as const,
      priority: locale === "en" ? 0.5 : 0.4,
      alternates: { languages: statusLanguages },
    })),
    // docs 는 매니페스트에서 파생시킨다. 목록을 여기 손으로 적으면 페이지를 추가할 때마다 두 곳을
    // 고쳐야 하고, 실제로 #130 이 docs 6 페이지를 넣으면서 sitemap 을 잊어 색인 대상에서 빠져 있었다.
    // 로케일도 같은 이유로 `LOCALES` 에서 돌린다 — 언어를 추가하면 URL 이 자동으로 따라온다.
    ...DOCS_PAGES.flatMap((page) => {
      // 한 슬러그의 두 URL 은 서로의 언어 대안이다. 이 쌍이 없으면 구글이 두 언어를 중복 콘텐츠로 보고
      // 한쪽을 버린다(#121 시점에는 영어 한 벌뿐이라 대안이 없어 일부러 비워 뒀고, 그 전제가 깨졌다).
      // 이 맵도 바로 아래 URL 루프와 **같은 `LOCALES`** 에서 돌린다. 여기만 로케일을 손으로 적어 두면
      // 언어를 추가할 때 `<loc>` 는 늘고 hreflang 쌍은 그대로인 상태가 되고, 그건 사이트맵을 열어 봐도
      // 눈에 띄지 않는다(URL 은 다 있고 관계만 빠져 있다).
      const docsLanguages = Object.fromEntries(
        LOCALES.map((locale) => [locale, `${SITE_URL}${docsHref(page.slug, locale)}`]),
      ) as Record<Locale, string>;
      return LOCALES.map((locale) => ({
        url: `${SITE_URL}${docsHref(page.slug, locale)}`,
        changeFrequency: "monthly" as const,
        // 랜딩(1.0/0.9)보다 낮게 두되 Introduction 을 하위 페이지보다 앞세우고, 기본 로케일이 아닌
        // 언어는 랜딩과 같은 0.1 만큼 낮춘다. 뺄셈으로 계산하지 않고 값을 적는다 — `0.8 - 0.1` 은
        // 부동소수점 오차로 `0.7000000000000001` 이 되어 사이트맵 XML 에 그대로 실린다.
        priority: locale === "en" ? (page.slug === "" ? 0.8 : 0.7) : page.slug === "" ? 0.7 : 0.6,
        alternates: { languages: docsLanguages },
      }));
    }),
  ];
}

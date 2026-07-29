"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { localePathFor, rememberLocale } from "@/lib/locale";
import { LOCALES, LOCALE_LABEL, type Locale } from "./i18n";

/**
 * 언어 토글 — 두 로케일 링크를 **항상 보이게** 나란히 둔다.
 *
 * ## 왜 드롭다운을 버렸나 (#143 리뷰)
 * 직전 구현은 지구본 버튼을 눌러야 목록이 열리는 드롭다운이었다. 목록이 `open` 상태에서만 렌더되므로
 * **내보낸 정적 HTML 에 다른 언어 링크가 존재하지 않았다.** 실측: `out/docs/api.html` 에 `href="/ko…"`
 * 가 0 건, `aria-label="Language"` 버튼만 있었다. 결과가 이것이다 —
 *   - JS 를 끄면 다른 언어로 갈 방법이 아예 없다.
 *   - 크롤러가 언어 간 링크를 따라갈 수 없다(hreflang 이 있어도 사용자 발견성과는 별개다).
 *   - 무엇보다, 한국어 문서를 만들어 놓고도 사용자 입장의 증상("한국어로 바꾸면 연동이 안 되어
 *     있다")이 그대로 남는다. 눌러 봐야 알 수 있는 것은 발견됐다고 할 수 없다.
 *
 * 로케일이 둘뿐인데 드롭다운을 쓸 이유가 없다. 링크 두 개를 그냥 노출하면 위 세 문제가 모두 사라진다.
 *
 * ## 쿠키는 점진적 향상으로 유지한다 (load-bearing)
 * 항목을 고르면 **이동 전에** `rp_locale` 쿠키를 심는다(#110). 이건 스타일이 아니라 계약이다:
 * `functions/_middleware.ts` 가 `/` 에서 방문자 신호로 `/ko` 로 307 을 보내고 쿠키를 1순위로 보므로,
 * 쿠키가 없으면 `/ko` 에서 English 를 골라 `/` 로 가는 순간 한국 IP 방문자가 곧바로 `/ko` 로 되돌려진다.
 *
 * 그래서 `onClick` 으로 심되 **링크 자체는 평범한 `<a href>`** 다. JS 가 없으면 쿠키 없이 이동한다 —
 * `/` 로 가는 한국 IP 방문자는 되돌려질 수 있지만, 그건 "링크가 아예 없다"보다 엄격히 낫다.
 *
 * docs 경로(`/docs/**`·`/ko/docs/**`)는 애초에 자동 판별에서 제외돼 있어(#143 의 결정) 쿠키가 없어도
 * 되돌려지지 않는다. 그래도 두 로케일·모든 경로에서 동작을 갈라 두지 않는다 — 다음 방문에 랜딩으로
 * 들어올 때 그 선택이 반영되어야 하고, 경로별로 다르게 동작하는 스위처는 설명할 수 없다.
 *
 * `prefetch={false}` 인 이유: 프리페치는 클릭 **전에**(따라서 쿠키가 심기기 전에) 일어나므로,
 * 프리페치된 `/` 응답이 "쿠키 없음 → /ko 로 리다이렉트"인 상태로 캐시될 수 있다. 그 캐시를 쓰면
 * 쿠키를 심어도 되돌리기가 먹히지 않는다.
 *
 * ## 목적지
 * 각 링크는 **지금 보고 있는 페이지의 그 언어 판**을 가리킨다(`usePathname()` + `localePathFor()`).
 * 로케일 랜딩 경로로 고정하면 `/docs/api` 에서 한국어를 고를 때 문서를 잃고 랜딩으로 떨어진다 —
 * 스위처는 언어를 바꾸는 장치이고 위치를 바꾸는 장치가 아니다. 현재 슬러그를 라우트마다 레이아웃까지
 * 내려보내는 배선 대신 경로 한 곳에서 읽는다(`DocsSidebar` 가 활성 페이지를 판별하는 방식과 동일).
 */

/**
 * 토글에 보이는 짧은 표기. nav 는 이미 빽빽하므로(테마·CTA·모바일 메뉴) 폭을 아낀다.
 * 접근 가능한 이름은 `LOCALE_LABEL` 의 온전한 언어명을 쓴다 — 스크린리더에 `EN` 은 언어가 아니다.
 * 보이는 텍스트가 접근 이름에 포함되므로(`english`.includes(`en`)) Label in Name 도 지킨다.
 */
const LOCALE_TOGGLE_LABEL: Record<Locale, string> = { en: "EN", ko: "한국어" };

export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname() ?? "/";

  return (
    // 라벨이 붙은 nav 로 감싸서 링크 두 개가 "언어 선택"으로 읽히게 한다. 링크만 나란히 두면
    // 스크린리더에는 정체 없는 링크 두 개일 뿐이다.
    <nav aria-label={label} className="flex items-center gap-px rounded-[8px] border border-line p-px">
      {LOCALES.map((l) => {
        const active = l === current;
        return (
          <Link
            key={l}
            href={localePathFor(pathname, l)}
            prefetch={false}
            hrefLang={l}
            // 현재 언어를 색만으로 표시하지 않는다 — 색은 스크린리더에 아무 정보가 아니다.
            aria-current={active ? "true" : undefined}
            aria-label={LOCALE_LABEL[l]}
            onClick={() => rememberLocale(l)}
            className={cn(
              "rounded-[7px] px-1.5 py-1 text-[12.5px] font-medium",
              active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {LOCALE_TOGGLE_LABEL[l]}
          </Link>
        );
      })}
    </nav>
  );
}

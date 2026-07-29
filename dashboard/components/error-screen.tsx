import type { ReactNode } from "react";
import { Brand } from "@/components/logo";
import type { Locale } from "@/lib/locale";

/**
 * 에러 화면 공용 셸 (#134) — `app/not-found.tsx`(404)와 `app/error.tsx`(런타임 에러)가 함께 쓴다.
 *
 * `"use client"` 를 붙이지 않는다. 서버 컴포넌트인 not-found 와 클라이언트 컴포넌트인 error 양쪽에서
 * import 되는데, 상태도 이벤트도 없는 순수 표현이라 어느 쪽 경계에 놓이든 그대로 동작한다.
 *
 * `app/global-error.tsx` 는 이 셸을 쓰지 **않는다** — 그 화면이 뜨는 시점엔 루트 레이아웃이 깨져 있어
 * globals.css 와 테마 클래스가 없다고 봐야 하고, Tailwind 유틸에 의존하는 이 셸은 그때 무너진다.
 * "장애가 깊을수록 의존하는 것이 적어야 한다" 는 것이 #134 의 설계 원칙이다:
 * 404 는 앱 전체 → error 는 앱 CSS + 디자인 시스템 → global-error 는 인라인 스타일 → 502 는 Caddy 정적 HTML.
 */
type ErrorScreenProps = {
  /** 크게 노출하는 상태 코드("404" 등). 사람이 스크린샷 한 장으로 상황을 전달할 수 있게 남긴다. */
  code: string;
  title: string;
  description: string;
  /** CTA 링크/버튼. 호출부가 상황에 맞는 것을 넣는다(홈으로 / 다시 시도 …). */
  actions: ReactNode;
  /** 지원 요청 시 붙일 식별자 같은 보조 정보(선택). */
  note?: ReactNode;
  /** `word-break: keep-all` 등 한국어 타이포 규칙이 걸리도록 서브트리에 lang 을 준다(globals.css). */
  locale: Locale;
};

export function ErrorScreen({ code, title, description, actions, note, locale }: ErrorScreenProps) {
  return (
    <div lang={locale} className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-16">
      {/*
        특수 파일(not-found/error)은 `metadata` export 를 지원하지 않아, React 19 가 <meta> 를 <head> 로
        끌어올려 주는 것이 유일한 통로다. 404 는 상태 코드만으로도 색인되지 않지만(Next 도 `/_not-found`
        에 noindex 를 하나 더 붙인다) 런타임 에러 화면은 200 으로 나갈 수 있어 상태 코드에 기댈 수 없다.
        두 화면이 같은 셸을 쓰므로 여기서 한 번에 건다.

        탭 제목은 루트 레이아웃의 "reputation-pool 콘솔" 이 그대로 남는다. 같은 방식으로 <title> 을
        얹어 봤지만 Next 의 Metadata API 가 넣는 <title> 이 뒤에 오면서 브라우저가 그쪽을 채택했다
        (실측: `document.title` 이 레이아웃 값). 특수 파일에 metadata 를 지원하기 전까지는 방법이 없고,
        보이는 화면은 멀쩡하므로 무효한 <title> 중복을 남기지 않는 쪽을 골랐다.
      */}
      <meta name="robots" content="noindex, nofollow" />

      <div className="w-full max-w-md text-center">
        <Brand className="justify-center" />
        <p className="mt-8 text-5xl font-extrabold tracking-tight text-muted tnum">{code}</p>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        {note && <p className="mt-8 border-t border-line pt-5 text-xs text-muted">{note}</p>}
      </div>
    </div>
  );
}

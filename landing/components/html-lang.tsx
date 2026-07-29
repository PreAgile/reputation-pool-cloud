"use client";

import { useEffect } from "react";

/**
 * 클라이언트에서 `<html lang>` 을 보정한다. 루트 레이아웃이 `lang="ko"` 로 고정돼 있어(대시보드·로그인 다수가
 * 한국어), 영어 랜딩에서만 `lang="en"` 으로 바꿔 준다. 검색엔진의 이중언어 시그널은 페이지 metadata 의
 * hreflang(alternates.languages)가 담당하고, 이 컴포넌트는 스크린리더/브라우저용 lang 을 맞춘다.
 */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}

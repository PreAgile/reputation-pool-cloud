import type { Metadata } from "next";
import { StatusPage } from "@/components/status/status-page";
import { getDict } from "@/components/marketing/i18n";
import { statusAlternates, statusHref } from "@/lib/status";

const LOCALE = "ko";
const dict = getDict(LOCALE);

/** hreflang 표는 영어판과 **같은 함수**에서 나온다 — 한쪽만 고쳐 두 언어가 서로를 잃는 일을 막는다. */
export const metadata: Metadata = {
  title: dict.status.meta.title,
  description: dict.status.meta.description,
  alternates: { canonical: statusHref(LOCALE), languages: statusAlternates() },
};

/**
 * 한국어 상태 페이지(`/ko/status`). 초기 HTML 의 `<html lang>` 은 `scripts/postexport-lang.mjs` 가,
 * 하이드레이션 이후는 `HtmlLang` 이 보정한다(랜딩·docs 와 같은 장치).
 */
export default function StatusRouteKo() {
  return <StatusPage locale={LOCALE} />;
}

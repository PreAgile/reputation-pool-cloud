import type { Metadata } from "next";
import { StatusPage } from "@/components/status/status-page";
import { getDict } from "@/components/marketing/i18n";
import { statusAlternates, statusHref } from "@/lib/status";

const LOCALE = "en";
const dict = getDict(LOCALE);

/**
 * `metadataBase` 는 여기서 설정하지 않는다 — 사이트 절대 URL 의 단일 출처는 루트 레이아웃과
 * `lib/site.ts`(#118)다. canonical 을 상대 경로로 두면 Next 가 상위 `metadataBase` 와 합성한다.
 */
export const metadata: Metadata = {
  title: dict.status.meta.title,
  description: dict.status.meta.description,
  alternates: { canonical: statusHref(LOCALE), languages: statusAlternates() },
};

/** 영어 상태 페이지(`/status`). 구조는 `components/status/status-page.tsx` 한 곳에 있다 (#145). */
export default function StatusRoute() {
  return <StatusPage locale={LOCALE} />;
}

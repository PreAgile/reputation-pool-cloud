import type { Dict, Locale } from "./dictionary";
import { en } from "./en";
import { ko } from "./ko";

export type { Dict, Locale } from "./dictionary";
export { LOCALES, LOCALE_PATH, LOCALE_LABEL } from "./dictionary";

const DICTS: Record<Locale, Dict> = { en, ko };

/** 로케일별 사전. 마케팅 서버 컴포넌트가 최상위에서 한 번 읽어 하위로 주입한다. */
export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}

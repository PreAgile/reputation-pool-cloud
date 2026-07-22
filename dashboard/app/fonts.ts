import localFont from "next/font/local";

/**
 * Pretendard Variable 을 자체 호스팅으로 로드한다(외부 CDN 의존 없음, 빌드에 번들).
 * 라이선스: SIL Open Font License 1.1 (npm `pretendard`, OFL-1.1) — 상업 사용/재배포 가능.
 *
 * `--font-sans`(globals.css) 가 기대하던 폰트를 실제로 공급한다. variable woff2 한 파일로
 * 45~920 전 두께를 커버하므로 제목(bold)·본문(regular)이 같은 폰트 패밀리로 렌더된다.
 * `display: swap` 으로 폰트 로드 전 시스템 폴백을 먼저 그려 CLS/FOIT 를 피한다.
 */
export const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Apple SD Gothic Neo",
    "Segoe UI",
    "Roboto",
    "sans-serif",
  ],
});

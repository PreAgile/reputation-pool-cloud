"use client";

import { useEffect } from "react";
import { getErrorMessages, localeFromDocument } from "@/components/error-messages";

/**
 * 루트 레이아웃까지 깨진 경우의 최후 화면 (#134).
 *
 * `app/error.tsx` 는 루트 레이아웃 **안쪽**의 에러만 잡는다. 레이아웃 자체나 `Providers` 가 던지면
 * 그 경계는 아예 마운트되지 못하고, 그때 Next 가 이 파일을 렌더한다. 그래서 이 컴포넌트는 루트
 * 레이아웃을 대체한다 — `<html>`·`<body>` 를 직접 그려야 하고, 없으면 문서 구조가 성립하지 않는다.
 *
 * ## 왜 Tailwind 도 디자인 시스템도 쓰지 않나
 * `globals.css` 는 `app/layout.tsx` 가 import 한다. 그 레이아웃을 대체하는 화면에서 같은 CSS 가
 * 확실히 로드된다고 가정할 근거가 없고(next-themes 의 `.dark` 클래스도 마찬가지로 없다), 가정이 틀리면
 * 클래스만 잔뜩 붙은 흰 화면이 남는다. #134 의 원칙은 "장애가 깊을수록 의존하는 것이 적어야 한다" 이므로
 * 여기서는 자기 자신만 참조한다: 인라인 `<style>` 한 덩어리 + 시스템 폰트. 다크 모드는 JS 없이
 * `prefers-color-scheme` 만 본다.
 *
 * 다음 단계는 Caddy 가 서빙하는 `caddy/origin-down.html`(502)이다 — 거기서는 이 앱조차 없다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const locale = localeFromDocument();
  const messages = getErrorMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <meta name="robots" content="noindex, nofollow" />
        <style>{CSS}</style>
        <main className="rp-fatal">
          <h1>{messages.fatal.title}</h1>
          <p>{messages.fatal.description}</p>
          {/* reset() 은 루트부터 다시 렌더한다. 여기까지 온 상황에서 유일하게 의미 있는 행동이다. */}
          <button type="button" onClick={reset}>
            {messages.actions.reload}
          </button>
          {error.digest && (
            <p className="rp-fatal-digest">
              {messages.digest}: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

/**
 * 토큰 값은 `app/globals.css` 에서 옮겨 적었다. 그 파일을 import 하면 이 화면이 다시 앱의 CSS 파이프라인에
 * 의존하게 되므로(위 주석 참고) 복사가 의도적이다 — 색이 조금 어긋나도 화면은 뜬다.
 */
const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f2f4f6; --ink: #191f28; --muted: #5f6b7a;
    --line: #e8ebee; --accent: #1a66d6; --accent-ink: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17191d; --ink: #eaecef; --muted: #8b95a1;
      --line: #2a2e35; --accent: #4593fc; --accent-ink: #0a2540;
    }
  }
  /* 브라우저 기본 body 여백(8px)을 지운다 — globals.css 의 리셋이 없는 화면이라 직접 해야 한다. */
  body { margin: 0; }
  .rp-fatal {
    box-sizing: border-box;
    min-height: 100vh;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 12px;
    padding: 24px;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif;
    text-align: center;
    word-break: keep-all;
  }
  .rp-fatal h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.015em; }
  .rp-fatal p { margin: 0; max-width: 30rem; font-size: 14px; line-height: 1.7; color: var(--muted); }
  .rp-fatal button {
    margin-top: 12px;
    padding: 10px 18px;
    border: 0;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .rp-fatal .rp-fatal-digest {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
`;

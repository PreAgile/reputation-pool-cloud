import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vitest — 트로피의 unit/component/integration 층(빠른 피드백, 브라우저 없이 jsdom).
 * e2e/visual(Playwright)은 제외한다(그건 실브라우저 전용).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // 루트의 두 파일도 포함한다 — Next 는 `middleware.ts`·`next.config.ts` 를 프로젝트 루트에서만 찾으므로
    // 구현을 app/·lib/ 로 옮길 수 없다. 그런데 둘 다 계약이 응답 자체다: 미들웨어의 응답 헤더(#110 의
    // `Vary`)와 config 의 리다이렉트 표(#15 의 마케팅 URL 이전)는 그 파일을 직접 읽어야만 검증된다.
    include: [
      "{app,components,lib}/**/*.test.{ts,tsx}",
      "middleware.test.ts",
      "next.config.test.ts",
    ],
    exclude: ["node_modules", ".next", "e2e", "visual"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

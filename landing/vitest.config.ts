import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * 랜딩의 단위·컴포넌트 테스트. 대시보드와 달리 Radix·recharts 를 쓰지 않으므로 setup 에 폴리필이 없다.
 * `functions/` 를 포함하는 이유: 언어 판별 미들웨어가 이 앱에서 유일하게 요청마다 도는 코드이고,
 * 잘못되면 방문자가 엉뚱한 언어를 받거나 리다이렉트 루프에 빠진다.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["{app,components,lib,functions}/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "out"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

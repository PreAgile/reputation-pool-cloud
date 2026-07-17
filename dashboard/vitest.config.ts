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
    include: ["{app,components,lib}/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e", "visual"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

// ESLint flat config — `next lint`(deprecated) → ESLint CLI 마이그레이션(#58).
// Next 공식 방식대로 FlatCompat로 기존 확장형 프리셋을 flat config에 얹는다.
// next/core-web-vitals + next/typescript 규칙을 그대로 사용한다.
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // 빌드 산출물·의존성·자동 생성 파일은 린트 대상에서 제외한다.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python venv for the FastF1 export (ships third-party JS inside matplotlib).
    "pipeline/.venv/**",
    // Local data and caches, never linted.
    ".cache/**",
    "public/data/**",
  ]),
]);

export default eslintConfig;

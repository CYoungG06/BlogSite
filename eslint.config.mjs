import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "public/**",
    "next-env.d.ts",
    // 非本项目源码:Python 虚拟环境里的第三方 JS、wrangler 本地状态
    ".venv/**",
    "**/.wrangler/**",
  ]),
]);

export default eslintConfig;

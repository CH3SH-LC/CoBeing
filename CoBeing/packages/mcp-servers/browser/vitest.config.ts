import { defineConfig } from "vitest/config";

/**
 * 包级 vitest 配置：使 `pnpm --filter @cobeing/browser-mcp-server test` 可从
 * 包目录独立运行。include 相对本目录（vitest root = 配置所在目录）。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

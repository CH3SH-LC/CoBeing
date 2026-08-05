import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "gui-v2/src/**/*.test.ts", // GUI 测试并入根命令（2026-08-03：Market 前端任务发现既有配置未覆盖 gui-v2）
      "gui-v2/src/**/*.test.tsx",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "gui-v2/src"), // gui-v2 测试的 @/ 路径别名（与 gui-v2/vite.config.ts 一致）
    },
  },
});

#!/usr/bin/env node
/**
 * 非交互式启动 CoBeing core（WS 服务器），供真实测试脚本连接。
 * 用法: npx tsx scripts/start-core.ts
 */
import { resolve } from "node:path";
import v8 from "node:v8";
import { config as dotenvConfig } from "dotenv";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/shared/dist/index.js";

dotenvConfig({ path: resolve(".env") });
const log = createLogger("start-core");

// 陈默 OOM 防护（P2 core 运行时健壮性）：堆上限自检 + 提示。
// V8 堆上限在进程启动前固定，脚本无法自设——用 NODE_OPTIONS 或 pnpm start:core。
const HEAP_TARGET_MB = Number(process.env.COBeING_HEAP_MB ?? 4096);
const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
if (heapLimitMB < HEAP_TARGET_MB) {
  log.warn(
    "当前 V8 堆上限 %dMB < 建议 %dMB — 长会话 grep/大文件可能 OOM。请用 `NODE_OPTIONS=--max-old-space-size=%d` 或 `pnpm start:core` 启动。",
    heapLimitMB, HEAP_TARGET_MB, HEAP_TARGET_MB,
  );
}

async function main() {
  const config = loadConfig();
  const runtime = new CoBeingRuntime(config);
  await runtime.start();
  log.info("CoBeing runtime started. WS server listening. Press Ctrl+C to stop.");
  process.on("SIGINT", async () => { await runtime.stop(); process.exit(0); });
  process.on("SIGTERM", async () => { await runtime.stop(); process.exit(0); });
  setInterval(() => {}, 1000); // keep alive
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

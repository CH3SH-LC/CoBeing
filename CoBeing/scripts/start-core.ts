#!/usr/bin/env node
/**
 * 非交互式启动 CoBeing core（WS 服务器），供真实测试脚本连接。
 * 用法: npx tsx scripts/start-core.ts
 */
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/shared/dist/index.js";

dotenvConfig({ path: resolve(".env") });
const log = createLogger("start-core");

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

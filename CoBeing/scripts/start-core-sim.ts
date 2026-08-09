#!/usr/bin/env node
/**
 * 隔离启动 CoBeing core（dataDir = data-sim-chenmo），供陈默模拟用户真实测试连接。
 * 用法: npx tsx scripts/start-core-sim.ts
 * 环境变量: COBEING_SIM_PORT（默认 18765）
 */
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/shared/dist/index.js";

dotenvConfig({ path: resolve(".env") });
const log = createLogger("start-core-sim");

async function main() {
  const config = loadConfig();
  config.core.dataDir = resolve("data-sim-chenmo");
  if (process.env.COBEING_SIM_PORT && config.gui) config.gui.wsPort = Number(process.env.COBEING_SIM_PORT);
  const runtime = new CoBeingRuntime(config);
  await runtime.start();
  log.info("CoBeing sim runtime started (dataDir=data-sim-chenmo). WS listening. Ctrl+C to stop.");
  // 打印 gateway 状态（验证全局 gateway 真实挂载）
  const gateway = (globalThis as any).__cobeing?.gateway;
  log.info("Global gateway mounted: %s (%s)", !!gateway, gateway ? JSON.stringify(gateway.getStatus()) : "N/A");
  process.on("SIGINT", async () => { await runtime.stop(); process.exit(0); });
  process.on("SIGTERM", async () => { await runtime.stop(); process.exit(0); });
  setInterval(() => {}, 1000); // keep alive
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

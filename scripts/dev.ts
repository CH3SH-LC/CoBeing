#!/usr/bin/env node
/**
 * CoBeing v2 开发启动入口
 * 交互式命令行模式
 *
 * 用法: npx tsx scripts/dev.ts
 *
 * 命令:
 *   直接输入文本     — 和管家对话
 *   /agents          — 列出所有 Agent
 *   /groups          — 列出所有群组
 *   /registry        — 查看 ButlerRegistry
 *   /gateway         — 查看 LLMGateway 状态
 *   /help            — 帮助
 *   /quit            — 退出
 */
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { config as dotenvConfig } from "dotenv";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/shared/dist/index.js";

dotenvConfig({ path: resolve(".env") });
const log = createLogger("dev");

async function main() {
  const config = loadConfig();
  const runtime = new CoBeingRuntime(config);
  await runtime.start();

  console.log("\n=== CoBeing v2 ===");
  console.log("输入文字与管家对话，输入 /help 查看命令\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you> ",
  });
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // 内置命令
    if (input === "/quit" || input === "/exit") {
      await shutdown();
      return;
    }

    if (input === "/help") {
      console.log(`
命令列表:
  /agents    — 列出所有 Agent
  /groups    — 列出所有群组
  /registry  — 查看 ButlerRegistry
  /gateway   — 查看 LLMGateway 状态
  /help      — 显示帮助
  /quit      — 退出
  其他       — 与管家对话
`);
      rl.prompt();
      return;
    }

    if (input === "/agents") {
      const agents = runtime.registry.list();
      if (agents.length === 0) {
        console.log("  (无 Agent)");
      } else {
        for (const a of agents) {
          console.log(`  ${a.name} (${a.id}) [${a.getStatus()}]`);
        }
      }
      rl.prompt();
      return;
    }

    if (input === "/groups") {
      const groups = runtime.groupManager.list();
      if (groups.length === 0) {
        console.log("  (无群组)");
      } else {
        for (const g of groups) {
          console.log(`  ${g.config.name} (${g.id}) [${g.config.members.length} members, ${g.config.protocol}]`);
        }
      }
      rl.prompt();
      return;
    }

    if (input === "/registry") {
      const butler = runtime.registry.list().find(a => a.id === "butler") as any;
      if (butler?.butlerRegistry) {
        console.log("\n--- Agent 注册表 ---");
        console.log(butler.butlerRegistry.readAgentsRegistry() || "(空)");
        console.log("\n--- 群组注册表 ---");
        console.log(butler.butlerRegistry.readGroupsRegistry() || "(空)");
      }
      rl.prompt();
      return;
    }

    if (input === "/gateway") {
      const status = runtime.getGatewayStatus();
      console.log(`  活跃请求: ${status.activeCount}, 队列: ${status.queueLength}, RPM: ${status.currentRpm}`);
      rl.prompt();
      return;
    }

    // 与管家对话
    try {
      const response = await runtime.handleUserInput(input);
      console.log(`\nbutler> ${response}\n`);
    } catch (err: any) {
      console.error(`\n错误: ${err.message}\n`);
    }
    rl.prompt();
  });

  const shutdown = async () => {
    console.log("\n正在关闭...");
    rl.close();
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * 终端交互测试 — 直接在命令行测试带工具的 Agent
 * 用法: npx tsx scripts/test-tool.ts
 */
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { Agent } from "../packages/core/dist/index.js";
import { OpenAICompatProvider } from "../packages/providers/dist/index.js";
import { createLogger, setGlobalLogLevel } from "../packages/shared/dist/index.js";

dotenvConfig({ path: resolve(".env") });

const log = createLogger("test-tool");

async function main() {
  setGlobalLogLevel("debug");

  const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
  if (!apiKey) {
    console.error("请在 .env 中设置 DEEPSEEK_API_KEY");
    process.exit(1);
  }

  const provider = new OpenAICompatProvider({
    id: "deepseek",
    name: "DeepSeek",
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
  });

  const agent = new Agent(
    {
      id: "test",
      name: "assistant",
      role: "编程助手",
      systemPrompt: "你是一个有帮助的AI助手。当用户要求时，使用工具来完成任务。",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      permissions: { mode: "workspace-write" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: true, mode: "all" } },
      tools: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch"],
      toolsConfig: {
        defaultPermission: "workspace-write",
        enabled: ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch"],
        permissions: {},
      },
    },
    provider,
  );

  console.log("\n=== CoBeing 工具测试 ===");
  console.log("输入消息测试工具调用，输入 exit 退出\n");

  // 从命令行读取输入
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    const input = await ask("> ");
    if (input.trim() === "exit") break;
    if (!input.trim()) continue;

    console.log("\n--- 思考中 ---");
    try {
      const response = await agent.run(input, {
        onToken: (token) => process.stdout.write(token),
        onToolCall: (tc) => console.log(`\n[工具调用] ${tc.function.name}(${tc.function.arguments})`),
        onToolResult: (id, result) => console.log(`\n[工具结果] ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`),
      });
      console.log("\n\n--- 回复 ---");
      console.log(response.content);
      console.log();
    } catch (err: any) {
      console.error("错误:", err.message);
    }
  }

  rl.close();
  console.log("再见！");
}

main().catch(console.error);

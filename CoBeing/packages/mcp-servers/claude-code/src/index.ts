/**
 * Claude Code MCP Server — 让 CoBeing Agent 借用 Claude Code 的完整编码能力
 *
 * 通过 stdio 实现 JSON-RPC 2.0 MCP 协议。CoBeing 的 MCPManager 以 stdio 模式
 * 启动本服务器，Agent 通过 mcp-discover / mcp-register 按需发现和注册工具。
 *
 * 环境变量:
 *   CLAUDE_CODE_MCP_DEFAULT_BUDGET   — 默认每任务预算 USD（默认 2）
 *   CLAUDE_CODE_MCP_DEFAULT_MAX_TURNS — 默认最大轮数（默认 50）
 *   CLAUDE_CODE_MCP_PERMISSION       — "strict" 用 acceptEdits；否则 bypassPermissions（默认）
 *   CLAUDE_CODE_PATH                 — Claude Code 可执行文件路径（可选）
 *   ANTHROPIC_API_KEY                — API 计费密钥（可选，缺省用 CLI 既有登录态）
 */
import { createLogger } from "@cobeing/shared";
import { MCPServer } from "./mcp-server.js";
import { ClaudeCodeTaskManager } from "./task-manager.js";
import { makeSdkRunner } from "./sdk.js";
import { makeTools } from "./tools.js";

// ================================================================
//  MCP stdio 协议约束：stdout 必须纯净（只承载 JSON-RPC 协议消息）。
//  @cobeing/shared 的 createLogger 把 info/debug 写到 console.log（stdout），
//  会污染协议通道（CoBeing 传输层会把每行 stdout 当 JSON 解析并告警）。
//  在模块顶层把 console.log 重定向到 stderr；process.stdout.write（协议响应）
//  不受影响。warn/error 本就走 stderr。
// ================================================================
const stdioLogger = (...args: unknown[]): void => {
  const line = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)))
    .join(" ");
  process.stderr.write(line + "\n");
};
// 仅在未设置过时覆盖（幂等）
if (!(console as any).__claudeCodeMcpStderrRedirect) {
  console.log = stdioLogger as unknown as typeof console.log;
  console.debug = stdioLogger as unknown as typeof console.debug;
  (console as any).__claudeCodeMcpStderrRedirect = true;
}

const log = createLogger("claude-code-mcp");

/**
 * Agent 面向的使用指南 —— 随 MCP initialize 握手返回，Agent 用 mcp-register
 * 注册本 server 工具时会一并收到这段「怎么用」。
 */
const INSTRUCTIONS = `使用 Claude Code MCP 工具的协议：
1. 用 claude_code_start 提交编码任务（working_dir 为存在的绝对路径，prompt 描述任务），立即返回 task_id。
2. 用 claude_code_result 轮询 task_id 直至状态变为 completed/failed/cancelled（单次最多等约 25 秒；超时返回当前状态，可再次调用）。
3. 也可用 claude_code_status 查进度与部分输出；claude_code_cancel 中止；claude_code_list 看全部任务。
4. 要延续上下文时，把上次结果里的 session_id 传给下次 claude_code_start。
5. 建议设置 max_budget_usd（默认 $2）与 max_turns（默认 50）控制成本。任务会真实修改 working_dir 内（甚至目录外绝对路径）的文件，请按可信任务使用。`;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const strict = process.env.CLAUDE_CODE_MCP_PERMISSION === "strict";
  const defaultPermissionMode = strict ? "acceptEdits" : "bypassPermissions";

  const runner = makeSdkRunner();
  const manager = new ClaudeCodeTaskManager(runner, {
    defaultMaxBudgetUsd: envNumber("CLAUDE_CODE_MCP_DEFAULT_BUDGET", 2),
    defaultMaxTurns: envNumber("CLAUDE_CODE_MCP_DEFAULT_MAX_TURNS", 50),
    defaultPermissionMode,
  });

  const server = new MCPServer({
    serverInfo: { name: "claude-code-mcp", version: "0.1.0" },
    capabilities: { tools: { listChanged: true } },
    instructions: INSTRUCTIONS,
    tools: makeTools(manager),
  });

  log.info(
    "Claude Code MCP Server starting (permission=%s budget=$%s turns=%s)",
    defaultPermissionMode,
    envNumber("CLAUDE_CODE_MCP_DEFAULT_BUDGET", 2),
    envNumber("CLAUDE_CODE_MCP_DEFAULT_MAX_TURNS", 50),
  );
  await server.run();
}

main().catch((err) => {
  log.error("Fatal: %s", err.message);
  process.exit(1);
});

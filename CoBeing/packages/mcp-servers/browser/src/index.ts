/**
 * Browser MCP Server — Playwright 驱动的浏览器自动化
 *
 * 通过 stdio 实现 JSON-RPC 2.0 MCP 协议。CoBeing 的 MCPManager 以 stdio 模式
 * 启动本服务器，Agent 通过 mcp-discover / mcp-register 按需发现和注册工具。
 *
 * 环境变量:
 *   BROWSER_HEADLESS       — headless 模式（默认 true）
 *   BROWSER_STORAGE_STATE  — storageState 保存路径（默认 data/mcp/browser-state.json）
 *   BROWSER_TIMEOUT_MS     — 单次操作超时毫秒数（默认 30000）
 */
import { createLogger } from "@cobeing/shared";
import { MCPServer } from "./mcp-server.js";
import { BrowserEngine } from "./browser-engine.js";
import { makeTools, BROWSER_INSTRUCTIONS } from "./tools.js";

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
if (!(console as any).__browserMcpStderrRedirect) {
  console.log = stdioLogger as unknown as typeof console.log;
  console.debug = stdioLogger as unknown as typeof console.debug;
  (console as any).__browserMcpStderrRedirect = true;
}

const log = createLogger("browser-mcp");

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

/** 启动入口：读 env → 构造 BrowserEngine + tools → run MCPServer */
export async function main(): Promise<void> {
  const headless = envBool("BROWSER_HEADLESS", true);
  const storageStatePath = process.env.BROWSER_STORAGE_STATE ?? "data/mcp/browser-state.json";
  const timeoutMs = envNumber("BROWSER_TIMEOUT_MS", 30000);

  const engine = new BrowserEngine({ headless, storageStatePath, timeoutMs });
  const server = new MCPServer({
    serverInfo: { name: "browser-mcp", version: "0.1.0" },
    capabilities: { tools: { listChanged: true } },
    instructions: BROWSER_INSTRUCTIONS,
    tools: makeTools(engine),
  });

  log.info(
    "Browser MCP Server starting (headless=%s storageState=%s timeoutMs=%s)",
    headless,
    storageStatePath,
    timeoutMs,
  );
  await server.run();
}

main().catch((err) => {
  log.error("Fatal: %s", err.message);
  process.exit(1);
});

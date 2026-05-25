/**
 * Office MCP Server — Word/Excel/PowerPoint 文档处理工具
 *
 * 通过 stdio 实现 JSON-RPC 2.0 MCP 协议。
 * CoBeing 的 MCPManager 以 stdio 模式启动本服务器，
 * Agent 通过 mcp-discover / mcp-register 按需发现和注册工具。
 *
 * 环境变量:
 *   OFFICE_SANDBOX=true — 沙箱模式，不实际写入文件
 */
import { createLogger } from "@cobeing/shared";
import { MCPServer } from "./mcp-server.js";
import { makeTools } from "./tools.js";

const log = createLogger("office-mcp");

async function main() {
  const tools = makeTools();
  const sandbox = process.env.OFFICE_SANDBOX === "true";

  const server = new MCPServer({
    serverInfo: { name: "office-mcp", version: "0.1.0" },
    capabilities: { tools: { listChanged: true } },
    tools,
  });

  log.info("Office MCP Server starting (sandbox=%s)", sandbox);
  await server.run();
}

main().catch((err) => {
  log.error("Fatal: %s", err.message);
  process.exit(1);
});

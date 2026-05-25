/**
 * QQ Bot MCP Server — 提供 QQ Bot 操作工具的 MCP 服务器
 *
 * 通过 stdio 实现 JSON-RPC 2.0 MCP 协议，CoBeing 的 MCPManager 以 stdio
 * 模式启动本服务器，自动发现并注册工具供 Agent 调用。
 *
 * 环境变量:
 *   QQ_BOT_APP_ID              — QQ Bot 应用 ID（必填，沙箱模式可空）
 *   QQ_BOT_TOKEN               — QQ Bot 令牌（必填，沙箱模式可空）
 *   QQ_BOT_API_BASE            — API 基础地址，默认 https://api.sgroup.qq.com
 *   QQ_BOT_AUTO_CONNECT_GATEWAY — 设为 "true" 自动连接事件网关（默认 false）
 */
import { createLogger } from "@cobeing/shared";
import { MCPServer } from "./mcp-server.js";
import { QQClient } from "./qq-client.js";
import { makeTools } from "./tools.js";

const log = createLogger("qqbot-mcp");

function getConfig() {
  const appId = process.env.QQ_BOT_APP_ID || "";
  const token = process.env.QQ_BOT_TOKEN || "";
  const apiBase = process.env.QQ_BOT_API_BASE || "https://api.sgroup.qq.com";
  const autoConnect = process.env.QQ_BOT_AUTO_CONNECT_GATEWAY === "true";

  if (!appId) log.warn("QQ_BOT_APP_ID 未设置，工具将在沙箱模式下运行");
  if (!token) log.warn("QQ_BOT_TOKEN 未设置，工具将在沙箱模式下运行");

  return { appId, token, apiBase, autoConnect };
}

async function main() {
  const config = getConfig();
  const client = new QQClient(config);
  const tools = makeTools(client);

  const server = new MCPServer({
    serverInfo: { name: "qqbot-mcp", version: "0.1.0" },
    capabilities: { tools: { listChanged: true } },
    tools,
  });

  log.info("QQ Bot MCP Server starting (sandbox=%s)", !config.appId);

  // 自动连接事件网关
  if (!client.sandbox && config.autoConnect) {
    client.connectGateway().catch(err => {
      log.error("Gateway auto-connect failed: %s", err.message);
    });
  }

  await server.run();
}

main().catch((err) => {
  log.error("Fatal: %s", err.message);
  process.exit(1);
});

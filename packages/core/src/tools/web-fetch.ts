/**
 * Web Fetch 工具 — 获取网页内容
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export const webFetchTool: Tool = {
  name: "web-fetch",
  description: "获取网页内容",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL 地址" },
      method: { type: "string", enum: ["GET", "POST"], default: "GET" },
      headers: { type: "object", description: "请求头" },
      body: { type: "string", description: "请求体" },
    },
    required: ["url"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    if (!context.sandbox.network) {
      return { toolCallId: "", content: "网络访问被禁止（sandbox.network=false）", isError: true };
    }

    const url = params.url as string;
    const method = (params.method as string) || "GET";
    const headers = params.headers as Record<string, string> | undefined;
    const body = params.body as string | undefined;

    try {
      const resp = await fetch(url, {
        method,
        headers: headers ?? {},
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const text = await resp.text();

      if (!resp.ok) {
        return { toolCallId: "", content: `HTTP ${resp.status}: ${text.slice(0, 500)}`, isError: true };
      }

      // 截断过长内容
      const truncated = text.length > 50000 ? text.slice(0, 50000) + "\n...(truncated)" : text;
      return { toolCallId: "", content: truncated };
    } catch (err: any) {
      return { toolCallId: "", content: `请求失败: ${err.message}`, isError: true };
    }
  },
};

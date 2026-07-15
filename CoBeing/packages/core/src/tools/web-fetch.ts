import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import { resolveNetworkConfig } from "./sandbox/network-whitelist.js";

export const webFetchTool: Tool = {
  name: "web-fetch",
  description: "Fetch an HTTP/HTTPS URL",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL" },
      method: { type: "string", enum: ["GET", "POST"], default: "GET" },
      headers: { type: "object", description: "Request headers" },
      body: { type: "string", description: "Request body" },
    },
    required: ["url"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const network = resolveNetworkConfig(context.sandbox.network);
    if (!network.enabled || network.mode === "none") {
      return { toolCallId: "", content: "Network access is disabled by sandbox policy", isError: true };
    }

    const rawUrl = params.url as string;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { toolCallId: "", content: "Invalid URL", isError: true };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { toolCallId: "", content: "Only http/https URLs are allowed", isError: true };
    }

    if (network.mode === "whitelist") {
      const host = parsed.hostname.toLowerCase();
      const allowed = (network.allowDomains ?? []).some(domain => {
        const d = domain.toLowerCase();
        return host === d || host.endsWith(`.${d}`);
      });
      if (!allowed) {
        return { toolCallId: "", content: `Domain not allowed by sandbox whitelist: ${host}`, isError: true };
      }
    }

    const method = (params.method as string) || "GET";
    const headers = sanitizeHeaders(params.headers as Record<string, string> | undefined);
    const body = params.body as string | undefined;

    try {
      const resp = await fetch(rawUrl, {
        method,
        headers,
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const text = await resp.text();
      if (!resp.ok) {
        return { toolCallId: "", content: `HTTP ${resp.status}: ${text.slice(0, 500)}`, isError: true };
      }

      const truncated = text.length > 50000 ? text.slice(0, 50000) + "\n...(truncated)" : text;
      return { toolCallId: "", content: truncated };
    } catch (err: any) {
      return { toolCallId: "", content: `Request failed: ${err.message}`, isError: true };
    }
  },
};

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) continue;
    out[key] = String(value);
  }
  return out;
}

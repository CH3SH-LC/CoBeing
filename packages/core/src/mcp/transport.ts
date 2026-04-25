/**
 * MCP Transport 层 — stdio 和 Streamable HTTP 传输实现
 */
import { ChildProcess, spawn } from "node:child_process";
import { createLogger } from "@cobeing/shared";

const log = createLogger("mcp-transport");

// ---- JSON-RPC 类型 ----

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// ---- Transport 接口 ----

export interface MCPTransport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  onMessage(handler: (message: JSONRPCMessage) => void): void;
  close(): Promise<void>;
}

// ---- Stdio Transport ----

export class StdioTransport implements MCPTransport {
  private proc: ChildProcess | null = null;
  private messageHandler: ((message: JSONRPCMessage) => void) | null = null;
  private buffer = "";

  constructor(
    private command: string,
    private args: string[] = [],
    private env?: Record<string, string>,
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {

      const procEnv = { ...process.env, ...this.env };
      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: procEnv,
      });

      this.proc.on("error", (err) => {
        log.error("Process error: %s", err.message);
        reject(err);
      });

      this.proc.stdout!.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.proc.stderr!.on("data", (data: Buffer) => {
        log.debug("[stderr] %s", data.toString().trim());
      });

      this.proc.on("close", (code) => {
        log.info("Process exited with code %d", code);
        this.proc = null;
      });

      // 等进程启动
      resolve();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Process not running");
    }
    const line = JSON.stringify(message) + "\n";
    this.proc.stdin.write(line);
  }

  onMessage(handler: (message: JSONRPCMessage) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    if (!this.proc) return;
    this.proc.stdin?.end();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.proc?.kill("SIGKILL");
        resolve();
      }, 5000);
      this.proc!.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.proc!.kill("SIGTERM");
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCMessage;
        this.messageHandler?.(msg);
      } catch {
        log.warn("Failed to parse: %s", trimmed.slice(0, 100));
      }
    }
  }
}

// ---- HTTP Transport (Streamable HTTP) ----

export class HTTPTransport implements MCPTransport {
  private messageHandler: ((message: JSONRPCMessage) => void) | null = null;
  private sessionId: string | null = null;
  private protocolVersion = "2025-11-25";

  constructor(
    private url: string,
    private headers: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    // 无需额外初始化，HTTP 在第一次请求时连接
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) {
      reqHeaders["MCP-Session-Id"] = this.sessionId;
    }
    if ("method" in message && "id" in message) {
      reqHeaders["MCP-Protocol-Version"] = this.protocolVersion;
    }

    const resp = await fetch(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(message),
    });

    // 捕获 session ID
    const sid = resp.headers.get("MCP-Session-Id");
    if (sid) this.sessionId = sid;

    if (resp.status === 202) return; // notification accepted

    const contentType = resp.headers.get("Content-Type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // SSE 流式响应
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6)) as JSONRPCMessage;
              this.messageHandler?.(msg);
            } catch { /* skip */ }
          }
        }
      }
    } else if (contentType.includes("application/json")) {
      // 单个 JSON 响应
      const msg = await resp.json() as JSONRPCMessage;
      this.messageHandler?.(msg);
    }
  }

  onMessage(handler: (message: JSONRPCMessage) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    // HTTP 无状态，无需关闭
    this.sessionId = null;
  }
}

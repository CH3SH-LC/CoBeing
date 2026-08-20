/**
 * StdioTransport env 测试 — 子进程必须继承 process.env（MCP server 才能读到 .env 中的凭据），
 * config env（this.env）覆盖 process.env。
 *
 * 实现：真实 spawn node 子进程，子进程把自身可见的 env 变量以 JSONRPC 消息形式
 * 打印到 stdout，经 StdioTransport 的 processBuffer 解析后由 messageHandler 收到。
 */
import { describe, it, expect, afterEach } from "vitest";
import { StdioTransport } from "./transport.js";

/** 子进程脚本：把目标 env 变量以 JSONRPC 消息格式输出到 stdout */
const CHILD_SCRIPT =
  `console.log(JSON.stringify({jsonrpc:"2.0",id:1,method:"env-report",params:{` +
  `inherited:process.env.CO_BEING_TST_INHERITED||"__absent__",` +
  `overridden:process.env.CO_BEING_TST_OVERRIDE||"__absent__",` +
  `notPresent:process.env.CO_BEING_TST_NOT_PRESENT||"__absent__"}}));`;

/** 在 start() 之前挂上消息收集器 */
function collectMessages(transport: StdioTransport): any[] {
  const messages: any[] = [];
  transport.onMessage((m) => messages.push(m));
  return messages;
}

/** 轮询等待子进程输出（带超时，避免测试悬挂） */
function waitForMessage(messages: any[], timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (messages.length > 0) {
        clearInterval(timer);
        resolve(messages[0]);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for child process output"));
      }
    }, 25);
  });
}

describe("StdioTransport env inheritance", () => {
  afterEach(() => {
    delete process.env.CO_BEING_TST_INHERITED;
    delete process.env.CO_BEING_TST_OVERRIDE;
  });

  it("子进程默认继承 process.env（非白名单变量也能读到）", async () => {
    process.env.CO_BEING_TST_INHERITED = "inherited-value";

    const transport = new StdioTransport("node", ["-e", CHILD_SCRIPT]);
    const messages = collectMessages(transport);
    await transport.start();

    const msg = await waitForMessage(messages);
    expect(msg.params.inherited).toBe("inherited-value");
    // 未设置的变量不会被凭空注入
    expect(msg.params.notPresent).toBe("__absent__");

    await transport.close();
  });

  it("config env（this.env）覆盖 process.env", async () => {
    process.env.CO_BEING_TST_OVERRIDE = "from-process-env";

    const transport = new StdioTransport("node", ["-e", CHILD_SCRIPT], {
      CO_BEING_TST_OVERRIDE: "from-config",
    });
    const messages = collectMessages(transport);
    await transport.start();

    const msg = await waitForMessage(messages);
    expect(msg.params.overridden).toBe("from-config");

    await transport.close();
  });
});

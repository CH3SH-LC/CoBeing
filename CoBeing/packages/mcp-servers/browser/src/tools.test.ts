/**
 * Browser MCP 工具单元测试 — mock engine，验证参数校验与 execute 转发
 *
 * 覆盖: 9 个工具齐全 / 缺参报错（isError）/ 参数转发 / 引擎异常 → isError 内容 /
 *       playwright 缺失提示映射 / INSTRUCTIONS 信任边界说明
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTools, BROWSER_INSTRUCTIONS } from "./tools.js";
import type { BrowserEngine } from "./browser-engine.js";

/** fake engine：与 BrowserEngine 同形，方法均为 vi.fn */
function makeFakeEngine() {
  return {
    navigate: vi.fn().mockResolvedValue("URL: https://example.com\n标题: 示例"),
    getText: vi.fn().mockResolvedValue("页面文本"),
    screenshot: vi.fn().mockResolvedValue("data/mcp/screenshots/s1.png"),
    search: vi.fn().mockResolvedValue("搜索结果（bing）:\n..."),
    click: vi.fn().mockResolvedValue("已点击 #btn"),
    fill: vi.fn().mockResolvedValue("已填写"),
    download: vi.fn().mockResolvedValue("已下载到 data/mcp/downloads/a.pdf"),
    saveLoginState: vi.fn().mockResolvedValue("data/mcp/browser-state.json"),
    status: vi.fn().mockResolvedValue("浏览器: 未启动"),
  } as unknown as BrowserEngine;
}

const TOOL_NAMES = [
  "browser_navigate",
  "browser_get_text",
  "browser_screenshot",
  "browser_search",
  "browser_click",
  "browser_fill",
  "browser_download",
  "browser_save_login_state",
  "browser_status",
];

let fakeEngine: ReturnType<typeof makeFakeEngine>;
let tools: ReturnType<typeof makeTools>;

beforeEach(() => {
  fakeEngine = makeFakeEngine();
  tools = makeTools(fakeEngine);
});

describe("工具清单", () => {
  it("9 个工具齐全且名字精确匹配", () => {
    const names = tools.map((t) => t.name);
    for (const n of TOOL_NAMES) expect(names).toContain(n);
    expect(names.length).toBe(9);
  });

  it("每个工具都有 inputSchema", () => {
    for (const t of tools) {
      expect(t.inputSchema).toBeTypeOf("object");
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });
});

describe("browser_navigate", () => {
  it("缺少 url 时返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_navigate")!;
    const r = await t.execute({});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("缺少 url");
    expect(fakeEngine.navigate).not.toHaveBeenCalled();
  });

  it("转发 url 并返回内容", async () => {
    const t = tools.find((x) => x.name === "browser_navigate")!;
    const r = await t.execute({ url: "https://example.com" });
    expect(fakeEngine.navigate).toHaveBeenCalledWith("https://example.com");
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("URL:");
  });
});

describe("browser_get_text", () => {
  it("无 selector 时转发 undefined", async () => {
    const t = tools.find((x) => x.name === "browser_get_text")!;
    const r = await t.execute({});
    expect(fakeEngine.getText).toHaveBeenCalledWith(undefined);
    expect(r.content).toBe("页面文本");
  });

  it("有 selector 时转发 selector", async () => {
    const t = tools.find((x) => x.name === "browser_get_text")!;
    await t.execute({ selector: "#main" });
    expect(fakeEngine.getText).toHaveBeenCalledWith("#main");
  });
});

describe("browser_screenshot", () => {
  it("无 save_path 时转发 undefined", async () => {
    const t = tools.find((x) => x.name === "browser_screenshot")!;
    await t.execute({});
    expect(fakeEngine.screenshot).toHaveBeenCalledWith(undefined);
  });

  it("有 save_path 时转发", async () => {
    const t = tools.find((x) => x.name === "browser_screenshot")!;
    await t.execute({ save_path: "./out/a.png" });
    expect(fakeEngine.screenshot).toHaveBeenCalledWith("./out/a.png");
  });
});

describe("browser_search", () => {
  it("缺少 query 时返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_search")!;
    const r = await t.execute({});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("缺少 query");
  });

  it("默认 bing", async () => {
    const t = tools.find((x) => x.name === "browser_search")!;
    await t.execute({ query: "天气" });
    expect(fakeEngine.search).toHaveBeenCalledWith("天气", "bing");
  });

  it("支持 baidu", async () => {
    const t = tools.find((x) => x.name === "browser_search")!;
    await t.execute({ query: "天气", engine: "baidu" });
    expect(fakeEngine.search).toHaveBeenCalledWith("天气", "baidu");
  });

  it("非法 engine 返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_search")!;
    const r = await t.execute({ query: "天气", engine: "google" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("bing");
  });
});

describe("browser_click / browser_fill", () => {
  it("click 缺少 selector 时返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_click")!;
    const r = await t.execute({});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("缺少 selector");
  });

  it("click 转发 selector", async () => {
    const t = tools.find((x) => x.name === "browser_click")!;
    await t.execute({ selector: "#go" });
    expect(fakeEngine.click).toHaveBeenCalledWith("#go");
  });

  it("fill 缺少 selector 或 value 时返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_fill")!;
    expect((await t.execute({ value: "x" })).isError).toBe(true);
    expect((await t.execute({ selector: "#a" })).isError).toBe(true);
  });

  it("fill 转发 selector + value", async () => {
    const t = tools.find((x) => x.name === "browser_fill")!;
    await t.execute({ selector: "#q", value: "hello" });
    expect(fakeEngine.fill).toHaveBeenCalledWith("#q", "hello");
  });
});

describe("browser_download", () => {
  it("缺少 url 时返回错误", async () => {
    const t = tools.find((x) => x.name === "browser_download")!;
    const r = await t.execute({});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("缺少 url");
  });

  it("转发 url 与 dest_dir", async () => {
    const t = tools.find((x) => x.name === "browser_download")!;
    await t.execute({ url: "https://example.com/a.pdf", dest_dir: "./dl" });
    expect(fakeEngine.download).toHaveBeenCalledWith("https://example.com/a.pdf", "./dl");
  });
});

describe("browser_save_login_state / browser_status", () => {
  it("save_login_state 转发并返回路径", async () => {
    const t = tools.find((x) => x.name === "browser_save_login_state")!;
    const r = await t.execute({});
    expect(fakeEngine.saveLoginState).toHaveBeenCalled();
    expect(r.content).toContain("browser-state.json");
  });

  it("status 转发", async () => {
    const t = tools.find((x) => x.name === "browser_status")!;
    const r = await t.execute({});
    expect(fakeEngine.status).toHaveBeenCalled();
    expect(r.content).toContain("未启动");
  });
});

describe("引擎异常 → isError 内容", () => {
  it("playwright 缺失提示被映射为明确安装指引", async () => {
    fakeEngine.navigate.mockRejectedValue(
      new Error("playwright 未安装，请运行 pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium"),
    );
    const t = tools.find((x) => x.name === "browser_navigate")!;
    const r = await t.execute({ url: "https://example.com" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("playwright 未安装");
    expect(r.content).toContain("pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium");
  });

  it("一般引擎错误包装为 错误: 前缀", async () => {
    fakeEngine.navigate.mockRejectedValue(new Error("boom"));
    const t = tools.find((x) => x.name === "browser_navigate")!;
    const r = await t.execute({ url: "https://example.com" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("错误: boom");
  });
});

describe("INSTRUCTIONS 登录态信任边界", () => {
  it("说明 storageState 本机存储、Agent 复用已登录会话、敏感操作回用户确认", () => {
    expect(BROWSER_INSTRUCTIONS).toContain("登录态");
    expect(BROWSER_INSTRUCTIONS).toContain("data/mcp/browser-state.json");
    expect(BROWSER_INSTRUCTIONS).toContain("用户授权");
    expect(BROWSER_INSTRUCTIONS).toContain("敏感操作");
    expect(BROWSER_INSTRUCTIONS).toContain("回到用户确认");
  });
});

/**
 * Browser MCP 工具定义
 *
 * 工具面:
 *   browser_navigate          — 导航到 URL（仅 http/https）
 *   browser_get_text         — 提取 body 或指定选择器文本（截断 8000 字符）
 *   browser_screenshot       — 截图保存（默认 data/mcp/screenshots/）
 *   browser_search           — bing/baidu 搜索
 *   browser_click            — 点击选择器
 *   browser_fill             — 填表单
 *   browser_download         — 下载文件（默认 data/mcp/downloads/）
 *   browser_save_login_state — 保存登录态（storageState）
 *   browser_status           — 连接状态 / 当前 URL / 登录态文件
 *
 * 所有工具调用真实浏览器自动化。playwright 不可用时（import 失败），
 * 工具返回明确错误提示而非崩溃。
 */
import type { BrowserEngine } from "./browser-engine.js";
import { PLAYWRIGHT_MISSING_HINT } from "./browser-engine.js";

interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** 执行引擎调用，统一包装错误为 isError 内容 */
async function runEngine(
  fn: () => Promise<string>,
): Promise<{ content: string; isError?: boolean }> {
  try {
    return { content: await fn() };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("playwright 未安装")) {
      return { content: `浏览器工具不可用: ${PLAYWRIGHT_MISSING_HINT}`, isError: true };
    }
    return { content: `错误: ${msg}`, isError: true };
  }
}

export function makeTools(engine: BrowserEngine): Tool[] {
  return [
    {
      name: "browser_navigate",
      description: `打开指定 URL 并等待页面加载完成，返回最终 URL 与页面标题。
仅允许 http/https 协议（拒绝 javascript:/file: 等危险协议）。`,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "要访问的完整 URL，如 https://example.com" },
        },
        required: ["url"],
      },
      async execute(params) {
        const url = str(params.url);
        if (!url) return { content: "错误: 缺少 url", isError: true };
        return runEngine(() => engine.navigate(url));
      },
    },

    {
      name: "browser_get_text",
      description: `提取当前页面文本内容（最多 8000 字符，超出自动截断）。
不传 selector 时提取整页 body 文本；传 selector 时提取匹配元素的文本。`,
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器（可选），如 '#main'、'article p'" },
        },
      },
      async execute(params) {
        const selector = str(params.selector);
        return runEngine(() => engine.getText(selector));
      },
    },

    {
      name: "browser_screenshot",
      description: `对当前页面截图并保存为 PNG 文件。
默认保存到 data/mcp/screenshots/ 目录（文件名带时间戳）；可指定保存路径。返回文件绝对/相对路径。`,
      inputSchema: {
        type: "object",
        properties: {
          save_path: { type: "string", description: "截图保存路径（可选），如 ./output/page.png" },
        },
      },
      async execute(params) {
        const savePath = str(params.save_path);
        return runEngine(() => engine.screenshot(savePath));
      },
    },

    {
      name: "browser_search",
      description: `在搜索引擎搜索关键词并返回结果页面文本。
engine 可选 bing（默认）或 baidu。`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          engine: { type: "string", description: "搜索引擎: bing（默认）/ baidu", enum: ["bing", "baidu"] },
        },
        required: ["query"],
      },
      async execute(params) {
        const query = str(params.query);
        if (!query) return { content: "错误: 缺少 query", isError: true };
        const engineName = str(params.engine);
        if (engineName && engineName !== "bing" && engineName !== "baidu") {
          return { content: "错误: engine 需为 bing 或 baidu", isError: true };
        }
        return runEngine(() => engine.search(query, (engineName as "bing" | "baidu") ?? "bing"));
      },
    },

    {
      name: "browser_click",
      description: `点击页面中匹配 CSS 选择器的元素（如按钮、链接）。
点击后等待页面稳定并返回当前 URL。`,
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器，如 'button#submit'、'a.login'" },
        },
        required: ["selector"],
      },
      async execute(params) {
        const selector = str(params.selector);
        if (!selector) return { content: "错误: 缺少 selector", isError: true };
        return runEngine(() => engine.click(selector));
      },
    },

    {
      name: "browser_fill",
      description: `在页面中匹配 CSS 选择器的输入元素中填入文本（如文本框、搜索框、表单字段）。`,
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器，如 '#username'、'input[name=q]'" },
          value: { type: "string", description: "要填入的文本" },
        },
        required: ["selector", "value"],
      },
      async execute(params) {
        const selector = str(params.selector);
        const value = str(params.value);
        if (!selector) return { content: "错误: 缺少 selector", isError: true };
        if (value === undefined) return { content: "错误: 缺少 value", isError: true };
        return runEngine(() => engine.fill(selector, value));
      },
    },

    {
      name: "browser_download",
      description: `下载指定 URL 的文件到本地目录。
默认保存到 data/mcp/downloads/ 目录；可指定 dest_dir。仅允许 http/https URL。`,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "要下载的文件 URL，如 https://example.com/report.pdf" },
          dest_dir: { type: "string", description: "保存目录（可选），默认 data/mcp/downloads/" },
        },
        required: ["url"],
      },
      async execute(params) {
        const url = str(params.url);
        if (!url) return { content: "错误: 缺少 url", isError: true };
        const destDir = str(params.dest_dir);
        return runEngine(() => engine.download(url, destDir));
      },
    },

    {
      name: "browser_save_login_state",
      description: `保存当前浏览器的登录态（cookies/localStorage）到本机 data/mcp/browser-state.json（gitignored）。
之后启动的浏览器会话会自动复用该登录态。
注意安全边界：复用的是用户已登录的会话，仅限用户授权的站点操作。`,
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return runEngine(() => engine.saveLoginState());
      },
    },

    {
      name: "browser_status",
      description: `查看浏览器连接状态、当前页面 URL、登录态文件是否存在。
首次工具调用前浏览器为未启动状态（懒启动）。`,
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return runEngine(() => engine.status());
      },
    },
  ];
}

/** 随 MCP initialize 返回的使用指南：登录态信任边界说明 */
export const BROWSER_INSTRUCTIONS = `使用浏览器 MCP 工具的协议与安全边界：
1. browser_navigate 打开页面，browser_get_text 读文本，browser_screenshot 留证据，browser_search 查信息。
2. browser_click / browser_fill 可操作页面（登录表单、搜索框、按钮），browser_download 下载文件到本机 data/mcp/downloads/。
3. 登录态信任边界：浏览器复用的是用户已登录的会话（storageState 存本机 data/mcp/browser-state.json，gitignored）。
   仅在用户授权的站点内操作；涉及敏感操作（支付、删除、发布、修改个人资料）必须回到用户确认后再执行。
4. browser_save_login_state 保存当前登录态；保存后新会话自动复用。
5. 截图/下载产物存 data/mcp/ 下，供用户查阅。`;

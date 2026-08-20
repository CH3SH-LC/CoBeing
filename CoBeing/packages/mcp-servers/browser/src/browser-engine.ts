/**
 * BrowserEngine — Playwright chromium 封装
 *
 * 能力: 导航 / 搜索 / 提取文本 / 截图 / 点击 / 填表单 / 下载 / 登录态持久化。
 *
 * 设计要点:
 * - lazy launch: 首次调用工具时启动浏览器（headless 可配），避免 server 启动即耗资源
 * - storageState 持久化: launch 时若 state 文件存在则 context 加载登录态；
 *   close() / saveLoginState() 时保存到 state 路径（默认 data/mcp/browser-state.json，gitignored）
 * - URL 校验: 仅允许 http/https（拒绝 javascript:/file:/data: 等）
 * - 超时防护: 每次操作受 timeoutMs（默认 30000ms）约束，拒绝无限等待
 * - playwright 不可用: 动态 import 失败时抛出明确提示，tools 层转为错误内容而非崩溃
 */
import { createLogger } from "@cobeing/shared";
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Download, Page } from "playwright";

const log = createLogger("browser-engine");

/** playwright 缺失时的明确错误提示（与 tools 层约定一致） */
export const PLAYWRIGHT_MISSING_HINT =
  "playwright 未安装，请运行 pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium";

/** 文本提取的截断上限（字符） */
export const TEXT_TRUNCATE_LIMIT = 8000;

export interface BrowserEngineOptions {
  /** headless 模式（默认 true） */
  headless?: boolean;
  /** storageState 保存路径（默认 data/mcp/browser-state.json，相对 cwd） */
  storageStatePath?: string;
  /** 单次操作超时毫秒数（默认 30000） */
  timeoutMs?: number;
}

export class BrowserEngine {
  private options: Required<BrowserEngineOptions>;
  /** 动态 import 的 playwright 模块；null 表示尚未加载/加载失败 */
  private pw: typeof import("playwright") | null = null;
  private playwrightError: string | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentUrl: string | null = null;

  constructor(options: BrowserEngineOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      storageStatePath: options.storageStatePath ?? path.join("data", "mcp", "browser-state.json"),
      timeoutMs: options.timeoutMs ?? 30000,
    };
  }

  // ================================================================
  //  内部辅助
  // ================================================================

  /** 动态加载 playwright；失败时给出明确安装提示（不崩溃） */
  private async ensurePlaywright(): Promise<void> {
    if (this.pw) return;
    if (this.playwrightError) throw new Error(this.playwrightError);
    try {
      this.pw = await import("playwright");
    } catch (err: any) {
      this.playwrightError = PLAYWRIGHT_MISSING_HINT;
      log.error("playwright import failed: %s", err?.message ?? err);
      throw new Error(PLAYWRIGHT_MISSING_HINT);
    }
  }

  /** lazy launch：首次调用时启动 browser + context（按需加载 storageState）+ page */
  private async ensureLaunched(): Promise<void> {
    if (this.browser) return;
    await this.ensurePlaywright();
    const { chromium } = this.pw!;
    await this.withTimeout(async () => {
      this.browser = await chromium.launch({ headless: this.options.headless });
      const statePath = this.options.storageStatePath;
      const hasState = fs.existsSync(statePath);
      this.context = await this.browser.newContext(hasState ? { storageState: statePath } : {});
      this.page = await this.context.newPage();
      if (hasState) log.info("已加载 storageState: %s", statePath);
    }, "浏览器启动");
  }

  /** 操作级超时防护：拒绝无限等待 */
  private async withTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const ms = this.options.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    });
    try {
      return await Promise.race([fn(), guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** URL 校验：仅允许 http/https */
  private assertHttpUrl(raw: string, label: string): string {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${label}无效: ${raw}（必须是完整 URL，如 https://example.com）`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${label}仅允许 http/https 协议: ${raw}`);
    }
    return url.toString();
  }

  private async ensurePage(): Promise<Page> {
    await this.ensureLaunched();
    return this.page!;
  }

  private truncate(text: string): string {
    if (text.length <= TEXT_TRUNCATE_LIMIT) return text;
    return text.slice(0, TEXT_TRUNCATE_LIMIT) + "\n…（已截断，超出 " + TEXT_TRUNCATE_LIMIT + " 字符）";
  }

  // ================================================================
  //  公开能力
  // ================================================================

  /** 导航到 URL，返回最终 URL + 标题 */
  async navigate(url: string): Promise<string> {
    const target = this.assertHttpUrl(url, "导航目标");
    const page = await this.ensurePage();
    await this.withTimeout(async () => {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: this.options.timeoutMs });
    }, "页面加载");
    this.currentUrl = page.url();
    const title = await this.withTimeout(() => page.title(), "读取标题");
    return `URL: ${this.currentUrl}\n标题: ${title}`;
  }

  /** 提取 body 文本或指定选择器文本（截断 8000 字符） */
  async getText(selector?: string): Promise<string> {
    const page = await this.ensurePage();
    const text = await this.withTimeout(async () => {
      if (selector && selector.trim() !== "") {
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: "attached", timeout: this.options.timeoutMs });
        return await loc.innerText({ timeout: this.options.timeoutMs });
      }
      return await page.locator("body").innerText({ timeout: this.options.timeoutMs });
    }, "提取文本");
    return this.truncate(text);
  }

  /** 截图保存到指定路径；默认 data/mcp/screenshots/<ts>.png，目录自动创建 */
  async screenshot(savePath?: string): Promise<string> {
    const page = await this.ensurePage();
    const dest =
      savePath && savePath.trim() !== ""
        ? savePath
        : path.join("data", "mcp", "screenshots", `screenshot-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await this.withTimeout(async () => {
      await page.screenshot({ path: dest, fullPage: true });
    }, "截图");
    return dest;
  }

  /** 打开搜索引擎搜索，返回结果文本（bing 默认 / baidu 可选） */
  async search(query: string, engine: "bing" | "baidu" = "bing"): Promise<string> {
    const q = query.trim();
    if (!q) throw new Error("搜索关键词不能为空");
    const url =
      engine === "baidu"
        ? `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`
        : `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
    const page = await this.ensurePage();
    await this.withTimeout(async () => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.options.timeoutMs });
    }, "搜索结果加载");
    let text: string;
    try {
      const resultSelector = engine === "baidu" ? "#content_left" : "#b_results";
      text = await page.locator(resultSelector).first().innerText({ timeout: this.options.timeoutMs });
    } catch {
      text = await page.locator("body").innerText({ timeout: this.options.timeoutMs });
    }
    return `搜索结果（${engine}）:\n${this.truncate(text)}`;
  }

  /** 点击指定选择器 */
  async click(selector: string): Promise<string> {
    const page = await this.ensurePage();
    await this.withTimeout(async () => {
      await page.click(selector, { timeout: this.options.timeoutMs });
    }, "点击");
    await page.waitForLoadState("domcontentloaded", { timeout: this.options.timeoutMs }).catch(() => undefined);
    this.currentUrl = page.url();
    return `已点击 ${selector}\n当前 URL: ${this.currentUrl}`;
  }

  /** 在指定选择器填入值 */
  async fill(selector: string, value: string): Promise<string> {
    const page = await this.ensurePage();
    await this.withTimeout(async () => {
      await page.fill(selector, value, { timeout: this.options.timeoutMs });
    }, "填写表单");
    return `已在 ${selector} 填写值`;
  }

  /** 下载 URL 到目录（默认 data/mcp/downloads/）；文件名清洗防路径穿越 */
  async download(url: string, destDir?: string): Promise<string> {
    const target = this.assertHttpUrl(url, "下载目标");
    const page = await this.ensurePage();
    const dir = destDir && destDir.trim() !== "" ? destDir : path.join("data", "mcp", "downloads");
    fs.mkdirSync(dir, { recursive: true });
    // 先注册 download 事件再触发导航（waitForEvent 须先于 goto）
    const downloadPromise = page.waitForEvent("download", { timeout: this.options.timeoutMs });
    downloadPromise.catch(() => undefined); // 防止超时后未消费的 rejection
    await this.withTimeout(async () => {
      await page.goto(target, { waitUntil: "load", timeout: this.options.timeoutMs });
    }, "触发下载");
    const download: Download = await this.withTimeout(async () => downloadPromise, "等待下载");
    const rawName = download.suggestedFilename() || `download-${Date.now()}`;
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_"); // 清洗路径分隔符，防目录穿越
    const dest = path.join(dir, safeName);
    await this.withTimeout(async () => {
      await download.saveAs(dest);
    }, "保存文件");
    return `已下载到 ${dest}`;
  }

  /** 保存登录态（storageState）到 state 路径 */
  async saveLoginState(): Promise<string> {
    await this.ensureLaunched();
    const statePath = this.options.storageStatePath;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await this.withTimeout(async () => {
      await this.context!.storageState({ path: statePath });
    }, "保存登录态");
    return statePath;
  }

  /** 状态汇总：连接状态 / 当前 URL / state 文件存在性 */
  async status(): Promise<string> {
    const statePath = this.options.storageStatePath;
    const lines = [
      this.browser
        ? `浏览器: 已启动（headless: ${this.options.headless}）`
        : "浏览器: 未启动（懒启动，首次调用工具时启动）",
      this.currentUrl ? `当前 URL: ${this.currentUrl}` : "当前 URL: （未访问）",
      fs.existsSync(statePath)
        ? `登录态文件: 存在（${statePath}）`
        : `登录态文件: 不存在（${statePath}）`,
      this.playwrightError ? `playwright 状态: 不可用 — ${this.playwrightError}` : "playwright 状态: 可用",
    ];
    return lines.join("\n");
  }

  /** 关闭：先保存登录态（尽力而为），再关闭浏览器并清空引用 */
  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.saveLoginState();
      } catch (err: any) {
        log.warn("close 时保存登录态失败: %s", err?.message ?? err);
      }
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err: any) {
        log.warn("关闭浏览器失败: %s", err?.message ?? err);
      }
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

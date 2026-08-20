/**
 * BrowserEngine 单元测试 — vi.mock("playwright")，全程不触碰真实浏览器
 *
 * 覆盖: URL 校验 / lazy launch / storageState 加载与保存 / 文本提取与截断 /
 *       截图路径 / 搜索 URL 构造 / 下载（事件顺序 + 文件名清洗）/ 超时防护 /
 *       close 清理 / status / playwright 缺失降级
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BrowserEngine, PLAYWRIGHT_MISSING_HINT, TEXT_TRUNCATE_LIMIT } from "./browser-engine.js";

// ---- playwright mock（vi.hoisted 保证工厂内可引用） ----
const mocks = vi.hoisted(() => {
  const locatorFirst = { waitFor: vi.fn(), innerText: vi.fn() };
  const locatorRoot = { first: vi.fn(() => locatorFirst), innerText: vi.fn() };
  return {
    launch: vi.fn(),
    newContext: vi.fn(),
    newPage: vi.fn(),
    browserClose: vi.fn(),
    contextClose: vi.fn(),
    goto: vi.fn(),
    title: vi.fn(),
    url: vi.fn(),
    locator: vi.fn(() => locatorRoot),
    locatorFirst,
    locatorRoot,
    click: vi.fn(),
    fill: vi.fn(),
    screenshot: vi.fn(),
    waitForEvent: vi.fn(),
    waitForLoadState: vi.fn(),
    storageState: vi.fn(),
    suggestedFilename: vi.fn(),
    saveAs: vi.fn(),
  };
});

vi.mock("playwright", () => ({
  chromium: { launch: mocks.launch },
}));

/** 安装完整的 fake 浏览器对象链（browser → context → page → download） */
function installBrowser(): void {
  const download = { suggestedFilename: mocks.suggestedFilename, saveAs: mocks.saveAs };
  const page = {
    goto: mocks.goto,
    title: mocks.title,
    url: mocks.url,
    locator: mocks.locator,
    click: mocks.click,
    fill: mocks.fill,
    screenshot: mocks.screenshot,
    waitForEvent: mocks.waitForEvent,
    waitForLoadState: mocks.waitForLoadState,
  };
  const context = { newPage: mocks.newPage, storageState: mocks.storageState, close: mocks.contextClose };
  const browser = { newContext: mocks.newContext, close: mocks.browserClose };
  mocks.newPage.mockReturnValue(page);
  mocks.newContext.mockReturnValue(context);
  mocks.launch.mockResolvedValue(browser);
  mocks.waitForEvent.mockResolvedValue(download);
}

/** 常用默认 resolve 值 */
function installDefaults(): void {
  installBrowser();
  mocks.goto.mockResolvedValue(undefined as never);
  mocks.title.mockResolvedValue("示例页" as never);
  mocks.url.mockReturnValue("https://example.com/page" as never);
  mocks.locatorFirst.waitFor.mockResolvedValue(undefined as never);
  mocks.locatorFirst.innerText.mockResolvedValue("正文内容" as never);
  mocks.locatorRoot.innerText.mockResolvedValue("整页文本" as never);
  mocks.click.mockResolvedValue(undefined as never);
  mocks.fill.mockResolvedValue(undefined as never);
  mocks.screenshot.mockResolvedValue(undefined as never);
  mocks.waitForLoadState.mockResolvedValue(undefined as never);
  mocks.storageState.mockResolvedValue(undefined as never);
  mocks.suggestedFilename.mockReturnValue("file.pdf");
  mocks.saveAs.mockResolvedValue(undefined as never);
}

const STATE_PATH = "data/mcp/browser-state.json";

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  installDefaults();
});

describe("URL 校验（http/https 白名单）", () => {
  it("拒绝 javascript: 协议", async () => {
    const engine = new BrowserEngine();
    await expect(engine.navigate("javascript:alert(1)")).rejects.toThrow("仅允许 http/https");
  });

  it("拒绝 file: 协议", async () => {
    const engine = new BrowserEngine();
    await expect(engine.navigate("file:///etc/passwd")).rejects.toThrow("仅允许 http/https");
  });

  it("拒绝 data: 协议", async () => {
    const engine = new BrowserEngine();
    await expect(engine.navigate("data:text/html,<b>x</b>")).rejects.toThrow("仅允许 http/https");
  });

  it("拒绝非法 URL（非完整 URL）", async () => {
    const engine = new BrowserEngine();
    await expect(engine.navigate("not a url")).rejects.toThrow("无效");
  });

  it("下载同样受 URL 校验约束", async () => {
    const engine = new BrowserEngine();
    await expect(engine.download("file:///C:/secret.txt")).rejects.toThrow("仅允许 http/https");
  });
});

describe("lazy launch + storageState 加载", () => {
  it("构造后不启动浏览器，首次工具调用才 launch", async () => {
    const engine = new BrowserEngine();
    expect(mocks.launch).not.toHaveBeenCalled();
    await engine.status(); // status 不触发 launch
    expect(mocks.launch).not.toHaveBeenCalled();
    await engine.navigate("https://example.com");
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch).toHaveBeenCalledWith({ headless: true });
  });

  it("headless 可配", async () => {
    const engine = new BrowserEngine({ headless: false });
    await engine.navigate("https://example.com");
    expect(mocks.launch).toHaveBeenCalledWith({ headless: false });
  });

  it("state 文件存在时 context 加载 storageState", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p === STATE_PATH);
    const engine = new BrowserEngine({ storageStatePath: STATE_PATH });
    await engine.navigate("https://example.com");
    expect(mocks.newContext).toHaveBeenCalledWith({ storageState: STATE_PATH });
  });

  it("state 文件不存在时 context 不加载 storageState", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const engine = new BrowserEngine({ storageStatePath: STATE_PATH });
    await engine.navigate("https://example.com");
    expect(mocks.newContext).toHaveBeenCalledWith({});
  });
});

describe("navigate / getText", () => {
  it("navigate 返回最终 URL + 标题", async () => {
    mocks.url.mockReturnValue("https://example.com/redirected");
    mocks.title.mockResolvedValue("标题 A" as never);
    const engine = new BrowserEngine();
    const result = await engine.navigate("https://example.com");
    // assertHttpUrl 规范化 URL（补尾部斜杠）
    expect(mocks.goto).toHaveBeenCalledWith("https://example.com/", expect.objectContaining({ waitUntil: "domcontentloaded" }));
    expect(result).toContain("https://example.com/redirected");
    expect(result).toContain("标题 A");
  });

  it("getText 无 selector 时取 body 文本", async () => {
    const engine = new BrowserEngine();
    const text = await engine.getText();
    expect(mocks.locator).toHaveBeenCalledWith("body");
    expect(text).toBe("整页文本");
  });

  it("getText 有 selector 时先 waitFor 再取文本", async () => {
    const engine = new BrowserEngine();
    const text = await engine.getText("#main");
    expect(mocks.locator).toHaveBeenCalledWith("#main");
    expect(mocks.locatorFirst.waitFor).toHaveBeenCalled();
    expect(text).toBe("正文内容");
  });

  it("getText 超 8000 字符时截断", async () => {
    const longText = "x".repeat(TEXT_TRUNCATE_LIMIT + 500);
    mocks.locatorRoot.innerText.mockResolvedValue(longText as never);
    const engine = new BrowserEngine();
    const text = await engine.getText();
    expect(text.startsWith("x".repeat(TEXT_TRUNCATE_LIMIT))).toBe(true);
    expect(text).toContain("已截断");
  });
});

describe("screenshot / search / click / fill", () => {
  it("screenshot 默认保存到 data/mcp/screenshots/ 并建目录", async () => {
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as never);
    const engine = new BrowserEngine();
    const saved = await engine.screenshot();
    expect(saved.startsWith(path.join("data", "mcp", "screenshots", "screenshot-"))).toBe(true);
    expect(saved.endsWith(".png")).toBe(true);
    expect(mkdirSpy).toHaveBeenCalled();
    expect(mocks.screenshot).toHaveBeenCalledWith(expect.objectContaining({ path: saved }));
  });

  it("screenshot 支持指定路径", async () => {
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as never);
    const engine = new BrowserEngine();
    const saved = await engine.screenshot("./out/page.png");
    expect(saved).toBe("./out/page.png");
    expect(mocks.screenshot).toHaveBeenCalledWith(expect.objectContaining({ path: "./out/page.png" }));
  });

  it("search 默认 bing，URL 带 encodeURIComponent 编码", async () => {
    const engine = new BrowserEngine();
    const result = await engine.search("hello world");
    expect(mocks.goto).toHaveBeenCalledWith(
      "https://www.bing.com/search?q=hello%20world",
      expect.anything(),
    );
    expect(result).toContain("搜索结果（bing）");
  });

  it("search 支持 baidu 并编码中文", async () => {
    const engine = new BrowserEngine();
    await engine.search("南京", "baidu");
    expect(mocks.goto).toHaveBeenCalledWith(
      "https://www.baidu.com/s?wd=%E5%8D%97%E4%BA%AC",
      expect.anything(),
    );
  });

  it("search 拒绝空关键词", async () => {
    const engine = new BrowserEngine();
    await expect(engine.search("   ")).rejects.toThrow("搜索关键词不能为空");
  });

  it("click 转发并等待页面稳定", async () => {
    const engine = new BrowserEngine();
    const result = await engine.click("#submit");
    expect(mocks.click).toHaveBeenCalledWith("#submit", expect.anything());
    expect(mocks.waitForLoadState).toHaveBeenCalled();
    expect(result).toContain("已点击 #submit");
  });

  it("fill 转发 selector + value", async () => {
    const engine = new BrowserEngine();
    const result = await engine.fill("#username", "alice");
    expect(mocks.fill).toHaveBeenCalledWith("#username", "alice", expect.anything());
    expect(result).toContain("#username");
  });
});

describe("download", () => {
  it("waitForEvent 在 goto 之前注册，saveAs 到清洗后的文件名", async () => {
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as never);
    mocks.suggestedFilename.mockReturnValue("my report?.pdf");
    const engine = new BrowserEngine();
    const result = await engine.download("https://example.com/file.pdf");
    // 事件注册先于导航
    expect(mocks.waitForEvent.mock.invocationCallOrder[0]).toBeLessThan(mocks.goto.mock.invocationCallOrder[0]);
    expect(mocks.saveAs).toHaveBeenCalledWith(path.join("data", "mcp", "downloads", "my report_.pdf"));
    expect(result).toContain("my report_.pdf");
  });

  it("支持指定 dest_dir", async () => {
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as never);
    const engine = new BrowserEngine();
    await engine.download("https://example.com/a.pdf", "./out");
    expect(mocks.saveAs).toHaveBeenCalledWith(path.join(".", "out", "file.pdf"));
  });
});

describe("saveLoginState / status / close", () => {
  it("saveLoginState 保存 storageState 到 state 路径并建目录", async () => {
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as never);
    const engine = new BrowserEngine({ storageStatePath: STATE_PATH });
    const saved = await engine.saveLoginState();
    expect(saved).toBe(STATE_PATH);
    expect(mocks.storageState).toHaveBeenCalledWith({ path: STATE_PATH });
  });

  it("status 反映连接状态与登录态文件存在性", async () => {
    // 测试隔离：mock existsSync 按场景控制，不依赖真实 data/mcp/ 状态
    const existsSpy = vi.spyOn(fs, "existsSync");
    existsSpy.mockReturnValue(false);
    const engine = new BrowserEngine({ storageStatePath: STATE_PATH });
    const before = await engine.status();
    expect(before).toContain("未启动");
    expect(before).toContain("不存在");
    await engine.navigate("https://example.com");
    existsSpy.mockReturnValue(true);
    const after = await engine.status();
    expect(after).toContain("已启动");
    expect(after).toContain("存在");
    expect(after).toContain("https://example.com/page");
  });

  it("close 先保存登录态再关闭浏览器，并清空引用", async () => {
    const engine = new BrowserEngine({ storageStatePath: STATE_PATH });
    await engine.navigate("https://example.com");
    await engine.close();
    expect(mocks.storageState).toHaveBeenCalledWith({ path: STATE_PATH });
    // Playwright 中 browser.close() 会关闭全部 context，无需单独关 context
    expect(mocks.browserClose).toHaveBeenCalled();
    const status = await engine.status();
    expect(status).toContain("未启动");
  });

  it("close 在未启动时是幂等空操作", async () => {
    const engine = new BrowserEngine();
    await engine.close();
    expect(mocks.browserClose).not.toHaveBeenCalled();
  });
});

describe("超时防护", () => {
  it("操作超时（goto 永不返回）时拒绝而非无限等待", async () => {
    mocks.goto.mockImplementation(() => new Promise(() => undefined));
    const engine = new BrowserEngine({ timeoutMs: 100 });
    await expect(engine.navigate("https://example.com")).rejects.toThrow("超时");
  });
});

describe("playwright 缺失降级（import 失败）", () => {
  it("import playwright 抛错时抛出明确安装提示", async () => {
    vi.doMock("playwright", () => {
      throw new Error("Cannot find module 'playwright'");
    });
    // 动态 import 引擎模块，确保拿到新的 mock 注册
    const { BrowserEngine: ReloadedEngine } = await import("./browser-engine.js");
    const engine = new ReloadedEngine();
    await expect(engine.navigate("https://example.com")).rejects.toThrow("playwright 未安装");
    expect(PLAYWRIGHT_MISSING_HINT).toContain("pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium");
  });
});

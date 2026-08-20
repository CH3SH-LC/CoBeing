# 接口声明 — task-browser-mcp
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-12T21:30:00+08:00

## 我将创建/修改的文件

- [x] `packages/mcp-servers/browser/src/mcp-server.ts` — 复制 claude-code 的 MCPServer（JSON-RPC over stdio，含 instructions 支持），仅调整头部注释
- [x] `packages/mcp-servers/browser/src/browser-engine.ts` — BrowserEngine class：Playwright chromium 封装（lazy launch / storageState 持久化 / URL 校验 / 超时防护 / playwright 缺失降级）
- [x] `packages/mcp-servers/browser/src/tools.ts` — makeTools(engine)，9 个工具 + INSTRUCTIONS 登录态信任边界说明
- [x] `packages/mcp-servers/browser/src/index.ts` — 入口：读 env + 构造 engine + MCPServer + stdioLogger 重定向纪律 + 导出并执行 main
- [x] `packages/mcp-servers/browser/src/browser-engine.test.ts` — TDD 单测（vi.mock("playwright")）
- [x] `packages/mcp-servers/browser/src/tools.test.ts` — TDD 单测（mock engine）
- [x] `packages/mcp-servers/browser/package.json` — **修改**：新增 `"test": "vitest run"` script（验证标准要求 `pnpm --filter @cobeing/browser-mcp-server test` 通过，骨架缺此 script；属本包内配置，非其他模块）
- [x] `packages/mcp-servers/browser/vitest.config.ts` — 包级 vitest 配置（`test.include: ["src/**/*.test.ts"]`）。实测 vitest 从包目录运行时 root=cwd，上层根配置的 include 模式相对仓库根导致「No test files found」，故需包内配置使 `pnpm --filter X test` 独立可跑（根 `pnpm test` 仍由根配置覆盖，双配置下测试均全绿）
- [x] `.task-manifest/outputs/browser-config.json` — 配置片段 `{ mcpServers: { browser: { transport: "stdio", command: "node", args: ["packages/mcp-servers/browser/dist/index.js"], env: {} } } }`

## 我将暴露的接口

| 名称 | 签名 | 所在文件 |
|------|------|----------|
| BrowserEngine | `class BrowserEngine`（构造 options: `{ headless?: boolean; storageStatePath?: string; timeoutMs?: number; }`，默认 headless=true / state=`data/mcp/browser-state.json` / timeout=30000） | browser-engine.ts |
| BrowserEngine.navigate | `async navigate(url: string): Promise<string>` — 校验 http/https；返回 `最终URL\n标题: ...` | browser-engine.ts |
| BrowserEngine.getText | `async getText(selector?: string): Promise<string>` — body 或指定选择器文本，截断 8000 字符 | browser-engine.ts |
| BrowserEngine.screenshot | `async screenshot(savePath?: string): Promise<string>` — 默认 `data/mcp/screenshots/<ts>.png`，目录自动 mkdir -p | browser-engine.ts |
| BrowserEngine.search | `async search(query: string, engine?: "bing" \| "baidu"): Promise<string>` — 默认 bing，返回结果文本 | browser-engine.ts |
| BrowserEngine.click | `async click(selector: string): Promise<string>` | browser-engine.ts |
| BrowserEngine.fill | `async fill(selector: string, value: string): Promise<string>` | browser-engine.ts |
| BrowserEngine.download | `async download(url: string, destDir?: string): Promise<string>` — 默认 `data/mcp/downloads/`，URL 校验 http/https，文件名清洗防路径穿越 | browser-engine.ts |
| BrowserEngine.saveLoginState | `async saveLoginState(): Promise<string>` — storageState 写 state 路径 | browser-engine.ts |
| BrowserEngine.status | `async status(): Promise<string>` — 连接状态/当前 URL/state 文件存在性 | browser-engine.ts |
| BrowserEngine.close | `async close(): Promise<void>` — 保存 storageState（尽力）后关闭 browser/context，置空引用 | browser-engine.ts |
| makeTools | `function makeTools(engine: BrowserEngine): Tool[]` — 9 工具：browser_navigate / browser_get_text / browser_screenshot / browser_search / browser_click / browser_fill / browser_download / browser_save_login_state / browser_status | tools.ts |
| main | `async function main(): Promise<void>` — 读 env（BROWSER_HEADLESS 默认 true、BROWSER_STORAGE_STATE 默认 data/mcp/browser-state.json、BROWSER_TIMEOUT_MS 默认 30000），构造 BrowserEngine + makeTools + MCPServer，run；模块底部同时直接调用 main() | index.ts |
| MCPServer | `class MCPServer`（复制 claude-code 实现：initialize 返回 instructions、tools/list、tools/call、ping、错误码 -32601/-32602/-32603） | mcp-server.ts |

## 我需要的外部输入

| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/mcp-servers/claude-code/src/mcp-server.ts | MCPServer 模板（Tool/ServerConfig 接口、handleInitialize instructions 支持、stdio 行协议） | 复制为 browser 包 mcp-server.ts |
| packages/mcp-servers/claude-code/src/index.ts | 入口模式 + stdioLogger 重定向纪律（console.log → stderr，幂等标记） | index.ts 采用同纪律 |
| packages/mcp-servers/claude-code/src/tools.ts | Tool 接口 { name, description?, inputSchema, execute } | tools.ts 风格 |
| packages/mcp-servers/office/src/tools.ts | 沙箱/降级风格（依赖不可用时返回明确错误而非崩溃） | playwright 缺失时工具返回明确提示 |
| packages/mcp-servers/browser/package.json | 骨架（@cobeing/shared + playwright ^1.62.1，type: module，build: tsc） | 包脚本基础；需补 test script |
| packages/mcp-servers/browser/tsconfig.json | 骨架（ES2022 / bundler / strict / exclude *.test.ts） | 构建配置（不改） |
| @cobeing/shared | createLogger | 日志 |

## 风险和假设

- 假设 1：`browser/package.json` 需补 `"test": "vitest run"` script 才能满足验证标准 `pnpm --filter @cobeing/browser-mcp-server test`（骨架无 test script）。这是本包内必要配置变更，不属于「其他模块」，已在文件清单中声明。
- 假设 2：playwright 1.62.1 已装（`packages/mcp-servers/browser/node_modules` 确认存在），tsc 构建可用其类型；chromium 二进制未装不影响单测（全程 mock），真实验证由主线程阶段 4 执行。
- 假设 3：engine 用动态 `await import("playwright")` 并捕获失败——import 失败时抛「playwright 未安装，请运行 pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium」，tools 层转成 isError 内容，不崩溃。
- 假设 4：storageState 默认路径 `data/mcp/browser-state.json` 相对 cwd（server 由 config 的 args 从项目根启动）；data/ 已 gitignored（.gitignore 第 3 行 `data/`）。
- 风险：vi.mock("playwright") 需拦截 engine 内的动态 import——vitest 对 CJS 模块的静态/动态 import mock 均生效，若拦截失效测试将尝试加载真实 playwright（本地已装，不会崩溃但会改变断言行为），自检时验证。
- 范围：不修改 config/default.json、不修改 core、不修改其他 mcp-servers 包。真实验证（启动真实 chromium）不在本任务范围。

# 自检报告 — task-browser-mcp
> 自检时间: 2026-08-12T21:35:00+08:00

## 文件存在性
- [x] `packages/mcp-servers/browser/src/mcp-server.ts` — 存在且非空（107 行，与 claude-code 模板同构）
- [x] `packages/mcp-servers/browser/src/browser-engine.ts` — 存在且非空（约 340 行）
- [x] `packages/mcp-servers/browser/src/tools.ts` — 存在且非空（9 工具 + INSTRUCTIONS）
- [x] `packages/mcp-servers/browser/src/index.ts` — 存在且非空（导出 main + 底部调用 + stdioLogger 纪律）
- [x] `packages/mcp-servers/browser/src/browser-engine.test.ts` — 存在且非空（28 个测试）
- [x] `packages/mcp-servers/browser/src/tools.test.ts` — 存在且非空（23 个测试）
- [x] `packages/mcp-servers/browser/package.json` — 已加 `"test": "vitest run"` script
- [x] `packages/mcp-servers/browser/vitest.config.ts` — 包级测试配置
- [x] `.task-manifest/outputs/browser-config.json` — 存在且 JSON 合法（node -e require 验证通过）

## 接口签名匹配（与 interface-declaration.md 对比）
- [x] `BrowserEngine` — `class BrowserEngine`，构造 `{ headless?, storageStatePath?, timeoutMs? }` 默认 headless=true / data/mcp/browser-state.json / 30000 — 实际一致
- [x] `navigate(url: string): Promise<string>` — 一致（返回 `URL: ...\n标题: ...`）
- [x] `getText(selector?: string): Promise<string>` — 一致（body/选择器 + 8000 截断）
- [x] `screenshot(savePath?: string): Promise<string>` — 一致（默认 data/mcp/screenshots/<ts>.png）
- [x] `search(query: string, engine?: "bing" | "baidu"): Promise<string>` — 一致（默认 bing）
- [x] `click(selector: string): Promise<string>` / `fill(selector, value): Promise<string>` — 一致
- [x] `download(url: string, destDir?: string): Promise<string>` — 一致（默认 data/mcp/downloads/，文件名清洗）
- [x] `saveLoginState(): Promise<string>` / `status(): Promise<string>` / `close(): Promise<void>` — 一致
- [x] `makeTools(engine: BrowserEngine): Tool[]` — 9 工具名精确匹配（tools.test.ts 断言 9 个且名字全对）
- [x] `main()` — 读 BROWSER_HEADLESS/BROWSER_STORAGE_STATE/BROWSER_TIMEOUT_MS，构造 engine+tools+MCPServer，run — 一致
- [x] `MCPServer` — 复制 claude-code（instructions 支持、stdioLogger 纪律、错误码 -32601/-32602/-32603）— 冒烟实测 initialize 返回 instructions

## 功能完整性
- [x] URL 校验：navigate/download 拒绝 javascript:/file:/data:/非法 URL（engine 测试 5 断言 + 冒烟实测）
- [x] lazy launch：构造不启动，首次工具调用才 launch；headless 可配（测试覆盖）
- [x] storageState 持久化：launch 加载（存在时）/ saveLoginState / close 时保存（测试覆盖 + 冒烟实测重启用登录态成功）
- [x] 超时防护：goto 永不返回时 100ms 后拒绝「超时」（测试覆盖）
- [x] playwright 缺失降级：import 失败抛「playwright 未安装 + pnpm exec playwright install chromium」；tools 层映射为 isError 内容（测试覆盖）
- [x] 搜索：bing/baidu URL 构造 + 中文 encodeURIComponent（测试覆盖）
- [x] 下载：waitForEvent 先于 goto 注册、文件名清洗防路径穿越、dest_dir 可配（测试覆盖）
- [x] 登录态信任边界：BROWSER_INSTRUCTIONS 含「storageState 存本机 data/mcp/（gitignored）/ 仅用户授权站点 / 敏感操作回用户确认」（测试覆盖 + 冒烟实测 424 字符随 initialize 返回）
- [x] 工具参数校验：缺 url/selector/value/query、非法 engine 均返回 isError 且不转发（tools.test.ts 覆盖）

## 接口自洽
- [x] 所有导出的函数/类型在同一个模块内有定义（tsc strict 构建通过 = 无悬空引用）
- [x] 没有引用不存在的模块/文件 → 对每个相对 import 用文件存在性脚本验证：8/8 OK（.js 后缀 → .ts 源文件全部命中）
- [x] 没有孤立的导出 → makeTools/BrowserEngine/PLAYWRIGHT_MISSING_HINT/TEXT_TRUNCATE_LIMIT/BROWSER_INSTRUCTIONS 均被 index.ts/tools.ts/测试引用（grep 验证）
- [x] @cobeing/shared 外部依赖可解析（dist 已构建；包内 node_modules 链接存在；测试与构建均通过）

## 错误处理
- [x] 非法协议 URL → 明确报错（含协议白名单说明）
- [x] playwright 未安装 → 明确安装指引（不崩溃，isError 内容）
- [x] 操作超时 → 「XX超时（Nms）」拒绝
- [x] 引擎异常 → tools 层统一包装 `错误: <msg>` isError
- [x] close 保存登录态失败 → 仅告警不阻断关闭（log.warn）
- [x] download 超时后未消费的 waitForEvent promise → 挂 .catch 防 unhandled rejection

## 验证命令结果（实测）
- [x] `pnpm --filter @cobeing/browser-mcp-server test` → Test Files 2 passed, Tests 51 passed
- [x] `pnpm --filter @cobeing/browser-mcp-server build` → tsc 通过，dist 产物 12 个文件（含 .d.ts）
- [x] 根配置下 `npx vitest run packages/mcp-servers/browser` → 51 passed（根 pnpm test 不受影响）
- [x] stdio 冒烟：initialize(instructions=424chars) / tools/list(9 工具) / browser_status 正常，stdout 纯净
- [x] 真实浏览器冒烟（chromium 151.0.7922.34 已就绪）：navigate/getText/fill/click/screenshot/saveLoginState/重启复用登录态/URL 校验 全部通过；冒烟产物已清理

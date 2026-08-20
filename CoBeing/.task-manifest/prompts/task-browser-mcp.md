# 子任务：task-browser-mcp

## 任务描述
实现 CoBeing 浏览器 MCP server 包（packages/mcp-servers/browser/）：Playwright 驱动浏览器自动化，能力含导航/搜索/提取文本/截图/点击/填表单/下载/登录态持久化（storageState）。骨架（package.json/tsconfig.json）已建好，playwright 依赖与 chromium 由主线程后台安装中。

## 依赖关系
- 依赖的任务：无（第 0 批）
- 本任务产出被以下任务依赖：集成（主线程）

## 输入文件
| 文件 | 章节/位置 | 描述 |
|------|-----------|------|
| packages/mcp-servers/claude-code/src/mcp-server.ts | MCPServer 模板 | 带 instructions 支持的 MCPServer，直接复用（含 stdioLogger 重定向纪律） |
| packages/mcp-servers/claude-code/src/index.ts | 入口模式 | 读 env + makeTools + server.run() |
| packages/mcp-servers/claude-code/src/tools.ts | 工具风格 | Tool 接口 { name, description, inputSchema, execute } |
| packages/mcp-servers/browser/package.json | 骨架（已建） | playwright 依赖已加入 |
| packages/mcp-servers/browser/tsconfig.json | 骨架（已建） | 与 claude-code 一致 |
| packages/mcp-servers/office/src/tools.ts | 沙箱降级风格 | OFFICE_SANDBOX 式降级可参考（playwright 不可用时降级提示） |

## 输出接口
| 文件 | 导出 | 签名/说明 |
|------|------|-----------|
| packages/mcp-servers/browser/src/mcp-server.ts | MCPServer | 复制 claude-code 的 MCPServer（含 instructions 支持与 stdioLogger 纪律） |
| packages/mcp-servers/browser/src/index.ts | main | 入口：读 env（BROWSER_HEADLESS 默认 true、BROWSER_STORAGE_STATE 默认 data/mcp/browser-state.json、BROWSER_TIMEOUT_MS 默认 30000），构造 BrowserEngine + tools，run MCPServer；INSTRUCTIONS 说明登录态信任边界 |
| packages/mcp-servers/browser/src/browser-engine.ts | BrowserEngine | class BrowserEngine — Playwright chromium 封装 |
| packages/mcp-servers/browser/src/tools.ts | makeTools | function makeTools(engine: BrowserEngine): Tool[] |
| .task-manifest/outputs/browser-config.json | 配置片段 | { "mcpServers": { "browser": { "transport": "stdio", "command": "node", "args": ["packages/mcp-servers/browser/dist/index.js"], "env": {} } } } |
| packages/mcp-servers/browser/src/browser-engine.test.ts | TDD 单测 | mock playwright，不依赖真实浏览器 |
| packages/mcp-servers/browser/src/tools.test.ts | TDD 单测 | mock engine 验证参数校验与转发 |

## BrowserEngine 设计要求
```typescript
class BrowserEngine {
  // lazy launch：首次调用工具时启动；headless 可配（env BROWSER_HEADLESS）
  // storageState 持久化：launch 时若 state 文件存在则 context 加载；close()/saveLoginState() 时保存
  async navigate(url: string): Promise<string>           // 返回最终 URL + title
  async getText(selector?: string): Promise<string>      // body 文本或指定选择器文本（截断 8000 字符）
  async screenshot(savePath?: string): Promise<string>   // 截图保存路径，默认 data/mcp/screenshots/<ts>.png
  async search(query: string, engine?: "bing" | "baidu"): Promise<string>  // 打开搜索引擎搜索，返回结果文本
  async click(selector: string): Promise<string>
  async fill(selector: string, value: string): Promise<string>
  async download(url: string, destDir?: string): Promise<string>  // 下载文件到 data/mcp/downloads/（默认）
  async saveLoginState(): Promise<string>                // 保存 storageState 到 state 路径
  async status(): Promise<string>                        // 连接状态、当前 URL、state 文件存在性
  async close(): Promise<void>
}
```
要点：
- **URL 校验**：仅允许 http/https 协议（拒绝 javascript:/file: 等），navigate/download 都要校验
- **超时防护**：每次操作超时（env BROWSER_TIMEOUT_MS，默认 30000），拒绝无限等待
- **playwright 不可用**（import 失败）：所有工具返回明确错误提示「playwright 未安装，请运行 pnpm --filter @cobeing/browser-mcp-server exec playwright install chromium」而非崩溃
- **登录态安全边界**：storageState 存本机 data/mcp/（gitignored），INSTRUCTIONS 明确「Agent 复用的是用户已登录会话，仅限用户授权的站点操作；敏感操作（支付/删除/发布）应回到用户确认」
- 截图/下载目录需 mkdir -p

## 工具列表（makeTools）
browser_navigate / browser_get_text / browser_screenshot / browser_search / browser_click / browser_fill / browser_download / browser_save_login_state / browser_status

## 验证标准
- [ ] 4 个 src 文件 + 2 个测试文件已写
- [ ] .task-manifest/outputs/browser-config.json 已写
- [ ] 测试全绿：`pnpm --filter @cobeing/browser-mcp-server test`（vi.mock("playwright")，不碰真实浏览器）
- [ ] 构建通过：`pnpm --filter @cobeing/browser-mcp-server build`
- [ ] 真实验证不做（主线程阶段 4 执行）；但若 chromium 已就绪可额外冒烟（不阻塞交付）

## 工作协议
请遵循「myworkflow:subagent-protocol」的 5 阶段工作规范：
1. 读取合约 + 确认输入：读取 `.task-manifest/task-contract-realwork.yaml` 中你的条目和所有输入文件
2. 声明接口：先写 interface-declaration.md 承诺你的接口——声明先于实现
3. 产出实现：按声明逐项编码，每完成一个文件在声明中勾选
4. 自检：写 self-check.md，逐项核对，全部打勾才能进入下一步
5. 完成报告：写 completion.md，列出产出文件和自检结果

## 约束
- 只创建本任务指定的输出文件，不修改其他模块（含 config/default.json）
- 测试必须 mock playwright（vi.mock("playwright")），严禁在单测中启动真实浏览器
- src 文件导入一律用相对路径 + .js 后缀（ESM 编译产物），与现有 mcp-servers 包一致
- 文件路径必须精确匹配

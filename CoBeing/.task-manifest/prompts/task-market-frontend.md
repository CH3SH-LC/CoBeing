# 子任务：task-market-frontend

## 任务描述
实现 CoBeing 前端 Market Tab：Market 类型定义、zustand store（资源列表/过滤/详情/安装状态机）、WS 消息 handler、MarketTab 组件（分层过滤 + 资源卡片 + 详情浮层含依赖树 + 社区安装确认流），并接入「扩展」页。后端 5 个 WS 命令由主线程实现，你按下方 WS 协议对接即可（协议已冻结，不要自行增改）。

## 依赖关系
- 依赖的任务：无（第 0 批，与后端并行）
- 本任务产出被以下任务依赖：主线程冒烟验证（将用真实后端打通你的前端链路）

## 输入文件
| 文件 | 章节/位置 | 描述 |
|------|----------|------|
| gui-v2/src/lib/types.ts | 全文件 | 追加 Market 类型；ExtensionsTab 增加 "market" |
| gui-v2/src/stores/agentEnhancement.ts | 全文件 | zustand store + getWsClient().send 的既有写法 |
| gui-v2/src/hooks/useWebSocket.ts | 全文件 | 消息 handler 注册表（将 market handlers 并入） |
| gui-v2/src/hooks/ws-handlers/extension-handlers.ts | 全文件 | buildXxxHandlers(ctx) 模式 |
| gui-v2/src/hooks/ws-handlers/types.ts | 全文件 | WsHandlerContext / WsMessageHandler 类型 |
| gui-v2/src/components/extensions/ExtensionsView.tsx | 全文件 | tab 结构（TABS 数组 + 内容区），增加 Market |
| gui-v2/src/components/extensions/SkillsTab.tsx | 全文件 | 现有 tab UI 写法参考 |
| gui-v2/src/components/layout/Surface.tsx | Sheet/Dialog | 浮层基础设施（Sheet/Dialog 的 props） |
| CoBeing/.claude/skills/frontend-design/user-ui-preferences.md | 全文件（必读） | 层次化渲染/间距/字号/圆角规则 |
| CoBeing/.claude/skills/frontend-design/co-being-ui-terms.md | 全文件（必读） | 「卡片」「浮层」等术语 |
| CoBeing/.claude/skills/frontend-design/co-being-ui-design-preferences.md | 全文件（必读） | 三层主体结构/糖果色层次/浮层规则 |

## WS 协议（冻结，与后端一致）
```
发: market_list      {type?: "agent"|"group"|"skill", tier?: "official"|"certified"|"community"|"local", query?: string}
收: market_list      {resources: MarketResourceView[], installed: InstalledEntry[]}
发: market_get       {id: string}
收: market_get       {resource: MarketResourceView, dependencyTree: MarketDepNode}
发: market_install   {id: string, confirmed?: boolean}
收: market_install   {status: "installed"|"approval_required"|"already_installed"|"error", id, type, name, message?, installedIds: string[], dependencyTree: MarketDepNode, warning?}
发: market_uninstall {id: string}
收: market_uninstall {id: string, removedIds: string[], message?}
发: market_installed （无 payload）
收: market_installed {installed: InstalledEntry[]}
```

## 输出接口（与 task-contract.yaml 完全一致）

### gui-v2/src/lib/types.ts（修改：追加）
```ts
export type MarketResourceType = "agent" | "group" | "skill";
export type MarketTier = "official" | "certified" | "community" | "local";
export type MarketRiskLevel = "low" | "medium" | "high";
export interface MarketDependency { type: MarketResourceType; id: string; version?: string }
export interface MarketResourceView {
  id: string; type: MarketResourceType; name: string; description: string; version: string;
  tier: MarketTier; author: string; icon?: string; tags: string[]; riskLevel: MarketRiskLevel;
  permissions: string[]; dependencies: MarketDependency[]; installed: boolean;
}
export interface MarketDepNode {
  id: string; type: MarketResourceType; name: string; tier: MarketTier;
  riskLevel: MarketRiskLevel; required: boolean; children: MarketDepNode[];
}
export interface MarketInstallResult {
  status: "installed" | "approval_required" | "already_installed" | "error";
  id: string; type: MarketResourceType; name: string; message?: string;
  installedIds: string[]; dependencyTree: MarketDepNode; warning?: string;
}
export interface InstalledEntry {
  id: string; type: MarketResourceType; name: string;
  installedAt: string; sourceId: string; installedIds: string[];
}
```
另将 `ExtensionsTab` 联合类型增加 `"market"`（找到现有定义处修改）。

### gui-v2/src/stores/market.ts
```ts
export const useMarketStore: UseBoundStore<StoreApi<{
  resources: MarketResourceView[];
  installed: Record<string, InstalledEntry>;
  filters: { type: MarketResourceType | "all"; tier: MarketTier | "all"; query: string };
  detail: { resource: MarketResourceView; tree: MarketDepNode } | null;
  installState: "idle" | "installing" | "approval_required" | "installed" | "error";
  pendingInstall: { id: string; name: string; tree: MarketDepNode } | null;
  lastError: string | null;
  load(): void;
  setTypeFilter(type: MarketResourceType | "all"): void;
  setTierFilter(tier: MarketTier | "all"): void;
  setQuery(query: string): void;
  openDetail(id: string): void;
  closeDetail(): void;
  requestInstall(id: string): void;
  confirmInstall(): void;
  uninstall(id: string): void;
}>>;
```
行为约定：
- `load()`：发 `market_list`（带当前 filters）。`setTypeFilter/setTierFilter/setQuery` 更新后自动重新 load（query 可立即重载，不做防抖也可）。
- `openDetail(id)`：发 `market_get {id}`；收到后写入 detail。
- `requestInstall(id)`：发 `market_install {id}`（不带 confirmed）；收到 `approval_required` → installState 置 "approval_required"，pendingInstall 存 { id, name, tree }；收到 `installed` → installState "installed"，刷新列表与 installed。
- `confirmInstall()`：对 pendingInstall 发 `market_install {id, confirmed: true}`。
- `uninstall(id)`：发 `market_uninstall {id}`。
- `load()` 也在组件 mount 时调用（useEffect）。
- 发送统一用 `getWsClient()?.send({ type, payload })`（从 `@/hooks/useWebSocket` 导入 getWsClient，与 agentEnhancement.ts 一致）。

### gui-v2/src/hooks/ws-handlers/market-handlers.ts
```ts
export function buildMarketHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  // market_list / market_get / market_install / market_uninstall / market_installed
}
```
- `market_list`：`useMarketStore.getState()` 写入 resources + installed（Record 化）。
- `market_get`：写入 detail。
- `market_install`：按 status 走 store 状态机（approval_required → pendingInstall；installed → 刷新并提示）。
- `market_uninstall`：从 installed 中删除该 id，刷新列表。
- 风格与 extension-handlers.ts 一致。

### gui-v2/src/hooks/useWebSocket.ts（修改）
将 `buildMarketHandlers(ctx)` 并入主 handler 表（找到现有 buildXxxHandlers 展开处）。

### gui-v2/src/components/extensions/MarketTab.tsx
```tsx
export function MarketTab(): JSX.Element;
```
UI 结构（严格遵循 frontend-design 三份规则文件）：
1. **过滤栏**：类型 chips（全部/智能体/群组/技能）+ 信任分级 chips（全部/官方内置/官方认证/社区/本地）+ 搜索输入框。
2. **资源卡片列表**（网格或列表）：每卡显示 name、tier 徽章（official=「官方内置」绿 / certified=「官方认证」蓝 / community=「社区」橙 / local=「本地」灰）、类型图标（agent 👤 / group 👥 / skill 📘）、description（两行截断）、riskLevel 徽章（低/中/高）、tags；操作区：未安装 →「安装」按钮；已安装 →「已安装」标记 +「卸载」；local →「本地资源」禁用态。
3. **详情浮层**（Sheet，参考现有 Sheet 用法）：名称/tier/类型、作者/版本、完整描述、权限列表（permissions 逐条）、**依赖树**（递归缩进渲染 children，每个节点显示类型图标 + tier + 风险）；底部操作：安装 / 确认安装 / 卸载 / 关闭。
4. **社区确认流**：点「安装」发出 market_install（无 confirmed）→ 收到 approval_required → 浮层内显示警告区（「⚠️ 该资源来自社区，未经过官方审核。请确认作者、权限与依赖后安装」+ 依赖树 + 风险）+「确认安装」按钮 → confirmInstall()。官方/认证资源点「安装」直接装。
5. **状态处理**：加载中 spinner/文字、error 展示 lastError、安装中禁用按钮、安装成功后的轻提示（可用现有 toast/提示模式，找不到就内联成功文字）。
6. 视觉：使用主题 token（--color-*/--shadow-surface 等），不要硬编码色值；层级按 user-ui-preferences.md。

### gui-v2/src/components/extensions/ExtensionsView.tsx（修改）
TABS 增加 `{ id: "market", label: "Market", icon: "🛍️" }`（图标自选，中文 label「Market」），内容区渲染 `{activeTab === "market" && <MarketTab />}`。

## 验证标准
- [ ] 所有输出文件存在，导出签名与合约一致
- [ ] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit` 通过
- [ ] `cd D:/agent-codes/CoBeing/gui-v2 && pnpm build`（tsc + vite build）通过
- [ ] `cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src` 全绿（不破坏既有 19 个测试；如修改的组件有测试文件，同步更新）

## 工作协议
请遵循「myworkflow:subagent-protocol」的 5 阶段工作规范：
1. 读取合约 + 确认输入：读取 `.task-manifest/task-contract.yaml` 中你的条目和所有输入文件（必读 frontend-design 三份规则）
2. 声明接口：先写 `.task-manifest/interface-declaration.md` 承诺你的接口——声明先于实现
3. 产出实现：按声明逐项编码，每完成一个文件在声明中勾选
4. 自检：写 `.task-manifest/self-check.md`，逐项核对，全部打勾才能进入下一步
5. 完成报告：写 `.task-manifest/completion.md`，列出产出文件和自检结果

## 约束
- 只创建/修改 `gui-v2/src/` 下的文件，不得碰 `packages/`（后端是另一任务与主线程的范围）。
- 可修改文件清单：lib/types.ts、stores/market.ts（新）、hooks/ws-handlers/market-handlers.ts（新）、hooks/useWebSocket.ts、components/extensions/MarketTab.tsx（新）、components/extensions/ExtensionsView.tsx。不要动其他组件。
- 严格按冻结的 WS 协议实现，不要自行增改消息类型。
- UI 必须读 frontend-design 三份规则文件后设计，不得套用默认模板样式。

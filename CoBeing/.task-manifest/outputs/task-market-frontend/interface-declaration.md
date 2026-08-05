# 接口声明 — task-market-frontend

日期：2026-08-03
状态：已声明（实现前）

## 产出文件与导出接口（与 task-contract.yaml 完全一致）

### 1. gui-v2/src/lib/types.ts（修改：追加）
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
- `ExtensionsTab` 联合类型增加 `"market"`。

### 2. gui-v2/src/stores/market.ts（新）
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
- `load()`：发 `market_list`（带当前 filters）；组件 mount 时由 MarketTab useEffect 调用。
- `setTypeFilter/setTierFilter/setQuery`：更新 filters 后自动重新 load（query 立即重载）。
- `openDetail(id)`：重置 installState/pendingInstall/lastError，发 `market_get {id}`。
- `closeDetail()`：清空 detail 并重置安装状态。
- `requestInstall(id)`：置 installState="installing"、清 lastError，发 `market_install {id}`。
- `confirmInstall()`：对 pendingInstall 发 `market_install {id, confirmed: true}`（无 pendingInstall 时 no-op），置 "installing"。
- `uninstall(id)`：发 `market_uninstall {id}`。
- 发送统一 `getWsClient()?.send({ type, payload })`（来自 `@/hooks/useWebSocket`）。

### 3. gui-v2/src/hooks/ws-handlers/market-handlers.ts（新）
```ts
export function buildMarketHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler>
```
覆盖 5 个消息：market_list / market_get / market_install / market_uninstall / market_installed。
- `market_list`：写 resources + installed（Record 化），并 dispatch `ws-market-list` CustomEvent（供 MarketTab 本地 loaded 状态）。
- `market_get`：写 detail { resource, tree }。
- `market_install`：按 status 走状态机 —— approval_required → pendingInstall + installState；installed/already_installed → installState="installed"、同步 detail.resource.installed=true、emitActivity 提示、load() 刷新；error → lastError。
- `market_uninstall`：从 installed 删除 id + removedIds、同步 detail.resource.installed=false、重置安装状态、load() 刷新。
- `market_installed`：整体更新 installed Record。
- 风格与 extension-handlers.ts 一致（useStore.getState()/setState，不依赖 ctx）。

### 4. gui-v2/src/hooks/useWebSocket.ts（修改）
- import `buildMarketHandlers` 并展开进主 handler 表。

### 5. gui-v2/src/components/extensions/MarketTab.tsx（新）
```tsx
export function MarketTab(): JSX.Element;
```
UI 结构（按 frontend-design 三份规则）：
- 过滤栏（bg-surface 面板 + --shadow-surface）：类型 chips（全部/👤智能体/👥群组/📘技能）+ 信任分级 chips（全部/官方内置/官方认证/社区/本地）+ 搜索输入框（bg-input）。
- 资源卡片网格（auto-fill minmax(270px,1fr)）：name、tier 徽章（official 绿/官方内置、certified 紫/官方认证、community 橙/社区、local 灰/本地）、类型图标、description 两行截断（line-clamp-2）、riskLevel 徽章（低/中/高 → success/accent-warm/danger）、tags；操作区：未安装→「安装」、已安装→「已安装」+「卸载」、local→「本地资源」禁用。
- 详情浮层（Sheet right，复用 components/ui/sheet.tsx）：名称/tier/类型/作者/版本、完整描述、权限列表（逐条 divider）、依赖树（递归缩进 + 左侧 divider 连线，节点含类型图标+tier+风险+必装/可选）、底部操作条（安装/确认安装/卸载/关闭）。
- 社区确认流：卡片「安装」→ openDetail + requestInstall（无 confirmed）→ approval_required → 浮层顶部警告区（⚠️ 未审核提示 + 依赖风险提示）+「确认安装」→ confirmInstall()。官方/认证资源直接装。
- 状态处理：首次加载 spinner 文字（依赖 ws-market-list 事件置 loaded）、lastError 错误横幅（danger token）、installing 禁用按钮、安装成功内联 success 横幅 + emitActivity。
- 主题 token：--color-*/--shadow-surface/--color-divider，不硬编码色值；层级 bg-surface→bg-elevated→bg-hover。

### 6. gui-v2/src/components/extensions/ExtensionsView.tsx（修改）
- TABS 增加 `{ id: "market", label: "Market", icon: "🛍️" }`，内容区 `{activeTab === "market" && <MarketTab />}`。

## 约束确认
- 只改 6 个文件（3 改 3 新），不碰 packages/。
- WS 协议按冻结版，不增改消息类型。
- JSX.Element 通过 `import type { JSX } from "react"` 引入（React 19 类型无全局 JSX 命名空间）。

## 勾选清单
- [x] types.ts
- [x] stores/market.ts
- [x] ws-handlers/market-handlers.ts
- [x] useWebSocket.ts
- [x] MarketTab.tsx
- [x] ExtensionsView.tsx

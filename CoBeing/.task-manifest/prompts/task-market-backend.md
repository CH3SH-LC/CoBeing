# 子任务：task-market-backend

## 任务描述
实现 CoBeing 后端 Market 核心模块：资源类型/信任分级模型、MarketCatalog（扫描 `data/market/<tier>/<id>/market.json` + installed.json 持久化）、MarketInstaller（依赖树解析 + 分级安装门禁 + skill/agent/group 三类落盘 + 卸载）、Butler 推荐/安装工具工厂、4 个内置示例资源（3 官方 + 1 社区）、单元测试。你的产出是 Market 功能的后端地基，主线程随后用它接线 WS 命令与 Runtime。

## 依赖关系
- 依赖的任务：无（第 0 批）
- 本任务产出被以下任务依赖：后端接线（主线程）— 将 import MarketCatalog/MarketInstaller/make*Tool

## 输入文件
| 文件 | 章节/位置 | 描述 |
|------|----------|------|
| packages/core/src/agent/butler/tools/registry-tools.ts | 全文件 | Butler 工具工厂写法（Tool 来自 @cobeing/shared，execute 返回 { toolCallId: "", content }） |
| packages/core/src/skills/repository.ts | 前 90 行 | SKILL.md 格式：frontmatter 需含 name/description，body 为正文 |
| packages/core/src/api/handlers/plugin.ts | 全文件 | WS handler 风格参考（只读，不要修改） |

## 输出接口（与 task-contract.yaml 完全一致）

### packages/core/src/market/types.ts
```ts
export type MarketResourceType = "agent" | "group" | "skill";
export type MarketTier = "official" | "certified" | "community" | "local";
export type MarketRiskLevel = "low" | "medium" | "high";
export interface MarketDependency { type: MarketResourceType; id: string; version?: string }
export interface MarketResource {
  id: string; type: MarketResourceType; name: string; description: string;
  version: string; tier: MarketTier; author: string; icon?: string;
  tags: string[]; riskLevel: MarketRiskLevel; permissions: string[];
  dependencies: MarketDependency[];
}
export interface MarketResourceView extends MarketResource { installed: boolean }
export interface MarketDepNode {
  id: string; type: MarketResourceType; name: string; tier: MarketTier;
  riskLevel: MarketRiskLevel; required: boolean; children: MarketDepNode[];
}
export type MarketInstallStatus = "installed" | "approval_required" | "already_installed" | "error";
export interface MarketInstallResult {
  status: MarketInstallStatus; id: string; type: MarketResourceType; name: string;
  message?: string; installedIds: string[]; dependencyTree: MarketDepNode; warning?: string;
}
export interface InstalledEntry {
  id: string; type: MarketResourceType; name: string;
  installedAt: string; sourceId: string; installedIds: string[];
}
```

### packages/core/src/market/catalog.ts
```ts
export class MarketCatalog {
  constructor(dataRoot: string);          // dataRoot = data/ 目录
  reload(): void;                          // 重新扫描 data/market/ 下 official/certified/community 三层的 market.json
  list(): MarketResource[];                // 全部文件型资源
  get(id: string): MarketResource | undefined;
  search(query: string, opts?: { type?: MarketResourceType; tier?: MarketTier }): MarketResource[];
  isInstalled(id: string): boolean;
  getInstalled(): InstalledEntry[];        // 读 data/market/installed.json
  markInstalled(entry: InstalledEntry): void;   // 写 installed.json
  unmarkInstalled(id: string): void;
}
export function buildLocalResources(
  agents: Array<{ id: string; name: string; role?: string }>,
  skills: Array<{ name: string; description: string }>,
): MarketResource[];
```
说明：
- 扫描规则：`dataRoot/market/<tier>/<id>/market.json`，tier 只取 official/certified/community；market.json 缺失或 id 非法（非 `^[\w][\w\-]*$`）跳过并 warn。
- 资源目录中除 market.json 外的所有文件视为载荷文件（payload），安装时整体复制。
- `installed.json` 格式：`{ "<id>": InstalledEntry }`。
- `buildLocalResources`：把现有 Agent（排除 id 为 butler/host 的系统核心）合成 tier:"local"、type:"agent"、riskLevel:"low"、permissions:["workspace:readwrite"]、tags:["本地"] 的资源；把现有技能合成 type:"skill" 的本地资源。无依赖。用于「本地私有」层展示。

### packages/core/src/market/installer.ts
```ts
export interface MarketInstallerHooks {
  registerAgent?: (id: string, dir: string) => Promise<void> | void;
  createGroup?: (id: string, name: string, memberIds: string[], topic?: string) => Promise<void> | void;
  destroyGroup?: (id: string) => Promise<void> | void;
  reloadSkills?: () => void;
}
export class MarketInstaller {
  constructor(catalog: MarketCatalog, opts: { dataRoot: string; hooks?: MarketInstallerHooks });
  buildDependencyTree(id: string): MarketDepNode | null;
  install(id: string, opts?: { confirmed?: boolean }): MarketInstallResult;
  uninstall(id: string): { id: string; removedIds: string[]; message?: string };
}
```
install() 逻辑（顺序执行）：
1. `catalog.get(id)` 不存在 → `{ status: "error", message: "Resource not found: <id>" }`（dependencyTree 用单节点占位）。
2. `buildDependencyTree(id)` 递归解析（**visited 集合防环**，依赖缺失时生成 tier:"community" 的保守节点，name 用 dep.id）。
3. 若自身或依赖树中任一节点 tier === "community" → 未传 `confirmed: true` → 返回 `{ status: "approval_required", dependencyTree, installedIds: [] }`（社区资源必须用户确认）。
4. 已安装（catalog.isInstalled(id) 且所有依赖已装）→ `{ status: "already_installed", ... }`。
5. 拓扑序安装（先依赖后自身），跳过已安装节点：
   - skill：载荷复制到 `dataRoot/skills/<id>/`（SKILL.md 必在），hooks.reloadSkills?.()
   - agent：载荷复制到 `dataRoot/agents/<id>/`，hooks.registerAgent?.(id, dir)
   - group：先装成员 Agent 依赖；载荷复制到 `dataRoot/groups/<id>/`（GUIDE.md 等），hooks.createGroup?.(id, name, memberIds, topic)；memberIds 从依赖树中 type==="agent" 的节点收集
   - 每个节点安装后 `catalog.markInstalled({ id, type, name, installedAt: new Date().toISOString(), sourceId: id, installedIds: [id] })`
6. 返回 `{ status: "installed", installedIds: [实际新装节点 id 列表], dependencyTree, warning? }`（warning 用于提示连带安装或部分跳过）。

安全要求：资源 id 与复制目标路径必须做校验（id 匹配 `^[\w][\w\-]*$`；复制后 resolve 路径必须仍在目标目录内，防路径穿越）。

uninstall(id)：installed.json 有记录才可卸载；按类型删除目录（skill → dataRoot/skills/<id>、agent → dataRoot/agents/<id>、group → hooks.destroyGroup?.(id) + dataRoot/groups/<id>）；卸载后 unmarkInstalled(id)；返回 `{ id, removedIds: [id] }`。依赖不级联卸载（它们是共享资源），message 中说明。

### packages/core/src/market/tools.ts
```ts
import type { Tool } from "@cobeing/shared";
export function makeMarketRecommendTool(
  catalog: MarketCatalog,
  deps: { dataRoot: string; listLocalResources: () => MarketResource[] },
): Tool;
export function makeMarketInstallTool(
  catalog: MarketCatalog,
  installer: MarketInstaller,
): Tool;
```
- `butler-market-recommend` 参数：`query`（关键词）、`type?`。返回文本：官方内置/官方认证资源优先列（标 tier），社区资源必须标注「⚠️ 未认证，需用户审查后安装」，本地资源标注为默认路径；给出推荐结论（可推荐/需用户确认/建议本地创建）。
- `butler-market-install` 参数：`id`、`confirmed?`（布尔）。内部走 installer.install；approval_required 时返回文本要求用户明确确认（`confirmed: true`）；成功返回安装清单。
- 每个 Tool 的 execute 返回 `{ toolCallId: "", content: <文本> }`，失败返回 `{ toolCallId: "", content: "错误：<原因>", isError: true }`（参考 registry-tools.ts 的写法）。

### packages/core/src/market/bundled/（4 个资源，manifest 格式见下）
`bundled/<tier>/<id>/market.json` + 载荷文件。market.json 必须含：id/type/name/description/version/tier/author/tags/riskLevel/permissions/dependencies。
- `official/travel-planning/`：skill「旅行规划」，SKILL.md（frontmatter: name: travel-planning, description），正文为旅行规划方法步骤。
- `official/travel-planner/`：agent「旅行规划师」，deps: [{type:"skill", id:"travel-planning"}]，载荷：AGENTS.md（运行规则/工具边界/红线，中文）、CHARACTER.md（人设）、JOB.md（职责）、MEMORY.md/EXPERIENCE.md（空模板）、config.json（{ name, role, permissions:{mode:"workspace-readwrite"}, tools:[常用安全工具如 read-file/glob/grep/web-fetch/agent-message], skills:[["travel-planning"]] } 或按 skills 白名单格式）。
- `official/travel-team/`：group「旅行规划小队」，deps: [{type:"agent", id:"travel-planner"}]，载荷 GUIDE.md（群组规则草案，中文）。
- `community/expense-assistant/`：agent「记账小助手」，tier:"community"，riskLevel:"medium"，permissions 含 ["workspace:readwrite","agent-message"]，无依赖；载荷同 agent 格式。用于演示社区分级门禁。
所有文案用中文，内容真实可用（不是占位 Lorem）。

### 测试（TDD：先写失败测试，再实现）
- `catalog.test.ts`：用临时目录构造 fake data/market 结构 → list/get/search（type/tier 过滤）/reload 跳过非法 id/markInstalled+getInstalled+unmarkInstalled 持久化/buildLocalResources 合成。
- `installer.test.ts`：临时目录：
  - 依赖树构建（含缺失依赖保守节点、防环）
  - 社区门禁：community 资源无 confirmed → approval_required；confirmed: true → installed
  - 官方 skill/agent 安装：文件落盘 + hooks 调用断言
  - group 安装：先装 agent 依赖 + createGroup hook 收到 memberIds
  - uninstall：目录删除 + installed.json 记录清除
  - 路径穿越：id 为 "../evil" 等 → 拒绝且不写文件
  - already_installed 幂等
- 测试用 `node:fs` 的 `mkdtempSync` + 清理（afterAll rmSync recursive force）。

## 验证标准
- [ ] 所有输出文件存在，导出签名与合约完全一致
- [ ] `cd packages/core && pnpm exec tsc --noEmit` 通过
- [ ] `cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/market` 全绿
- [ ] `pnpm build`（全 workspace）通过

## 工作协议
请遵循「myworkflow:subagent-protocol」的 5 阶段工作规范：
1. 读取合约 + 确认输入：读取 `.task-manifest/task-contract.yaml` 中你的条目和所有输入文件
2. 声明接口：先写 `.task-manifest/interface-declaration.md` 承诺你的接口——声明先于实现
3. 产出实现：按声明逐项编码，每完成一个文件在声明中勾选
4. 自检：写 `.task-manifest/self-check.md`，逐项核对，全部打勾才能进入下一步
5. 完成报告：写 `.task-manifest/completion.md`，列出产出文件和自检结果

## 约束
- 只修改/创建 `packages/core/src/market/` 下的文件（新目录）。**不得修改** packages/core/src 下任何现有文件（含 runtime.ts/ws-server.ts/handlers/butler.ts/skills/repository.ts——这些是主线程的接线范围）。
- 项目规则：修改 .ts 源码后必须 `pnpm build` 验证。
- 导出的签名必须与合约完全一致（主线程的接线代码依赖精确签名）。
- 模块内可 `import { createLogger } from "@cobeing/shared"` 打日志（参考 registry-tools.ts）。

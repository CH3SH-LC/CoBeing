# 接口声明 — task-market-backend

> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-03T00:00:00Z（会话内声明）
> task-id: task-market-backend（合约条目见 task-contract.yaml `id: task-market-backend`）

## 我将创建/修改的文件

- [x] packages/core/src/market/types.ts — 市场资源类型/信任分级/依赖树/安装状态等全部类型定义
- [x] packages/core/src/market/catalog.ts — MarketCatalog 扫描 data/market/<tier>/<id>/market.json + installed.json 持久化 + buildLocalResources
- [x] packages/core/src/market/installer.ts — MarketInstaller 依赖树解析/分级安装门禁/三类落盘/卸载
- [x] packages/core/src/market/tools.ts — butler-market-recommend / butler-market-install 两个 Butler 工具工厂
- [x] packages/core/src/market/bundled/official/travel-planning/market.json — 官方技能「旅行规划」清单
- [x] packages/core/src/market/bundled/official/travel-planning/SKILL.md — 技能正文（frontmatter name/description）
- [x] packages/core/src/market/bundled/official/travel-planner/market.json — 官方 Agent「旅行规划师」清单
- [x] packages/core/src/market/bundled/official/travel-planner/AGENTS.md — 运行规则
- [x] packages/core/src/market/bundled/official/travel-planner/CHARACTER.md — 人设
- [x] packages/core/src/market/bundled/official/travel-planner/JOB.md — 职责
- [x] packages/core/src/market/bundled/official/travel-planner/MEMORY.md — 记忆模板
- [x] packages/core/src/market/bundled/official/travel-planner/EXPERIENCE.md — 经验模板
- [x] packages/core/src/market/bundled/official/travel-planner/config.json — AgentConfig 兼容配置
- [x] packages/core/src/market/bundled/official/travel-team/market.json — 官方群组「旅行规划小队」清单
- [x] packages/core/src/market/bundled/official/travel-team/GUIDE.md — 群组规则
- [x] packages/core/src/market/bundled/community/expense-assistant/market.json — 社区 Agent「记账小助手」清单
- [x] packages/core/src/market/bundled/community/expense-assistant/AGENTS.md — 运行规则
- [x] packages/core/src/market/bundled/community/expense-assistant/CHARACTER.md — 人设
- [x] packages/core/src/market/bundled/community/expense-assistant/JOB.md — 职责
- [x] packages/core/src/market/bundled/community/expense-assistant/MEMORY.md — 记忆模板
- [x] packages/core/src/market/bundled/community/expense-assistant/EXPERIENCE.md — 经验模板
- [x] packages/core/src/market/bundled/community/expense-assistant/config.json — AgentConfig 兼容配置
- [x] packages/core/src/market/catalog.test.ts — catalog 单元测试（TDD 先行）
- [x] packages/core/src/market/installer.test.ts — installer 单元测试（TDD 先行）
- [x] .task-manifest/outputs/task-market-backend/self-check.md — 自检报告
- [x] .task-manifest/outputs/task-market-backend/completion.md — 完成报告

不修改任何 packages/core/src 现有文件（runtime.ts/ws-server.ts/handlers/butler.ts/skills/repository.ts 属主线程接线范围）。

## 我将暴露的接口

| 名称 | 签名 | 所在文件 |
|------|------|----------|
| MarketResourceType | `export type MarketResourceType = "agent" \| "group" \| "skill"` | types.ts |
| MarketTier | `export type MarketTier = "official" \| "certified" \| "community" \| "local"` | types.ts |
| MarketRiskLevel | `export type MarketRiskLevel = "low" \| "medium" \| "high"` | types.ts |
| MarketDependency | `export interface MarketDependency { type: MarketResourceType; id: string; version?: string }` | types.ts |
| MarketResource | `export interface MarketResource { id: string; type: MarketResourceType; name: string; description: string; version: string; tier: MarketTier; author: string; icon?: string; tags: string[]; riskLevel: MarketRiskLevel; permissions: string[]; dependencies: MarketDependency[] }` | types.ts |
| MarketResourceView | `export interface MarketResourceView extends MarketResource { installed: boolean }` | types.ts |
| MarketDepNode | `export interface MarketDepNode { id: string; type: MarketResourceType; name: string; tier: MarketTier; riskLevel: MarketRiskLevel; required: boolean; children: MarketDepNode[] }` | types.ts |
| MarketInstallStatus | `export type MarketInstallStatus = "installed" \| "approval_required" \| "already_installed" \| "error"` | types.ts |
| MarketInstallResult | `export interface MarketInstallResult { status: MarketInstallStatus; id: string; type: MarketResourceType; name: string; message?: string; installedIds: string[]; dependencyTree: MarketDepNode; warning?: string }` | types.ts |
| InstalledEntry | `export interface InstalledEntry { id: string; type: MarketResourceType; name: string; installedAt: string; sourceId: string; installedIds: string[] }` | types.ts |
| MarketCatalog | `export class MarketCatalog { constructor(dataRoot: string); reload(): void; list(): MarketResource[]; get(id: string): MarketResource \| undefined; search(query: string, opts?: { type?: MarketResourceType; tier?: MarketTier }): MarketResource[]; isInstalled(id: string): boolean; getInstalled(): InstalledEntry[]; markInstalled(entry: InstalledEntry): void; unmarkInstalled(id: string): void }` | catalog.ts |
| buildLocalResources | `export function buildLocalResources(agents: Array<{ id: string; name: string; role?: string }>, skills: Array<{ name: string; description: string }>): MarketResource[]` | catalog.ts |
| MarketInstallerHooks | `export interface MarketInstallerHooks { registerAgent?: (id: string, dir: string) => Promise<void> \| void; createGroup?: (id: string, name: string, memberIds: string[], topic?: string) => Promise<void> \| void; destroyGroup?: (id: string) => Promise<void> \| void; reloadSkills?: () => void }` | installer.ts |
| MarketInstaller | `export class MarketInstaller { constructor(catalog: MarketCatalog, opts: { dataRoot: string; hooks?: MarketInstallerHooks }); buildDependencyTree(id: string): MarketDepNode \| null; install(id: string, opts?: { confirmed?: boolean }): MarketInstallResult; uninstall(id: string): { id: string; removedIds: string[]; message?: string } }` | installer.ts |
| makeMarketRecommendTool | `export function makeMarketRecommendTool(catalog: MarketCatalog, deps: { dataRoot: string; listLocalResources: () => MarketResource[] }): Tool` | tools.ts |
| makeMarketInstallTool | `export function makeMarketInstallTool(catalog: MarketCatalog, installer: MarketInstaller): Tool` | tools.ts |

（bundled 资源为 JSON/MD 载荷文件，无导出接口；market.json 必须含 id/type/name/description/version/tier/author/tags/riskLevel/permissions/dependencies。）

## 我需要的外部输入

| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/core/src/agent/butler/tools/registry-tools.ts | Tool 工厂写法（`{ name, description, parameters, async execute(params, context): Promise<ToolResult> }`，返回 `{ toolCallId: "", content }` / `{ ..., isError: true }`） | tools.ts 工具工厂模式 |
| packages/core/src/skills/repository.ts | SKILL.md 格式：frontmatter 含 name/description（缺失即无效），body 为正文 | bundled 技能载荷 + installer skill 校验（SKILL.md 必在） |
| packages/core/src/api/handlers/plugin.ts | id 校验正则 `^[\w][\w\-]*$` + resolve 路径穿越防护模式 | installer/catalog 安全校验 |
| packages/shared/src/types.ts | Tool / ToolContext / ToolResult 定义、createLogger 来自 @cobeing/shared | tools.ts 类型与日志 |

## 风险和假设

- 假设 1：install() 为同步签名，hooks 若返回 Promise 则 fire-and-forget（.catch 记录日志），不阻塞安装流程。
- 假设 2：依赖缺失（保守节点 tier=community）经用户 confirmed 后，安装为「占位记录」（无载荷可复制，markInstalled 记录 + warning 说明），使依赖图状态一致、后续幂等判断稳定。
- 假设 3：catalog.reload() 在构造函数内自动调用一次；list() 按 id 排序保证确定性。
- 假设 4：market.json 中 id 字段与目录名不一致时跳过并 warn（防清单与目录错位）；type 非法时跳过并 warn。
- 假设 5：bundled/ 为内置资源打包源，由主线程接线复制到 data/market/；catalog 仅扫描 dataRoot/market/<tier>/<id>。
- 假设 6：error 状态（资源不存在）时 dependencyTree 用单节点占位（type 未知取 "skill"、tier community、name 取请求 id）。

# 自检报告 — task-market-backend

> 自检时间: 2026-08-03T07:40:00Z

## 文件存在性

- [x] packages/core/src/market/types.ts — 存在且非空
- [x] packages/core/src/market/catalog.ts — 存在且非空
- [x] packages/core/src/market/installer.ts — 存在且非空
- [x] packages/core/src/market/tools.ts — 存在且非空
- [x] packages/core/src/market/bundled/official/travel-planning/market.json + SKILL.md — 存在且非空
- [x] packages/core/src/market/bundled/official/travel-planner/market.json + AGENTS/CHARACTER/JOB/MEMORY/EXPERIENCE.md + config.json — 存在且非空
- [x] packages/core/src/market/bundled/official/travel-team/market.json + GUIDE.md — 存在且非空
- [x] packages/core/src/market/bundled/community/expense-assistant/market.json + 全套载荷 — 存在且非空
- [x] packages/core/src/market/catalog.test.ts — 存在且非空（9 个测试）
- [x] packages/core/src/market/installer.test.ts — 存在且非空（16 个测试）
- [x] 未修改 packages/core/src 任何现有文件（git status 交叉核对：仅新增 market/ 目录）

## 接口签名匹配（与 interface-declaration.md / task-contract.yaml 对比）

以 `pnpm build` 产出的 dist/market/*.d.ts 逐项核对：

- [x] MarketResourceType: `"agent" | "group" | "skill"` — 一致
- [x] MarketTier: `"official" | "certified" | "community" | "local"` — 一致
- [x] MarketRiskLevel: `"low" | "medium" | "high"` — 一致
- [x] MarketDependency / MarketResource / MarketResourceView / MarketDepNode / MarketInstallStatus / MarketInstallResult / InstalledEntry — 字段与契约逐项一致
- [x] MarketCatalog: `constructor(dataRoot) / reload() / list() / get(id) / search(query, opts?) / isInstalled(id) / getInstalled() / markInstalled(entry) / unmarkInstalled(id)` — 一致
- [x] buildLocalResources: `(agents: Array<{id,name,role?}>, skills: Array<{name,description}>) => MarketResource[]` — 一致
- [x] MarketInstallerHooks: registerAgent/createGroup(含 topic?)/destroyGroup/reloadSkills — 一致
- [x] MarketInstaller: `constructor(catalog, {dataRoot, hooks?}) / buildDependencyTree(id): MarketDepNode|null / install(id, opts?): MarketInstallResult / uninstall(id): {id, removedIds, message?}` — 一致
- [x] makeMarketRecommendTool / makeMarketInstallTool: 签名返回 `Tool`（@cobeing/shared）— 一致

## 功能完整性（合约需求 → 验证）

- [x] 扫描规则：dataRoot/market/<tier>/<id>/market.json，tier 仅 official/certified/community — catalog.test「构造后自动扫描三层目录」
- [x] market.json 缺失 / id 非法 / id 与目录名不一致 → 跳过并 warn — catalog.test「非法 id 被跳过」
- [x] installed.json 格式 `{ "<id>": InstalledEntry }` + 持久化 — catalog.test「markInstalled/…持久化」「新实例读取」
- [x] buildLocalResources：排除 butler/host、tier local、riskLevel low、permissions workspace:readwrite、tags 本地、无依赖 — catalog.test「合成」
- [x] 依赖树递归解析 + visited 防环 + 缺失依赖 community 保守节点（name=dep.id）— installer.test「递归构建/防环/保守节点/不存在→null」
- [x] 社区门禁：无 confirmed → approval_required（installedIds 空）；confirmed → installed — installer.test「社区分级门禁」
- [x] skill 安装：载荷复制到 dataRoot/skills/<id>（SKILL.md 必在）、reloadSkills hook、installed.json 记录 — installer.test「skill 安装」
- [x] agent 安装：复制到 dataRoot/agents/<id>、registerAgent hook 收到 (id, 绝对路径 dir) — installer.test「agent 安装」
- [x] group 安装：先装成员 agent 依赖、复制到 dataRoot/groups/<id>、createGroup hook 收到 memberIds（仅 agent 节点）— installer.test「group 安装」
- [x] 拓扑序安装：installedIds 顺序 = [lib-skill, agent-bob, team-omega] — installer.test 断言
- [x] uninstall：按类型删目录 + installed.json 清除 + destroyGroup hook；依赖不级联（message 说明）— installer.test「uninstall」
- [x] 路径穿越防护：id="../evil" 直接 error；依赖 id 非法先于社区门禁拒绝；复制目标 resolve 必须在目标根内 — installer.test「安全防护」+ 代码防御
- [x] already_installed 幂等（依赖齐全判断）— installer.test「幂等」
- [x] 错误处理：资源不存在 → error + 单节点占位 dependencyTree — installer.test「资源不存在」
- [x] 工具行为：recommend 分层排序 + 社区 ⚠️ 标注 + 结论分级；install 的 approval_required 文本引导 confirmed:true、error 返回 isError — tools 端到端冒烟（node + dist 产物）
- [x] 4 个内置资源清单一致性（必填字段 / id=目录名 / tier=目录层 / 类型枚举 / riskLevel 枚举 / skill 含 SKILL.md frontmatter）— 冒烟校验脚本「ALL BUNDLED RESOURCES OK」

## 接口自洽

- [x] 所有导出的函数/类型在对应模块内有定义（dist .d.ts 逐项核对通过）
- [x] 没有引用不存在的模块/文件 — tsc --noEmit 通过，全部相对导入均为同级既有文件
- [x] 没有孤立的导出 — RESOURCE_ID_PATTERN 被 installer.ts/tools.ts 引用；MarketResource 被 tools.ts 引用；其余导出均为合约要求的 outputs
- [x] 测试文件 import 路径（./catalog.js / ./installer.js 的 NodeNext 形式）与 vitest 解析一致 — 25/25 通过

## 错误处理

- [x] 资源不存在：error + message「Resource not found: <id>」+ 单节点占位树
- [x] 非法 id（含依赖中的恶意 id）：error「非法资源 id：…」，不写任何文件（先于门禁与落盘）
- [x] skill 载荷缺 SKILL.md：error，拒绝安装
- [x] installed.json 损坏 / market 目录缺失：warn 降级为空集合，不崩溃（catalog.test「market 目录不存在时安全空扫」）
- [x] hooks 返回 Promise：fire-and-forget + .catch 记日志，不阻塞同步安装流程（假设 1）
- [x] 缺失依赖安装：占位记录 + warning 说明，保持依赖图一致（假设 2）

## 验证命令结果

- [x] `cd packages/core && pnpm exec tsc --noEmit` — exit 0
- [x] `pnpm exec vitest run packages/core/src/market` — 2 files / 25 tests 全绿
- [x] `pnpm build`（全 workspace）— exit 0，dist/market/*.d.ts 生成
- [x] 端到端冒烟（bundled 4 资源 → catalog → installer → tools，node + dist）— 全链路 OK（install/uninstall/门禁/幂等/错误路径）

全部 [x]，自检通过。

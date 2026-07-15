# Phase 9: Architecture Fix — 设计规范

> 日期: 2026-04-20
> 状态: 已批准

## 背景

MyAgents 前端 P0-P2 已完成，后端 Phase 0-8 已完成。Phase 9 修复 7 个架构问题，使系统从"演示级"升级为"可用级"。

## 7 个问题及设计方案

### 1. 创建流程：UI 直接创建，不经过 Butler

**现状**: 前端 CreateGroupDialog 通过 `send_message` 给 butler 发自然语言指令来创建群组。
**目标**: 前端 UI 按钮 → WS 命令（`create_agent` / `create_group`）→ 后端直接执行。

- 新增 WS 命令: `create_agent`, `create_group`, `destroy_agent`, `destroy_group`
- 创建过程中同步更新 ButlerRegistry（作为副作用）
- Butler 通过 `butler-read-registry` 可看到完整列表

### 2. Agent 核心文档：IDENTITY.md → CHARACTER.md + JOB.md

**现状**: `config/templates/IDENTITY.md` 只有一个简单模板（Name/Emoji/Creature/Vibe）。
**目标**: 拆为两个更专业的文件。

- **删除** `config/templates/IDENTITY.md`
- **新建** `config/templates/CHARACTER.md` — 性格、行事风格、背景、个人描写
- **新建** `config/templates/JOB.md` — 职责、工作范围、工作原则
- `paths.ts`: `identityPath` → `characterPath` + `jobPath`，移除 `AgentIdentity` 相关代码
- `butler.ts`: 模板复制列表更新

### 3. HostAgent（群主智能体）— 预置实例

**现状**: 群主工具硬编码在 `group/owner.ts` 中，没有被任何 Agent 使用。
**目标**: 创建一个预置的基本 Agent "HostAgent"，项目初始化时创建（类似 Butler）。

- 在 `config/default.json` 中新增 `agents` 配置段，包含 host agent 定义
- Runtime 启动时创建 HostAgent 实例并注册
- 创建群组时自动加入 HostAgent 并标记为 owner
- HostAgent 拥有群组管理工具（从 owner.ts 迁移）: group-plan, group-summarize, group-assign-task, group-invite-talk
- 拥有自己的 CHARACTER.md 和 JOB.md

### 4. 移除讨论范式 → 多智能体协作

**现状**: GroupProtocol 类型（round-robin/free-form/moderated）遍布前后端。
**目标**: 移除所有"讨论协议"概念，保留协作语义。

- **删除** `group/protocol.ts` 及其测试
- **移除** `GroupConfig.protocol` 字段（后端 shared/types.ts）
- **移除** 前端 `GroupProtocol` 类型
- **保留** Screener 初筛机制，仅更新语义
- **语义更新**: "讨论" → "协作", "讨论协议" → "协作模式"

### 5. 群主组织能力

**已由第 3 点覆盖**: HostAgent 拥有更强工具。Screener 双模型监测机制保留。

### 6. 群组独立文件夹 + 配置注册

**现状**: 群组只存在于内存中（GroupManager Map），无持久化。
**目标**: 群组拥有独立文件夹和配置注册。

- 群组独立文件夹: `data/groups/{group-id}/config.json` + workspace 文件
- 在 `config/default.json` 中注册（`groups` 数组）
- GroupManager 新增持久化方法（save/load）
- Runtime 启动时从 `data/groups/` 目录扫描恢复群组
- 新增 WS 命令: `create_group` 直接创建并持久化

### 7. 前端类型和 UI 更新

- 移除 `GroupProtocol` 类型
- CreateGroupDialog 移除协议选择器
- GroupConfigTab 移除协议配置
- Sidebar / GroupDetailPanel 更新显示语义
- 前端创建群组通过 `create_group` WS 命令（不再通过 send_message 给 butler）

## 影响范围

### 后端（需修改）
| 文件 | 操作 |
|------|------|
| `packages/core/src/agent/paths.ts` | 重构: identityPath → characterPath + jobPath |
| `packages/core/src/agent/butler.ts` | 更新模板复制列表 + 创建逻辑 |
| `packages/core/src/group/group.ts` | 移除 protocol 引用 |
| `packages/core/src/group/protocol.ts` | **删除** |
| `packages/core/src/group/protocol.test.ts` | **删除** |
| `packages/core/src/group/screener.ts` | 语义更新 |
| `packages/core/src/group/owner.ts` | 保留，工具迁移到 HostAgent 使用 |
| `packages/core/src/group/manager.ts` | 新增持久化（save/load） |
| `packages/core/src/config/schema.ts` | 移除 protocol，新增 agents 配置 |
| `packages/core/src/api/ws-server.ts` | 新增 4 个 WS 命令 |
| `packages/core/src/runtime.ts` | 启动恢复群组 + 注册 HostAgent |
| `packages/shared/src/types.ts` | 移除 GroupConfig.protocol |
| `config/default.json` | 新增 agents 段 |
| `config/templates/IDENTITY.md` | **删除** |
| `config/templates/CHARACTER.md` | **新建** |
| `config/templates/JOB.md` | **新建** |

### 前端（需修改）
| 文件 | 操作 |
|------|------|
| `gui-v2/src/lib/types.ts` | 移除 GroupProtocol，更新类型 |
| `gui-v2/src/components/group/CreateGroupDialog.tsx` | 移除协议选择，改用 create_group 命令 |
| `gui-v2/src/components/group/GroupConfigTab.tsx` | 移除协议配置 |
| `gui-v2/src/components/group/GroupDetailPanel.tsx` | 更新显示语义 |
| `gui-v2/src/components/layout/Sidebar.tsx` | 更新显示语义 |

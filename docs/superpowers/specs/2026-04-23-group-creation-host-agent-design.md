# 群组创建优化 & 群主智能体核心文件补全

**日期**: 2026-04-23
**状态**: 已批准

## 背景

当前群组创建流程存在两个问题：

1. `butler-create-group` 工具不强制加入群主智能体（只有 WS 端点做了自动加入）
2. `remove_group_member` 不阻止移除群主
3. 群主智能体（host）缺少 6 个核心文件，只有 `config.json` + `EXPERIENCE.md`

## 设计决策

- 群主角色定位：**项目管理 + 协调**，负责组织讨论流程、拆解任务、跟踪进度、汇总成果
- 群主是完整智能体，群组主持是其中一种工作模式
- 创建群组时**强制**加入群主，且**不可移除**

## 第一部分：群组创建流程改动

### 1. `butler-create-group` 工具（butler.ts）

**改动**：强制将 host 加入成员列表并设为 owner。

```typescript
// before
members: params.members as string[],

// after
const members = params.members as string[];
if (!members.includes("host")) {
  members.unshift("host");
}
// ... 使用 members，并设置 owner: "host"
```

### 2. `remove_group_member` 端点（ws-server.ts）

**改动**：在移除前检查是否为 host，如果是则拒绝。

```typescript
if (rmAId === "host") {
  this.sendToClient(ws, { type: "error", payload: { message: "群主不可被移除" } });
  break;
}
```

### 3. `create_group` WS 端点（ws-server.ts）

**改动**：确保 host 始终存在于 registry，如果不存在则报错。

```typescript
if (!this.agentRegistry?.get("host")) {
  this.sendToClient(ws, { type: "error", payload: { message: "群主智能体不可用" } });
  break;
}
```

## 第二部分：群主智能体核心文件

为 `data/agents/host/` 创建 7 个核心文件（EXPERIENCE.md 已存在）：

| 文件 | 定位 |
|------|------|
| **SOUL.md** | 务实、高效、善于协调。不啰嗦不客套，直奔主题 |
| **CHARACTER.md** | 项目经理型人格，擅长拆解任务和组织协作 |
| **JOB.md** | 群组主持为主，也可被用户直接对话。核心职责：组织讨论、分配任务、跟踪进度、汇总成果 |
| **USER.md** | 沿用管家模板格式，空白待积累 |
| **TOOLS.md** | 群组工具（group-plan、group-assign-task 等）为主，日常工具为辅 |
| **AGENTS.md** | 启动流程、群组行为规范、可用工具清单、自我更新规则 |
| **BOOTSTRAP.md** | 行为备忘录 — 快速参考核心规则 |

### config.json 调整

现有 `systemPrompt` 中的重复内容（如协作原则）会移到核心文件中承载，`systemPrompt` 精简为基本身份声明。

## 文件清单

### 需要修改的代码文件

- `packages/core/src/agent/butler.ts` — `makeCreateGroupTool`
- `packages/core/src/api/ws-server.ts` — `create_group` 和 `remove_group_member`

### 需要创建的核心文件

- `data/agents/host/SOUL.md`
- `data/agents/host/CHARACTER.md`
- `data/agents/host/JOB.md`
- `data/agents/host/USER.md`
- `data/agents/host/TOOLS.md`
- `data/agents/host/AGENTS.md`
- `data/agents/host/BOOTSTRAP.md`

### 需要修改的配置文件

- `data/agents/host/config.json` — 精简 systemPrompt

## 不在范围内

- 群组协作引擎（v2 async engine）改动
- 群组 protocol 类型新增
- 前端 UI 改动

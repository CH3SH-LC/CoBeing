# TODO 驱动自动化 — 设计规格

> 日期：2026-04-24
> 状态：已审核

---

## 概述

为 CoBeing 添加 TODO 驱动自动化系统。Agent 和群组可以创建定时 TODO，到达触发时间后以 `TODOboard` 身份唤醒目标 Agent 执行任务。每个 TODO 都是一次性的，但通过 `recurrenceHint` 让 LLM 自行决定是否续期。

---

## 1. 数据结构

### TodoItem

```typescript
interface TodoItem {
  id: string;                    // uuid
  title: string;                 // 简短标题
  description: string;           // 触发时告诉 agent 要做什么
  status: "pending" | "triggered" | "completed" | "cancelled";
  triggerAt: string;             // ISO 8601 触发时间
  /** 触发后 LLM 据此决定是否续期及下次触发时间 */
  recurrenceHint: string;        // "每天9:00" / "每周一10:00" / "不重复"
  createdBy: string;             // "user" | agentId | "TODOboard"
  createdAt: string;             // ISO 8601
  triggeredAt?: string;          // 实际触发时间
  completedAt?: string;

  // Agent 级专用
  agentId?: string;              // Agent 级 TODO 归属

  // 群组级专用
  targetAgentId?: string;        // 群组级 TODO 触发目标 agent
  /** 完成后的动作链 */
  onComplete?: {
    mentionAgentId?: string;     // 完成后 @mention 这个 agent
    message?: string;            // @mention 时附带的消息
    createTodo?: Omit<TodoItem, "id" | "createdAt" | "status">;
  };
}
```

### 存储位置

| 层级 | 文件路径 | 说明 |
|------|---------|------|
| Agent 级 | `data/agents/{agentId}/TODO.json` | 该 agent 私有的 TODO 列表 |
| 群组级 | `data/groups/{groupId}/TODO.json` | 群组共享 TODO 列表 |

---

## 2. 扫描器架构

### Agent 级 — 全局扫描器 `AgentTodoScanner`

- 单例，挂载在 `CoBeingRuntime`
- 每 **60s** 扫描 `data/agents/*/TODO.json`
- 触发条件：`status === "pending" && triggerAt <= now`
- **包含逾期 TODO**（电脑关闭期间过期的也会触发）
- 在 `runtime.ts` 的 `start()` 中启动，`stop()` 中停止
- 触发时以 `TODOboard` 身份向目标 agent 发消息

### 群组级 — 每群组独立扫描 `GroupTodoScanner`

- 每个活跃 Group 一个实例，由 `GroupManager` 管理
- 每 **60s** 扫描 `data/groups/{groupId}/TODO.json`
- 群组内所有 agent 共享一份 TODO 列表
- 触发时通过群组上下文唤醒目标 agent
- 群组创建时启动，销毁时停止
- 完成后检查 `onComplete` 执行动作链

### 逾期处理

`triggerAt` 距 now 超过 1 小时时，消息标注逾期时长：
`[TODO 触发（已逾期 {X}小时）]`

---

## 3. 触发消息格式

### Agent 级

```
sender: "TODOboard"
content:
  【系统通知 — TODO 触发】
  标题: {title}
  内容: {description}
  触发时间: {triggerAt}
  逾期: {是/否，逾期多少}
  续期提示: {recurrenceHint}

  请根据上述内容执行相应操作。
  如需续期：
    1. 先调用 todo-add 创建新 TODO
    2. 再调用 todo-complete 完成当前 TODO
  一次性任务直接调用 todo-complete 即可。
```

### 群组级

```
sender: "TODOboard"
content:
  【系统通知 — 群组 TODO 触发 @ {groupId}】
  标题: {title}
  内容: {description}
  指派给: {targetAgentId}
  续期提示: {recurrenceHint}

  请根据上述内容执行相应操作。
  如需续期：
    1. 先调用 todo-add 创建新 TODO
    2. 再调用 todo-complete 完成当前 TODO
  一次性任务直接调用 todo-complete 即可。
```

---

## 4. Agent 工具

### `todo-add`

```
参数:
  title: string (必填)
  description: string (必填)
  triggerAt: string (必填, ISO 8601)
  recurrenceHint: string (必填)
  scope: "agent" | "group" (默认 "agent")
  groupId: string (群组级时必填)
  targetAgentId: string (群组级时必填)
  onComplete: { mentionAgentId?, message?, createTodo? } (可选)

权限:
  Agent 级 — 任何 agent 可为自己创建
  群组级 — 任何群组成员可添加
```

### `todo-list`

```
参数:
  scope: "agent" | "group" (默认 "agent")
  groupId: string (群组级时必填)
  status?: "pending" | "triggered" | "completed" | "cancelled" (可选筛选)

行为: 返回匹配的 TODO 列表
```

### `todo-complete`

```
参数:
  todoId: string (必填)
  scope: "agent" | "group"
  groupId: string (群组级时必填)

行为:
  标记 status = "completed"
  检查 onComplete:
    - mentionAgentId → 在群组中 @mention 该 agent
    - createTodo → 自动创建新 TODO

权限:
  Agent 级 — 被指派的 agent 自身
  群组级 — 被指派的 agent 或用户手动
```

### `todo-cancel`

```
参数:
  todoId: string (必填)
  scope: "agent" | "group"
  groupId: string (群组级时必填)

权限:
  Agent 级 — 创建者本人或用户
  群组级 — 只有用户手动或群主
```

### `current-time`（全局工具，所有 Agent 自动注册）

```
参数: 无
行为: 返回当前系统时间
返回: ISO 8601 时间 + 星期几
说明: 创建 TODO 时建议先调用此工具获取准确时间
```

---

## 5. WS 命令

| 命令 | 方向 | 说明 |
|------|------|------|
| `get_todos` | GUI → Core | 获取指定 scope 的 TODO 列表 |
| `add_todo` | GUI → Core | 用户手动创建 TODO |
| `complete_todo` | GUI → Core | 用户手动完成 TODO |
| `cancel_todo` | GUI → Core | 用户手动取消 TODO |
| `todo_updated` | Core → GUI | scanner 触发变更后推送 |

---

## 6. 前端组件

```
gui-v2/src/components/todo/
  ├── TodoPanel.tsx         # 主面板 — Agent TODO / 群组 TODO 切换
  ├── TodoList.tsx          # TODO 列表（状态筛选 + 时间排序）
  ├── TodoItem.tsx          # 单条 TODO 卡片
  ├── TodoForm.tsx          # 创建/编辑表单
  └── TodoStatusBadge.tsx   # 状态标签组件
```

- Sidebar 选中 Agent 时显示该 Agent 的 TODO
- Sidebar 选中群组时显示群组共享 TODO
- 支持新建、完成、取消操作
- 实时刷新：通过 `todo_updated` WS 事件推送

---

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| Agent 不存在 | scanner 跳过，log warn |
| TODO.json 损坏 | 跳过该文件，log error |
| 触发时 Agent 正在运行 | 放入队列，等当前对话结束后触发 |
| onComplete 的目标 agent 不存在 | log warn，跳过该动作 |
| 进程重启 | scanner 启动时扫描所有 TODO，逾期的一并触发 |

---

## 8. 知识更新

| 文件 | 更新内容 |
|------|---------|
| `config/templates/JOB.md` | 管家职责增加 "管理用户和 Agent 的 TODO" |
| Butler 系统 prompt | `todo-add/list/complete/cancel` 工具使用说明 |
| 群主 (owner) prompt | 群组 TODO 管理能力、链式触发说明 |
| `config/default.json` | agents.butler.skills 补充 TODO 说明 |

---

## 9. 新增文件

```
packages/core/src/todo/
  ├── types.ts           # TodoItem 类型 + 常量
  ├── store.ts           # TodoStore 读写 TODO.json
  ├── scanner.ts         # AgentTodoScanner（全局）
  ├── group-scanner.ts   # GroupTodoScanner（每群组）
  ├── tools.ts           # todo-add/list/complete/cancel 工具
  ├── time-tool.ts       # current-time 工具
  └── scanner.test.ts    # 测试
```

---

## 10. 更新检查清单

- [x] `start.bat` / `start-gui.bat` — 不受影响（scanner 在 runtime 中启动）
- [x] `build-gui.bat` — 不受影响
- [ ] `config/default.json` — 需要更新 butler skills 配置
- [ ] 后端 WS 命令 — 新增 4 个命令需前后端同时部署
- [ ] `data/` 目录结构 — `TODO.json` 由 scanner 按需创建，无需预创建
- [ ] `STRUCTURE.md` — 新增 `packages/core/src/todo/` 目录需同步更新

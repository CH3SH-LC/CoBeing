# Group Workspace — 群组工作区设计

## 问题

群组中 Agent 被 @mention 唤醒后，文件工具（bash/read-file/write-file/edit-file/glob/grep）的 `workingDir` 指向 Agent 个人工作区 (`data/agents/<id>/workspace/`)，而非群组工作区。

**根因**：`Agent.getGroupLoop()` 创建 `ConversationLoop` 时硬编码 `workingDir: this.effectiveWorkspace`（Agent 个人工作区），WakeSystem 和 WS send_message 均未传递群组 workspace。

## 设计目标

让 Group 拥有与 Agent 完全对称的 workspace 机制，Agent 在群组上下文中执行时，文件操作自动指向群组工作区。

---

## 一、目录结构

```
data/groups/<groupId>/
├── config.json
├── TASK.md / PROGRESS.md / STRUCTURE.md / PLAN.md / MEMBERS.md / EXPERIENCE.md
├── context.jsonl
├── memory/             # current.md, group.db
├── conversations/      # Talk 子频道
└── workspace/          # ← 新增：群组工作区，Agent 文件操作根目录
```

Agent 可通过 `../TASK.md` 访问群组核心文件，通过 `./subdir/file` 操作工作区文件。

---

## 二、Group 类新增字段（对称 Agent）

| Agent | Group |
|-------|-------|
| `_boundWorkspace: string \| null` | `_boundWorkspace: string \| null` |
| `effectiveWorkspace` getter | `effectiveWorkspace` getter |
| `setBoundWorkspace(dir)` | `setBoundWorkspace(dir)` |
| `workspaceDir` → `data/agents/<id>/workspace/` | `workspaceDir` → `data/groups/<id>/workspace/` |

- `effectiveWorkspace` = `_boundWorkspace ?? workspaceDir`
- bind 后 `_boundWorkspace` 非 null，`effectiveWorkspace` 返回绑定目录
- 与 Agent 差异：Group 不需要 `rebuildExecutor()`，因为执行工具的是 Agent

---

## 三、工作目录传递链路

```
WakeSystem.executeWake()
  └─ agent.run(input, { groupId, groupContext,
       workingDir: group.effectiveWorkspace })        // ← 新增
     └─ getGroupLoop(groupId, groupContext, workingDir)
          └─ createGroupLoop(executor, groupId, snapshot, workingDir)
               └─ new ConversationLoop({ workingDir }) // ← 改为参数
                    └─ ToolExecutor.execute(params, { workingDir })
                         └─ 所有文件工具使用 context.workingDir
```

### 改动清单

**Agent (agent.ts)：**
- `RunOptions` 新增 `workingDir?: string`
- `getGroupLoop(groupId, groupContext, workingDir?)` 新增参数
- `createGroupLoop()` 接收 `workingDir`，写入 `ConversationLoopConfig.workingDir`
- `PermissionEnforcer` 也使用群组 workspace 做路径校验

**WakeSystem (wake-system.ts)：**
- `executeWake()` 传入 `workingDir: group.effectiveWorkspace`

**WS (ws-server.ts)：**
- `send_message` 处理器检测到群组消息时，传入 `workingDir: group.effectiveWorkspace`

---

## 四、workspace/ 目录生命周期

- **创建**：`GroupManager.create()` 时 `mkdir -p`
- **恢复**：`restoreGroups()` 时补建
- **绑定**：通过 butler-bind-workspace 或前端 WS `bind_workspace` 设置 `group.setBoundWorkspace(path)`
- **清理**：`GroupManager.delete()` 中 `rmDirRecursive` 删除整个群组目录

---

## 五、边缘情况

- **并发写同一文件**：由文件系统处理，不加应用层锁
- **bind 路径不存在**：自动 `mkdir -p`
- **已有工具兼容**：`host-manage-workspace`、`group-update-progress` 等使用 `GroupWorkspace` 绝对路径，不受影响
- **AbortSignal**：文件操作期间 abort 由工具自身处理

---

## 六、测试要点

- Group workspace/ 目录在 create/restore 时自动创建
- `effectiveWorkspace` 默认返回 `data/groups/<id>/workspace/`
- bind 后 `effectiveWorkspace` 返回绑定路径
- Agent 在群组上下文中 `read-file "TASK.md"` 应解析到 `data/groups/<id>/workspace/TASK.md`
- Agent 在群组上下文中 `read-file "../TASK.md"` 应正确访问群组核心文件
- bind 到外部目录后，文件操作在绑定目录中执行
- Agent 个人对话仍使用自己的 workspace（不受影响）

## 七、不涉及

- 不需要新增 WS 命令（bind 复用现有 `bind_workspace`，前端已支持）
- 不需要新增 TODO 工具或群组工具
- 不改变 Agent 个人对话的工作目录行为
- 不改变 sandbox/容器模式（容器内文件操作仍走现有的挂载机制）

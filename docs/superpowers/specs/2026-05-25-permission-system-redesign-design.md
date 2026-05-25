# 方案 5：权限分级免审批 + 工作区绑定 — 设计规格

> 来源：`docs/调研/综合调研-可执行改进方案.txt` 方案 5
> 状态：已设计，待实现

---

## 1. 目标

将现有 4 级权限体系（full-access / workspace-write / read-only / ask）替换为 5 级免审批体系，
同时支持多工作区绑定（用户从外部目录添加绑定）。

## 2. 架构概览

```
packages/shared/src/types.ts           ← 类型定义（新 5 级枚举 + WorkspaceBinding）
packages/core/src/tools/
├── permission.ts                      ← 重写：5 级权限检查 + 多绑定路径
├── bash-classifier.ts                 ← 新建：正则命令分级器
├── bash.ts                            ← 小改：调用 classifyBashPermission
└── permission.test.ts                 ← 重写：覆盖 5 级 + 多绑定 + 分级
packages/core/src/agent/agent.ts       ← _boundWorkspace→_bindings 数组
packages/core/src/api/ws-server.ts     ← bind_workspace 拆为 add/remove/list binding
packages/shared/src/master-registry.ts ← 启动时自动迁移旧模式值
config/default.json                    ← 新增 bindings 默认字段
gui-v2/src/hooks/useWebSocket.ts       ← 新增 3 个 binding WS 事件
gui-v2/src/lib/types.ts                ← 新增 WorkspaceBinding 类型
gui-v2/src/stores/agent.ts             ← Agent 类型新增 bindings 字段
gui-v2/src/components/settings/        ← 新建 WorkspaceBindingSection.tsx
```

### 2.1 数据流

```
Agent 调用工具
  → PermissionEnforcer.check(toolName, params)
    → 若 bash → BashClassifier.classify(command, allWorkingDirs, level)
    → 若写工具 → isWithinAnyWorkingDir(path, allWorkingDirs)
      遍历: 原始workspace + 默认绑定(workingDir) + 用户绑定(bindings)
    → 返回 { allowed, reason? }
```

## 3. 模块设计

### 3.1 类型定义 (`packages/shared/src/types.ts`)

**新 5 级枚举**：

```typescript
export type PermissionMode = "read-only" | "workspace-readwrite"
  | "workspace-access" | "basic-access" | "full-access";
```

**旧→新自动迁移**（启动时执行）：

| 旧值 | 新值 |
|------|------|
| `full-access` | `full-access` |
| `workspace-write` | `workspace-readwrite` |
| `read-only` | `read-only` |
| `ask` | `workspace-readwrite`（allow/deny 列表保留生效） |

**新增类型**：

```typescript
export interface WorkspaceBinding {
  path: string;
  mode: "readonly" | "readwrite";
  label?: string;
}
```

**AgentConfig 新增字段**：`bindings?: WorkspaceBinding[]`

### 3.2 PermissionEnforcer 重写 (`permission.ts`)

构造函数：`(policy, toolConfig, originalWorkspace, defaultBinding?, userBindings?)`

**check() 逻辑**：

1. FullAccess → 全过
2. 工具级显式 deny → 拒绝 / 显式 allow → 通过
3. ReadOnly → 拒绝所有写工具（含 bash）
4. bash → 委托 BashClassifier
5. WorkspaceReadWrite / WorkspaceAccess → 写工具路径检查仅限原始工作区+默认绑定
6. BasicAccess → 写工具路径检查含用户绑定目录

**isWithinAnyWorkingDir(path, dirs)**：遍历所有工作区目录，任一命中即通过。
readonly 绑定仅用于读工具（读工具不受路径限制）。

### 3.3 Bash 命令分级器 (`bash-classifier.ts`)

纯正则匹配，从高危到安全逐层检查：

```
1. 极端危险 → 仅 FullAccess 可通过
   rm -rf /, dd of=/dev/*, mkfs.*, fork bomb
   sudo su/sudo -i, chmod 777 /, chown -R root /
   ngrok, serveo, localhost.run, ssh -R
   bcdedit, efibootmgr

2. 高危 → BasicAccess+
   rm -rf (非/), sudo (非su), chmod 777 (非/)
   curl/wget | bash, git push --force, git reset --hard

3. 只读白名单 → 所有级别通过（含 ReadOnly）
   cat, head, tail, less, ls, dir, pwd, echo, printf
   grep, rg, awk(无 -i), sed(无 -i), file, stat
   wc, sort, uniq, cut, tr
   find(无 -exec/-delete)
   Get-ChildItem, Get-Content, Get-Location, Write-Output, Select-String

4. 路径逃逸 → BasicAccess+
   ../, /etc/, /proc/, /sys/, /dev/, ~/.ssh, ~/.gnupg

5. 其余命令 → WorkspaceReadWrite+
```

### 3.4 Agent 多绑定 (`agent.ts`)

`_boundWorkspace: string | null` → `_bindings: WorkspaceBinding[]`

```
effectiveWorkspace → 始终返回原始 workspaceDir（不变）
bindings getter → 返回用户绑定列表
allWorkingDirs → 原始 + 默认绑定(workingDir) + 用户 bindings(仅readwrite)

addBinding(b) → 去重后 push + saveConfig + rebuildExecutor
removeBinding(path) → filter + saveConfig + rebuildExecutor
clearBindings() → 清空 + saveConfig + rebuildExecutor
```

PermissionEnforcer 构造处传入：`(policy, toolConfig, workspaceDir, workingDir, this._bindings)`

### 3.5 WS 命令 (`ws-server.ts`)

```
add_binding { agentId, path, mode, label? }
remove_binding { agentId, path }
list_bindings { agentId }
```

安全约束（仅前端可调用，Agent 不可）：
- 禁止绑定系统目录：C:\Windows, C:\Program Files, /etc, /proc, /sys, /dev
- 禁止绑定敏感目录：~/.ssh, ~/.gnupg, ~/.aws, ~/.config
- 禁止绑定 CoBeing data/ 下其他 Agent 目录
- 路径必须存在（fs.existsSync）
- 符号链接用 realpath 解析后再检查（参照已有修复）
- 绑定持久化到 Agent config.json 的 bindings 字段

### 3.6 前端 (`gui-v2/`)

**WorkspaceBindingSection.tsx**（新建）：
- 显示三区：原始工作区（只读）/ 群组绑定（只读）/ 用户额外绑定（可删）
- 添加绑定对话框：路径输入 + 模式选择(readonly/readwrite) + 可选标签
- 每行右侧删除按钮

**useWebSocket.ts**：新增 `binding_added` / `binding_removed` / `bindings_list` 处理

**types.ts**：新增 `WorkspaceBinding` 类型

**agent store**：Agent 类型新增 `bindings` 字段

## 4. 5 级权限速查

| Level | 值 | 读 | 工作区写 | Bash | 外部绑定 | 极端命令 |
|-------|-----|-----|---------|------|---------|---------|
| 0 ReadOnly | `read-only` | ✅ | ❌ | 仅只读 | ❌ | ❌ |
| 1 WorkspaceReadWrite | `workspace-readwrite` | ✅ | ✅ | 仅只读 | ❌ | ❌ |
| 2 WorkspaceAccess | `workspace-access` | ✅ | ✅ | ✅(工作区内) | ❌ | ❌ |
| 3 BasicAccess | `basic-access` | ✅ | ✅ | ✅ | ✅ | ❌ |
| 4 FullAccess | `full-access` | ✅ | ✅ | ✅ | ✅ | ✅ |

## 5. 不包含的内容

- 前端绑定 UI 的完整实现（需 frontend-design skill 配合）
- 沙箱集成（保持现有可选沙箱，不改为强制）
- Bash 分级器的模糊匹配/AI 判断（纯正则）

## 6. 安全边界

- 绑定仅前端用户手动操作，不对 Agent 暴露为工具
- 默认群组绑定由系统自动管理，Agent 不可修改
- 路径检查在 PermissionEnforcer 层统一执行，不依赖工具层自觉
- Bash 分级器的正则白名单是纯防御性的：未被白名单覆盖的命令默认为"需要更高权限"

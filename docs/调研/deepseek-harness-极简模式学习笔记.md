# DeepSeek Harness「极简模式」学习笔记

> 日期：2026-08-18
> 源码：`D:\agent-codes\projects\deepseek-harness`（官方 `deepseek-ai/deepseek-harness`，master @ 99f6f02fec，v0.1.0-rc.7）
> 主题：极简模式（minimal agent preset）为什么能让代码任务做得又好又可靠——「少即是多」的工程化实现

---

## 一、一句话结论

**极简模式不是功能残缺的玩具，而是刻意设计的「决策面最小化」：把模型每次请求要做的选择压缩到极致（1 句系统提示 + 2 个工具），同时把可靠性所需的全部基础设施（沙箱、权限、持久化、可重建日志）原样保留在模型面之外。** 模型面的"纯净"换来的是：工具选择几乎不可能出错、上下文预算几乎全给任务、KV 缓存前缀稳定、无摘要损失——代码任务因此又快又稳。

---

## 二、极简模式是什么

### 定义与位置

极简模式是 DeepSeek Harness 的 **`minimal` agent preset**（Web UI 创建会话时可选的 agent 预设，中文名「极简模式」）：

- 定义文件：`apps/cli/config/agent-presets/minimal/`（`agent.cordis.yml` + `preset.yml`）
- 展示元数据（`preset.yml`）：`name: 极简模式`，`description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。`
- 四个随附预设：`standard` / `code` / `minimal` / `cordis`；用户可设置默认（`agent-presets.default: minimal`）
- 无人值守独立版：`examples/jsonrpc-agent/minimal.cordis.yml`（Python SDK 用，`minimal.py` 驱动）

### 完整组成（`minimal/agent.cordis.yml`，全文仅 62 行）

```
persona            → @deepseek-ai/dsh-persona
                     text: "You are a helpful software engineer assistant."
                     complete: true            ← persona 即唯一系统提示
                     includeRuntimeContext: false
persistent-shell   → cordis:group（isolate: terminals）
                     ├─ @deepseek-ai/dsh-terminal（PTY）
                     ├─ @deepseek-ai/dsh-terminal-bash（timeoutMs 300000）
                     └─ @deepseek-ai/dsh-tool-bash-persistent（持久 bash 工具）
filesystem         → cordis:group（isolate: fs）
                     ├─ @deepseek-ai/dsh-fs-local（裸本地文件系统）
                     └─ @deepseek-ai/dsh-tool-str-replace-editor（maxOutputChars 16000）
```

### 与 standard preset 的差异（"剪了什么"）

| 能力 | standard | minimal |
|---|---|---|
| 系统提示 | 动态组装（身份/工具指南/运行时上下文/监听器） | **固定 1 句**（complete + 无 runtime context） |
| 工具 | bash/pwsh、fs 全家桶、fs-search、jobs、skill、goal、plan、compaction、subagent/workflow/ralph、ask-user、todo、web（约 20 个） | **持久 bash + str_replace_editor（2 个）** |
| 上下文压缩 | compaction-basic + tool-result-pruner（8192/4096/1024） | **无**（contextWindow 默认 100 万，裸跑） |
| 计划/委派/技能/目标 | 全有 | 全无 |
| 沙箱/权限/持久化/模型路由 | 宿主提供 | **宿主提供（不缩水）** |

---

## 三、模型面 vs 宿主面：极简只剪模型面

极简模式的工程核心是 **preset 机制**（`packages/preset/agent-presets/README.md`）：

- **standing mount**：preset 每进程只挂载一次，所有命名它的会话通过 scope 父链（`agent → preset → global`）加入同一份挂载，工具与 prompt 段只存在一份，会话状态按 Session/Agent 键隔离。
- **isolate realm**：preset 内需要私有实例的服务（如 PTY 注册表、fs）放进 entry-local realm——两个 preset 的同名服务互不干扰。
- **recompose 锁定**：只允许"未产生任何内容"的空白会话切换 preset；中途换工具会让历史日志里的工具调用无法重建。
- **子代理绑定**：subagent 通过 `composeFrom()` 绑定父 preset 的 standing 组成，绝不重新 mount（避免代际漂移）。

**被剪掉的只是"模型可见面"**：`persona complete: true` 保证 assembly 后把 persona 恢复为唯一 system-prompt section（`packages/preset/persona/README.md`）——没有任何身份、工具指南或监听器能追加 prompt 文本；`includeRuntimeContext: false` 让所有上下文提供者（沙箱策略、审批策略、委派等）对该 scope 不求值。**而宿主面（浏览器、workspace、持久化、沙箱、权限、模型路由、工具注册表）原样保留**（`apps/cli/reference/README.md` 第 72 行原话：*"the shared browser, workspace, persistence, sandbox, and permission host stays in place"*）。

> 一句话：**安全与可观测性不因极简而削弱；被精简的是模型的决策空间。**

---

## 四、为什么代码任务做得好——机制证据

### 1. 工具选择负担最小化 → 决策错误趋近于零

模型每次请求只需在 **2 个工具**里选（standard 有约 20 个）。工具选择是 agent 代码任务最常见的失败源之一（选错工具、参数用错、多工具组合错）；双工具把该维度彻底压缩。两个工具能力互补、覆盖完整闭环：

- **持久 bash**（`packages/shell/tool-bash-persistent/README.md`）：覆盖一切命令类操作——编译、测试、git、安装、运行、后台服务。一个工具 = 无穷能力面。
- **str_replace_editor**（`packages/fs/tool-str-replace-editor/README.md`）：覆盖精确文本编辑——view / create / str_replace / insert，绝对路径，1-based 行号，保留 tab（显示文本可直接作为替换输入）。

### 2. 上下文纯净 → 预算全给任务

系统提示只有一句话 `You are a helpful software engineer assistant.`。这意味着：

- **上下文预算几乎 100% 用于任务内容**（文件、历史、工具结果），而不是身份说明、工具指南、运行时快照。
- **无摘要损失**：不挂 compaction → 历史不被压缩改写；配合大 contextWindow（minimal.cordis.yml 默认 1,000,000）直接裸跑长任务，避免"压缩后丢失关键代码上下文"这一长任务杀手。

### 3. KV 缓存前缀稳定 → 快且省

persona README 明确写了缓存效应：**"Prefix-stable for the life of an agent — the row mounts once, before the agent is published and therefore before its first request, and its text never changes while the agent runs"**。系统提示与工具 schema 固定 → 请求前缀字节级稳定 → provider 侧 prompt 缓存命中率高；工具结果是 append-only，跟随可复用前缀、不失效缓存。极简模式把"动态注入"彻底去掉，正是为了让每次请求都吃满缓存。

### 4. 请求可重建性（model-visible ⟺ logged）→ 可靠可调试

harness 的硬性约定：**任何到达模型请求的输入必须能从 session log 重建**（AGENTS.md: "Model-visible ⟺ logged"）。agent-loop 记录每个冻结请求，invariant companion 从日志独立重建请求边界与折叠的请求头（`packages/core/agent-loop/README.md` 第 34 行）。极简模式下这条更硬——没有动态注入就没有"重建时对不上的上下文"。

### 5. 持久 shell = 真实工作环境

persistent bash 的关键不是"能跑命令"，而是**状态持久**（README 第 36 行）：

- 每个 Agent 一个 owner-scoped PTY shell：cwd、导出变量、激活环境、函数、**后台作业**跨调用保留。
- 编译一次后直接跑产物；`cd` 后下次调用还在那个目录；起个开发服务器后继续操作。
- 超时（默认 300s）或显式 `exit` **关闭 shell 并告知模型重置**——绝不把"不确定状态"留给下一次调用（`[shell exited: code N]`、`[shell killed by signal: SIG]` 等明确标记）。
- 输出保留**最早前缀** + 裁剪说明；PTY 丢了前缀就明说，绝不用尾巴冒充完整输出（防止模型把截断当全文）。

### 6. str_replace_editor 的"精确编辑协议"

- `str_replace` 要求**唯一字面匹配**，0 或多个匹配一律拒绝，**无 replace_all**（README Known Limitations 原话：*"intentionally rejects zero or multiple matches and has no replace_all"*）——把"改错地方"从根上杜绝。
- 编辑基于 diff 语义：create/replace 调用向展示面暴露 **diff 卡片**，变更走 `fs/write-intent` / `fs/edit-intent` + 当前会话沙箱策略（`packages/fs/tool-fs` 同款机制）。
- view 窗口有上限（maxOutputChars 16000），但显示文本即合法替换输入（1-based 行号 + 保留 tab），读→改闭环无缝。
- 元数据 miss 时记录"确认缺失"再返回 `FS_NOT_FOUND`，后续 `create` 可恢复外部删除的文件；**缺失永不授权 str_replace/insert**。

### 7. loop 层可靠性语义（不因极简而简化）

`packages/core/agent-loop/README.md` 展示了驱动语义：

- **插件失败结束当前 turn，而不是整个 loop**；模型调用失败进入 `agent/request-error` 恢复通道（可 retry），扩展失败直接关闭当前 turn。
- 取消/超时收敛：abort 后新工具调用被拒绝、已启动的结果被排干、未派发的调用得到合成 `ABORTED_BEFORE_DISPATCH` 结果——日志永远完整。
- 并行工具调用有界（`maxParallelToolCalls` 默认 10），排他调用形成屏障、结果保持模型序。
- 请求头记录有效配置与适配器来源，HMR 不会混用两个适配器的能力结果。

### 8. headless 模式与极简模式的组合

- **headless 是 profile**（一次性运行器，无服务器无浏览器，`packages/bundle/headless`）：`dsh --profile headless "task"` 创建一个 fresh persisted agent、提交任务、等待 quiescence、从持久区间推导最终文本与 `turn/end` reason，stdout 输出后退出（0=completed，1=失败）。
- **minimal 是 agent preset**（会话组装面）。二者可组合：`DSH_TOOLS_MODE`（native/code/both）选择部署的工具呈现，minimal 保留该呈现（`apps/cli/reference/README.md` 第 72 行）。
- `examples/jsonrpc-agent/minimal.cordis.yml` 是极简组合的完整独立版：llm-deepseek（deepseek-v4-flash，contextWindow 1M）+ sandbox（danger-full-access）+ subprocess + PTY + fs-local + agent-spine（persona 固定、关闭 identity/runtime-context/workspace-context/skills）+ persistent-bash + str-replace-editor + session-persistence-jsonl（`compression: none`）。

---

## 五、对自研 Agent 框架的启示（借鉴清单）

1. **模型面与宿主面分离**：工具/prompt 是"per-agent 组装层"，安全/持久化/权限是"全局底座"——极简预设不重复实现任何底座。
2. **工具数量是设计决策**：宁可少而完备（bash 兜底一切命令），不要多而重叠；每个工具进模型面都要问"它是否提供了 bash/编辑器覆盖不了的能力"。
3. **上下文纯净优先于功能堆砌**：固定 system prompt + 无动态注入 → 前缀缓存命中、预算全给任务、重建可验证。
4. **持久 shell 是代码任务的地基**：状态跨调用保留 + 超时/退出即重置 + 输出前缀保留与显式裁剪说明。
5. **精确编辑协议 > 整文件重写**：唯一匹配替换 + diff 展示 + 版本/缺失守卫，省 token 且防错。
6. **长任务不靠压缩靠窗口**：contextWindow 大 + 无 compaction 牺牲 → 无摘要损失；压缩是不得已的兜底，不是默认路径。

---

## 六、参考资料（仓库内路径）

- `apps/cli/config/agent-presets/minimal/agent.cordis.yml` + `preset.yml` — 极简模式定义
- `apps/cli/config/agent-presets/standard/agent.cordis.yml` — 对照组
- `packages/preset/agent-presets/README.md` — preset 机制（mount/isolate/recompose/子代理绑定）
- `packages/preset/persona/README.md` — complete / includeRuntimeContext / KV 缓存效应
- `packages/shell/tool-bash-persistent/README.md` — 持久 bash 契约
- `packages/fs/tool-str-replace-editor/README.md` — 编辑协议
- `packages/core/agent-loop/README.md` — loop 生命周期与失败语义
- `apps/cli/reference/README.md` — DSH_TOOLS_MODE、headless 一次性运行、默认权限
- `examples/jsonrpc-agent/minimal.cordis.yml` — 无人值守完整版组合
- `docs/architecture.md` — profile/bundle/核心包总览

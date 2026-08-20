# dsh 编码能力工程诊断：为什么 dsh 能写好代码而 CoBeing 不能

> 日期：2026-08-18
> 源码：dsh = `projects/deepseek-harness`（官方 master @ 99f6f02fec）；CoBeing = `D:\agent-codes\CoBeing`
> 方法：双方核心实现逐行对比（agent loop / 工具执行 / 会话日志 / prompt 组装），只论工程事实，不讨论模型能力差异
> 结论先行：**dsh 编码强不是模型强，是"每次请求都可重建、每次失败都可解释、每次调用都有序"的工程强。** CoBeing 缺的不是想法，是这层工程地基。

---

## 一、dsh 标准模式（standard preset）全景

standard 是 dsh 的完整编码 agent（`apps/cli/config/agent-presets/standard/agent.cordis.yml`，251 行，与 minimal 同属于 preset 机制）。它比极简模式多出的部分，正是"完整编码工作台"：

| 组成部分 | 内容 | 对编码的贡献 |
|---|---|---|
| **工具全家桶** | `tool-bash`/`tool-pwsh`（按平台二选一）+ `tool-fs`（read/write/edit/glob/grep）+ `tool-fs-search` | 读文件、搜索、编辑、跑命令全覆盖 |
| **plan mode** | `plan-mode`（作为 logged state 的模式，`exit_plan_mode` 协议，先探索后计划再实施） | 大改动先出计划再动手，防止"边想边写"跑偏 |
| **compaction** | `compaction-basic` + `tool-result-pruner`（threshold 8192 / head 4096 / tail 1024）+ `command-compact` | 长会话不爆上下文：工具结果裁剪 + 摘要替换旧节点 |
| **delegation** | subagent（spawn/fork）、workflow、ralph（fresh-agent 轮） | 大任务拆给子代理并行 |
| **辅助工具** | ask-user（澄清）、todo（todo_write）、web（搜索，fetch 默认关）、tool-jobs（后台任务控制）、skill | 交互、任务跟踪、信息获取 |
| **persona** | 动态模板 `You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.` + agent-instructions（读 AGENTS.md，65KB 预算） | 把仓库指令给模型 |

**关键认知：standard 与 minimal 的差异是"宽度"不是"深度"**——两者共用同一套 agent-loop、同一套会话日志、同一套工具执行管线。极简模式证明"深度"全部在 loop/日志/工具契约里，不靠插件堆砌。

---

## 二、为什么 dsh 编码强：六个工程机制（代码证据）

### 机制 1：请求可重建性——"模型看到了什么"永远说得清（最大差距）

`packages/core/agent-loop/src/agent.ts`：

- 每个请求由 `session.deriveMessages()` + `canonicalHeader()` 派生（agent.ts:340-341、458-463）——**请求是会话日志的纯函数**，日志里没有任何东西是"为了省事"而不记的。
- 每次请求前检查请求头是否变化，**只有变化才追加 `request/header` 事件**（agent.ts:464-470，`headerEquals` 比较）——日志里永远能重建"模型当时看到的确切 system/tools/messages"。
- 所有生命周期都落盘：`turn/start`、`step/start`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`（每个都带 turn/step 坐标与事件 seq）。
- `markAgentLoopRequest(deepFreeze(...))`（agent.ts:486）——请求深冻结，任何监听器只读不改。

**对编码的意义**：多轮改代码时，任何一步出错（模型跑偏、工具结果丢失、中断），都可以精确回放"模型看到了什么"来定位。快照测试（keyless 回放 JSONL）也由此而来——**可靠性是测出来的，不是想出来的**。

### 机制 2：工具执行是调度器，不是 for 循环

`packages/core/agent-loop/src/tool-calls.ts`：

- `executionMode` 分类：**exclusive（屏障）/ parallel（有界池）**（tool-calls.ts:88-89），`maxParallelToolCalls` 默认 10——模型一次返回多个工具调用（编码中常见：同时读文件+grep+glob）时并行执行、互不阻塞。
- 分类在每次提交前**重读**（tool-calls.ts:203-204，`re-executionMode`）——注册表变化影响未开始的调用。
- 结果**按模型序提交**（tool-calls.ts:146-160，`commitReady` 只推进连续槽位）——并行执行但模型看到的顺序不乱。
- `prepare → dispatch / post-result / final-result` 三态（tool-calls.ts:169-195）——权限、策略、呈现与执行分离。
- **abort 语义完整**（tool-calls.ts:237-242、249-259）：已开始调用排干并提交结果；未开始调用写合成结果 `Error: tool call aborted before dispatch`——**日志永远完整，重放永远有效**。
- 每个 `tool/call` 事件带 seq，`tool/result` 引用它（tool-calls.ts:262-289）——调用-结果成对，缺一不可。

**对编码的意义**：大改代码时模型可以并行探索（读多个文件再决定改哪），且任何中断都不会留下"半截调用"污染后续轮次。

### 机制 3：错误恢复通道，失败不致命

- 模型调用失败（超时/网络/协议）→ `agent/request-error` waterfall（agent.ts:354-370），监听器可返回 `{ kind: 'retry' }`（`dsh-llm-retry` 实现指数退避重试）；不处理才致命。
- **插件/工具失败只结束当前 turn，不杀 loop**（agent.ts:302-315）——turn 失败写 `turn/end {reason: error}` 后，下一次输入还能正常开新 turn。
- 错误结构化：`LlmError` 保留失败事实（provider、code、message），其它异常扁平化为 `errorChain` + `UNKNOWN` code（agent.ts:309-314）——日志里的错误永远可解释。

**对编码的意义**：网络抖动、单次工具异常不会让整个编码任务报废；且失败原因永远记录在案。

### 机制 4：KV 缓存前缀稳定——长会话又便宜又快

- 请求头只有变化才追加（机制 1）→ 同一 agent 的 system prompt + tools schema **字节级稳定** → provider 侧前缀缓存命中。
- persona README 明示：persona 在 agent 发布前挂载一次、文本永不改变 → "Prefix-stable for the life of an agent"。
- 工具结果是 append-only，跟随可复用前缀、不失效缓存（各工具 README 的 KV Cache effect 段是**强制文档义务**——每个工具都要声明自己的缓存效应）。

**对编码的意义**：编码任务历史长（几十轮工具调用），缓存命中率直接决定成本与速度。dsh 把"缓存稳定性"当作每个工具的文档义务来设计。

### 机制 5：工具契约是"模型视角"的工程品

- **fs 观察策略**（`packages/fs/fs-observation-policy`）：read 产生 freshness token，write/edit 用 token 守卫（stale → `FS_STALE_VERSION` 拒绝）；"确认缺失"记录让外部删除的文件可被 create 恢复；缺失永不授权编辑。`tool-fs` 的 read 有行号窗口 + 字节上限，`edit` 用 old_string 唯一匹配。
- **str_replace_editor**：view/create/str_replace/insert，唯一字面匹配（拒绝多匹配、无 replace_all），错误只用公开 `old_str` 词汇，diff 卡片展示。
- **持久 bash**：PTY 状态跨调用保留；输出保留**最早前缀** + 显式裁剪说明（绝不把尾巴冒充全文）；超时/exit 即重置 shell 并明说。
- 每个工具的 description/schema/结果格式都按"模型契约"写（`docs/cookbook/adding-a-tool.md`：presentation 是 args 的纯函数、UI render intent 设计在前）。

**对编码的意义**：工具是模型的"手"。手稳（精确编辑协议、版本守卫、明确的状态语义），代码就稳。

### 机制 6：plan mode 作为 logged state——先计划后动手

- plan mode 是**持久化的模式状态**（`packages/plan/plan-mode`，作为 session projection），不是 prompt 拼接。
- 协议强制：探索（只读）→ 出完整计划 → `exit_plan_mode` 唯一工具调用提交 → 审批后实施（standard/agent.cordis.yml:113-124 的 section 文本）。
- 工具目录跨模式不变（request-cache stability 的原因之一）——切模式不破坏缓存。

**对编码的意义**：复杂改动强制"先想清楚再写"，且计划可审、可拒、可迭代。

---

## 三、CoBeing 差距诊断（逐项对比，代码证据）

### 对比表

| 维度 | dsh | CoBeing（`conversation-loop.ts`） | 差距等级 |
|---|---|---|---|
| 循环结构 | turn/step 状态机 + 持久事件边界 | `for (round...)` 命令式循环（:231），历史是内存数组 | 🔴 结构性 |
| 请求可重建 | 请求 = 日志纯函数；header 变化才追加 | 无请求日志；`clearHistory` 截断即永久丢失（:616-622） | 🔴 结构性 |
| 工具执行 | 调度器：并行池/屏障/模型序提交/合成中止结果 | `for (const tc of toolCalls)` 串行（:487-550） | 🔴 结构性 |
| 中断自愈 | abort 合成结果保日志完整 | 中断时"补写 [已停止] 占位" + `repairIncompleteToolCalls` **截断历史**（:171-193、:489-495） | 🔴 数据丢失 |
| 错误恢复 | request-error 通道可 retry；插件失败只死 turn | provider fallback 链（有）；但工具异常只写 isError 结果；无 turn 级隔离 | 🟡 部分 |
| KV 缓存 | 请求头稳定 → 前缀缓存；工具文档义务 | 统计 cacheHit 但无前缀稳定设计；system prompt 固定但未管理请求头 | 🟡 部分 |
| 工具契约 | freshness/观察策略/编辑协议/持久 shell/输出前缀保留 | file-version CAS（有！）；结果截断 `slice(0, 8000)` 保留前缀但**提示分块**（:517-521）；bash 非持久（每次新进程） | 🟡 部分 |
| 计划模式 | plan as logged state + exit 协议 | 无 plan mode（群组有 JOB.md 纪律但无结构化模式） | 🟠 缺失 |
| 快照/回放测试 | keyless JSONL 回放 + 100% 覆盖门禁 | 739 单测 + 冒烟，无回放体系 | 🟠 缺失 |
| 上下文管理 | compaction（摘要+裁剪，参数化）+ 大窗口 | 工具结果 8K 截断 + maxContextMessages 100 条 + 预算熔断（有） | 🟡 部分 |

### 三个"为什么 CoBeing 写不好代码"的根因（工程层面）

**根因 1：历史不可重建 → 长任务必然熵增。**
CoBeing 的对话历史是内存数组，截断/自愈后"模型看过什么"变成不可知。编码是几十轮的长任务：第 30 轮模型写出的代码质量，取决于前 29 轮上下文是否精确无损。dsh 靠"日志=真相、请求=日志的函数"保证无损；CoBeing 靠 `slice` 和"自愈截断"——**每次出错都在丢上下文，而不是在解释错误**。

**根因 2：工具调用串行且中断处理粗暴 → 探索能力与可靠性双低。**
模型一次返回 5 个工具调用（读 3 个文件 + 2 个搜索）时：dsh 并行执行、按序提交、中断合成结果；CoBeing 串行执行、中断补占位、甚至截断历史。串行意味着大任务的时间线性增长；中断截断意味着失败后无法继续——**编码任务最需要的"并行探索 + 失败可续"恰好被结构挡住了**。

**根因 3：工具契约未按"模型契约"工程化 → 手不稳。**
CoBeing 已有 file-version CAS（好），但：bash 每次新进程（无持久状态，模型每次 `cd` 都要重来）；结果截断策略不一致；工具 description 未按模型视角审计；无 freshness 观察策略（read 后文件被外部改，write 无感知）。**模型的手（工具）不稳，写出的代码自然不稳。**

---

## 四、落地改进建议（按 CoBeing 现状可执行）

### P0（结构性，改造 conversation-loop）

1. **引入请求日志（可重建性）**：把每次 LLM 请求的 `{system, tools, messages, config}` 序列化为追加式请求记录（JSONL 或内存环形缓冲），失败/中断时可导出"模型看到的确切内容"；为快照测试打地基。改动集中在 `conversation-loop.ts` + 新增 `request-log.ts`。
2. **工具执行升级为调度器**：模型返回多个 tool_calls 时：分类（排他/并行）→ 有界并行池（默认 4-6）→ 结果按模型序写回 history → abort 时为未执行调用写合成结果（不截断历史）。`repairIncompleteToolCalls` 改为"补结果"而非"截断"。
3. **持久 shell**：bash 工具升级为 per-agent 持久 PTY（复用 dsh-terminal-bash 语义：状态跨调用、超时即重置并明说、输出保留前缀+裁剪说明）。这是"编译一次后直接跑"的体验前提。

### P1（质量）

4. **工具契约审计**：以模型视角重写全部工具 description/schema/结果格式；read 返回行号窗口、edit 唯一匹配校验、write 带版本守卫（已有 CAS，补 read 附版本行→write 校验的闭环提示）；统一结果截断策略（保留前缀 + 明确说明 + 分块读取指引）。
5. **plan mode（轻量版）**：实现为会话状态而非 prompt 拼接：`plan:start → explore（只读工具）→ plan:submit → 批准 → 实施`；模式切换不改变工具目录（保缓存）。
6. **KV 缓存前缀稳定**：固定 system prompt 组装顺序 + 工具 schema 排序稳定 + 记录请求指纹（header hash），供成本/速度观测。

### P2（工程文化）

7. **回放测试**：录制 1-2 条真实编码会话（JSONL），keyless 回放断言（工具调用序、错误路径、截断行为）——P0-1 落地后成本极低。
8. **失败语义文档化**：明确"工具失败不终止任务、错误永远入日志、中断永远可续"三条纪律，写入 CoBeing CLAUDE.md 与 loop 文档。

---

## 五、一句话总结

> **dsh 的编码能力 = 可重建日志 × 调度器式工具执行 × 模型契约式工具 × 前缀稳定缓存。**
> CoBeing 与 dsh 的差距不在"想法/功能清单"，而在这三个工程地基：历史不可重建（熵增）、工具串行（低效且脆弱）、契约不工程化（手不稳）。照 P0 三条改造 conversation-loop，是把"我写不好代码"变成"我也能写好"的最小充分路径。

---

## 参考资料

- dsh：`packages/core/agent-loop/src/agent.ts`（turn/step/请求重建）、`src/tool-calls.ts`（调度器）、`packages/core/tools/`（执行管线）、`packages/fs/fs-observation-policy`（freshness）、`packages/shell/tool-bash-persistent/`、`packages/fs/tool-str-replace-editor/`、`apps/cli/config/agent-presets/standard/agent.cordis.yml`、`packages/plan/plan-mode/`
- CoBeing：`packages/core/src/conversation/conversation-loop.ts`、`tools/`（bash/read-file/write-file/edit-file/file-version/executor）
- 前置学习：`docs/调研/deepseek-harness-极简模式学习笔记.md`

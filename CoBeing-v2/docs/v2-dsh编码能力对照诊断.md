# dsh 编码能力对照诊断（CoBeing v2 第二轮）：机制全景与差距清单

> 日期：2026-08-24
> 方法：dsh 当前源码逐包深研（3 路并行：agent-loop 生命周期 / fs 工具链 / plan-jobs-呈现）+ 与 CoBeing v2 现行实现逐项对照
> 前提：v1 时代诊断（`docs/调研/dsh编码能力工程诊断-CoBeing差距.md`，2026-08-18）中三大结构性根因（历史不可重建 / 工具串行 / 契约不工程化）在 v2 已由架构定稿解决（可重建事件日志 + 调度器六语义 + 持久 shell/精确编辑）。本轮找的是**第二轮差距**：v1 诊断之后仍存的、以及 v2 已实现但与 dsh 仍不完全对齐的机制面。

---

## 一、dsh 编码能力机制全景（源码证据摘要）

### A. 生命周期/循环层（`packages/core/agent-loop/` + `packages/core/session/`）

| 机制 | 源码证据 | 对编码的贡献 |
|---|---|---|
| turn/step 状态机 | `agent.ts:246-330` turn() 用 finally 保证 turn/end 必落盘；插件失败只断 turn 不杀 loop（:210-223） | 长编码任务任一步可回放、可续 |
| 请求 = 日志纯函数 | `session/index.ts:726` deriveMessages() 折叠 surface 缓存；请求 deepFreeze（agent.ts:486） | "模型看到了什么"永远可重建 |
| **request/header 变化才追加** | `agent.ts:458-470` canonicalHeader + headerEquals 比较，只有变化才落 header 快照（reason: initial/resume/change） | 日志不膨胀、重建精确 |
| 错误恢复通道 | `agent/request-error` waterfall；监听器返回 `{kind:'retry'}` 触发重发；LlmError 结构化 + errorChain 展平；llm-retry 指数退避+jitter 且**先落盘再等** | 网络抖动不报废任务 |
| KV 缓存前缀稳定 | system-prompt `orderTools` 字典序排序（index.ts:164-183）保证跨机一致；工具 README 强制 "KV Cache effect" 段 | 长会话又快又省 |
| abort 收敛 | tool-calls.ts 取消后排干已启动、未派发写合成 `TOOL_ABORTED_BEFORE_DISPATCH` | 中断不污染后续轮次 |
| compaction 压力触发 | agent/pre-step + context-overflow 触发；pruner 8192/4096/1024（config.ts:10-14） | 长会话可控 |

### B. 文件系统工具链（`packages/fs/`）

| 机制 | 源码证据 | 对编码的贡献 |
|---|---|---|
| **fs 观察策略（freshness）** | read 一次 stat 记 `info.version` 并 emit `fs/observed`（tool-fs/read.ts:140-162）；写/改前经 `fs/write-intent`/`fs/edit-intent` 拿意图；provider 在 **withLock 持锁临界区**原子 CAS（fs-local/index.ts:172-183），stale → FS_STALE_VERSION；unseen → FS_NOT_OBSERVED；缺失 → FS_NOT_FOUND | 杜绝基于陈旧观点的盲写 |
| 缺失文件永不授权编辑 | str_replace/insert 走 edit-intent，absent 抛 FS_NOT_FOUND；外部删除经"确认缺失"→ create 可恢复 | 手稳 |
| read 分页协议 | 1-based 行号 + offset/limit（默认 2000）+ 单行/整窗上限 + **footer 指引 `offset=end+1` 续读** + 精确 totalLines + 二进制 NUL 探测 | 可控 token、可续读 |
| edit 唯一字面匹配 | 0/多匹配拒绝（无 replace_all）；错误只回显公开 old_string | 防误伤、可自纠 |
| diff 卡片 | write/edit `{card:'diff', diffs:[{path,oldText,newText}]}`（edit.ts:151-166） | 人可审改 |
| glob/grep 确定性 | glob 无斜杠匹配任意深度 basename、跳 VCS/node_modules、上限 100；grep 上限 250、`--json` 结构化、相对路径 | 探索高效 |

### C. 计划/任务/呈现层（`packages/plan/` + `packages/jobs/` + `packages/todo/` + `packages/core/agent-tool-presentation/`）

| 机制 | 源码证据 | 对编码的贡献 |
|---|---|---|
| **plan mode = logged state** | `plan/mode` 事件 whole-value replace、最后 wins；foldPlanMode 纯折叠（index.ts:129-138）；exit_plan_mode **常驻注册**（工具目录跨模式不变，:16-18）；只改变 prompt section | 先探索后计划再实施，计划可审可拒可续 |
| todo_write 整表替换 | 每次调用写完整列表到 session log `todo/write`（tool-todo/index.ts:213）；投影 last-write-wins；turn/start 清空 | 多步任务活清单、防偏离 |
| jobs 后台任务 | JobHooks{cancel,done,readOutput}；owner-fenced；job_output 带 wait deadline；`[status:...]` 定式输出 | 长命令不阻塞推理轮 |
| ask-user 阻塞转 UI | 执行时暂停工具调用，回答以普通工具结果喂回当前 turn | 歧义就地解决 |
| 工具呈现解耦 | presentCall/presentResult 纯函数返回 `{card:'generic'|'terminal'|'diff'}` | GUI 与输出协议独立迭代 |
| subagent composeFrom | 子代理 join 父 preset 组合防代际漂移；继承 provider/model/workspace | 大任务水平拆分 |
| 持久 bash 细节 | cwd/env 跨调用；超时 300s 返 partial + reset 告知；LOST_PREFIX_MESSAGE 保留最早前缀 | 编译测试渐进推进 |

---

## 二、v2 现状对照（已具备 / 差距）

### 已具备（v2 架构定稿即覆盖 dsh 对应面）

- ✅ 可重建事件日志（JSONL append-only + 投影动态重建 + compaction 遮蔽）≈ dsh session log + surface
- ✅ 调度器六语义（排他/并行/模型序提交/合成结果/失败落槽位）≈ dsh tool-calls
- ✅ 持久 shell（node-pty，cwd/env 跨调用，超时重置，保留最早前缀）≈ dsh persistent bash
- ✅ 精确编辑（唯一字面匹配、无 replace_all、写走 assertWrite）≈ dsh str_replace
- ✅ 工具 schema 摘要注入（组装 [可用工具] 含参数键名/枚举）≈ dsh tool catalog（但位置不同，见差距 1）
- ✅ glob/grep/todo（2026-08-24 落地）
- ✅ ask-user 确认卡片（butler 工具 → GUI 渲染）≈ dsh ask_user_question
- ✅ 错误恢复：网关串行队列/RPM/超时/重试（指数退避）≈ dsh llm-retry
- ✅ 压缩：ButlerRuntime 归档（总结→压缩→compaction）≈ dsh compaction

### 差距清单（本轮优化目标）

| # | 差距 | dsh 证据 | v2 现状 | 优先级 |
|---|---|---|---|---|
| 1 | **组装前缀不稳定**：工具清单/输出协议在 user 文本内、systemNote（动态）置于最前 | system-prompt orderTools 字典序 + 冻结 system + 历史 append-only | `[可用工具]` 每次组装重新生成（内容相同但位置随 systemNote 漂移）；system 三段冻结但工具面不进 system | 🔴 P0 |
| 2 | **request/header 不含 model 面完整头**：只有 provider/model/maxTokens | header 含 config/system/tools，变化才追加、可折叠重建 | 每次请求都追加、不可重建"工具集当时长什么样" | 🔴 P0 |
| 3 | **无 fs 观察策略**：view 后文件被外部/他智能体修改，write 无感知 | freshness version token + 持锁 CAS + FS_STALE_VERSION | write 无条件覆盖 | 🔴 P0 |
| 4 | **无 request/error 事件**：模型调用失败只有网关重试，失败事实不落盘 | agent/request-error waterfall + LlmError 结构化 | 重试后仍失败 → run() catch 写 [工作失败]，无结构化错误链 | 🟡 P1 |
| 5 | **工具结果无分级裁剪**：统一 20 条/8000 字符 | tool-result-pruner 8192/4096/1024 | renderToolResults 20 条 + 8000 截断 | 🟡 P1 |
| 6 | plan mode 缺失 | plan/mode logged state + exit_plan_mode | 群组任务直接开工（todo 可部分替代） | 🟢 P2（随 GUI 二期） |
| 7 | jobs 后台任务缺失 | tool-jobs owner-fenced | 持久 shell 已支持后台作业但无工具面 | 🟢 P2 |
| 8 | 工具呈现无 render intent | presentCall/presentResult card 纯函数 | GUI 二期 | 🟢 P2 |

---

## 三、优化方案（本轮实施 1-5）

### P0-1：组装前缀稳定（KV 缓存命中的地基）

- **工具清单 + 输出协议移入 system 冻结段**：`[可用工具]`（含 schema 摘要）与 `[输出协议]` 从 user 文本移入 system 第三段（定义段之后），按**名称字典序**渲染（跨实例一致，与 dsh orderTools 对齐）。
- **system 三段保持字节稳定**：基座 + 协作协议 + 定义/工具面——均实例化冻结，运行期不变 → 请求前缀字节级稳定 → DeepSeek 前缀缓存命中。
- **user 文本只含动态内容**：系统状态注记、唤醒内容、公共上下文、私密、工具结果——append-only 增长，不干扰前缀。
- 注意：denyTools 按实例过滤后渲染（主窗口但丁与群组智能体工具面不同，但各自冻结）。

### P0-2：request/header 升级为可重建完整头

- `RequestHeaderEvent` 扩展：`system`（组装后的 system 全文，或摘要）+ `tools`（可用工具名列表）+ `reason: 'initial' | 'change'`。
- **变化才追加**：agent-loop 缓存上次 header，`headerEquals`（system+tools+provider/model）相同则不追加——与 dsh 对齐，日志不膨胀。
- 重建辅助：`foldRequestHeader(events)` 导出，从日志恢复任意请求当时的有效头。

### P0-3：fs 观察策略（read→write 版本守卫）

- editor 增加**观察状态表**（按 `${group}/${agent}/${path}` 键）：view 成功 → 记录 `{version: stat(mtimeMs+size)}`；外部/他智能体修改 → version 变化。
- **write/create/str_replace/insert 前校验**：未观察 → `FS_NOT_OBSERVED`（提示先 view）；已观察但 version 过期 → `FS_STALE_VERSION`（提示 "file changed since your last view; re-read then retry"）。
- 缺失文件：view 缺失 → 记 "确认缺失"；create 可恢复（已存在但未观察 → 拒绝）。
- 持久 shell 的 bash 修改文件场景由 shell 结果文本提示（bash 无版本语义，属已知边界，写入工具描述）。

### P1-4：request/error 事件（失败事实落盘）

- 新事件类型 `request/error`：actor / provider / model / attempt / errorChain（message + code）——模型调用失败经网关重试仍失败时落盘。
- agent-loop 在 gateway.chat 抛错时捕获并落盘，再抛给 run() 的 catch（保留 [工作失败] 汇总发言）。

### P1-5：工具结果分级裁剪

- renderToolResults 分级：最近 5 条全量（8000 字符上限）；更早结果截断至 1024 字符 + 显式 `…[truncated by pruner]`——与 dsh pruner 8192/4096/1024 同思路，v2 场景取 8000/1024 两档。

---

## 四、验证方案

1. TDD：每项优化配套单测（header 变化才追加 / header 重建 / 前缀稳定断言 / freshness 三态 / request-error 落盘 / 结果分级）。
2. 真实 DeepSeek 编码任务回归：`scripts/verify-coding-tools.mjs`（todo→write→bash 全链路）+ CLI 冒烟 7/7。
3. 前缀稳定性观测：真实运行中连续两次请求的 system 段字节相同（组装单测覆盖即可，避免真实调用噪声）。

## 五、后续（P2，随 GUI 二期或独立排期）

- plan mode（logged state + exit_plan_mode 常驻 + 群组审批复用 ask-user 卡片）
- tool-jobs（owner-fenced 后台任务 + `[status:]` 定式输出）
- 工具呈现 render intent（diff/terminal 卡片进 GUI）
- 快照回放测试体系（keyless JSONL 回放）

---

## 参考

- 前置：`docs/调研/dsh编码能力工程诊断-CoBeing差距.md`（2026-08-18，v1 视角）
- 前置：`docs/调研/deepseek-harness-极简模式学习笔记.md`（2026-08-18）
- dsh 源码路径见各表内证据

# 2026-08-09 待办专项调研成果（决策表 #2/#3/#6/#8/#10/#11）

> 调研日期：2026-08-09
> 背景：用户对第一性原理报告逐条裁决后，对「需额外研究/需调研/待确认」的条目完成自主调研。
> 本文件汇总四份调研产出，供实施排期使用；对应决策记录见 `docs/项目信息/当前待办.md`「2026-08-08/09 第一性原理报告决策记录」。

---

## 1. 群组并发写防护（决策 #2：群组多智能体并发是核心功能，可改进工程防护）

**定位**：不做架构收敛（用户否决单一推进者方案），只做并发写防护，防止多 Agent 同时操作同一工作区文件时静默覆写。

**外部证据**：5 个并发 Agent 改同一仓库时 24% 改动静默消失且构建通过（阿里云实践文）；共享状态必须有版本检查/CAS/租约（durable execution 共识）。

**建议方案（待实施排期）**：
1. **写前版本检查（CAS）**：write-file/edit-file 在执行前检查目标文件 mtime/大小（或内容哈希），与 Agent 读取时的快照不符 → 返回「文件已被其他成员修改，请重新读取」错误。最小实现：工作区文件写入口记录 `lastWriter` + `lastWriteAt`。
2. **低配租约**：群组工作区写入前先「认领」文件（写 `.lock` 或内存 Map），完成即释放；超时（如 10 分钟）自动释放防死锁。优先内存 Map（单进程，无需落盘）。
3. **优先级低于 TODOboard 改进**：先做 TODOboard（决策 #3），并发写防护可与其共用扫描/状态基础。

**验收**：陈默场景群组内两个 Agent 同时被唤醒操作同一文件 → 至少一个收到「文件已变更」错误而非静默覆盖。

---

## 2. TODOboard 改进方案（决策 #3：Global 大类账本 + Group 具体任务三层隔离）

**现状盘点结论**（todo/ 目录 8 文件全读）：
- TodoItem 触发三模式齐全（time/0time/condition），但 **Agent 级 0time/condition 永不触发**（scanner.ts 只扫 time，明摆着的 bug）
- `getOverdueTodos()`（含 1h 阈值）**已实现但全库无调用方**——普通 time TODO 触发后永不重唤醒（goal 机制缺核心一环）
- `recurrenceHint` 是纯 LLM 提示文本，无 cron 语义——「每天 8 点报天气」靠 LLM 人肉续期（陈默数据实证：host 用「续期/续期2/续期3」每 2 小时新建 TODO 模拟轮询）
- `expired` 是死状态；`onComplete.createTodo` 是死字段；`OVERDUE_THRESHOLD_MS` 只用于文案
- Global（管家账本）无触发机制、无时间字段——纯账本 + 状态机，由 Butler 工具与完成回流驱动（与 Group TODO 的隔离是有意设计，非冗余）

**P0 最小改进**（全部 optional 字段，588 测试零破坏）：
1. 数据模型（todo/types.ts）：`repeat?{type:"daily"|"weekly"|"interval", timeOfDay?, weekday?, intervalHours?, until?}`、`nextTriggerAt?`、`overduePolicy?{action:"re-wake"|"escalate-to-host", cooldownMinutes?:10, maxRetries?:3}`
2. 触发引擎：`getRepeatDueTodos()`（触发后计算下次 nextTriggerAt 保持 pending，复用 0time「已触发保持 pending」已验证语义）；**`getOverdueTodos()` 接线**（超时重唤醒承担者，带冷却 + 只重触发不重建——0time 300 条刷屏事故教训）；`AgentTodoScanner` 补 0time/condition
3. GUI：TodoPanel 行内「下次触发/已逾期」标记；GlobalTodoPanel 补 internalBlocker 展示

**P1 完整协议**：统一 TriggerEngine（五类 due 集合收敛）、goal 升级阶梯（1h 重唤醒 → 3h @群主 → 6h 通知 butler）、依赖链加固（dependencyNotifiedAt 防重复通知、上游被删检测、跨 store 依赖）、cron 追赶（missedCount）、`onComplete.createTodo` 实现、GlobalTodoItem 加 deadline/repeat

**风险**：重触发刷屏（必须带冷却+幂等）；repeat 与 0time 显式互斥；时区（time-tool 只报 UTC，P1 必须 timezone 字段）；group-scanner complete() 的 Global 回流链路不得破坏

**验证**：陈默场景注入 `repeat:{type:"daily",timeOfDay:"08:00"}` 天气 TODO 断言次日再触发；给「写手大纲」TODO 加 `overduePolicy:{action:"re-wake"}` 断言超时后 @mention 再唤醒且无重复条目。

---

## 3. 记忆纪律调研（决策 #6）

**外部证据**（报告 §3.2-6 已有）：文件式记忆主流实践 = MEMORY.md 指针索引（每条 <150 字符）+ 写入过滤（Q1 不看会犯错→P0 永不过期；Q2 将来可能查→P1 ~90 天 TTL；否则只留日志）+ 定期整合（L0 常驻/L1 按需/L2 日志，90% 查询只需 L0+L1）+ **过期记忆比没有记忆更误导**（Simon Willison 一手验证）；多 Agent 写同一记忆文件需 provenance。

**建议方案（待实施）**：
1. Memory ToolAgent 输出协议补：`entries[].ttl?`（P0/P1/P2 分级）、`provenance`（来源 agent id）、写入过滤提示（Q1/Q2/Q3 规则写入 prompt.md）
2. 定期整合：管家/群主 JOB.md 增加「每周整合 EXPERIENCE.md」（去重、合并、过期标记）
3. 并发写防护：与决策 #2 共用文件写 CAS
4. 可验证手段：记忆加载提供「你记得我什么」入口（对管家提问时返回当前 MEMORY/EXPERIENCE 快照）

**注意**：本项为调研结论，实施排期在 TODOboard 与并发写防护之后。

---

## 4. ToolAgent 专项确认（决策 #8）

**盘点结论**（8 类型 + base/spec/types + 全仓调用点）：
- `runToolAgent` 是唯一统一基座（provider.chat + ToolExecutor 循环，maxIterations 控制，120s 兜底）
- **`loadToolAgentSpec()` 生产代码零消费**（仅 index.ts 导出 + 测试调用）；插件 SDK 的 `registerToolAgent` 是死注册（`__cobeing.toolAgents` Map 无人读）；GUI 零引用
- 8 类型全部无状态（临时 id、无身份、无长期记忆）

**判断矩阵**：
| 类型 | 判定 | 理由 |
|---|---|---|
| clone | ①保留为 ToolAgent | 唯一真·多轮工具循环（maxIterations 5-10，7 工具） |
| memory | ①保留 | 多轮提取（read-file/grep，3 轮），个人/群组双 mode |
| review/judgment/growth-reviewer/task-archive/capability-updater | ②收敛为普通工具引擎 | 全部单轮纯判断、零工具 |
| creator | ②收敛为普通生成服务 | 现状是「伪 ToolAgent」：不走 runToolAgent、不读自己配置卡、硬编码 SYSTEM_PROMPT（双份 prompt 需合并） |
| 统一注册 | ③轻量版值得做 | 死注册复活 + spec 元数据唯一入口 + 插件消费 + 日志分类 |

**建议实施**：2 真主体 + 6 工具引擎（保留 `run*` 导出名薄封装，破坏面 ≤5 个测试断言）+ 轻量 ToolAgentRegistry（注册/发现/插件消费/日志分类，不做 GUI 面板与统一评估——anti-overengineering）。creator 双份 prompt 独立先修。

---

## 5. 安全分类器工具智能体（决策 #10：抛弃 Docker 沙箱）

**Claude Code auto 模式机制事实**（官方文档 + 工程博客 + 社区代码分析）：
- 分类器 = 每次工具调用前的**独立 LLM 裁决调用**（yoloClassifier），非规则引擎；工具调用挂起至裁决
- 裁决三值：allow（静默放行）/ deny（拒绝 + 理由，Agent 换方案）/ ask（回退人工询问）
- **两级流水线**：fast（max_tokens=64）→ thinking（CoT 重判压低误伤）；官方实测 FPR 0.4%（全流水线）/ FNR 17%（诚实数字）
- **reasoning-blind 是防御核心**：分类器输入 = 用户消息 + 待裁决调用 + CLAUDE.md，**不含工具结果、不含 Agent 推理**（防话术说服、防 prompt injection 操纵）
- 规则优先级 first-match-wins：用户 deny > ask > 只读/工作目录内编辑自动放行 > 分类器；分类器内部 hard_deny > soft_deny > allow > 显式用户意图
- **熔断器**：连续 3 次 / 累计 20 次 block → 回退经典询问（非交互则终止）
- 已知坑：Friendly Fire 攻击（文档注入操纵分类器，模型层难修复）；`dangerouslyDisableSandbox` 被静默放行（类逃逸口必须 hard-deny）；分类器镜像主模型（成本/容量问题，建议专用轻量模型）

**CoBeing 落地建议**（待实施）：
1. 新建 `tools/safety-classifier.ts`：`classifyToolCall({toolName, 参数摘要, agentId, workingDir, 上下文}) → {verdict:"allow"|"deny"|"ask", reason}`；复用 judgment.ts 的调用骨架（无工具 + JSON 严格输出 + AbortController 15s 超时）；**不注册进任何 Agent 工具白名单**（iron gate：分类器被 Agent 触达即失效）
2. PermissionEnforcer 决策链：deny 无条件拒绝（hard_deny）→ allow 命中但 bash 仍过 EXTREME_DANGER 正则 → `mode==="auto"` 时只读/工作目录内编辑直接放行 → 其余调分类器 → **ask 无人工通道时降级 deny**；**兜底 fail-closed**（分类器不可用=拒绝；现状是 fail-open，必须改）
3. 成本控制：两级流水线 + 会话级裁决缓存（allow 缓存、deny 不缓存）+ 跳过清单 + `judgeModel` 可配置（避免镜像主模型）
4. 审计：`events.emit("tool:classified", {agentId, toolName, verdict, stage, latencyMs})`
5. `check()` 需异步化（executor.ts:45 改 await）；`PermissionMode` 增加 "auto"
6. bash-classifier.ts（现成正则分级）作为 Stage 0 硬规则保留

**依赖**：PermissionMode 扩展（shared）、permission.ts 异步化、executor 调用点。建议在 TODOboard 改进之后排期（独立模块，无耦合）。

---

## 6. GUI 入口收敛研究（决策 #11：只暴露管家，其它入口放进别的菜单）

**现状**：六入口纯前端状态机（ViewType 六值，后端零耦合）；`activeView` 非持久化默认 "butler"（启动即管家，收敛天然利好）；NavBar 6×44px 图标按钮；键盘 Ctrl+1~6 硬映射；未读徽章独立于入口项。

**推荐方案**：**方案 1（NavBar 折叠 +「更多」菜单）+ 方案 3（进阶模式开关）合并**，暂不做管家页二级入口卡片：
1. `stores/settings.ts` 加 `advancedNav: boolean`（默认 false）+ localStorage 持久化（key `cobeing_advanced_nav`）
2. `NavBar.tsx`：常驻组（管家、设置）+ 折叠组（智能体/群组/仪表盘/扩展 → Radix DropdownMenu，依赖已在 package.json）；`advancedNav=true` 时恢复全量六项
3. `SettingsView` GeneralSection 加「完整导航」开关
4. 文案同步：TutorialOverlay 第 5 步改「⚙ 进设置」并补「⋯ 菜单」提示
5. 键盘快捷键不跟随开关（Ctrl+1~6 保持稳定）

**兼容性**：NavBar 无测试覆盖（surface-style-audit 不含它）；MainContent/Sidebar/详情面板全不动；activeView 非持久化无迁移问题。前端 vitest 19 例不受影响。

---

## 实施优先级建议

1. **P0 立即**：TODOboard P0 改进（goal 机制缺口最影响体验）→ 陈默场景验证
2. **P1**：GUI 入口收敛（纯前端，独立可交付）；安全分类器（与沙箱废弃绑定，需 PermissionMode 扩展）
3. **P2**：ToolAgent 收敛 + 轻量注册；并发写防护（CAS）；记忆纪律（TTL/过滤/整合）；creator 双份 prompt 合并；HRR Phase 2
4. 每项沿用陈默专项基建做真实验证（data-sim-chenmo 场景 + 断言脚本），不满足「行为可复现」不宣称完成

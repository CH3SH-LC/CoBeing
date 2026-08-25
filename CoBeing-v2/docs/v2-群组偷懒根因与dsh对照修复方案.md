# v2 群组智能体"偷懒"根因分析 + dsh 对照 + 修复方案

> 日期：2026-08-25
> 状态：**根因已定（3 子智能体独立审计 + 2 实证实验 + dsh 源码对照）；5 项修复已全部实施并真实验证（2026-08-25，见第七节实施记录）**
> 背景：用户反馈"主窗口对话正常，群组内智能体偷懒（不调工具直接回复 / 只做一两步）"；用户要求不用硬方法约束（如"0 工具就拒绝"），找真实原因；并对照 dsh 源码找"为什么 dsh 能优秀工作"。

---

## 一、根因链（6 层，全部有代码证据）

```
用户一句话
  ↓ ①【群组特有·最直接】mention 为空 → 零唤醒（packages/core/src/runtime/group.ts:57-63）
  │      for (const target of mention ?? []) —— mention 空时循环不执行，无实例 wake
  │      GUI/mobile 群组页 mention 默认 []（gui/src/views/GroupsView.tsx:20/99 + mobile:84-85）
  │      对照：主窗口 mainWindowSpeak 无条件唤醒但丁（kernel.ts:386-401）
  ↓ ②【引擎级·群组显痛】round≥2 任务锚点丢失（packages/core/src/runtime/agent-loop.ts:146）
  │      工具执行后 message={content:'',task:undefined} → [唤醒内容]/[任务说明] 消失
  │      + renderPublic 不渲染 task 字段（packages/core/src/event-log/projection.ts:142-144）
  │      + 群组公共上下文 = 200 条多人+系统反馈高噪声 vs 但丁纯净短对话
  ↓ ③【机制性·三份报告一致】reply=done 无工具强制（agent-loop.ts:353-354）
  │      模型输出任何 reply（哪怕"好的我开始了"）→ 回合当场结束
  ↓ ④【机制性·H1 实证】诚实审查 rule2 放行"过程性话术"（tools/builtin-tool-agents.ts:40）
  │      只拦"声称完成"，不拦"没干活"→ 反向教会模型用话术规避 → 偷懒合法化
  ↓ ⑤【机制性·必失败诱饵】worker 无 denyTools（kernel.ts:755）→ 可见 4 个必失败协调工具
  │      butler-relay / list-groups / create-group / ask-user（guard 恒失败但仍展示）
  ↓ ⑥【放大项】maxTokens=2048 默认（gui/src/views/AgentsView.tsx:19）
  │      PvZ E2E 实证 2048 写大文件必截断 → 多轮往返惩罚 → 模型学到"小步/reply 更省"
```

**为什么主窗口正常**：但丁被设计成"回复即正当"的协调者（BUTLER_PERSONA_PROMPT 明确不干活 + 无条件唤醒 + denyTools 后工具全匹配协调角色 + 纯净上下文），所以它 reply 永远合法；worker 被期望多步工具调用，却同时被 ①③④⑤⑥ 五重结构推向"就此汇报"，系统只有一句【回合纪律】自然语言劝诫（agent-loop.ts:556），无结构性托底。

**已排除**：maxToolRounds（worker 10 > 但丁 6）、经验注入机制（同函数同 caps）、调度器（六语义完整）、组装骨架/输出协议 JSON（两路径共有）。

## 二、实证实验（已通过）

- **H1（诚实审查诱导）**：mock 模型输出"好的我开始了"（0 工具）→ 审查规则 2 pass → 发言发布 → 回合结束。文件：packages/core/tests/lazy-h1.spec.ts
- **H2（任务锚点丢失）**：第 1 轮 userText 含 `[唤醒内容] 任务` + `[任务说明]`；第 2 轮两者消失（只剩空 `[唤醒内容] `）。文件：packages/core/tests/lazy-h2.spec.ts
- 真实 DeepSeek 诊断：同任务群组 worker 一次认真完成 3 步（条件性行为，非必然）

## 三、dsh 为什么能优秀工作（源码对照，projects/deepseek-harness）

**本质**：dsh 从不靠"你必须努力"的巨型命令提示词，而是靠结构性循环 + 全量历史 + 无二选一协议 + goal 强制续跑。

### dsh 五大机制（源码证据）
1. **回合终止是结构性的**（packages/core/agent-loop/src/agent.ts:393-399）：
   ```js
   const toolCalls = message.content.filter(block => block.type === 'tool-call')
   if (toolCalls.length === 0) return { kind: 'completed' }   // 无工具调用 → 自然结束
   const { concluded } = await executeToolCalls(...)
   return concluded ? { kind: 'completed' } : null            // 有调用未 concluded → while(true) 继续
   ```
   模型输出文本≠结束回合；`concludesTurn` 由工具契约设置（packages/core/tools/src/index.ts:420 concludeTurn()），只有 goal 完成/blocked 等权威动作才触发（packages/goal/tool-goal/README.md:17）。
2. **任务目标每轮全量在场**：deriveMessages()（packages/core/session/src/index.ts:726）从持久日志全量重放；compaction 结构化 checkpoint（Primary Request / Pending Jobs / Next Step，packages/compaction/compaction-basic/src/summarizer.ts:31-70）跨压缩保目标。
3. **没有"否则 reply"的二选一协议**：系统提示只含身份+persona（packages/core/system-prompt/src/index.ts:361,364）；minimal preset persona 仅一句 "You are a helpful software engineer assistant."（complete:true）依然多步工作——能力在结构不在提示词。
4. **三层防提前停护栏**：goal-round-driver idle+armed 自动注入下一轮（packages/goal/goal-round-driver/src/index.ts:103-172，轮数到顶才 block）；blocked 报告带阈值硬门（tool-goal:299-305）；step while(true) + inbox next-step 闸门 + agent/turn-stopping 事件（agent.ts:295-300,324）。
5. **工具契约的完成标准**：todo 即完成即勾、全完成才允许无 in_progress（packages/todo/tool-todo/src/index.ts:45-67,107-109）；repeat-tool-reminder 抓打转（packages/guard/repeat-tool-reminder/src/index.ts:63-79）；goal guidance"完成前必须收集证据"。

### dsh vs CoBeing v2 对照
| 维度 | dsh | CoBeing v2 | 差距 |
|---|---|---|---|
| 回合终止 | 无 tool-call 块 或 concludesTurn | reply 即结束（agent-loop.ts:353-354） | 🔴 结构性 |
| 任务锚点 | 全量历史每轮在场 | 第 2 轮清空 + task 不渲染 | 🔴 结构性 |
| 输出协议 | 无"否则 reply" | 明写"否则回复 JSON reply"（agent-loop.ts:195） | 🟠 提示性 |
| 长任务驱动 | goal round 强制续跑 + blocked 阈值门 | 【回合纪律】纯文本 | 🔴 结构性 |
| 工具终止权 | 工具可 concludesTurn | 无 | 🔴 结构性 |
| 防打转 | repeat-tool-reminder | 无 | 🟡 缺失 |

## 四、修复方案（5 项，全部结构性、无硬约束——用户明确反对硬方法）

### 修复 1：群组默认唤醒（修"没被叫醒"）
- `GroupRuntime.speak`：mention 为空时默认唤醒全部工作智能体（或经群组内 butler 转达）
- GUI/mobile 群组页：发送时未选 mention → 提示"将唤醒 @all"或默认勾选工作智能体
- 对齐：主窗口 mainWindowSpeak 无条件唤醒但丁

### 修复 2：任务锚点保留（修"第 2 轮失忆"）——对齐 dsh 全量历史在场
- agent-loop run()：工具执行后 `message = { content:'', task: 保留原 task }`（task 不清空）
- renderPublic：渲染 task 字段（`actor: content [任务: task]`）
- 效果：模型每轮都能看到任务说明，不需要从 200 条高噪声公共上下文里考古

### 修复 3：回合终止改为"本轮无工具调用才结束"——对齐 dsh step 循环（替代硬约束）
- agent-loop step()：reply 不再自动 done。逻辑：
  - 本轮有 toolCalls 且执行成功 → `done: false` 继续循环（工具结果回填，模型自然看到进展）
  - 本轮无 toolCalls（纯 reply）→ `done: true` 自然结束
- **这不是"0 工具就拒绝"的惩罚性硬闸**——是结构性修正：把"结束权"从模型措辞手里收回结构手里；模型真的完成了工作后输出纯 reply 依然正常结束
- 注意：与"诚实审查拒绝"路径区分——诚实审查仍是防假完成的兜底（规则 1 保留）；规则 2 语义修正为"过程性发言需已有 ≥1 次成功工具调用才 pass，0 工具时提示继续"（引导性反馈）

### 修复 4：删除"否则 reply"输出协议 + 工具面收敛
- agent-loop.ts:195 输出协议改为 dsh 式："需要工作时调用工具，工具结果会回填；只有确认完成才输出最终回复"——不给偷懒盖章
- worker denyTools 过滤协调/元工具（butler-relay/list-groups/create-group/ask-user），只留干活类 + 群内发言——减少必失败诱饵

### 修复 5：群组任务 goal 化（对齐 goal-round-driver）+ maxTokens 默认 8192
- 群组任务 = 轻量 goal：objective 每轮重述 + 未完成自动续轮 + blocked 阈值门（复用现有经验/归档机制）
- GUI/mobile 创建智能体默认 maxTokens 2048 → 8192（消除截断惩罚）

## 五、验证计划（修复后必跑）

1. 单测：lazy-h1.spec.ts 改为"0 工具过程性 reply → 不再结束（继续循环）"；lazy-h2.spec.ts 改为"第 2 轮仍含 [任务说明]"
2. 回归：core 全量（当前 201/201）+ GUI 25/25 + mobile 15/15 + typecheck
3. 真实 E2E：verify-pvz-e2e 32/32、verify-sync 14/14、verify-honesty 4/4、verify-remote 11/11、verify-mobile-chat 6/6
4. 新增：真实 DeepSeek 群组"用户一句话不带 mention"场景 → 应默认唤醒并工作（修复 1 验证）

## 六、相关文件索引

- 根因代码：packages/core/src/runtime/agent-loop.ts、group.ts、kernel.ts、event-log/projection.ts、tools/builtin-tool-agents.ts、tools/butler-tools.ts、tools/butler-relay.ts
- UI：gui/src/views/GroupsView.tsx、AgentsView.tsx；mobile/src/views/GroupsView.tsx、AgentsView.tsx
- 实验：packages/core/tests/lazy-h1.spec.ts、lazy-h2.spec.ts
- dsh 源码：projects/deepseek-harness/packages/core/agent-loop/src/agent.ts、core/tools/src/index.ts、core/session/src/index.ts、core/system-prompt/src/index.ts、goal/goal-round-driver/src/index.ts、goal/tool-goal/src/index.ts、compaction/compaction-basic/src/summarizer.ts、guard/repeat-tool-reminder/src/index.ts、todo/tool-todo/src/index.ts、apps/cli/config/agent-presets/minimal/agent.cordis.yml
- 既有调研：docs/调研/dsh编码能力工程诊断-CoBeing差距.md

---

## 七、修复实施记录（2026-08-25，5 项全部落地 + 真实验证）

### 修复落地明细

| # | 修复项 | 代码落点 | 说明 |
|---|---|---|---|
| 1 | 群组默认唤醒 | `runtime/group.ts` speak()：mention 空 → 默认 `['@all']` 唤醒全部工作智能体；GUI/mobile 群组页未选 @ 时显示"将唤醒全部工作智能体"提示 | 对齐主窗口 mainWindowSpeak 无条件唤醒；group-speak 工具不经本入口，汇报不级联唤醒 |
| 2 | 任务锚点保留 | `runtime/agent-loop.ts` run()：`anchorTask` 跨轮保留（feedback 消息自动补回 task）；`event-log/projection.ts` renderPublic：`actor: content [任务: task]` | 对齐 dsh 全量历史在场：模型每轮都看到 [任务说明]，不必从高噪声公共上下文考古 |
| 3 | 回合终止修正（诚实规则 2） | `tools/builtin-tool-agents.ts` HONESTY_INSTRUCTION 规则 2：过程性发言须 ≥1 条成功工具调用（[ok]）才 pass，"只说不做" fail + 引导继续；agent-loop 诚实证据改为**本轮唤醒切分**（`seq > wakeStartSeq`，跨唤醒旧工具不算） | 结构性修正非惩罚硬闸：0 工具过程性 reply → 拒绝不发布 → 继续循环；有真实工具后正常汇报 |
| 4 | 去"否则 reply" + 工具面收敛 | agent-loop 输出协议改为"需要工作时输出 toolCalls…只有确认完成才输出 reply"；kernel.ts makeAgentFor：worker denyTools = `['butler-relay','list-groups','create-group','ask-user']`（4 个必失败协调工具从工具面移除） | 不给偷懒盖章；guard 保留作纵深防御 |
| 5 | 群组任务 goal 化（轻量）+ maxTokens | **过程性发言有工具证据 → 发言发布（进展可见）后继续回合**（诚实 verdict 增加 `kind: completion/process/other`，agent-loop 对 process 返回 done:false + 【继续工作】反馈；受 maxToolRounds 兜底，非硬闸）——对齐 dsh goal-round-driver"未完成自动续轮"；GUI 创建智能体默认 maxTokens 2048 → 8192 | blocked 阈值门由 maxToolRounds + honesty 重试上限兜底；完整 goal-round-driver 迁移留待二期 |

### 顺带修复（真实验证中发现）

- **CLI 启动顺序竞态**（packages/bridge/src/cli.ts）：远程 WS 服务器先于 `kernel.start()` 开放监听 → 客户端在 working 群组恢复完成前查询 listGroups 得到 []（verify-sync 并行负载下 2 次复现）。修复：先 `await kernel.start()`（含 restoreWorkingGroups）再启动远程服务器。

### 真实验证结果（2026-08-25 全绿）

| 验证 | 结果 |
|---|---|
| 单测回归 core+bridge | **207/207**（H1 重写为"拒绝续轮→真实工具→进展发布+续轮→完成结束"全链路；H2 断言第 2 轮仍含 [任务说明]；新增群组默认唤醒 kernel 测试；list-groups 测试改为 TOOL_DENIED） |
| GUI / mobile 测试 | 25/25 / 15/15；typecheck 全 0 |
| CLI 冒烟 | 7/7 |
| verify-honesty（真实 LLM） | **7/7**（新增场景 5"过程性 + 0 工具 → 拦截"；场景 2/3 断言 kind=completion/process 分类正确） |
| verify-sync（真实 E2E） | **14/14**（并发条件下复验，启动竞态修复生效） |
| verify-remote（真实 E2E） | **11/11**（与 verify-sync 并发通过） |
| verify-mobile-chat（真实 DeepSeek） | **6/6** |
| verify-pvz-e2e（真实 DeepSeek 全流程） | **32/32（41.4s）**——game-dev 13 次工具调用产出 index.html 7.1KB（Canvas/交互/僵尸/胜负 + node --check 通过）；首跑暴露"过程性发言结束回合"（2.2KB 半成品）→ 修复 5 补全后通过 |
| **verify-group-wake（新增真实 E2E）** | **12/12（6.8s）**——用户发言**不带 mention** → 默认唤醒 waker → 真实工具调用（str-replace-editor + persistent-bash）→ hello.txt 落盘验证 → 完成汇报经【诚实】放行；无 TOOL_DENIED / 无 request/error / 无异常 |

### 遗留说明

- 完整 goal-round-driver 迁移（blocked 阈值门、todo 完成度检查、跨回合自动续轮）留待二期——当前以"过程性续轮 + 任务锚点 + 诚实审查"实现同等的结构性防偷懒效果。
- 诚实审查对"声称完成但产物半成品"的判定：规则 1 只查"是否有真实工具证据"（不评价质量），任务提示词层面的"未完成不得报告"仍是第一道防线。

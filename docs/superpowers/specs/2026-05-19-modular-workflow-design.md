# 模块化并行工作流系统设计

> 日期：2026-05-19
> 状态：设计稿

---

## 1. 问题

群组协作中存在以下不足：
- 唤醒队列不允许正在工作的 Agent 再次入队，限制并行
- PLAN.md 含无意义的预计时间，阶段模糊，缺少用户审核截断和自检
- PROGRESS.md 按 Agent 组织而非时间，不适合追踪实际工作日志
- TODOboard 仅支持时间触发，无法支持接口依赖的条件触发
- Host 缺少模块化组织能力，Agent 缺少模块化协作意识

## 2. 设计目标

1. WakeSystem 允许正在 processing 的 Agent 重新入队，支持并行 @mention
2. PLAN.md 重构为阶段驱动，含依赖关系、具体任务、自检和用户审核截断
3. PROGRESS.md 改为时间优先的工作日志
4. TODOboard 新增 0time 和 condition 两种触发模式，支持接口依赖联动
5. Host 模板显式支持模块化工作流
6. 全部 Agent 模板追加模块化协作意识

## 3. WakeSystem — 允许 processing Agent 重新入队

### 3.1 入队判断逻辑

```
当前: Agent 在队列中 → 拒绝入队
改后:
  Agent 在 _processingAgents 中（正在工作） → 允许入队（排到队尾）
  Agent 在队列中但不在 _processingAgents 中 → 跳过（已排队等待）
  Agent 不在队列中也不在 processing 中 → 正常入队
```

### 3.2 修改位置

`wake-system.ts` `_tickQueue` 或 `addToQueue` 方法。需要区分"已在队列中但未执行"和"正在执行中"两种情况。

### 3.3 效果

Agent A 正在工作时，Host 或其他 Agent 可以 @mention 它。新任务排到队尾，A 本轮完成后立即再次被唤醒处理新任务。

## 4. PLAN.md 重构

### 4.1 新模板

```markdown
# {群组名} - 执行计划

## 模块依赖

> 各模块间的接口依赖关系

- 前端 → 美术：图片资源（详见 INTERFACE.md）
- 前端 → 算法：推荐接口（详见 INTERFACE.md）

## 阶段计划

### 阶段 1：推荐算法开发

**负责人**: @算法专家

| 任务 | 负责人 | 状态 | 依赖 |
|------|--------|------|------|
| 设计推荐算法接口格式 | @算法专家 | ✅ 完成 | - |
| 实现 recommend() 函数 | @算法专家 | ✅ 完成 | 接口格式 |
| 产出推荐测试数据 | @算法专家 | 🔄 进行中 | recommend() |
| 检查接口依赖：确认接口已写入 INTERFACE.md，前端可正确调用 | @算法专家 | ⬜ 待开始 | 以上全部 |
| 👤 用户审核：确认推荐算法效果 | - | ⬜ 待开始 | 接口检查 |

### 阶段 2：美术资源制作

**负责人**: @美术

| 任务 | 负责人 | 状态 | 依赖 |
|------|--------|------|------|
| 设计首页横幅 1920×600 | @美术 | ⬜ 待开始 | - |
| 设计卡片背景 400×300 | @美术 | ⬜ 待开始 | - |
| 检查接口依赖：确认所有资源已写入 INTERFACE.md，规格标注完整 | @美术 | ⬜ 待开始 | 以上全部 |
| 👤 用户审核：确认美术风格 | - | ⬜ 待开始 | 接口检查 |

## 执行策略

1. **并行原则**: 同阶段无依赖的任务可同时 @mention 唤醒多个 Agent
2. **接口优先**: 先定义接口 → 再各自实现 → 最后联调检查
3. **动态调整**: 根据实际进展随时更新本计划，阶段数量可增减

## 风险预案

- **接口不匹配**: 及时同步 INTERFACE.md，Host 协调
- **人员阻塞**: 依赖项未就位时，先做其他可并行的工作

## 更新日志

- {timestamp} - 阶段1完成，算法和美术产出已就位
- {timestamp} - 初始调查完成，确认共需 8 个阶段
- {timestamp} - 初始化计划
```

### 4.2 规则

- 阶段有具体名称（如"推荐算法开发"），拒绝"核心开发"
- 每阶段最后两个任务固定：**检查接口依赖**（Agent 自检）+ **用户审核**（人工截断）
- 阶段数量动态变化，调查后可增减
- Host 实时更新表格状态（✅/🔄/⬜）
- 进度追踪在 PLAN 中完成（阶段完成 → 任务完成）
- 阶段内多 Agent 可并行启动（@mention 列表）
- `writePlan()` 生成的是动态模板框架，Host 调用 `updatePlan()` 填充和更新内容

## 5. PROGRESS.md 重构

### 5.1 新模板（时间优先）

```markdown
# {群组名} - 工作日志

## 2026-05-19

### 16:00
- @美术: 完成 assets/banner.png (1920×600) 和 card-bg.png (400×300)
- @美术: 已写入 INTERFACE.md 美术章节

### 15:30
- @算法专家: 完成 recommend() 函数，产出测试数据 data/recommendations.json
- @算法专家: 已写入 INTERFACE.md 算法章节

### 14:00
- @算法专家: 开始设计推荐算法接口格式
```

### 5.2 规则

- 时间倒序排列（最新在前）
- 顶格按日期分组，次格按时间点分组
- 每条目标注 `@Agent名`，记录做了什么 + 产出了什么
- 不追踪完成百分比（那是 PLAN 的职责）
- Agent 完成工作后通过工具追加条目

## 6. TODOboard 增强

### 6.1 新增触发模式

```typescript
interface TodoItem {
  // ... 现有字段
  triggerMode: 'time' | '0time' | 'condition'

  // time: 现有定时触发
  triggerAt?: number

  // 0time: 扫描即触发
  // (triggerMode='0time' 时忽略 triggerAt)

  // condition: 条件触发
  condition?: {
    type: 'agent_speak'
    targetAgents: string[]   // 每次这些 Agent 在群组发言 → 触发
    check: string            // 条件描述
    onFail: 'remind' | 'recreate'  // 不满足时：提醒 or 重建 TODO
  }
}
```

### 6.2 三种模式行为

| 模式 | 触发时机 | 完成后 | 未完成/不满足 |
|------|---------|--------|-------------|
| time | 到达指定时间 | 标记完成 | 过期提醒 |
| 0time | 扫描器发现即触发 | 完成 | 自动重建新的 0time TODO 并 @mention 负责人 |
| condition | 目标 Agent 在群组发言 | 条件满足→完成 | @mention 条件 Agent 提醒；onFail=recreate 则重建 TODO |

### 6.3 0time 流程

```
Scanner 扫描 → 发现 mode='0time', status='pending'
  → 通过 WakeSystem 唤醒 assignee
  → Agent 工作 → 标记 done
  → 若之前触发过但未完成 → 自动重建新 0time TODO → @mention 催促
```

### 6.4 condition 流程

```
Scanner 扫描 → 发现 mode='condition'
  → 监听群组消息
  → 目标 Agent 在群组发言 → 每次触发
  → 唤醒 assignee，检查 condition.check 是否满足
  → 满足 → done
  → 不满足 →
      remind: @mention 条件 Agent 提醒补充
      recreate: 重建同标题 TODO，重新监听
```

### 6.5 接口依赖场景

群主创建 0time TODO 指挥工作；组员创建 condition TODO 检查接口：

```
群主:
  mode='0time', title='开发推荐算法', assignee='算法专家'
  → 立即触发算法专家

前端专家（依赖算法接口）:
  mode='condition', targetAgents=['算法专家'], check='算法接口已写入INTERFACE.md'
  → 每次算法专家在群里说话，前端专家被唤醒检查
  → 接口未就位 → @mention 算法专家提醒
```

## 7. 模板更新

### 7.1 BOOTSTRAP.md 追加

```markdown
8. 工作前检查 INTERFACE.md 中你依赖的接口是否就位，有占位符则 @mention 对方提醒
9. 工作后更新 INTERFACE.md 你的章节；检查是否有 agent 的 condition TODO 等待你的接口
10. 如果你依赖的接口缺失，创建 condition TODO 监视对方（mode=condition, targetAgents=[对方], check=接口就位）
```

### 7.2 SOUL.md 追加

```markdown
## 协作方式
- 你是模块化团队的一员。你的产出可能被其他人调用，你也依赖其他人的产出
- 接口优先：不确定别人需要什么时，先写好你的输出格式
```

### 7.3 AGENTS.md 追加

```markdown
## 模块化工作规则
1. 工作前查 INTERFACE.md 确认依赖项是否就位
2. 有产出后更新 INTERFACE.md 你的章节
3. 发现依赖的接口缺失 → 创建 condition TODO 监视对方，或直接 @mention 对方请求
4. 群主通过 PLAN.md 组织阶段，通过 TODOboard 分配任务，关注 @mention 和 TODO 触发
```

### 7.4 Host JOB.md 追加

```markdown
## 群组管理

### 调查与规划
1. 收到需求后先调查，确定需要几个阶段
2. 在 PLAN.md 中写入阶段计划（动态调整，发现新需求随时增减阶段）
3. 写入模块依赖表

### 启动阶段
1. 为阶段内每项任务创建 0time TODO，指定负责人
2. 有接口依赖的，让下游 Agent 创建 condition TODO 监视上游
3. @mention 所有阶段负责人启动并行工作

### 追踪进度
1. 通过 PLAN.md 表格追踪阶段/任务完成状态
2. 阶段收尾执行"检查接口依赖"任务，确保 INTERFACE.md 完整
3. 提交用户审核，通过后进入下一阶段

### 接口协调
1. 接口变化时更新 PLAN.md 的依赖关系
2. 提醒受影响的下游 Agent 更新其 condition TODO
```

### 7.5 prompt-builder.ts GROUP_CONTEXT 段追加

在 INTERFACE.md 注入之后追加：

```typescript
parts.push(`> 接口依赖见 INTERFACE.md。阶段任务见 PLAN.md。个人任务见 TODOboard。`)
```

## 8. 改动清单

| 文件 | 改动 |
|------|------|
| `wake-system.ts` | `_tickQueue`/`addToQueue` 入队逻辑：_processingAgents 中的允许重新入队 |
| `workspace.ts` | `writePlan()` 模板重写；`writeProgress()` 改为时间优先工作日志模板 |
| `todo/store.ts` | TodoItem 类型增加 triggerMode / condition 字段 |
| `todo/scanner.ts` | 0time 模式扫描触发 + condition 模式消息监听触发 |
| `todo/todo-tools.ts` | todo-add 支持新字段参数 |
| `host-tools.ts` | `decompose-task` 适配 PLAN 新格式，支持并行 @mention + 0time TODO 创建 |
| `prompt-builder.ts` | GROUP_CONTEXT 末尾追加模块化协作提示 |
| `config/templates/BOOTSTRAP.md` | 追加 items 8-10 |
| `config/templates/SOUL.md` | 追加协作方式段 |
| `config/templates/AGENTS.md` | 追加模块化工作规则段 |
| skills 目录下 Host 相关 skill | 追加群组管理、模块化组织的内容 |

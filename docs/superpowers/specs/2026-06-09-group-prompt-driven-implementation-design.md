# 群组纯 Prompt 协作 — 实施规格

> 日期：2026-06-09 | 状态：已批准 | 基于：`docs/GOALS/group-organization-prompt-driven-design.md`

## 背景

`docs/GOALS/group-organization-prompt-driven-design.md` 已确认群组协作采用纯 prompt 驱动方向。本规格定义将设计文档中的规则落地到代码的具体变更。

核心原则：不新增代码基础设施，只改写 prompt、模板和工具描述。利用现有 WakeSystem、buildGroupCollaborationContext、group-send 等承载层，把设计文档中的规则注入到正确位置。

## 变更清单

### 1. 新建 `templates/host/HOST_JOB.md` — 群主核心职责模板

**文件**：`CoBeing/packages/core/src/templates/host/HOST_JOB.md`（新建）

**内容结构**：
- 核心定位：群主是群组对用户负责的运行接口
- 9 项核心职责（从设计文档映射）：
  1. 标记任务开始与结束
  2. 介入启动并唤醒智能体
  3. 恢复停滞工作
  4. 对用户负责并整合结果
  5. 申请更多资源
  6. 清理智能体和协作噪音
  7. 优化用户决策体验
  8. 维护群组 TODOboard
  9. 维护群组公共记忆
- 触发时机（8 种场景）
- 判断框架：何时启动/唤醒/恢复/收束/申请资源/请示用户
- 与管家/成员/TODOboard 的关系边界
- 禁止行为：不替用户决策、不静默安装资源、不默认 @all

**关联代码变更**：
- `butler.ts`：创建群主时从 `templates/host/HOST_JOB.md` 写入 `data/coreagents/host/JOB.md`
- `agent/paths.ts`：确保 `forAgent("host")` 正确路由到 `data/coreagents/host/`

### 2. 重写 `templates/group/GUIDE.md` — 群组规则模板

**文件**：`CoBeing/packages/core/src/templates/group/GUIDE.md`（重写）

**内容结构**：
- 场景定义：本群组的目标领域和长期定位
- 成员边界：每个成员的角色、职责范围
- 协作风格：纯 prompt 驱动，非重协议工作流
- 用户审批点：设计稿/方案/预算/风格/范围/权限/关键验收等必须经用户确认
- 资源申请规则：缺 Skill/Plugin/Agent/工具时，Agent → 群主 → 用户/管家
- 沟通规范：非阻塞协作消息、最终回复与协作消息的区别
- 禁止行为清单

### 3. 重写 Agent 群组上下文行为规则

**文件**：`CoBeing/packages/core/src/conversation/prompt-builder.ts`

**变更位置**：`buildGroupCollaborationContext()` 函数中的"协作规则"段（约 lines 465-492）

**替换为**：
- **Agent 判断框架**（6 步自查）：
  1. 这件事是否属于我的职责？
  2. 我能否在当前信息下继续？
  3. 是否需要用户判断？
  4. 是否需要其他 Agent 协作？
  5. 是否需要更多资源？
  6. 是否已经完成可交付结果？
- **需要用户判断的典型场景**（7 类）：设计稿/方案/预算/范围/权限/验收点/主观取舍
- **需要协作的典型场景**（6 类）：专业分工/上下游依赖/并行子任务/审查/分歧/能力不匹配
- **需要申请资源的典型场景**（4 类）：缺方法论/需专门流程/质量不达标/缺外部工具
- **禁止行为清单**：不替用户审批、不扩大范围、不静默安装资源、不刷屏、不强行参与、不用最终回复承担路由职责
- **协作消息规范**：5 要素模板（我在做什么/需要你做什么/你的输出用于什么/是否紧急/我会继续还是暂停）
- **最终回复与协作消息的区别**
- **群主专属职责段**（仅当 currentAgentId === ownerId 时注入）：从 HOST_JOB.md 读取摘要注入

### 4. 强化 `group-send` 工具说明

**文件**：`CoBeing/packages/core/src/tools/group-tools.ts`

**变更位置**：`makeGroupSendTool()` 的 `description` 字段

**新 description 核心要点**：
- 明确这是**协作旁路消息**，不是最终回复
- 发送后**默认继续自己的工作**，除非消息明确表示需要暂停等待
- 应说明：当前正在做什么、需要对方做什么、对方输出会被如何使用、是否需要立刻回复、自己是继续还是暂停
- 用途：中途发起协作、上报阻塞、请求审批、申请资源
- 如果需要对方接力，使用此工具；不要只在最终回复里写 @mention

### 5. 弱化工作区文档在产品表层的存在感

**文件**：`CoBeing/packages/core/src/group/workspace.ts`、`CoBeing/packages/core/src/group/group.ts`

**变更**：
- `workspace.initialize()` 不再自动创建 MEMBERS.md、STRUCTURE.md、TASK.md、PLAN.md、PROGRESS.md、INTERFACE.md
- 保留自动创建：GUIDE.md、EXPERIENCE.md、workspace/ 目录
- 旧有的 TASK/PLAN/PROGRESS/INTERFACE 等文件**保留读写方法**，但改为按需创建（Agent 调用对应工具时才创建），不作为初始化必需项
- `getSummary()` 对不存在的文件返回 null（已有此行为，无需改动）
- 群组初始化时 `config.json` 已由 GroupManager 管理（无需额外改动）

### 6. 验收用例

实施完成后需验证以下场景的 prompt 输出：

1. **旅行群场景**：用户在"旅行群"提出具体旅行需求，群主 prompt 中能看到启动工作回合的职责描述（而非创建新一次性群组的倾向）
2. **选择性唤醒**：群主 prompt 中包含"按能力点名而非默认 @all"的规则
3. **设计稿审批**：Agent 群组上下文中包含"生成设计稿后需请求用户审批"的规则
4. **非阻塞协作**：`group-send` 工具描述明确"发送后默认继续工作"
5. **异步唤醒**：被 @mention 的 Agent 通过 WakeSystem 异步唤醒（已有基础，验证不受影响）
6. **资源申请链**：Agent 发现缺 Skill 时 prompt 引导其向群主申请（而非静默安装）
7. **结果整合**：群主 prompt 中包含"整合多 Agent 结果为可读交付"的职责
8. **停滞恢复**：群主 prompt 中包含"任务未完成但无人工作时被唤醒并重启推进"
9. **管家不刷屏**：普通群组过程不过度通知管家（由群主 prompt 中的回传规则约束）
10. **Butler 派发回传**：群主 prompt 中包含"关键节点回传 Butler"的规则

## 不涉及的范围

- 不新增代码基础设施（不新建类、不新建包）
- 不改变 WakeSystem 的唤醒逻辑
- 不改变 TODOboard 的数据模型
- 不改变前端 GUI
- 不改变群组创建/销毁的生命周期
- 不改变 MCP、Plugin、Skill 的加载机制

## 涉及文件汇总

| 操作 | 文件 |
|------|------|
| 新建 | `packages/core/src/templates/host/HOST_JOB.md` |
| 重写 | `packages/core/src/templates/group/GUIDE.md` |
| 修改 | `packages/core/src/conversation/prompt-builder.ts` |
| 修改 | `packages/core/src/tools/group-tools.ts` |
| 修改 | `packages/core/src/group/workspace.ts` |
| 修改 | `packages/core/src/group/group.ts` |
| 修改 | `packages/core/src/agent/butler.ts` |
| 修改 | `packages/core/src/agent/paths.ts` |
| 更新 | `docs/项目信息/核心技术.md` |
| 更新 | `docs/项目信息/项目现状.md` |
| 更新 | `docs/项目信息/架构说明.md` |

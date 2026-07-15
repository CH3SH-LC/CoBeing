# 核心功能与前端闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前已经存在的 Butler / Agent / Group / TODO / Memory / Observability 基础，收敛成普通用户可稳定使用的核心闭环，并把这些能力在前端变成可看懂、可操作、可验证的工作台。`Market`、官方认证、社区资源推荐全部暂缓。

**Architecture:** 先固化核心能力契约，再打通 WebSocket 事件和前端 store，最后把 Agent、Group、TODOboard、Dashboard 四个核心面板连成闭环。重点不是新增更多抽象，而是让现有能力可见、可触达、可追踪、可验证。

**Tech Stack:** TypeScript, React 19, Tauri 2, WebSocket, Zustand, Vitest, pnpm

---

## File Structure Map

### Core runtime
- `CoBeing/packages/core/src/agent/butler.ts`
- `CoBeing/packages/core/src/agent/agent.ts`
- `CoBeing/packages/core/src/conversation/prompt-builder.ts`
- `CoBeing/packages/core/src/api/ws-server.ts`
- `CoBeing/packages/core/src/runtime.ts`

### Group / TODO / memory
- `CoBeing/packages/core/src/group/group.ts`
- `CoBeing/packages/core/src/group/group-context-v2.ts`
- `CoBeing/packages/core/src/group/wake-system.ts`
- `CoBeing/packages/core/src/group/host-tools.ts`
- `CoBeing/packages/core/src/group/manager.ts`
- `CoBeing/packages/core/src/todo/types.ts`
- `CoBeing/packages/core/src/todo/store.ts`
- `CoBeing/packages/core/src/todo/scanner.ts`
- `CoBeing/packages/core/src/todo/group-scanner.ts`
- `CoBeing/packages/core/src/todo/tools.ts`
- `CoBeing/packages/core/src/memory/memory-store.ts`
- `CoBeing/packages/core/src/memory/experience.ts`
- `CoBeing/packages/core/src/memory/experience-reflect.ts`

### Frontend runtime and shared types
- `CoBeing/gui-v2/src/lib/types.ts`
- `CoBeing/gui-v2/src/lib/ws-client.ts`
- `CoBeing/gui-v2/src/hooks/useWebSocket.ts`
- `CoBeing/gui-v2/src/stores/agents.ts`
- `CoBeing/gui-v2/src/stores/groups.ts`
- `CoBeing/gui-v2/src/stores/todo.ts`
- `CoBeing/gui-v2/src/stores/observability.ts`
- `CoBeing/gui-v2/src/stores/settings.ts`
- `CoBeing/gui-v2/src/stores/chat.ts`
- `CoBeing/gui-v2/src/stores/plugins.ts`

### Frontend views
- `CoBeing/gui-v2/src/components/agent/AgentDetailPanel.tsx`
- `CoBeing/gui-v2/src/components/agent/AgentFilesTab.tsx`
- `CoBeing/gui-v2/src/components/agent/AgentConfigTab.tsx`
- `CoBeing/gui-v2/src/components/agent/CreateAgentDialog.tsx`
- `CoBeing/gui-v2/src/components/agent/ButlerConfigPanel.tsx`
- `CoBeing/gui-v2/src/components/group/GroupDetailPanel.tsx`
- `CoBeing/gui-v2/src/components/group/GroupMembersTab.tsx`
- `CoBeing/gui-v2/src/components/group/GroupWorkspaceTab.tsx`
- `CoBeing/gui-v2/src/components/group/GroupHealthPanel.tsx`
- `CoBeing/gui-v2/src/components/todo/TodoPanel.tsx`
- `CoBeing/gui-v2/src/components/todo/TodoKanban.tsx`
- `CoBeing/gui-v2/src/components/todo/TodoList.tsx`
- `CoBeing/gui-v2/src/components/todo/TodoForm.tsx`
- `CoBeing/gui-v2/src/components/observability/DashboardView.tsx`
- `CoBeing/gui-v2/src/components/observability/ActiveAgentsPanel.tsx`
- `CoBeing/gui-v2/src/components/observability/AgentActivityCard.tsx`
- `CoBeing/gui-v2/src/components/observability/ToolRankCard.tsx`
- `CoBeing/gui-v2/src/components/observability/TokenCard.tsx`
- `CoBeing/gui-v2/src/components/observability/LatencyCard.tsx`
- `CoBeing/gui-v2/src/components/settings/SettingsView.tsx`
- `CoBeing/gui-v2/src/components/settings/WakeQueueSection.tsx`
- `CoBeing/gui-v2/src/components/settings/WorkspaceBindingSection.tsx`
- `CoBeing/gui-v2/src/components/settings/LogsSection.tsx`

### Verification / docs
- `CoBeing/packages/core/src/**/*.test.ts`
- `CoBeing/gui-v2/src/**/*.tsx`
- `PROGRESS.md`
- `PROGRESS-LITE.md`

---

## Scope

### In scope
- Butler 任务分流和入口体验
- Agent / Group / TODO / Memory 的核心闭环
- 前端让这些核心能力可见、可操作、可验证
- WebSocket 数据契约和 store 同步
- 核心测试和构建验证

### Out of scope
- `Market` 分级、认证、安装推荐
- 社区资源浏览与评分体系
- 官方/社区插件商店体验

---

### Task 1: 固化核心能力边界

**Files:**
- Modify: `CoBeing/packages/core/src/agent/butler.ts`
- Modify: `CoBeing/packages/core/src/agent/agent.ts`
- Modify: `CoBeing/packages/core/src/conversation/prompt-builder.ts`
- Modify: `CoBeing/packages/core/src/runtime.ts`
- Modify: `CoBeing/packages/core/src/api/ws-server.ts`
- Modify: `CoBeing/packages/core/src/agent/butler.test.ts`
- Modify: `CoBeing/packages/core/src/conversation/prompt-builder.test.ts`
- Modify: `CoBeing/packages/core/src/integration.test.ts`

**Goal:** 让 Butler 明确承担“接住需求、判断路由、解释转接”的职责，而不是把所有事情都堆给单个 Agent。

**Plan:**
- 收敛 Butler 的入口语义：直答、转 Agent、转 Group、创建 TODO、追问缺失信息。
- 让 prompt 构建明确反映当前职责边界，不再把过时的角色定义混进主 prompt。
- 把核心路由的结果和失败原因都变成可观察事件，方便前端展示和测试断言。
- 为最关键的路由场景补测试：直接回答、创建 Agent、创建 Group、群组消息转发、无上下文时的追问。

**Verification:**
- `cd CoBeing; pnpm test packages/core/src/agent/butler.test.ts packages/core/src/conversation/prompt-builder.test.ts packages/core/src/integration.test.ts`

---

### Task 2: 打通 Group / TODO / 唤醒闭环

**Files:**
- Modify: `CoBeing/packages/core/src/todo/types.ts`
- Modify: `CoBeing/packages/core/src/todo/store.ts`
- Modify: `CoBeing/packages/core/src/todo/scanner.ts`
- Modify: `CoBeing/packages/core/src/todo/group-scanner.ts`
- Modify: `CoBeing/packages/core/src/todo/tools.ts`
- Modify: `CoBeing/packages/core/src/group/group.ts`
- Modify: `CoBeing/packages/core/src/group/group-context-v2.ts`
- Modify: `CoBeing/packages/core/src/group/wake-system.ts`
- Modify: `CoBeing/packages/core/src/group/host-tools.ts`
- Modify: `CoBeing/packages/core/src/group/manager.ts`
- Modify: `CoBeing/packages/core/src/group/manager.test.ts`
- Modify: `CoBeing/packages/core/src/group/three-layer-memory.test.ts`
- Modify: `CoBeing/packages/core/src/group/context.test.ts`
- Modify: `CoBeing/packages/core/src/todo/scanner.test.ts`
- Modify: `CoBeing/packages/core/src/todo/group-scanner.test.ts`

**Goal:** 把现有 TODO 变成真正可调度的任务状态对象，让 Group 的进度、阻塞、交付和唤醒形成统一闭环。

**Plan:**
- 统一 Agent TODO 和 Group TODO 的字段表达，至少覆盖目标、负责人、参与者、依赖、状态、触发条件、交付物和验收信息。
- 让 Group 的唤醒机制既响应 `@mention`，也响应任务状态变化。
- 让 Host 能基于 TODO 读取当前任务，而不是只靠聊天上下文猜测下一步。
- 把群组里的关键状态变化广播给前端，后面才能接上群组详情页和 Kanban。

**Verification:**
- `cd CoBeing; pnpm test packages/core/src/todo/scanner.test.ts packages/core/src/todo/group-scanner.test.ts packages/core/src/group/manager.test.ts packages/core/src/group/context.test.ts`

---

### Task 3: 收紧 Memory / Experience 的长期沉淀

**Files:**
- Modify: `CoBeing/packages/core/src/memory/memory-store.ts`
- Modify: `CoBeing/packages/core/src/memory/experience.ts`
- Modify: `CoBeing/packages/core/src/memory/experience-reflect.ts`
- Modify: `CoBeing/packages/core/src/memory/memory-tool.ts`
- Modify: `CoBeing/packages/core/src/agent/agent.ts`
- Modify: `CoBeing/packages/core/src/group/agent-memory.ts`
- Modify: `CoBeing/packages/core/src/memory/memory-store.test.ts`
- Modify: `CoBeing/packages/core/src/memory/experience.test.ts`

**Goal:** 让事件记忆、工作经验、用户偏好和教训沉淀分层明确，避免继续把“记住了”当成“真正学会了”。

**Plan:**
- 区分短期事件记录和长期经验总结，保持结构和读取方式稳定。
- 让经验沉淀以“可复用建议”的形式出现，而不是纯自然语言聊天回放。
- 让群组复盘能回写到经验层，而不是只留在消息历史里。
- 在 Agent prompt 中明确经验和记忆的加载顺序，避免过度膨胀。

**Verification:**
- `cd CoBeing; pnpm test packages/core/src/memory/memory-store.test.ts packages/core/src/memory/experience.test.ts`

---

### Task 4: 统一 WS 协议和前端状态源

**Files:**
- Modify: `CoBeing/packages/core/src/api/ws-server.ts`
- Modify: `CoBeing/gui-v2/src/lib/types.ts`
- Modify: `CoBeing/gui-v2/src/lib/ws-client.ts`
- Modify: `CoBeing/gui-v2/src/hooks/useWebSocket.ts`
- Modify: `CoBeing/gui-v2/src/stores/agents.ts`
- Modify: `CoBeing/gui-v2/src/stores/groups.ts`
- Modify: `CoBeing/gui-v2/src/stores/todo.ts`
- Modify: `CoBeing/gui-v2/src/stores/observability.ts`
- Modify: `CoBeing/gui-v2/src/stores/settings.ts`
- Modify: `CoBeing/gui-v2/src/stores/chat.ts`
- Modify: `CoBeing/gui-v2/src/stores/plugins.ts`

**Goal:** 让前端从单纯“轮询状态页”变成实时接收 Agent / Group / TODO / Dashboard 的核心事件。

**Plan:**
- 将 agent 创建、更新、删除、群组成员变化、TODO 变更、唤醒队列、仪表盘数据统一进可读的 WS 消息结构。
- 让前端 store 对应这些事件做增量更新，而不是每次都全量重刷。
- 清理不再需要的旧字段和不明确的 payload，避免前后端各说各话。
- 把关键错误也标准化，方便 UI 直接展示。

**Verification:**
- `cd CoBeing; pnpm test packages/core/src/integration.test.ts`
- `cd CoBeing/gui-v2; pnpm build`

---

### Task 5: 让 Agent 页面能真正改和看

**Files:**
- Modify: `CoBeing/gui-v2/src/components/agent/AgentDetailPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/agent/AgentFilesTab.tsx`
- Modify: `CoBeing/gui-v2/src/components/agent/AgentConfigTab.tsx`
- Modify: `CoBeing/gui-v2/src/components/agent/CreateAgentDialog.tsx`
- Modify: `CoBeing/gui-v2/src/components/agent/ButlerConfigPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/layout/MainContent.tsx`
- Modify: `CoBeing/gui-v2/src/components/layout/NavBar.tsx`

**Goal:** 让用户在前端里就能完成 Agent 的创建、查看、编辑、绑定和基础调试，不需要翻文件系统。

**Plan:**
- 让 Agent 详情页把文件、配置、绑定、状态放在一个自然的工作流里。
- 把 `CHARACTER.md`、`JOB.md`、`MEMORY.md`、`EXPERIENCE.md` 的编辑/查看入口整理清楚。
- 让 Butler 配置和 Agent 创建对普通用户更像“创建一个角色”，而不是填配置表。
- 确保顶部导航和主视图切换不打断当前编辑状态。

**Verification:**
- `cd CoBeing/gui-v2; pnpm build`

---

### Task 6: 让 Group / TODO 页面成为真正的工作台

**Files:**
- Modify: `CoBeing/gui-v2/src/components/group/GroupDetailPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/group/GroupMembersTab.tsx`
- Modify: `CoBeing/gui-v2/src/components/group/GroupWorkspaceTab.tsx`
- Modify: `CoBeing/gui-v2/src/components/group/GroupHealthPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/todo/TodoPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/todo/TodoKanban.tsx`
- Modify: `CoBeing/gui-v2/src/components/todo/TodoList.tsx`
- Modify: `CoBeing/gui-v2/src/components/todo/TodoForm.tsx`
- Modify: `CoBeing/gui-v2/src/stores/groups.ts`
- Modify: `CoBeing/gui-v2/src/stores/todo.ts`

**Goal:** 让 Group 的任务、成员、工作区、健康状态和 TODO 变成一个连续的协作面板，而不是分散的几个页面。

**Plan:**
- 把 Group 详情页改成能同时看到成员、当前任务、工作区和健康状态的主工作面。
- 让 TODO 面板支持 Agent 级和 Group 级两种上下文，并能直接看任务状态变化。
- 把群组工作区和任务板挂到同一条状态链路上，避免用户在多个页面间来回找上下文。
- 把群组健康面板作为“是否需要人工介入”的信号，而不是装饰性的统计面板。

**Verification:**
- `cd CoBeing/gui-v2; pnpm build`

---

### Task 7: 让 Dashboard 和可观测信息说人话

**Files:**
- Modify: `CoBeing/gui-v2/src/components/observability/DashboardView.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/ActiveAgentsPanel.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/AgentActivityCard.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/ToolRankCard.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/TokenCard.tsx`
- Modify: `CoBeing/gui-v2/src/components/observability/LatencyCard.tsx`
- Modify: `CoBeing/gui-v2/src/components/settings/WakeQueueSection.tsx`
- Modify: `CoBeing/gui-v2/src/components/settings/WorkspaceBindingSection.tsx`
- Modify: `CoBeing/gui-v2/src/components/settings/LogsSection.tsx`

**Goal:** 让用户和调试者能快速知道系统现在在干什么、哪里卡住、哪个 Agent 在忙、哪个任务在等。

**Plan:**
- 让仪表盘展示对核心能力有意义的指标，而不是纯技术统计。
- 把活跃 Agent、唤醒队列、最近工具调用和任务健康状态连起来。
- 保持 UI 简洁，优先服务“看懂发生了什么”，不要堆装饰性图表。

**Verification:**
- `cd CoBeing/gui-v2; pnpm build`

---

### Task 8: 验证、回归和文档收口

**Files:**
- Modify: `CoBeing/packages/core/src/**/*.test.ts`
- Modify: `CoBeing/gui-v2/src/**/*.tsx`
- Modify: `PROGRESS.md`
- Modify: `PROGRESS-LITE.md`

**Goal:** 让这轮核心能力和前端改动有明确的验证证据，并把文档口径收回到真实实现。

**Plan:**
- 为所有改到的核心逻辑补上单测或集成测试。
- 前端至少通过构建和类型检查，不保留静默错误。
- 每个完成点都写进进度文档，避免“做过了但没人知道”。
- 若后续新增文件，再同步更新 `STRUCTURE.md`。

**Verification:**
- `cd CoBeing; pnpm build`
- `cd CoBeing; pnpm test`
- `cd CoBeing/gui-v2; pnpm build`


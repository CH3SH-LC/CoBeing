project: cobeing-butler-productization
generated: "2026-08-04T00:00:00Z"
tasks:
  - id: task-butler-core-backend
    description: "阶段C地基+阶段A/D prompt规则:ensureButlerDir 文件体系 + 管家走文件 prompt + templates/butler/ 4 模板 + butler_set_persona/update_butler_style 命令"
    depends_on: []
    inputs:
      - file: packages/core/src/runtime.ts
        section: "createButler/ensureHostDir/start 顺序"
        description: 管家创建与目录初始化锚点
      - file: packages/core/src/agent/butler.ts
        section: "构造函数与 loop 创建"
        description: 固定 prompt 路径改造点
      - file: packages/core/src/agent/agent.ts
        section: "createLoop/promptBuilder 逻辑(400-440)"
        description: 文件 prompt 与固定 prompt 的分支逻辑
      - file: packages/core/src/conversation/conversation-loop.ts
        section: "prompt 组装"
        description: buildSystemPrompt 与 promptBuilder 的取舍
      - file: packages/core/src/api/handlers/plugin.ts
        section: "handler 风格"
        description: WS 命令写法参考
    outputs:
      - file: packages/core/src/templates/butler/personas/亲密朋友/CHARACTER.md
        type: markdown
        description: 管家模板-亲密朋友人设
      - file: packages/core/src/templates/butler/personas/亲密朋友/JOB.md
        type: markdown
        description: 职责+分级转接规则+Market 推荐纪律(阶段A/D prompt 规则的载体)
      - file: packages/core/src/templates/butler/personas/专业秘书/CHARACTER.md
        type: markdown
        description: 管家模板-专业秘书人设
      - file: packages/core/src/templates/butler/personas/专业秘书/JOB.md
        type: markdown
        description: 职责+分级转接规则+Market 推荐纪律
      - file: packages/core/src/templates/butler/personas/学习陪伴/CHARACTER.md
        type: markdown
        description: 管家模板-学习陪伴人设
      - file: packages/core/src/templates/butler/personas/学习陪伴/JOB.md
        type: markdown
        description: 职责+分级转接规则+Market 推荐纪律
      - file: packages/core/src/templates/butler/personas/家庭助理/CHARACTER.md
        type: markdown
        description: 管家模板-家庭助理人设
      - file: packages/core/src/templates/butler/personas/家庭助理/JOB.md
        type: markdown
        description: 职责+分级转接规则+Market 推荐纪律
      - file: packages/core/src/templates/butler/base/AGENTS.md
        type: markdown
        description: 管家运行边界与红线
      - file: packages/core/src/templates/butler/base/MEMORY.md
        type: markdown
        description: 管家记忆入口模板
      - file: packages/core/src/templates/butler/base/EXPERIENCE.md
        type: markdown
        description: 管家经验沉淀模板
      - file: packages/core/src/api/handlers/butler-persona.ts
        type: typescript-module
        exports:
          - name: registerButlerPersonaHandlers
            signature: "export function registerButlerPersonaHandlers(register: HandlerRegistrar): void"
        description: "butler_get_personas(列模板+当前) / butler_set_persona{persona}(复制模板到 data/coreagents/butler/) / butler_update_style{nickname?,tone?,greeting?,apply:boolean}(写 CHARACTER.md/配置)"
      - file: packages/core/src/runtime.test.ts
        type: test
        description: "ensureButlerDir 首次启动创建管家文件体系;persona 切换复制模板;style 更新写入"
    verification:
      - file_exists: "packages/core/src/templates/butler/personas/亲密朋友/JOB.md"
      - export_matches: "registerButlerPersonaHandlers"
      - test_passes: "cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit"
      - test_passes: "cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/runtime.test.ts"
    notes: |
      1. 不动 ws-server.ts(主线程统一注册 handler)。
      2. JOB.md 必须包含:管家分级转接规则(寒暄/问答/短润色自己答;多步研究/长文/协作/需长期跟踪默认派发;不确定先问用户)+ Market 推荐纪律(官方内置/认证且明显优于本地才轻量提示,1次/会话;社区必须用户确认;本地已有能力时闭嘴)。
      3. 管家走文件 prompt 是高风险改造:createButler 改造必须保证工具注册/多步推理不退化;新增但ler 目录初始化(ensureButlerDir 类比 ensureHostDir)必须在 createButler 之前执行;config.json 生成含 provider/model/tools 白名单。
      4. 提供回归验证方案(管家对话/工具调用基线)。

  - id: task-butler-receipt-backend
    description: "阶段A 后端:派发回执结构化 + butler_task_updated 广播携带完整视图 + dispatch_task 支持 group 目标"
    depends_on: []
    inputs:
      - file: packages/core/src/butler/dispatch.ts
        section: "broadcast/dispatchButlerTask"
        description: 广播扩展点
      - file: packages/core/src/agent/butler/tools/dispatch-tools.ts
        section: "formatDispatchReceipt/makeDispatchToAgentTool"
        description: 回执结构化
      - file: packages/core/src/tools/agent-task.ts
        section: "状态同步广播"
        description: 状态变更广播携带状态
      - file: packages/shared/src/butler-bridge.ts
        section: "类型"
        description: 追加 TaskReceipt/事件 payload 类型
      - file: packages/core/src/api/handlers/agent.ts
        section: "dispatch_task(495-546)"
        description: 扩展 targetType group
    outputs:
      - file: packages/shared/src/butler-bridge.ts
        type: typescript-module
        exports:
          - name: ButlerTaskReceiptPayload
            signature: "export interface ButlerTaskReceiptPayload { butlerTaskId: string; globalTodoId?: string; title: string; targetType: \"agent\" | \"group\"; targetId: string; assigneeName: string; status: string; summary?: string; nextAction?: string; timestamp: number }"
      - file: packages/core/src/butler/dispatch.ts
        type: typescript-module
        description: "broadcast() 携带 ButlerTaskReceiptPayload(从 butlerTaskStore 读最新视图,失败降级 timestamp-only)"
      - file: packages/core/src/agent/butler/tools/dispatch-tools.ts
        type: typescript-module
        description: "formatDispatchReceipt 返回结构化 receipt(内容不变+附加结构化视图);派发后广播携带完整 payload"
      - file: packages/core/src/tools/agent-task.ts
        type: typescript-module
        description: "syncTrackedTask 广播但ler_task_updated 携带 status/title"
      - file: packages/core/src/api/handlers/agent.ts
        type: typescript-module
        description: "dispatch_task payload 扩展 targetType:\"agent\"|\"group\"(默认 agent)+ groupId;group 目标校验 groupManager;返回 dispatch_task_result 含 targetType"
      - file: packages/core/src/butler/dispatch.test.ts
        type: test
        description: "广播 payload 结构;dispatch_task group 路径(可通过 handler 单测或 dispatchButlerTask 直接测)"
    verification:
      - export_matches: "ButlerTaskReceiptPayload"
      - test_passes: "cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit"
      - test_passes: "cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/butler"
    notes: |
      1. 不动 ws-server.ts/runtime.ts(主线程集成)。
      2. 契约:但ler_task_updated 事件 payload 至少含 butlerTaskId/globalTodoId/title/status;前端将据此点亮回执卡片与但lerTasks store。
      3. dispatch_task 扩展保持向后兼容(旧 payload 只有 agentId 仍工作)。

  - id: task-onboarding-backend
    description: "阶段B 后端:onboarding_apply 命令(问卷→Creator 生成 1-2 初始 Agent + Market 轻量推荐 ≤2 条)"
    depends_on: []
    inputs:
      - file: packages/core/src/api/handlers/agent.ts
        section: "create_agent(26-180)"
        description: 初始 Agent 创建链路复用(含 Creator ToolAgent 调用)
      - file: packages/core/src/agent/tool-agent/creator.ts
        section: "runAgentCreator"
        description: 生成核心文件
      - file: packages/core/src/market/catalog.ts
        section: "search"
        description: 官方资源轻量推荐检索
      - file: packages/core/src/api/handlers/plugin.ts
        section: "handler 风格"
        description: WS 命令写法
    outputs:
      - file: packages/core/src/api/handlers/onboarding.ts
        type: typescript-module
        exports:
          - name: registerOnboardingHandlers
            signature: "export function registerOnboardingHandlers(register: HandlerRegistrar): void"
        description: "onboarding_apply{interests:string[], note?} → 生成 1-2 个初始 Agent(兴趣映射角色,复用 create_agent 逻辑:AgentPaths 写文件+Creator 生成+registry 注册)+ 返回 createdAgents + marketRecommendations(官方/认证 tier 资源 ≤2 条,含 id/name/description/tier,不自动安装)+ onboarding_done 标记(写 data/onboarding.json);onboarding_get{}(读标记与已生成列表)"
    verification:
      - export_matches: "registerOnboardingHandlers"
      - test_passes: "cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit"
    notes: |
      1. 不动 ws-server.ts(主线程注册)。
      2. 幂等:onboarding_done 已存在时 onboarding_apply 返回 already_done 不重复创建。
      3. 失败不阻塞:Creator 生成失败走模板 fallback(同 create_agent);无 Provider 时返回错误文案。
      4. 生成 Agent 数量 1-2 个,不得批量。

  - id: task-butler-receipt-frontend
    description: "阶段A 前端:butler_task_updated handler + butlerTasks store 复活 + ChatInputActions 结构化派发"
    depends_on: []
    inputs:
      - file: gui-v2/src/hooks/ws-handlers/todo-handlers.ts
        section: "handler 模式"
        description: 追加 butler_task_updated
      - file: gui-v2/src/stores/butlerTasks.ts
        section: "全文件"
        description: 复活(现在零消费者)
      - file: gui-v2/src/components/chat/ChatInputActions.tsx
        section: "全文件"
        description: 派发菜单结构化
      - file: gui-v2/src/components/todo/GlobalTodoPanel.tsx
        section: "结构"
        description: 管家任务摘要展示位(设计:顶部加但lerTasks 状态小计)
      - file: gui-v2/src/components/chat/MessageBubble.tsx
        section: "taskReceipt 渲染条件"
        description: 回执卡片点亮
    outputs:
      - file: gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts
        type: typescript-module
        exports:
          - name: buildButlerTaskHandlers
            signature: "export function buildButlerTaskHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler>"
        description: "butler_task_updated:更新但lerTasks store(按但lerTaskId 合并/upsert)+ emitActivity;若 payload 含关联消息上下文则派发 ws-butler-task-receipt 事件"
      - file: gui-v2/src/components/todo/GlobalTodoPanel.tsx
        type: react-component
        description: "顶部增加「管家任务」小计区(运行中/等待你 计数,来自但lerTasks store),空数据不渲染"
      - file: gui-v2/src/components/chat/ChatInputActions.tsx
        type: react-component
        description: "「派发」菜单选择 Agent/Group 后直接发 dispatch_task{agentId|groupId,targetType,title,goal}(title=菜单项或当前输入文本,goal=输入文本);发送后插入本地提示消息「已派发给 X」;需先读后端 dispatch_task payload 契约(agent.ts:495,扩展 targetType)"
      - file: gui-v2/src/components/chat/ChatView.tsx
        type: react-component
        description: "任务回执卡片点亮:监听 ws-butler-task-receipt 或 store 变化,把回执附加为系统消息(metadata.taskReceipt),复用 TaskReceiptCard"
    verification:
      - export_matches: "buildButlerTaskHandlers"
      - test_passes: "cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit"
      - test_passes: "cd D:/agent-codes/CoBeing/gui-v2 && pnpm build"
    notes: |
      1. 不动 useWebSocket.ts 的主 handler 合并区?需要——buildButlerTaskHandlers 并入主表,允许修改 useWebSocket.ts(与 T5 不冲突,T5 不动该文件)。
      2. 事件契约:但ler_task_updated payload {butlerTaskId, globalTodoId?, title, targetType, targetId, assigneeName, status, summary?, nextAction?, timestamp}。
      3. dispatch_task 请求契约:{agentId|groupId, targetType?("agent"|"group",默认 agent), title, goal, acceptance?, constraints?} → 响应 dispatch_task_result{ok, agentId, globalTodoId, butlerTaskId, executionRef}。
      4. 回执卡片渲染:收到事件后,在 chat store 追加一条方向 out 的 system 消息(metadata.taskReceipt=结构化 receipt),TaskReceiptCard 自动渲染。

  - id: task-onboarding-persona-frontend
    description: "阶段B+C 前端:首启 OnboardingOverlay 问卷 + 欢迎消息 + ChatHeader 空态修复 + ButlerConfigPanel 管家形象区"
    depends_on: []
    inputs:
      - file: gui-v2/src/App.tsx
        section: "TutorialController(11-25)"
        description: onboarding 控制器仿照
      - file: gui-v2/src/components/tutorial/TutorialOverlay.tsx
        section: "全文件"
        description: 浮层模式参考
      - file: gui-v2/src/components/chat/ChatHeader.tsx
        section: "副标题 undefined 渲染"
        description: 空态修复
      - file: gui-v2/src/components/settings/ButlerConfigPanel.tsx
        section: "全文件"
        description: 增加管家形象区
      - file: gui-v2/src/stores/userProfile.ts
        section: "store 模式"
        description: 持久化模式参考
    outputs:
      - file: gui-v2/src/components/onboarding/OnboardingOverlay.tsx
        type: react-component
        exports:
          - name: OnboardingOverlay
            signature: "export function OnboardingOverlay(): JSX.Element | null"
        description: "首启检测(localStorage cobeing_onboarding_done)+ 兴趣问卷(生活/学习/旅行/购物/创作/家庭事务/工作杂事 多选 chips + 可选自定义输入)+ 提交按钮 → 发 onboarding_apply → 展示结果(创建的 Agent 列表 + Market 推荐卡片,推荐卡带「安装/跳过」);可跳过"
      - file: gui-v2/src/App.tsx
        type: react-component
        description: "OnboardingController(仿 TutorialController):首启且教程已看过/跳过时显示问卷"
      - file: gui-v2/src/components/chat/ChatHeader.tsx
        type: react-component
        description: "副标题 undefined 修复:provider/model/status 未加载时显示「连接中…」而非 undefined 串"
      - file: gui-v2/src/components/settings/ButlerConfigPanel.tsx
        type: react-component
        description: "管家形象区:称呼输入 + 欢迎语输入 + 模板选择(亲密朋友/专业秘书/学习陪伴/家庭助理,发 butler_get_personas/butler_set_persona)+ 保存(butler_update_style{nickname,greeting,apply:true})"
      - file: gui-v2/src/stores/onboarding.ts
        type: typescript-module
        exports:
          - name: useOnboardingStore
            signature: "export const useOnboardingStore: ...(问卷状态/结果/推荐)"
    verification:
      - export_matches: "OnboardingOverlay"
      - test_passes: "cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit"
      - test_passes: "cd D:/agent-codes/CoBeing/gui-v2 && pnpm build"
    notes: |
      1. 不动 useWebSocket.ts(主线程统一接线 onboarding 消息);OnboardingOverlay 用 getWsClient().send + window CustomEvent 或 zustand。
      2. WS 契约:发 onboarding_apply{interests:string[], note?} → 收 onboarding_result{status:"done"|"already_done"|"error", createdAgents:[{id,name,role}], marketRecommendations:[{id,name,description,tier}]};发 butler_get_personas{} → 收 butler_personas{personas:[{id,name}], current};发 butler_set_persona{persona} → 收 butler_persona_set{ok,persona};发 butler_update_style{nickname?,greeting?,apply} → 收 butler_style_updated{ok}。
      3. 首启欢迎消息:OnboardingOverlay 关闭后向聊天区注入一条管家欢迎消息(chat store addMessage),文案含引导性问题。
      4. UI 遵循 frontend-design 三份规则文件(必读 CoBeing/.claude/skills/frontend-design/)。
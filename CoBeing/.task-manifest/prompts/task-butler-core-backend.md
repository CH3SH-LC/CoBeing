# 子任务:task-butler-core-backend(阶段 C 地基 + A/D prompt 规则)

## 任务描述
让管家拥有自己的文件体系与人格模板:ensureButlerDir 首次启动创建 data/coreagents/butler/ 全套文件;管家从固定 prompt 改为文件 prompt 路径(AGENTS/CHARACTER/JOB/EXPERIENCE/MEMORY 生效);templates/butler/ 4 个人格模板(亲密朋友/专业秘书/学习陪伴/家庭助理,内含分级转接规则与 Market 推荐纪律);butler_get_personas / butler_set_persona / butler_update_style 三个 WS 命令。

## 关键契约(读 .task-manifest/task-contract-butler.md 中你的条目)
- 输出文件清单与验证命令见合约。
- **不动 ws-server.ts**(主线程统一注册 handler)、不动 dispatch 域文件(T2 范围)、不动前端。

## 实现要点
1. **ensureButlerDir**(类比 ensureHostDir):首次启动创建 data/coreagents/butler/{config.json, AGENTS.md, CHARACTER.md, JOB.md, MEMORY.md, EXPERIENCE.md};config.json 含 provider/model(默认 DEFAULT_PROVIDER/DEFAULT_MODEL)/permissions/tools(保留现有 butler 工具面,从 butler.ts 构造默认工具列表提炼)/skills。必须**在 createButler 之前**执行(start 顺序调整)。已存在文件不覆盖(用户改过的人格保留)。
2. **管家走文件 prompt**:当前 butler.ts 直接 new ConversationLoop 传 systemPrompt(固定 prompt),导致 files 五/三层架构不生效、EXPERIENCE.md/memory 不进 prompt。改造方案自选,但必须:a) 人格文件(CHARACTER.md 等)真实进入 prompt;b) 工具注册/多步推理不退化;c) 提供回归验证方案(对话基线 + 工具调用基线)。读 agent.ts createLoop(400-440)/conversation-loop.ts prompt 组装/prompt-builder.ts 后设计。若判断改动过大,允许「最小方案」:保留固定 prompt 作为底座,把 templates/butler/base 内容作为 systemPrompt 的可选注入层——但模板切换必须真实改变管家言行。
3. **JOB.md 内容**(每个 persona 模板,中文真实内容):
   - 管家身份/职责边界(对话、管理 Agent、管理群组)
   - **分级转接规则**:寒暄/简单问答/短文本润色自己答;多步研究/长文创作/代码修改/需要长期跟踪/需要成员协作的任务默认派发(butler-dispatch-to-agent/group);不确定时先问用户。
   - **Market 推荐纪律**:官方内置/认证且明显优于本地创建才轻量提示(每会话 ≤1 次);社区资源必须走确认流程(confirmed:true);本地已有等价能力时闭嘴。
   - 多步推理标准流程(保留现有 list→判断→create→run 逻辑)
4. **butler-persona.ts 命令**:
   - butler_get_personas → butler_personas{personas:[{id,name}], current}
   - butler_set_persona{persona} → 校验 persona 存在于 templates/butler/personas/ → 复制 CHARACTER.md/JOB.md 到 data/coreagents/butler/(config.json 不动)→ butler_persona_set{ok,persona};非法 persona → error
   - butler_update_style{nickname?, greeting?, tone?, apply:boolean} → apply=true 时写入管家 CHARACTER.md(追加「用户偏好」段)/config.json;返回 butler_style_updated{ok}
5. **测试**(runtime.test.ts 或独立文件):ensureButlerDir 首次启动创建文件;重复启动不覆盖;persona 切换复制;style 更新写入。用临时 dataRoot。

## 验证
- cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit
- cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/runtime.test.ts
- cd D:/agent-codes/CoBeing && pnpm build

## 工作协议
遵循「myworkflow:subagent-protocol」,task-id=task-butler-core-backend。声明/自检/完成报告写 .task-manifest/outputs/task-butler-core-backend/。
只创建/修改合约列出的文件(runtime.ts 允许改,但注意与 T2/T3 无交集;若改 conversation-loop.ts/agent.ts/prompt-builder.ts 需在完成报告说明理由)。

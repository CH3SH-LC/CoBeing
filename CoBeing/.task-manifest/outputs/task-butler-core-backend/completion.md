# 完成报告 — task-butler-core-backend

**状态**: DONE_WITH_CONCERNS

## 产出文件清单

### 新建（合约 outputs 全覆盖）
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/亲密朋友/CHARACTER.md] — 亲密朋友人设（朋友口吻、情绪自然、口语化）
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/亲密朋友/JOB.md] — 职责边界 + 分级转接规则 + Market 推荐纪律 + 多步推理标准流程 + 建群规则 + 主动建议
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/专业秘书/CHARACTER.md] — 专业秘书人设
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/专业秘书/JOB.md] — 同上核心 + 秘书服务方式
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/学习陪伴/CHARACTER.md] — 学习陪伴人设
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/学习陪伴/JOB.md] — 同上核心 + 陪伴方式
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/家庭助理/CHARACTER.md] — 家庭助理人设
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/personas/家庭助理/JOB.md] — 同上核心 + 操持方式
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/base/AGENTS.md] — 管家运行边界与红线（不替用户决策/不擅自装资源/不静默失败/不编造结果）
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/base/MEMORY.md] — 记忆入口模板
- [D:/agent-codes/CoBeing/packages/core/src/templates/butler/base/EXPERIENCE.md] — 经验沉淀模板（含 EXPERIENCE_SUMMARY 标记，与 maintainExperienceSummarySync 兼容）
- [D:/agent-codes/CoBeing/packages/core/src/api/handlers/butler-persona.ts] — 三个 WS 命令：butler_get_personas / butler_set_persona / butler_update_style
- [D:/agent-codes/CoBeing/packages/core/src/runtime.test.ts] — 9 个测试（ensureButlerDir 创建/不覆盖/createCoreAgents 顺序/文件 prompt 捕获/人格查询切换/风格更新）

### 修改
- [D:/agent-codes/CoBeing/packages/core/src/runtime.ts] — ensureButlerDir()（类比 ensureHostDir，在 createCoreAgents 中先于 createButler 执行）；reloadButlerSelfConfig()（构造函数与 createCoreAgents 共用）；createButler 默认 systemPrompt 缩短为 BUTLER_DEFAULT_SYSTEM_PROMPT、tools 引用 BUTLER_DEFAULT_TOOLS
- [D:/agent-codes/CoBeing/packages/core/src/agent/butler.ts] — 导出 BUTLER_DEFAULT_TOOLS / BUTLER_DEFAULT_SYSTEM_PROMPT；ConversationLoop 增加 promptBuilder（buildButlerPrompt，三层架构同构于 Agent.createLoop）

## 自检结果
- [x] 文件存在性 — 11 个模板 + 2 个新 ts 文件 + runtime.test.ts 全部存在非空
- [x] 接口签名匹配 — registerButlerPersonaHandlers 签名与合约一致；3 个 WS 命令响应格式经测试逐条断言
- [x] 功能完整性 — 9/9 测试覆盖合约全部功能点
- [x] 接口自洽 — tsc --noEmit 通过；导出均有引用；模板路径被 ensureButlerDir / handler 引用
- [x] 错误处理 — 非法 persona/路径穿越/非法字段类型/apply=false/模板缺失/配置损坏均有降级
- 全部通过: 是

## 验证命令结果
| 命令 | 结果 |
|------|------|
| cd packages/core && pnpm exec tsc --noEmit | EXIT 0 |
| cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/runtime.test.ts | 9/9 通过 |
| cd D:/agent-codes/CoBeing && pnpm build | EXIT 0 |
| 回归补充：vitest run packages/core（全量） | 54 文件 / 520 测试全部通过 |
| 回归补充：butler.test.ts + prompt-builder.test.ts | 29/29 通过 |

## 「固定 prompt → 文件 prompt」改造说明

**改造点**：ButlerAgent 构造函数原用固定 systemPrompt 创建 ConversationLoop（files 五层架构不生效）。现改为 promptBuilder（buildButlerPrompt），复用 Agent.createLoop 同款三层架构：
1. 共享前缀：buildStaticLayer() + AGENTS.md（base/AGENTS.md 管家边界与红线）
2. 人格前缀：CHARACTER.md + ROLE_PLAY_INSTRUCTION + systemPrompt（短底座）+ JOB.md（分级转接/Market 纪律/多步推理）
3. 易失层：EXPERIENCE.md 概要 + MEMORY.md 索引（无 memoryStore 时读文件，与 Agent 一致）+ 插件 Prompt 层

**关键保证**：
- 工具注册零改动：butler-* 工具仍全部无条件注册，tools 白名单原样提炼为 BUTLER_DEFAULT_TOOLS
- 多步推理不退化：原固定 prompt 的「多步推理标准流程（list→判断→create→run）」+「建群规则」+「主动建议」整体迁移进每个 persona 的 JOB.md，首启 ensureButlerDir 即种子写入
- 实时生效：promptBuilder 每次 run() 重读文件 → butler_set_persona / butler_update_style 无需重建 loop 即生效
- 现有部署兼容：实测 data/coreagents/butler 无 config.json/CHARACTER/JOB — ensureButlerDir 补建，EXPERIENCE.md（真实经验）保留不覆盖；已有但lerSelfConfig.systemPrompt 的用户配置仍优先

**回归验证方案**（已固化进 runtime.test.ts 测试 4）：
1. 对话基线：mock provider 捕获实际发给 LLM 的 system prompt，断言包含 CHARACTER（亲密朋友）/JOB（分级转接/Market 纪律）/AGENTS（管家运行边界）→ 文件 prompt 真实生效
2. 工具调用基线：捕获同一调用的 tools 数组，断言 butler-list / butler-create-agent / butler-create-group / butler-run-group / butler-dispatch-to-agent / butler-get-work-status / group-send / bash 全部下发 → 工具注册与多步推理输入不退化
3. 建议上线前手工基线：启动 dev，与管家对话确认「帮我写篇长文」触发派发而非自行创作；切换人格后言行变化；GUI 设置页保存称呼后重启仍生效

## 已知担忧 (DONE_WITH_CONCERNS)
- 担忧 1 — **ws-server.ts 接线未做**：合约禁止触碰 ws-server.ts，主线程（主智能体）须在 registerHandlers() 中追加 `registerButlerPersonaHandlers((t, h) => this.registerCommand(t, h))`，否则三个命令在生产 WS 不可达。影响：命令只能被单测覆盖，集成验证依赖主线程。
- 担忧 2 — **current 人格检测的语义**：合约要求 butler_set_persona 不动 config.json，故 current 采用「CHARACTER.md + JOB.md 与模板完全一致」的内容匹配。butler_update_style 追加「用户偏好」段后 current 变 null（诚实反映"已自定义"，前端显示无选中）。若希望切换后即使改风格仍能识别，需放宽为「忽略尾部用户偏好段匹配」或写入标记文件——超出当前合约，留给主线程决策。
- 担忧 3 — **现有固定 prompt 语义迁移的边界**：默认系统提示从长篇固定文案改为短底座 + JOB.md 文件。对已有 install，行为等价（JOB.md 承载全部规则）；对已手工在 config.json 配了 systemPrompt 的用户，其配置仍优先（文件 prompt 叠加其上），若其旧 prompt 与文件规则冲突，以文件为准。影响：个别深度定制用户可能需要调整。

## 缺失信息 (NEEDS_CONTEXT 时填写)
- 无

## 阻塞原因 (BLOCKED 时填写)
- 无

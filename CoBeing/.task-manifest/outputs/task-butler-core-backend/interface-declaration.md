# 接口声明 — task-butler-core-backend
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-03T16:26:16Z

## 我将创建/修改的文件
- [x] packages/core/src/templates/butler/personas/亲密朋友/CHARACTER.md — 管家模板-亲密朋友人设
- [x] packages/core/src/templates/butler/personas/亲密朋友/JOB.md — 职责+分级转接规则+Market 推荐纪律+多步推理标准流程
- [x] packages/core/src/templates/butler/personas/专业秘书/CHARACTER.md — 管家模板-专业秘书人设
- [x] packages/core/src/templates/butler/personas/专业秘书/JOB.md — 职责+分级转接规则+Market 推荐纪律+多步推理标准流程
- [x] packages/core/src/templates/butler/personas/学习陪伴/CHARACTER.md — 管家模板-学习陪伴人设
- [x] packages/core/src/templates/butler/personas/学习陪伴/JOB.md — 职责+分级转接规则+Market 推荐纪律+多步推理标准流程
- [x] packages/core/src/templates/butler/personas/家庭助理/CHARACTER.md — 管家模板-家庭助理人设
- [x] packages/core/src/templates/butler/personas/家庭助理/JOB.md — 职责+分级转接规则+Market 推荐纪律+多步推理标准流程
- [x] packages/core/src/templates/butler/base/AGENTS.md — 管家运行边界与红线
- [x] packages/core/src/templates/butler/base/MEMORY.md — 管家记忆入口模板
- [x] packages/core/src/templates/butler/base/EXPERIENCE.md — 管家经验沉淀模板
- [x] packages/core/src/api/handlers/butler-persona.ts — 新 WS 命令模块（butler_get_personas / butler_set_persona / butler_update_style）
- [x] packages/core/src/runtime.test.ts — 新测试文件（ensureButlerDir / persona 切换 / style 更新，合约验证命令目标）
- [x] packages/core/src/runtime.ts — ensureButlerDir（start 顺序调整：createCoreAgents 中先于 createButler 执行）+ reloadButlerSelfConfig + createButler 默认 prompt 缩短为文件 prompt 底座
- [x] packages/core/src/agent/butler.ts — 导出 BUTLER_DEFAULT_TOOLS / BUTLER_DEFAULT_SYSTEM_PROMPT（供 ensureButlerDir 写 config.json 白名单与 runtime 共用）；管家 ConversationLoop 改为 promptBuilder 文件 prompt（AGENTS/CHARACTER/JOB/EXPERIENCE/MEMORY 进入 prompt）

## 我将暴露的接口
| 名称 | 签名 | 所在文件 |
|------|------|----------|
| registerButlerPersonaHandlers | `export function registerButlerPersonaHandlers(register: HandlerRegistrar): void` | packages/core/src/api/handlers/butler-persona.ts |
| BUTLER_DEFAULT_TOOLS | `export const BUTLER_DEFAULT_TOOLS: string[]`（现有管家工具白名单原样提炼） | packages/core/src/agent/butler.ts |
| BUTLER_DEFAULT_SYSTEM_PROMPT | `export const BUTLER_DEFAULT_SYSTEM_PROMPT: string`（短底座，人格指向文件） | packages/core/src/agent/butler.ts |
| CoBeingRuntime.ensureButlerDir | `private ensureButlerDir(): void`（首次启动创建 data/coreagents/butler 全套文件，已存在不覆盖） | packages/core/src/runtime.ts |
| CoBeingRuntime.reloadButlerSelfConfig | `private reloadButlerSelfConfig(): void`（重读管家 config.json） | packages/core/src/runtime.ts |

### WS 命令契约（butler-persona.ts）
| 命令 | 请求 payload | 响应 |
|------|-------------|------|
| butler_get_personas | `{}` | `butler_personas{personas:[{id,name}], current}`；current 为内容匹配检测（null 表示自定义人格） |
| butler_set_persona | `{persona}` | 合法 → `butler_persona_set{ok:true, persona}`；非法 → `error`（persona 必须在 templates/butler/personas/ 下，复制 CHARACTER.md/JOB.md 到 data/coreagents/butler/，config.json 不动） |
| butler_update_style | `{nickname?, greeting?, tone?, apply}` | apply=true → 写入 CHARACTER.md「用户偏好」段 + config.json name（nickname）→ `butler_style_updated{ok:true, applied:true}`；apply≠true → 不写入，`butler_style_updated{ok:true, applied:false}` |

## 我需要的外部输入
| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/core/src/runtime.ts | createButler / ensureHostDir / start 顺序 / _butlerSelfConfig | 添加 ensureButlerDir 并调整 createCoreAgents 顺序 |
| packages/core/src/agent/butler.ts | 构造函数与 ConversationLoop 创建 | 固定 prompt → 文件 prompt（promptBuilder） |
| packages/core/src/agent/agent.ts | createLoop / promptBuilder 逻辑（402-445） | 复用三层 promptBuilder 模式（不修改该文件） |
| packages/core/src/conversation/conversation-loop.ts | promptBuilder 优先于 buildSystemPrompt（192-201） | 确认 promptBuilder 机制 |
| packages/core/src/conversation/prompt-builder.ts | buildCacheablePrompt / buildStaticLayer | 管家文件 prompt 组装 |
| packages/core/src/api/handlers/plugin.ts | handler 风格（register + this.dataRoot + sendToClient） | butler-persona.ts 写法参考 |
| packages/core/src/api/handlers/types.ts | HandlerRegistrar / WsCommandHandler | 签名 |
| packages/core/src/agent/paths.ts | AgentPaths.forAgent / AgentFiles | butler 目录与文件访问 |
| packages/core/src/config/schema.ts | AgentSelfConfig | config.json 结构 |
| packages/core/src/runtime-globals.test.ts | runtime 构造 + loadConfig + tmpDir 模式 | runtime.test.ts 测试脚手架 |

## 风险和假设
- 假设 1: vitest / dev 运行时 CWD 为项目根（D:/agent-codes/CoBeing），模板路径 `packages/core/src/templates/butler` 可解析；另加 `src/templates/butler` 兜底（CWD=packages/core 时）。
- 假设 2: ws-server.ts 由主线程（主智能体）统一接线 `registerButlerPersonaHandlers`，本任务不触碰 ws-server.ts（合约禁止）。若主线程未接线，三个命令在生产 WS 上不可达——完成报告中注明集成要求。
- 假设 3: 管家走文件 prompt 后，默认人格（亲密朋友）的 JOB.md 承担原固定 systemPrompt 的多步推理/建群规则/主动建议内容，确保多步推理不退化。
- 风险 1: 现有部署 data/coreagents/butler/ 无 config.json/CHARACTER.md/JOB.md（实测目录只有 registry/记忆类文件）——ensureButlerDir 补建，EXPERIENCE.md 已存在则保留不覆盖。
- 风险 2: butler_set_persona 不动 config.json（合约约束）→ current 人格检测依赖 CHARACTER.md/JOB.md 与模板的内容完全匹配；butler_update_style 追加「用户偏好」段后 current 变 null（诚实反映"已自定义"）。
- 风险 3: Agent 构造函数会从 CHARACTER.md 的 `**姓名**:` 行覆盖 agent.name → 管家 persona 模板**刻意不写** `**姓名**:` 字段，避免人格切换改变管家显示名、与 update_style 的 nickname 冲突。

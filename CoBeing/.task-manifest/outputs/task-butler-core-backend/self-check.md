# 自检报告 — task-butler-core-backend
> 自检时间: 2026-08-04T00:34:00Z

## 文件存在性
- [x] packages/core/src/templates/butler/base/AGENTS.md — 存在且非空（管家运行边界与红线）
- [x] packages/core/src/templates/butler/base/MEMORY.md — 存在且非空（记忆入口模板）
- [x] packages/core/src/templates/butler/base/EXPERIENCE.md — 存在且非空（经验模板，含 EXPERIENCE_SUMMARY 标记）
- [x] packages/core/src/templates/butler/personas/亲密朋友/{CHARACTER.md, JOB.md} — 存在且非空
- [x] packages/core/src/templates/butler/personas/专业秘书/{CHARACTER.md, JOB.md} — 存在且非空
- [x] packages/core/src/templates/butler/personas/学习陪伴/{CHARACTER.md, JOB.md} — 存在且非空
- [x] packages/core/src/templates/butler/personas/家庭助理/{CHARACTER.md, JOB.md} — 存在且非空
- [x] packages/core/src/api/handlers/butler-persona.ts — 存在且非空
- [x] packages/core/src/runtime.test.ts — 存在且非空（9 个测试）
- [x] packages/core/src/runtime.ts — 修改完成（ensureButlerDir/reloadButlerSelfConfig/createCoreAgents/createButler）
- [x] packages/core/src/agent/butler.ts — 修改完成（BUTLER_DEFAULT_TOOLS/BUTLER_DEFAULT_SYSTEM_PROMPT/promptBuilder）

## 接口签名匹配（与 interface-declaration.md 对比）
- [x] registerButlerPersonaHandlers: `export function registerButlerPersonaHandlers(register: HandlerRegistrar): void` — 实际签名一致
- [x] BUTLER_DEFAULT_TOOLS: `export const BUTLER_DEFAULT_TOOLS: string[]` — 一致
- [x] BUTLER_DEFAULT_SYSTEM_PROMPT: `export const BUTLER_DEFAULT_SYSTEM_PROMPT: string` — 一致
- [x] CoBeingRuntime.ensureButlerDir / reloadButlerSelfConfig — 私有方法存在
- [x] WS 命令契约：butler_get_personas → butler_personas；butler_set_persona → butler_persona_set/error；butler_update_style → butler_style_updated/error — 与声明一致（测试逐条断言）

## 功能完整性
- [x] ensureButlerDir 首次启动创建 config.json + AGENTS/CHARACTER/JOB/MEMORY/EXPERIENCE（测试 1）
- [x] config.json 含 provider=DEFAULT_PROVIDER/model/tools 白名单（butler-list/butler-create-agent/group-send 等）（测试 1）
- [x] JOB.md 含分级转接规则 + Market 推荐纪律（confirmed:true）+ 多步推理标准流程 + butler-dispatch-to-agent/group（测试 1）
- [x] 重复启动不覆盖用户修改（测试 2）
- [x] createCoreAgents 顺序：ensureButlerDir 先于 createButler（测试 3）
- [x] 管家走文件 prompt：system prompt 包含 CHARACTER（亲密朋友）/JOB（分级转接/Market 纪律）/AGENTS（管家运行边界），工具面完整（butler-list/create-agent/create-group/run-group/dispatch-to-agent/get-work-status/group-send/bash）（测试 4）
- [x] butler_get_personas 列出 4 人格 + current 检测（测试 5、6）
- [x] butler_set_persona 复制模板、config.json 不动、current 跟随（测试 6）；非法 persona / 路径穿越 → error（测试 7）
- [x] butler_update_style apply=true 写入 CHARACTER.md「用户偏好」段 + config.json name，重复更新替换不追加（测试 8）；apply=false 不写入、非法字段 → error（测试 9）

## 接口自洽
- [x] 所有导出的函数/类型在模块内有定义（tsc --noEmit 通过）
- [x] import/require 验证：BUTLER_DEFAULT_TOOLS/SYSTEM_PROMPT 被 runtime.ts 3 处引用；registerButlerPersonaHandlers 被 runtime.test.ts 引用（生产接线由主线程 ws-server.ts 负责，合约禁止本任务触碰）
- [x] 没有孤立导出：buildButlerPrompt 仅 ButlerAgent 内部使用；template 文件被 ensureButlerDir 与 butler-persona.ts 引用
- [x] 模板文件路径验证：4 个 personas 目录 + base 3 文件均在 packages/core/src/templates/butler/ 下

## 错误处理
- [x] butler_set_persona 非法/不存在 persona → error 响应
- [x] 路径穿越防御：persona 必须解析在 personas/ 直接子目录内（startsWith + sep 校验）
- [x] butler_update_style 非法字段类型 → error；apply≠true → 只校验不写入
- [x] 模板根不可解析（CWD 异常）→ 返回 error / 跳过 seed 并 warn，不崩溃
- [x] config.json 损坏 → 重建默认（try/catch）
- [x] 创建/复制文件失败 → error 响应

## 验证命令结果
- [x] cd packages/core && pnpm exec tsc --noEmit → EXIT 0
- [x] cd D:/agent-codes/CoBeing && pnpm exec vitest run packages/core/src/runtime.test.ts → 9/9 通过
- [x] cd D:/agent-codes/CoBeing && pnpm build → EXIT 0
- [x] 回归补充：vitest run packages/core（全量 54 文件 520 测试）→ 全部通过；butler.test.ts + prompt-builder.test.ts → 29/29 通过
